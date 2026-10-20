"""Real-time notices for the owner: a live stream for open tabs, Web Push for when no tab is open.

Notices are written automatically when an inbox item is created, a helper replies in chat, or a job ends
(a SQLAlchemy before_flush hook), so no call site has to remember them. The nudge ladder (nudge.py) adds reminders
for inbox items nobody decided. Push honours the owner's settings: per type and channel, quiet hours, the focus switch
and a cap of a few pushes an hour (the rest merge into one)."""
from __future__ import annotations

import asyncio
import base64
import datetime as dt
import hashlib
import hmac
import json
import logging
import re
import time
from pathlib import Path

from sqlalchemy import event, func, inspect, select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import InboxItem, Message, Notice, Notification, Proposal, PushSub, Setting, Staff, Task, Thread, new_id, now

log = logging.getLogger("omilo.notify")

KINDS = {"inbox": "Inbox: approvals, questions and alerts", "reply": "Replies from helpers in chat",
         "job_failed": "A job failed", "job_done": "A job finished", "doc": "A helper changed a doc"}
CHANNELS = {"push": "Notification on this computer or phone", "app": "Pop-up while Omilo is open",
            "email": "Email to your account address"}
DEFAULT_KINDS = {"inbox": {"push": True, "app": True, "email": False}, "reply": {"push": True, "app": True, "email": False},
                 "job_failed": {"push": True, "app": True, "email": False},
                 "job_done": {"push": False, "app": True, "email": False}, "doc": {"push": False, "app": True, "email": False}}
DEFAULT_QUIET = {"on": True, "start": "22:00", "end": "07:00"}
MAX_PER_HOUR = 6
PREF_KEY = {"nudge": "inbox", "digest": "inbox"}  # reminders follow the Inbox setting
PRESENCE_S = 45  # a tab that streamed within this many seconds counts as open
_HM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _clip(s: str, n: int = 180) -> str:
    s = " ".join((s or "").replace("**", "").replace("`", "").split())
    return s if len(s) <= n else s[: n - 1] + "…"


def _name(session: Session, staff_id: str | None) -> str:
    if not staff_id:
        return "Omilo"
    with session.no_autoflush:
        st = session.get(Staff, staff_id)
    return st.name if st else staff_id


@event.listens_for(Session, "before_flush")
def _notices(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    add: list[Notice] = []
    for o in list(session.new):
        if isinstance(o, InboxItem):
            if not o.id:
                o.id = new_id("inb")
            who = _name(session, o.staff_id)
            title = {"proposal": f"{who} needs your approval", "question": f"{who} has a question"}.get(o.kind, f"{who}: {o.title}" if o.staff_id else o.title)
            if o.blocking and o.kind == "question":
                title = f"{who} is stuck until you answer"
            body = o.title if o.kind != "alert" else o.body
            # blocking items are Decisions that climb the nudge ladder faster; only real emergencies are Critical
            add.append(Notice(kind="inbox", title=_clip(title, 120), body=_clip(body), url=item_url(o.id), tag=f"inbox-{o.id}",
                              level=LEVEL.get(o.level, "decision"), item_id=o.id, who=who if o.staff_id else ""))
        elif isinstance(o, Message) and o.role in ("agent", "system") and not getattr(o, "_no_notice", False):
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
                              level="info" if o.role == "agent" else "decision", who=who))
    for o in list(session.dirty):
        if isinstance(o, Task) and o.status in ("done", "failed") and o.ended_at is not None:
            st_hist = inspect(o).attrs.status.history
            if not st_hist.added or st_hist.added[0] not in ("done", "failed"):
                continue
            who = _name(session, o.staff_id)
            ok = o.status == "done"
            add.append(Notice(kind="job_done" if ok else "job_failed", title=f"{who} {'finished' if ok else 'could not finish'} a job",
                              body=_clip(o.brief if ok else (o.error or o.brief)), url=f"/chat/?view=work&task={o.id}", tag=f"task-{o.id}",
                              level="info" if ok else "decision", who=who))
    for n in add:
        session.add(n)


LEVEL = {"critical": "critical", "decision": "decision", "fyi": "info"}


def item_url(item_id: str) -> str:
    return f"/?item={item_id}"


