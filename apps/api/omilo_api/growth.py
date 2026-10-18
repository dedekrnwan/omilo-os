"""Helpers that grow: they write their own skills, share the good ones with the team, ask teammates, reach out to the
founder, and every week take time to learn from their work.

- Skills: a helper saves a skill for itself right away (personal). Sharing it with the whole team waits for the founder's
  one-click approval in the Inbox. A team skill is never overwritten by a helper: a changed version goes to the founder too.
- Teammates: ask_teammate posts the question in the team chat (General), the teammate answers there; the founder sees
  the whole conversation.
- The founder: message_founder writes in the helper's own chat (an idea, a check-in, a question), a few times a day at most.
- Learning: every helper has a weekly "Learn and improve" job (lessons, skills, questions, ideas). The founder can
  change its time or switch it off like any regular job.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import zlib

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import capabilities as C
from . import services as S
from .models import InboxItem, Message, Shift, Staff, Thread

SHARE = "skill_share"
MAX_FOUNDER_MESSAGES_PER_DAY = 3
MAX_TEAMMATE_QUESTIONS_PER_DAY = 6
LEARN_SHIFT = "learn-and-improve"
LEARN_BRIEF = """Weekly learning. Take 10 minutes to get better at your job:
1. Look back: recall your jobs, reports and chats of the last 7 days, and the founder's decisions and notes on your work.
2. Lessons: save 1-3 lessons with remember (what worked, what the founder rejected and why, facts you keep needing).
3. Skills: if you did the same kind of work twice or more, write it down as a skill with skill_save (steps, checklist,
   examples). Keep it personal, or set share=true when teammates would use it too (the founder approves sharing).
   Improve a skill of yours that didn't work well.
4. Ask: if a teammate knows something you need, ask_teammate. If you have one idea or question that would help the
   founder's goals, message_founder (only if it's worth their time).
