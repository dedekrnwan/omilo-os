"""Redis: what several Omilo processes share.

- live events: office changes and notices are announced on a channel per company, so every API process can push them
  to its WebSockets right away (the database stays the record; the message only says "something changed")
- locks: only one worker process hands out a company's jobs and workflow runs at a time
- shared counters with expiry: the Claude Code pool's leases, connector health, rate limits
- the knowledge-base queue: sources waiting to be embedded, and marks for things to (re)index

Keys are "<prefix>:<company>:<name>" (prefix OMILO_REDIS_PREFIX, default "omilo").
"""
from __future__ import annotations

import json
import logging
import threading
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import redis
import redis.asyncio as aredis

from . import company as C
from .config import get_settings

log = logging.getLogger("omilo.bus")
_client: redis.Redis | None = None
_aclient: aredis.Redis | None = None
_lock = threading.Lock()


def r() -> redis.Redis:
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                _client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True, socket_timeout=10,
                                               socket_connect_timeout=5, health_check_interval=30)
    return _client


def ar() -> aredis.Redis:
    global _aclient
    if _aclient is None:
        _aclient = aredis.Redis.from_url(get_settings().redis_url, decode_responses=True, socket_connect_timeout=5)
    return _aclient


def reset() -> None:
    """Tests: forget the clients (a new URL or event loop)."""
    global _client, _aclient
    _client, _aclient = None, None


def check() -> None:
    try:
        r().ping()
    except redis.RedisError as e:
        raise RuntimeError(f"Can't reach Redis at {get_settings().redis_url} ({e}). Start it with `make db` "
                           "(Postgres + Redis in Docker) or set OMILO_REDIS_URL.") from e


def key(name: str, cid: str | None = None) -> str:
    return f"{get_settings().redis_prefix}:{cid or C.current()}:{name}"


def gkey(name: str) -> str:
    """A key shared by every company (e.g. the embedding queue)."""
    return f"{get_settings().redis_prefix}:_:{name}"


# ------------------------------------------------------------------ live events
def publish(channel: str, data: dict | None = None, cid: str | None = None) -> None:
    try:
        r().publish(key(f"ch:{channel}", cid), json.dumps(data or {}, default=str))
    except redis.RedisError as e:  # a missed wake-up is caught by the next poll; never fail the request for it
        log.warning("publish %s failed: %s", channel, e)


# ------------------------------------------------------------------ locks
@contextmanager
def lock(name: str, ttl_s: float = 30, cid: str | None = None, wait_s: float = 0) -> Iterator[bool]:
    """Yields True if this process holds the lock (released after the block); False if another process has it
    (after waiting up to wait_s seconds)."""
    import time

    k, token = key(f"lock:{name}", cid), uuid.uuid4().hex
    got, end = False, time.monotonic() + wait_s
    while True:
        try:
            got = bool(r().set(k, token, nx=True, px=int(ttl_s * 1000)))
        except redis.RedisError as e:
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
            except redis.RedisError:
                pass


def claim(name: str, ttl_s: float, cid: str | None = None) -> bool:
    """Take something once (e.g. a run) for ttl_s seconds; False if someone else has it."""
    try:
        return bool(r().set(key(f"claim:{name}", cid), "1", nx=True, px=int(ttl_s * 1000)))
    except redis.RedisError:
        return True


def release(name: str, cid: str | None = None) -> None:
    try:
        r().delete(key(f"claim:{name}", cid))
    except redis.RedisError:
        pass


# ------------------------------------------------------------------ small shared values
def get_json(name: str, cid: str | None = None):
    try:
        v = r().get(key(name, cid))
    except redis.RedisError:
        return None
    return json.loads(v) if v else None


def set_json(name: str, value, ttl_s: float | None = None, cid: str | None = None) -> None:
    try:
        r().set(key(name, cid), json.dumps(value, default=str), px=int(ttl_s * 1000) if ttl_s else None)
    except redis.RedisError as e:
        log.warning("set %s: %s", name, e)


def throttle(name: str, every_s: float, cid: str | None = None) -> bool:
    """True at most once per every_s seconds (across processes)."""
    try:
        return bool(r().set(key(f"thr:{name}", cid), "1", nx=True, px=int(every_s * 1000)))
    except redis.RedisError:
        return True