# ------------------------------------------------------------------ preferences and presence
def _normalize(raw) -> dict:
    """Settings as saved, filled up with the defaults. Older installs saved one switch per type: it becomes both channels."""
    raw = raw if isinstance(raw, dict) else {}
    kinds = {k: dict(v) for k, v in DEFAULT_KINDS.items()}
    src = raw.get("kinds") if isinstance(raw.get("kinds"), dict) else {k: v for k, v in raw.items() if k in KINDS}
    for k, v in src.items():
        if k not in KINDS:
            continue
        if isinstance(v, bool):
            kinds[k] = {"push": v, "app": v}
        elif isinstance(v, dict):
            kinds[k].update({c: bool(v[c]) for c in CHANNELS if c in v})
    quiet = {**DEFAULT_QUIET, **(raw.get("quiet") if isinstance(raw.get("quiet"), dict) else {})}
    focus = raw.get("focus") if isinstance(raw.get("focus"), dict) else None
    if focus and _parse(focus.get("until")) and _parse(focus["until"]) <= now():
        focus = None
    cap = raw.get("max_per_hour", MAX_PER_HOUR)
    return {"kinds": kinds, "quiet": quiet, "focus": focus, "sound": bool(raw.get("sound", False)),
            "max_per_hour": cap if isinstance(cap, int) and 1 <= cap <= 30 else MAX_PER_HOUR}


def _parse(s) -> dt.datetime | None:
    try:
        d = dt.datetime.fromisoformat(str(s))
    except (TypeError, ValueError):
        return None
    return d if d.tzinfo else d.replace(tzinfo=dt.UTC)


def prefs(db: Session, user_id: str) -> dict:
    s = db.get(Setting, f"notify_prefs:{user_id}")
    return _normalize(s.value if s else None)


def next_morning(local: dt.datetime, weekday: int | None = None) -> dt.datetime:
    """The next 08:00 (on `weekday`, 0 = Monday, when given) after `local`: just after midnight that is this morning."""
    at = local.replace(hour=8, minute=0, second=0, microsecond=0)
    if weekday is None:
        return at if local < at else at + dt.timedelta(days=1)
    days = (weekday - local.weekday()) % 7
    at += dt.timedelta(days=days)
    return at if at > local else at + dt.timedelta(days=7)


def focus_until(db: Session, choice) -> dict | None:
    """The focus switch: '1h', '2h', 'tomorrow' (08:00 local), 'off' or None."""
    from . import services as S

    if choice in (None, "off", False):
        return None
    start = now()
    if choice == "tomorrow":
        until = next_morning(start.astimezone(S._tz(db)))
    else:
        m = re.fullmatch(r"(\d{1,2})h", str(choice))
        if not m or not 1 <= int(m.group(1)) <= 24:
            raise ValueError("focus must be 1h…24h, tomorrow or off")
        until = start + dt.timedelta(hours=int(m.group(1)))
    return {"from": start.isoformat(), "until": until.astimezone(dt.UTC).isoformat()}


def set_prefs(db: Session, user_id: str, value: dict) -> dict:
    """Change some settings. Accepts {"kinds": {kind: {channel: bool}}} (or the older {kind: bool}), "quiet": {on, start, end},
    "focus": "1h" | "tomorrow" | "off", "sound": bool, "max_per_hour": int."""
    s = db.get(Setting, f"notify_prefs:{user_id}")
    cur = prefs(db, user_id)
    kinds = value.get("kinds") if isinstance(value.get("kinds"), dict) else {k: v for k, v in value.items() if k in KINDS}
    for k, v in kinds.items():
        if k not in KINDS:
            continue
        if isinstance(v, bool):
            cur["kinds"][k] = {"push": v, "app": v}
        elif isinstance(v, dict):
            cur["kinds"][k].update({c: bool(v[c]) for c in CHANNELS if c in v})
    if isinstance(value.get("quiet"), dict):
        q = value["quiet"]
        for k in ("start", "end"):
            if k in q and not _HM.match(str(q[k])):
                raise ValueError(f"quiet hours {k} must look like 22:00")
        cur["quiet"].update({k: (bool(q[k]) if k == "on" else str(q[k])) for k in ("on", "start", "end") if k in q})
    if "focus" in value:
        cur["focus"] = focus_until(db, value["focus"])
    if "sound" in value:
        cur["sound"] = bool(value["sound"])
    if "max_per_hour" in value:
        n = int(value["max_per_hour"])
        if not 1 <= n <= 30:
            raise ValueError("max_per_hour must be between 1 and 30")
        cur["max_per_hour"] = n
    if s:
        s.value = cur
    else:
        db.add(Setting(key=f"notify_prefs:{user_id}", value=cur))
    db.commit()
    return cur


def wants(p: dict, kind: str, channel: str) -> bool:
    if kind == "test":
        return True
    return bool(p["kinds"].get(PREF_KEY.get(kind, kind), {}).get(channel, False))


