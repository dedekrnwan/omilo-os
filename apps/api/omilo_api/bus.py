"""Redis: what several Omilo processes share.

- live events: office changes and notices are announced on a channel per company, so every API process can push them
  to its WebSockets right away (the database stays the record; the message only says "something changed")
- locks: only one worker process hands out a company's jobs and workflow runs at a time
- shared counters with expiry: the Claude Code pool's leases, connector health, rate limits
- the knowledge-base queue: sources waiting to be embedded, and marks for things to (re)index

Keys are "<prefix>:<company>:<name>" (prefix OMILO_REDIS_PREFIX, default "omilo").

Light tier: there is only one process and no Redis. Every function below dispatches on
`get_settings().tier`: in the light tier it uses an in-process `_LocalBus` (dicts + locks +
asyncio.Queue fan-out) that reuses the exact same namespaced string keys; in the full tier it
runs the unchanged Redis code path. `import redis` is lazy so the light tier never needs the
package installed.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

from . import company as C
from .config import get_settings

log = logging.getLogger("omilo.bus")
_client = None  # redis.Redis | None
_aclient = None  # aredis.Redis | None
_lock = threading.Lock()


def _light() -> bool:
    return get_settings().tier == "light"


def r():  # -> redis.Redis
    global _client
    if _client is None:
        import redis
        with _lock:
            if _client is None:
                _client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True, socket_timeout=10,
                                               socket_connect_timeout=5, health_check_interval=30)
    return _client


def ar():  # -> aredis.Redis
    global _aclient
    if _aclient is None:
        import redis.asyncio as aredis
        _aclient = aredis.Redis.from_url(get_settings().redis_url, decode_responses=True, socket_connect_timeout=5)
    return _aclient


def _rerr():
    """The RedisError class, imported lazily (full tier only reaches the except blocks)."""
    import redis
    return redis.RedisError


def reset() -> None:
    """Tests: forget the clients (a new URL or event loop) and the in-process bus state."""
    global _client, _aclient
    _client, _aclient = None, None
    _LOCAL.reset()


def check() -> None:
    if _light():
        return  # one process, no Redis: nothing to reach
    try:
        r().ping()
    except _rerr() as e:
        raise RuntimeError(f"Can't reach Redis at {get_settings().redis_url} ({e}). Start it with `make db` "
                           "(Postgres + Redis in Docker) or set OMILO_REDIS_URL.") from e


def key(name: str, cid: str | None = None) -> str:
    return f"{get_settings().redis_prefix}:{cid or C.current()}:{name}"


def gkey(name: str) -> str:
    """A key shared by every company (e.g. the embedding queue)."""
    return f"{get_settings().redis_prefix}:_:{name}"


# ------------------------------------------------------------------ in-process backend (light tier)
class _LocalBus:
    """Single-process stand-in for Redis. One module-level instance guarded by an RLock.

    - `kv`: {key: (value, expiry_monotonic|None)} backs get_json/set_json/throttle/claim.
    - `sets`: {key: set[str]} backs the pending/marks queues.
    - `locks`: {key: threading.Lock} backs lock() (a real lock => exact exclusion in one process).
    - `subs`: {token: (channels, queue, loop)} backs publish fan-out to the WebSocket layer;
      `loop` is the consumer's event loop so a worker-thread publish can wake it thread-safely.
    """

    def __init__(self) -> None:
        self._guard = threading.RLock()
        self.kv: dict[str, tuple[object, float | None]] = {}
        self.sets: dict[str, set[str]] = {}
        self.locks: dict[str, threading.Lock] = {}
        self.subs: dict[int, tuple[set[str], object, object]] = {}

    def reset(self) -> None:
        with self._guard:
            self.kv.clear()
            self.sets.clear()
            self.locks.clear()
            self.subs.clear()

    # -- small shared values (with ttl) --
    def _live(self, k: str):
        """Return (present, value); drop the entry if its ttl has passed."""
        item = self.kv.get(k)
        if item is None:
            return False, None
        value, expiry = item
        if expiry is not None and time.monotonic() >= expiry:
            self.kv.pop(k, None)
            return False, None
        return True, value

    def get_json(self, k: str):
        with self._guard:
            present, value = self._live(k)
            return value if present else None

    def set_json(self, k: str, value, ttl_s: float | None) -> None:
        with self._guard:
            # round-trip through json so callers see the same shape as the Redis path
            value = json.loads(json.dumps(value, default=str))
            self.kv[k] = (value, (time.monotonic() + ttl_s) if ttl_s else None)

    def set_nx(self, k: str, ttl_s: float | None) -> bool:
        """True if k was absent/expired (then set with ttl); False otherwise. Backs claim/throttle."""
        with self._guard:
            present, _ = self._live(k)
            if present:
                return False
            self.kv[k] = ("1", (time.monotonic() + ttl_s) if ttl_s else None)
            return True

    def delete(self, k: str) -> None:
        with self._guard:
            self.kv.pop(k, None)

    def drop(self, k: str) -> None:
        """Delete whatever (kv value or set) lives at this key — the generic delete."""
        with self._guard:
            self.kv.pop(k, None)
            self.sets.pop(k, None)

    # -- locks --
    @contextmanager
    def lock(self, k: str, wait_s: float) -> Iterator[bool]:
        with self._guard:
            lk = self.locks.get(k)
            if lk is None:
                lk = self.locks[k] = threading.Lock()
        got = lk.acquire(timeout=wait_s if wait_s > 0 else 0)
        try:
            yield got
        finally:
            if got:
                lk.release()

    # -- sets (pending / marks queues) --
    def sadd(self, k: str, *members: str) -> None:
        if not members:
            return
        with self._guard:
            self.sets.setdefault(k, set()).update(members)

    def spop(self, k: str, n: int) -> list[str]:
        with self._guard:
            s = self.sets.get(k)
            if not s:
                return []
            out = [s.pop() for _ in range(min(n, len(s)))]
            if not s:
                self.sets.pop(k, None)
            return out

    # -- live events / subscriptions --
    def subscribe(self, channels, queue, loop=None) -> int:
        """Register an asyncio.Queue subscriber. `loop` is the consumer's running event loop,
        captured at subscribe time so publish (which may run on a worker thread or a sync DB
        commit) can wake the queue safely via loop.call_soon_threadsafe."""
        token = id(queue)
        with self._guard:
            self.subs[token] = (set(channels), queue, loop)
        return token

    def unsubscribe(self, token: int) -> None:
        with self._guard:
            self.subs.pop(token, None)

    def publish(self, chan_key: str, data: dict) -> None:
        """Enqueue {channel, data} to every subscriber listening on chan_key. Never raises.

        publish may run on a worker thread (the KB loop) or a sync DB-commit event while the
        queue is consumed on the asyncio event loop. We hand the item across that boundary with
        loop.call_soon_threadsafe(queue.put_nowait, msg) when we captured the consumer's loop,
        falling back to a direct put_nowait otherwise. A full/closed queue is tolerated (dropped)
        — a missed wake-up is caught by the WS's periodic DB re-read."""
        with self._guard:
            targets = [(q, loop) for chans, q, loop in self.subs.values() if chan_key in chans]
        msg = {"channel": chan_key, "data": data}
        for q, loop in targets:
            try:
                if loop is not None and not loop.is_closed():
                    loop.call_soon_threadsafe(_safe_put, q, msg)
                else:
                    q.put_nowait(msg)
            except Exception:  # full queue or closed loop: a missed wake-up is caught by the next poll
                pass


