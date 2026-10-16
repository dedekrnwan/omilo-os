"""Real-time notices for the owner: a live stream for open tabs, Web Push for when no tab is open.

Notices are written automatically when an inbox item is created, a helper replies in chat, or a job ends
(a SQLAlchemy before_flush hook), so no call site has to remember them."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import time
from pathlib import Path

from sqlalchemy import event, func, inspect, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import InboxItem, Message, Notice, PushSub, Setting, Staff, Task, Thread, now

log = logging.getLogger("saga.notify")

KINDS = {"inbox": "Inbox: approvals, questions and alerts", "reply": "Replies from helpers in chat",
         "job_failed": "A job failed", "job_done": "A job finished", "doc": "A helper changed a doc"}
DEFAULT_PREFS = {"inbox": True, "reply": True, "job_failed": True, "job_done": False, "doc": True}
PRESENCE_S = 45  # a tab that streamed within this many seconds counts as open


def _clip(s: str, n: int = 180) -> str:
    s = " ".join((s or "").replace("**", "").replace("`", "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _name(session: Session, staff_id: str | None) -> str:
    if not staff_id:
        return "Saga OS"
    with session.no_autoflush:
        st = session.get(Staff, staff_id)
    return st.name if st else staff_id


@event.listens_for(Session, "before_flush")
def _notices(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    add: list[Notice] = []
    for o in list(session.new):
        if isinstance(o, InboxItem):
            who = _name(session, o.staff_id)
            title = {"proposal": f"{who} needs your approval", "question": f"{who} has a question"}.get(o.kind, f"{who}: {o.title}" if o.staff_id else o.title)
            body = o.title if o.kind != "alert" else o.body
            add.append(Notice(kind="inbox", title=_clip(title, 120), body=_clip(body), url="/", tag=f"inbox-{o.kind}",
                              level="critical" if o.level == "critical" or o.blocking else "decision"))
        elif isinstance(o, Message) and o.role in ("agent", "system"):
            with session.no_autoflush:
                th = session.get(Thread, o.thread_id)
            if not th:
                continue
            who = _name(session, o.author if o.role == "agent" else th.staff_id)
            if any(isinstance(b, dict) and b.get("type") == "file" for b in (o.blocks or [])):
                title = f"{who} shared a file"
            elif any(isinstance(b, dict) and b.get("type") == "choices" for b in (o.blocks or [])):
                title = f"{who} asks you to pick"
            else:
                title = f"{who} replied" if o.role == "agent" else f"{who} could not answer"
            add.append(Notice(kind="reply", title=title, body=_clip(o.text), url=f"/chat/?thread={th.id}", tag=f"thread-{th.id}",
                              level="info" if o.role == "agent" else "decision"))
    for o in list(session.dirty):
        if isinstance(o, Task) and o.status in ("done", "failed") and o.ended_at is not None:
            st_hist = inspect(o).attrs.status.history
            if not st_hist.added or st_hist.added[0] not in ("done", "failed"):
                continue
            who = _name(session, o.staff_id)
            ok = o.status == "done"
            add.append(Notice(kind="job_done" if ok else "job_failed", title=f"{who} {'finished' if ok else 'could not finish'} a job",
                              body=_clip(o.brief if ok else (o.error or o.brief)), url=f"/chat/?view=work&task={o.id}", tag=f"task-{o.id}",
                              level="info" if ok else "decision"))
    for n in add:
        session.add(n)


# ------------------------------------------------------------------ preferences and presence
def prefs(db: Session, user_id: str) -> dict:
    s = db.get(Setting, f"notify_prefs:{user_id}")
    return {**DEFAULT_PREFS, **((s.value if s else None) or {})}


def set_prefs(db: Session, user_id: str, value: dict) -> dict:
    p = {**prefs(db, user_id), **{k: bool(v) for k, v in value.items() if k in KINDS}}
    s = db.get(Setting, f"notify_prefs:{user_id}")
    if s:
        s.value = p
    else:
        db.add(Setting(key=f"notify_prefs:{user_id}", value=p))
    db.commit()
    return p


def mark_present(db: Session, user_id: str) -> None:
    key = f"presence:{user_id}"
    s = db.get(Setting, key)
    if s:
        s.value = time.time()
    else:
        db.add(Setting(key=key, value=time.time()))
    db.commit()


def is_present(db: Session, user_id: str) -> bool:
    s = db.get(Setting, f"presence:{user_id}")
    return bool(s and isinstance(s.value, (int, float)) and time.time() - s.value < PRESENCE_S)


def latest_id(db: Session) -> int:
    return db.scalar(select(func.max(Notice.id))) or 0


def serialize(n: Notice) -> dict:
    from .serialize import iso

    return {"id": n.id, "at": iso(n.at), "kind": n.kind, "title": n.title, "body": n.body, "url": n.url, "tag": n.tag, "level": n.level}


# ------------------------------------------------------------------ Web Push
def _vapid_path() -> Path:
    return get_settings().data_dir / "vapid.pem"


def push_available() -> bool:
    try:
        import pywebpush  # noqa: F401
    except ImportError:
        return False
    return True


def vapid_public_key() -> str | None:
    """Create the server's VAPID key pair once; return the public key for the browser (base64url, uncompressed point)."""
    if not push_available():
        return None
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    p = _vapid_path()
    if not p.exists():
        key = ec.generate_private_key(ec.SECP256R1())
        p.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        p.chmod(0o600)
    key = serialization.load_pem_private_key(p.read_bytes(), password=None)
    raw = key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _send(sub: PushSub, payload: dict, contact: str) -> str:
    """'ok', 'gone' (the browser dropped the subscription) or an error text."""
    from pywebpush import WebPushException, webpush

    try:
        webpush({"endpoint": sub.endpoint, "keys": sub.keys}, json.dumps(payload), vapid_private_key=str(_vapid_path()),
                vapid_claims={"sub": f"mailto:{contact}"}, ttl=3600, timeout=10)
        return "ok"
    except WebPushException as e:
        code = getattr(e.response, "status_code", None)
        return "gone" if code in (404, 410) else f"{code}: {str(e)[:200]}"
    except Exception as e:  # noqa: BLE001
        return str(e)[:200]


async def push_pending(db_factory) -> int:
    """Send Web Push for notices nobody saw live (no open tab), honouring each user's preferences. Returns the number sent."""
    from .models import User

    if not push_available():
        return 0
    sent = 0
    with db_factory() as db:
        cur = db.get(Setting, "push_cursor")
        last = int(cur.value) if cur and cur.value is not None else None
        if last is None:  # first run: start from now, never replay history
            db.add(Setting(key="push_cursor", value=latest_id(db)))
            db.commit()
            return 0
        notices = list(db.scalars(select(Notice).where(Notice.id > last).order_by(Notice.id).limit(50)))
        if not notices:
            return 0
        jobs = []
        for sub in db.scalars(select(PushSub)):
            u = db.get(User, sub.user_id)
            if not u or is_present(db, sub.user_id):
                continue
            pr = prefs(db, sub.user_id)
            for n in notices:
                if n.kind == "test" or pr.get(n.kind):
                    jobs.append((sub, {**serialize(n), "url": get_settings().base_path.rstrip("/") + n.url}, u.email))
        cur.value = notices[-1].id
        db.commit()
        for sub, payload, contact in jobs:
            res = await asyncio.to_thread(_send, sub, payload, contact)
            if res == "ok":
                sub.last_ok_at, sent = now(), sent + 1
            elif res == "gone":
                db.delete(sub)
            else:
                log.warning("web push failed: %s", res)
        db.commit()
    return sent
