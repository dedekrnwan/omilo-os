"""The live office stream: the authoritative helper state and the verified events behind it.

WebSocket `/api/office/ws` (same-origin, signed-in cookie): on connect it sends `state`; then `events` (with a fresh
`state`) whenever something really happens, and a `heartbeat` every few seconds so the view can show how fresh it is.
The client can send `{"type": "hello", "after": <cursor>}` to resume, or `{"type": "resync"}`. HTTP fallbacks:
`GET /api/office/state`, `GET /api/office/events?after=`, and `GET /api/office/agent/{id}` for the inspector.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
import logging
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import company as C
from .. import office as O
from ..config import get_settings
from ..db import get_db, session_scope
from ..models import AuthToken, User, now
from ..security import COOKIE, current_user, sha256

router = APIRouter(prefix="/api/office", tags=["office"])
log = logging.getLogger("omilo.office")
HEARTBEAT_S = 5
RECHECK_S = 15  # recompute the state this often even without events (time-based changes, e.g. a failure ageing out)
FALLBACK_S = 2.5  # without a Redis wake-up, check the database this often


@router.get("/state")
def office_state(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return O.state(db)


@router.get("/events")
def office_events(after: int = 0, limit: int = 200, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return {"cursor": O.cursor(db), "events": O.events(db, after, limit)}


@router.get("/agent/{staff_id}")
def office_agent(staff_id: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    d = O.agent_detail(db, staff_id)
    if not d:
        raise HTTPException(404, "unknown helper")
    return d


# ------------------------------------------------------------------ WebSocket
def _origin_ok(ws: WebSocket) -> bool:
    """Cookies ride along on cross-site WebSocket handshakes, so only our own pages may open the stream."""
    origin = ws.headers.get("origin")
    if not origin:
        return True  # not a browser (CLI, tests); the cookie or token still has to be valid
    allowed = {o.strip().rstrip("/") for o in (get_settings().cors_origins or "").split(",") if o.strip()}
    return urlparse(origin).netloc == ws.headers.get("host", "") or origin.rstrip("/") in allowed


def _user_ok(raw: str | None) -> bool:
    if not raw:
        return False
    with session_scope(C.MAIN) as db:
        tok = db.scalar(select(AuthToken).where(AuthToken.token_hash == sha256(raw)))
        if not tok:
            return False
        exp = tok.expires_at
        return not (exp is not None and exp.replace(tzinfo=exp.tzinfo or dt.UTC) < now())


def _bearer(ws: WebSocket) -> str | None:
    a = ws.headers.get("authorization", "")
    return a[7:].strip() if a.lower().startswith("bearer ") else None


@router.websocket("/ws")
async def office_ws(ws: WebSocket):
    if not _origin_ok(ws):
        await ws.close(code=4403)
        return
    raw = _bearer(ws) or ws.cookies.get(COOKIE)
    if not await asyncio.to_thread(_user_ok, raw):
        await ws.close(code=4401)
        return
    cid = C.current()
    await ws.accept()

    def snap() -> dict:
        with C.use(cid), session_scope(cid) as db:
            return O.state(db)

    def fetch(after: int) -> tuple[int, list[dict]]:
        with C.use(cid), session_scope(cid) as db:
            rows = O.events(db, after, 300)
            return (rows[-1]["id"] if rows else after), rows

    inbox: asyncio.Queue = asyncio.Queue()

    async def reader():
        try:
            while True:
                await inbox.put(await ws.receive_text())
        except (WebSocketDisconnect, RuntimeError):
            await inbox.put(None)

    rd = asyncio.create_task(reader())
    wake = asyncio.Event()

    async def listen():  # a message means "new events"; the database is still what we send
        from .. import bus

        if bus._light():
            # Light tier: no Redis. office.py's after_commit bus.publish("office", cid=...)
            # delivers into this in-process asyncio.Queue (waking us via call_soon_threadsafe).
            q = bus.subscribe(cid, ["ch:office"])
            try:
                while True:
                    await q.get()
                    wake.set()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 - the stream falls back to the periodic DB re-read
                log.warning("office stream without live wake-ups: %s", e)
            finally:
                bus.unsubscribe(q)
            return
        try:
            ps = bus.ar().pubsub()
            await ps.subscribe(bus.key("ch:office", cid))
            async for m in ps.listen():
                if m.get("type") == "message":
                    wake.set()
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - without Redis the stream falls back to checking every few seconds
            log.warning("office stream without live wake-ups: %s", e)

    ls = asyncio.create_task(listen())

    async def next_msg():
        get, w = asyncio.ensure_future(inbox.get()), asyncio.ensure_future(wake.wait())
        done, pending = await asyncio.wait({get, w}, timeout=FALLBACK_S, return_when=asyncio.FIRST_COMPLETED)
        for p in pending:
            p.cancel()
        wake.clear()
        return get.result() if get in done else ""
    loop = asyncio.get_running_loop()
    try:
        st = await asyncio.to_thread(snap)
        last = st["cursor"]
        digest = hashlib.sha1(json.dumps(st["agents"], sort_keys=True, default=str).encode()).hexdigest()
        await ws.send_json({"type": "state", "state": st})
        t_beat = t_state = t_auth = loop.time()
        while True:
            msg = await next_msg()
            if msg is None:
                break
            if msg:
                try:
                    m = json.loads(msg)
                except ValueError:
                    m = {}
                if m.get("type") == "hello" and isinstance(m.get("after"), int) and 0 <= m["after"] <= last:
                    # resume: replay what the client missed (bounded), then it has the same state as everyone
                    _, missed = await asyncio.to_thread(fetch, m["after"])
                    if missed:
                        await ws.send_json({"type": "events", "events": missed[-300:], "cursor": missed[-1]["id"], "replay": True})
                elif m.get("type") == "resync":
                    st = await asyncio.to_thread(snap)
                    await ws.send_json({"type": "state", "state": st})
            new_last, rows = await asyncio.to_thread(fetch, last)
            t = loop.time()
            if rows:
                last = new_last
                st = await asyncio.to_thread(snap)
                digest = hashlib.sha1(json.dumps(st["agents"], sort_keys=True, default=str).encode()).hexdigest()
                await ws.send_json({"type": "events", "events": rows, "cursor": last})
                await ws.send_json({"type": "state", "state": st})
                t_state = t
            elif t - t_state >= RECHECK_S:
                st = await asyncio.to_thread(snap)
                d2 = hashlib.sha1(json.dumps(st["agents"], sort_keys=True, default=str).encode()).hexdigest()
                if d2 != digest:
                    digest = d2
                    await ws.send_json({"type": "state", "state": st})
                t_state = t
            if t - t_beat >= HEARTBEAT_S:
                await ws.send_json({"type": "heartbeat", "server_time": O._iso(now()), "cursor": last})
                t_beat = t
            if t - t_auth >= 60:  # a signed-out or expired session closes the stream
                if not await asyncio.to_thread(_user_ok, raw):
                    await ws.close(code=4401)
                    break
                t_auth = t
    except (WebSocketDisconnect, RuntimeError):
        pass
    except Exception:  # noqa: BLE001
        log.exception("office stream failed")
        try:
            await ws.close(code=1011)
        except Exception:  # noqa: BLE001
            pass
    finally:
        rd.cancel()
        ls.cancel()