def _safe_put(queue, msg) -> None:
    """put_nowait on the consumer's loop thread; drop on a full queue (missed wakes are re-read)."""
    try:
        queue.put_nowait(msg)
    except Exception:
        pass


_LOCAL = _LocalBus()


# ------------------------------------------------------------------ live events
def publish(channel: str, data: dict | None = None, cid: str | None = None) -> None:
    chan_key = key(f"ch:{channel}", cid)
    if _light():
        _LOCAL.publish(chan_key, data or {})
        return
    try:
        r().publish(chan_key, json.dumps(data or {}, default=str))
    except _rerr() as e:  # a missed wake-up is caught by the next poll; never fail the request for it
        log.warning("publish %s failed: %s", channel, e)


def subscribe(cid: str, channels):  # -> asyncio.Queue
    """Light tier: register an in-process subscriber for the WebSocket layer and return its queue.

    `channels` are plain channel names (e.g. "ch:office"); they are namespaced with key() so they
    match what publish() writes. The returned asyncio.Queue receives {"channel":..., "data":...}.
    """
    import asyncio

    q: asyncio.Queue = asyncio.Queue()
    try:  # the consumer's loop: publish may run on a worker thread and must wake it safely
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    q._omilo_token = _LOCAL.subscribe([key(c, cid) for c in channels], q, loop)  # type: ignore[attr-defined]
    return q


def unsubscribe(queue) -> None:
    _LOCAL.unsubscribe(getattr(queue, "_omilo_token", id(queue)))