def is_quiet(db: Session, p: dict, at: dt.datetime | None = None) -> bool:
    """Inside the quiet hours (in the company's time zone)? A window like 22:00–07:00 runs over midnight."""
    from . import services as S

    q = p["quiet"]
    if not q.get("on"):
        return False
    local = (at or now()).astimezone(S._tz(db))
    t = local.hour * 60 + local.minute
    a, b = (int(x[:2]) * 60 + int(x[3:]) for x in (q["start"], q["end"]))
    if a == b:
        return False
    return a <= t < b if a < b else (t >= a or t < b)


def in_focus(p: dict, at: dt.datetime | None = None) -> bool:
    f = p.get("focus")
    if not f:
        return False
    at = at or now()
    a, b = _parse(f.get("from")), _parse(f.get("until"))
    return bool(b and (a is None or a <= at) and at < b)


def held(db: Session, p: dict, level: str, at: dt.datetime | None = None) -> bool:
    """Quiet hours and focus hold everything but Critical."""
    return level != "critical" and (is_quiet(db, p, at) or in_focus(p, at))


def status(db: Session, p: dict) -> dict:
    return {"quiet_now": is_quiet(db, p), "focus_now": in_focus(p)}


# ------------------------------------------------------------------ signed links for notification buttons
def sign(company: str, item_id: str) -> str:
    key = hashlib.sha256(("omilo-notify:" + get_settings().resolved_secret()).encode()).digest()
    return hmac.new(key, f"{company}:{item_id}".encode(), hashlib.sha256).hexdigest()[:40]


def check_sig(company: str, item_id: str, sig: str) -> bool:
    return hmac.compare_digest(sign(company, item_id), str(sig or ""))


def one_tap_ok(db: Session, item_id: str | None) -> bool:
    """Approve straight from a notification only for low-risk proposals still waiting: medium and high risk always
    open the item, so the owner reads what they approve."""
    if not item_id:
        return False
    item = db.get(InboxItem, item_id)
    if not item or item.kind != "proposal" or item.status != "open" or not item.ref_id:
        return False
    p = db.get(Proposal, item.ref_id)
    return bool(p and p.status == "pending" and p.risk == "low")


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

    return {"id": n.id, "at": iso(n.at), "kind": n.kind, "title": n.title, "body": n.body, "url": n.url, "tag": n.tag, "level": n.level,
            "item_id": n.item_id}


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


def _word(n: Notice) -> str:
    if n.kind in ("inbox", "nudge"):
        t = n.title.lower()
        return "approval" if "approval" in t else "question" if ("question" in t or "answer" in t) else "update"
    return {"reply": "reply", "job_failed": "failed job", "job_done": "finished job", "doc": "doc change"}.get(n.kind, "update")


def merged(rows: list[Notice]) -> dict:
    """Many notices as one push: "4 new approvals from Marketing and Sales"."""
    from collections import Counter

    words = Counter(_word(n) for n in rows)
    who = list(dict.fromkeys(n.who for n in rows if n.who))
    parts = [f"{c} {w}{'s' if c > 1 else ''}" for w, c in words.most_common()]
    head = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
    title = f"{head[0].upper()}{head[1:]}" if len(rows) > 1 else rows[0].title
    if len(rows) > 1 and who:
        names = who[:3]
        title += " from " + (names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]) + (" and others" if len(who) > 3 else "")
    body = " · ".join(_clip(n.title, 60) for n in rows[:4]) + (" …" if len(rows) > 4 else "")
    level = "critical" if any(n.level == "critical" for n in rows) else "decision"
    return {"id": rows[-1].id, "kind": "digest", "title": _clip(title, 120), "body": body, "url": "/", "tag": "omilo-digest", "level": level,
            "item_id": None, "count": len(rows)}


def _still_relevant(db: Session, n: Notice) -> bool:
    """A waiting notice about an inbox item that was decided meanwhile is not worth a push any more."""
    if not n.item_id:
        return True
    item = db.get(InboxItem, n.item_id)
    return bool(item and item.status == "open")


def _sent_last_hour(db: Session, user_id: str) -> int:
    since = now() - dt.timedelta(hours=1)
    return db.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == user_id, Notification.channel == "push", Notification.action.in_(["sent", "merged"]),
        Notification.sent_at >= since)) or 0