5. Report what you learned and changed, in 3-5 short lines."""


def _today(db: Session) -> dt.datetime:
    local = S.now().astimezone(S._tz(db))
    return local.replace(hour=0, minute=0, second=0, microsecond=0)


# ------------------------------------------------------------------ skills
def save_skill(db: Session, st: Staff, slug: str, name: str, description: str, body: str, share: bool = False) -> dict:
    """A helper saves a skill. Its own: written now. A team skill or sharing: the founder decides in the Inbox."""
    slug = re.sub(r"[^a-z0-9-]+", "-", (slug or name or "").lower()).strip("-")[:60]
    if not slug or not C.SLUG.match(slug):
        raise S.DomainError("give the skill a short id: lowercase letters, digits and dashes")
    if not (body or "").strip():
        raise S.DomainError("the skill needs a body: the steps, checklist or rules to follow")
    cur = C.get_skill(slug)
    content = {"name": (name or slug).strip()[:80], "description": (description or "").strip()[:300], "body": body.strip()}
    if cur and cur["owner"] and cur["owner"] != st.id:
        raise S.DomainError(f"'{slug}' is another helper's skill; pick another id")
    if cur and not cur["owner"]:  # a team skill: propose the change
        item = _share_item(db, st, slug, content, update=True)
        return {"slug": slug, "status": "proposed", "inbox_id": item.id,
                "note": "This is a team skill, so your new version waits for the founder's approval."}
    sk = C.save_skill(slug, content["name"], content["description"], content["body"], owner=st.id, made_by=st.id)
    S.audit(db, f"staff:{st.id}", "skill.save", slug, personal=True)
    out = {"slug": slug, "status": "saved", "personal": True, "skill": {k: sk[k] for k in ("slug", "name", "description")}}
    if share:
        item = _share_item(db, st, slug, None)
        out.update(share="proposed", inbox_id=item.id)
    db.commit()
    return out


def _share_item(db: Session, st: Staff, slug: str, content: dict | None, update: bool = False) -> InboxItem:
    old = db.scalar(select(InboxItem).where(InboxItem.kind == SHARE, InboxItem.ref_id == slug, InboxItem.status == "open"))
    if old:
        old.status, old.closed_at = "done", S.now()
        old.answer = "replaced by a newer request"
    sk = C.get_skill(slug) or {}
    name = (content or sk).get("name", slug)
    title = f"{st.name} {'updated the team skill' if update else 'wants to share a skill'}: {name}"
    item = InboxItem(kind=SHARE, ref_id=slug, staff_id=st.id, title=title[:300], level="decision",
                     body=json.dumps({"slug": slug, "staff_id": st.id, "update": update, "content": content}))
    db.add(item)
    db.commit()
    return item


def share_view(item: InboxItem) -> dict:
    d = json.loads(item.body or "{}")
    sk = C.get_skill(d.get("slug", "")) or {}
    content = d.get("content") or sk
    return {"slug": d.get("slug"), "update": bool(d.get("update")), "name": content.get("name"), "description": content.get("description"),
            "body": content.get("body", ""), "current_body": sk.get("body") if d.get("update") else None}


def decide_share(db: Session, item: InboxItem, approve: bool, by: str, note: str = "") -> dict:
    if item.kind != SHARE:
        raise S.DomainError("not a skill request", 404)
    if item.status != "open":
        raise S.DomainError(f"already {item.status}", 409)
    d = json.loads(item.body or "{}")
    slug = d.get("slug", "")
    sk = C.get_skill(slug)
    if sk is None and not d.get("content"):
        raise S.DomainError("the skill is gone", 404)
    if approve:
        c = d.get("content") or sk
        C.save_skill(slug, c["name"], c.get("description", ""), c["body"], default_on=True, owner=None, made_by=d.get("staff_id"))
    item.status, item.closed_at = "done", S.now()
    item.answer = "approved" if approve else (note or "kept personal")
    if not approve and d.get("staff_id"):
        from . import memory as M

        if db.get(Staff, d["staff_id"]):
            M.add_lesson(db, d["staff_id"], f"The founder kept the skill '{slug}' {'as it was' if d.get('update') else 'personal'}" + (f": {note}" if note else "."))
    S.audit(db, by, "skill.share" if approve else "skill.keep_personal", slug)
    db.commit()
    return {"slug": slug, "shared": approve}


# ------------------------------------------------------------------ reaching out
def _dm(db: Session, st: Staff) -> Thread:
    from . import jobs as J

    return J.dm_thread(db, st)


def message_founder(db: Session, st: Staff, text: str, options: list[str] | None = None) -> Message:
    """A helper starts a conversation with the founder in its own chat (an idea, a check-in, a question)."""
    text = (text or "").strip()
    if not text:
        raise S.DomainError("write the message")
    th = _dm(db, st)
    sent = db.scalar(select(func.count()).select_from(Message).where(Message.thread_id == th.id, Message.author == st.id,
                                                                  Message.at >= _today(db), Message.channel == "outreach"))
    if sent >= MAX_FOUNDER_MESSAGES_PER_DAY:
        raise S.DomainError(f"you already wrote to the founder {sent} times today; keep the rest for your report", 429)
    blocks = [{"type": "text", "text": text}]
    opts = [str(o)[:80] for o in (options or []) if str(o).strip()][:5]
    if opts:
        blocks.append({"type": "choices", "options": opts})
    m = S.post_message(db, th, "agent", st.id, text, blocks=blocks, channel="outreach")
    return m  # posting it notifies the founder (notify.py)


def ask_teammate(db: Session, st: Staff, teammate: str, question: str) -> dict:
    """Ask a teammate in the team chat; they answer there, right after."""
    from . import teamchat as TC

    mate = db.get(Staff, teammate) or next((s for s in TC.team(db) if s.name.lower() == (teammate or "").lower()), None)
    if mate is None or mate.status == "retired":
        raise S.DomainError("unknown teammate; use their id or name from get_context")
    if mate.id == st.id:
        raise S.DomainError("that's you")
    question = (question or "").strip()
    if not question:
        raise S.DomainError("write the question")
    th = TC.general(db)
    asked = db.scalar(select(func.count()).select_from(Message).where(Message.thread_id == th.id, Message.author == st.id,
                                                                    Message.at >= _today(db), Message.channel == "teammate"))
    if asked >= MAX_TEAMMATE_QUESTIONS_PER_DAY:
        raise S.DomainError("you asked teammates a lot today; collect the rest and ask tomorrow", 429)
    text = f"@{mate.name} {question}"
    m = S.post_message(db, th, "agent", st.id, text, blocks=[{"type": "text", "text": text}, {"type": "mentions", "ids": [mate.id]}],
                       channel="teammate")
    th.pending = [mate.id]
    th.awaiting_reply = True
    db.commit()
    return {"thread_id": th.id, "message_id": m.id,
            "note": f"{mate.name} answers in the team chat. Read it later with read_team_chat, or recall."}


def read_team_chat(db: Session, limit: int = 20) -> list[dict]:
    from . import teamchat as TC

    th = TC.general(db)
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    rows = list(db.scalars(select(Message).where(Message.thread_id == th.id).order_by(Message.at.desc()).limit(max(1, min(limit, 50)))))
    return [{"at": m.at.isoformat(), "from": "founder" if m.role == "owner" else names.get(m.author, m.author), "text": m.text[:1500]}
            for m in reversed(rows)]


# ------------------------------------------------------------------ the weekly learning job
def learning_cron(staff_id: str) -> str:
    """Spread helpers over the week: a weekday afternoon, its own minute."""
    h = zlib.crc32(staff_id.encode())
    return f"{h % 50 + 5} {14 + h % 3} * * {1 + h % 5}"


def ensure_learning_shift(db: Session, st: Staff, commit: bool = True) -> Shift | None:
    if st.status == "retired" or db.scalar(select(Shift).where(Shift.staff_id == st.id, Shift.name == LEARN_SHIFT)):
        return None
    sh = S.add_shift(db, st, LEARN_SHIFT, learning_cron(st.id), LEARN_BRIEF, commit=commit)
    return sh