# ------------------------------------------------------------------ locks
@contextmanager
def lock(name: str, ttl_s: float = 30, cid: str | None = None, wait_s: float = 0) -> Iterator[bool]:
    """Yields True if this process holds the lock (released after the block); False if another process has it
    (after waiting up to wait_s seconds)."""
    k = key(f"lock:{name}", cid)
    if _light():
        # Single process => a real threading.Lock is exact; ttl_s is a safety net we can ignore.
        with _LOCAL.lock(k, wait_s) as got:
            yield got
        return

    token = uuid.uuid4().hex
    got, end = False, time.monotonic() + wait_s
    while True:
        try:
            got = bool(r().set(k, token, nx=True, px=int(ttl_s * 1000)))
        except _rerr() as e:
            log.warning("lock %s: %s", name, e)
            break
        if got or time.monotonic() >= end:
            break
        time.sleep(0.05)
    try:
        yield got
    finally:
        if got:
            try:
                r().eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, k, token)
            except _rerr():
                pass


def claim(name: str, ttl_s: float, cid: str | None = None) -> bool:
    """Take something once (e.g. a run) for ttl_s seconds; False if someone else has it."""
    k = key(f"claim:{name}", cid)
    if _light():
        return _LOCAL.set_nx(k, ttl_s)
    try:
        return bool(r().set(k, "1", nx=True, px=int(ttl_s * 1000)))
    except _rerr():
        return True


def release(name: str, cid: str | None = None) -> None:
    k = key(f"claim:{name}", cid)
    if _light():
        _LOCAL.delete(k)
        return
    try:
        r().delete(k)
    except _rerr():
        pass


# ------------------------------------------------------------------ small shared values
def get_json(name: str, cid: str | None = None):
    k = key(name, cid)
    if _light():
        return _LOCAL.get_json(k)
    try:
        v = r().get(k)
    except _rerr():
        return None
    return json.loads(v) if v else None


def set_json(name: str, value, ttl_s: float | None = None, cid: str | None = None) -> None:
    k = key(name, cid)
    if _light():
        _LOCAL.set_json(k, value, ttl_s)
        return
    try:
        r().set(k, json.dumps(value, default=str), px=int(ttl_s * 1000) if ttl_s else None)
    except _rerr() as e:
        log.warning("set %s: %s", name, e)


def throttle(name: str, every_s: float, cid: str | None = None) -> bool:
    """True at most once per every_s seconds (across processes)."""
    k = key(f"thr:{name}", cid)
    if _light():
        return _LOCAL.set_nx(k, every_s)
    try:
        return bool(r().set(k, "1", nx=True, px=int(every_s * 1000)))
    except _rerr():
        return True


# ------------------------------------------------------------------ set/queue helpers (kb.py & worker.py)
def mark_pending(cid: str | None = None) -> None:
    """Add a company to the shared embedding queue. Key: gkey("kb:pending")."""
    member = cid or C.current()
    k = gkey("kb:pending")
    if _light():
        _LOCAL.sadd(k, member)
        return
    try:
        r().sadd(k, member)
    except _rerr() as e:
        log.warning("mark_pending: %s", e)


def pop_pending(n: int) -> list[str]:
    """Take up to n companies off the shared embedding queue. Key: gkey("kb:pending")."""
    k = gkey("kb:pending")
    if _light():
        return _LOCAL.spop(k, n)
    try:
        return r().spop(k, n) or []
    except _rerr():
        return []


def add_marks(items, cid: str | None = None) -> None:
    """Add per-company (re)index marks (strings like "doc|path.md"). Key: key("kb:marks", cid)."""
    items = list(items)
    if not items:
        return
    k = key("kb:marks", cid)
    if _light():
        _LOCAL.sadd(k, *items)
        return
    try:
        r().sadd(k, *items)
    except _rerr() as e:
        log.warning("add_marks: %s", e)


def pop_marks(n: int, cid: str | None = None) -> list[str]:
    """Take up to n (re)index marks for a company. Key: key("kb:marks", cid)."""
    k = key("kb:marks", cid)
    if _light():
        return _LOCAL.spop(k, n)
    try:
        return r().spop(k, n) or []
    except _rerr():
        return []


def drop(name: str, cid: str | None = None) -> None:
    """Delete a key (e.g. "kb:error"). Key: key(name, cid)."""
    k = key(name, cid)
    if _light():
        _LOCAL.drop(k)  # delete whichever kv or set lives at this key
        return
    try:
        r().delete(k)
    except _rerr():
        pass