def plan_pushes(db: Session, user_id: str, p: dict, candidates: list[Notice]) -> tuple[list[dict], list[int]]:
    """Which pushes go out now for one owner: Critical (and tests) always, the rest up to the hourly cap; what does not fit is merged
    into one push when there is room for it, otherwise kept (ids returned) for when a slot frees up."""
    always = lambda n: n.level == "critical" or n.kind == "test"  # noqa: E731  (a test from Settings must show as itself)
    crit = [n for n in candidates if always(n)]
    rest = [n for n in candidates if not always(n)]
    out: list[dict] = [serialize(n) for n in crit]
    slots = max(0, p["max_per_hour"] - _sent_last_hour(db, user_id) - len(crit))
    if len(rest) <= slots:
        out += [serialize(n) for n in rest]
        return out, []
    if slots == 0:
        return out, [n.id for n in rest]
    out += [serialize(n) for n in rest[: slots - 1]]
    out.append(merged(rest[slots - 1:]))
    return out, []


async def push_pending(db_factory, auth_factory=None, label: str = "", company: str = "") -> int:
    """Send Web Push for the current company's notices nobody saw live (no tab open on that company), honouring the
    owner's settings for that company: type and channel, quiet hours and focus (Critical still goes out), and the
    hourly cap. Subscriptions belong to the login, so they live in the auth database.
    `label` (the company name) is put before the title when the owner runs several companies. Returns the number sent."""
    from . import company as C
    from .models import User

    if not push_available():
        return 0
    auth_factory = auth_factory or db_factory
    cid = C.current()
    base = get_settings().base_path.rstrip("/")
    sent = 0
    with db_factory() as db, auth_factory() as adb:
        cur = db.get(Setting, "push_cursor")
        last = int(cur.value) if cur and cur.value is not None else None
        if last is None:  # first run: start from now, never replay history
            db.add(Setting(key="push_cursor", value=latest_id(db)))
            db.commit()
            return 0
        notices = list(db.scalars(select(Notice).where(Notice.id > last).order_by(Notice.id).limit(50)))
        subs = list(adb.scalars(select(PushSub)))
        backlog = {s.user_id: db.get(Setting, f"push_overflow:{s.user_id}") for s in subs}
        if not notices and not any(b and b.value for b in backlog.values()):
            return 0
        jobs = []
        for uid in dict.fromkeys(s.user_id for s in subs):
            u = adb.get(User, uid)
            ob = backlog.get(uid)
            if not u or is_present(db, uid):
                if ob and ob.value:
                    ob.value = []  # they are looking at Omilo: what waited has been seen
                continue
            p = prefs(db, uid)
            waiting = [n for n in (db.get(Notice, i) for i in ((ob.value if ob else None) or [])) if n and _still_relevant(db, n)]
            fresh = [n for n in notices if wants(p, n.kind, "push") and not (n.kind == "inbox" and n.level == "info")]  # FYI: no push
            now_ok = [n for n in waiting + fresh if not held(db, p, n.level)]
            # quiet hours / focus: inbox items come back through the nudge ladder; everything else waits here
            wait = [n.id for n in waiting + fresh if held(db, p, n.level) and not n.item_id]
            out, keep = plan_pushes(db, uid, p, now_ok) if now_ok else ([], [])
            keep = list(dict.fromkeys(wait + keep))
            if ob:
                ob.value = keep
            elif keep:
                db.add(Setting(key=f"push_overflow:{uid}", value=keep))
            for payload in out:
                payload = {**payload, "url": base + payload["url"], "co": cid}
                if payload.get("item_id"):
                    payload["sig"] = sign(cid, payload["item_id"])
                    payload["actions"] = ([{"action": "approve", "title": "Approve"}] if one_tap_ok(db, payload["item_id"])
                                          else [{"action": "open", "title": "Open"}]) + [{"action": "snooze", "title": "Snooze 1 h"}]
                if label:
                    payload["title"] = f"{label} · {payload['title']}"
                if company:  # opening it switches to that company
                    b, _, frag = payload["url"].partition("#")
                    payload["url"] = b + ("&" if "?" in b else "?") + f"co={company}" + (f"#{frag}" if frag else "")
                db.add(Notification(inbox_item_id=payload.get("item_id"), notice_id=payload["id"] if payload["kind"] != "digest" else None,
                                    user_id=uid, channel="push", level=payload["level"],
                                    action="merged" if payload["kind"] == "digest" else "sent"))
                for sub in (s for s in subs if s.user_id == uid):
                    jobs.append((sub, payload, u.email))
        if notices:
            cur.value = notices[-1].id
        db.commit()
        # all at once: one slow or dead push service must not hold up the others (each call can take up to 10 s)
        results = await asyncio.gather(*(asyncio.to_thread(_send, sub, payload, contact) for sub, payload, contact in jobs))
        gone: set[str] = set()
        for (sub, _payload, _contact), res in zip(jobs, results, strict=True):
            if res == "ok":
                sub.last_ok_at, sent = now(), sent + 1
            elif res == "gone" and sub.id not in gone:
                gone.add(sub.id)
                adb.delete(sub)
            else:
                log.warning("web push failed: %s", res)
        adb.commit()
    return sent


async def email_pending(db_factory, auth_factory=None, label: str = "", company: str = "") -> int:  # noqa: ARG001
    """Send email notifications for fresh Notice rows whose owner has email enabled, honouring quiet/focus/cap.

    Held notices (quiet-hours / focus) are deferred to an email_overflow:{uid} backlog and delivered
    once the window ends — mirroring push_pending's push_overflow:{uid} mechanism.
    Stale/decided items are skipped via _still_relevant (same guard as push_pending).
    Gracefully returns 0 (no exception) when SMTP is not configured.
    Returns the number of emails sent."""
    from . import smtp
    from .models import User

    auth_factory = auth_factory or db_factory
    sent = 0
    with db_factory() as db, auth_factory() as adb:
        # Guard: bail early if SMTP is not usable (no host configured)
        try:
            cfg = smtp.get_config(db)
            if not cfg.get("host"):
                return 0
        except Exception:  # noqa: BLE001
            return 0

        cur = db.get(Setting, "email_cursor")
        last = int(cur.value) if cur and cur.value is not None else None
        if last is None:  # first run: set cursor and do nothing this tick
            db.add(Setting(key="email_cursor", value=latest_id(db)))
            db.commit()
            return 0

        notices = list(db.scalars(select(Notice).where(Notice.id > last).order_by(Notice.id).limit(50)))

        # Find all unique user ids that have email prefs (stored in the company DB)
        # We mirror push_pending: iterate the auth DB for known users
        users = list(adb.scalars(select(User)))
        if not users:
            if notices:
                cur.value = notices[-1].id
                db.commit()
            return 0

        # Load backlogs for all users up front (mirrors push's backlog dict)
        backlog = {u.id: db.get(Setting, f"email_overflow:{u.id}") for u in users}

        if not notices and not any(b and b.value for b in backlog.values()):
            return 0

        for u in users:
            if is_present(db, u.id):
                ob = backlog.get(u.id)
                if ob and ob.value:
                    ob.value = []  # they are looking at Omilo: clear backlog (same as push)
                continue
            p = prefs(db, u.id)
            ob = backlog.get(u.id)
            # Restore backlogged notices that are still relevant (Finding B: relevance guard)
            waiting = [n for n in (db.get(Notice, i) for i in ((ob.value if ob else None) or [])) if n and _still_relevant(db, n)]
            # Fresh notices this user wants via email, also filtered by relevance (Finding B)
            fresh = [n for n in notices if wants(p, n.kind, "email") and _still_relevant(db, n)]
            # Split into sendable now vs held by quiet/focus
            now_ok = [n for n in waiting + fresh if not held(db, p, n.level)]
            # Held notices go to backlog (Finding A: defer, don't drop)
            wait_ids = [n.id for n in waiting + fresh if held(db, p, n.level)]
            keep = list(dict.fromkeys(wait_ids))  # dedup, preserve order
            if ob:
                ob.value = keep
            elif keep:
                db.add(Setting(key=f"email_overflow:{u.id}", value=keep))
            # Per-hour cap: mirror push_pending's MAX_PER_HOUR enforcement
            since = now() - dt.timedelta(hours=1)
            emails_this_hour = db.scalar(select(func.count()).select_from(Notification).where(
                Notification.user_id == u.id, Notification.channel == "email",
                Notification.action == "sent", Notification.sent_at >= since)) or 0
            cap = p["max_per_hour"]
            for n in now_ok:
                if emails_this_hour >= cap:
                    break
                payload = serialize(n)
                subject = payload["title"]
                if label:
                    subject = f"{label} · {subject}"
                body = payload.get("body") or payload["title"]
                try:
                    smtp.send_email(db, u.email, subject, body)
                except smtp.SmtpError:
                    log.warning("email send failed", exc_info=True)
                    continue
                db.add(Notification(
                    inbox_item_id=n.item_id,
                    notice_id=n.id,
                    user_id=u.id,
                    channel="email",
                    level=n.level,
                    action="sent",
                ))
                sent += 1
                emails_this_hour += 1

        if notices:
            cur.value = notices[-1].id
        db.commit()
    return sent
