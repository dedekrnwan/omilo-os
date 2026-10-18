"""Team chats and @mentions.

A team chat (thread scope "group") is a room with the owner and the whole team. The Chief of Staff answers when no
one is named; "@Marketing" (or "@marketing") brings that helper in, and several can be named at once. Mentions work in
one-to-one chats too: the named helper joins that conversation for its reply. A helper that names a teammate in its
own reply hands over: the teammate answers next (at most a few replies per message, so helpers can't loop).

Who still has to answer is kept on the thread (`pending`); the worker answers them one by one, in order.
"""
from __future__ import annotations

import re
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services as S
from .models import Message, Staff, Thread

GENERAL = "general"
MAX_REPLIES = 4  # helpers that answer one message of yours, hand-overs included


def team(db: Session) -> list[Staff]:
    return [s for s in db.scalars(select(Staff)) if s.status != "retired"]


def mentions(db: Session, text: str, ids: list[str] | None = None) -> list[str]:
    """The helpers named in `text` with @Name or @id (longest names first, so "@Chief of Staff" beats "@Chief"), in
    the order they appear, plus any `ids` the composer sent (only real helpers)."""
    people = team(db)
    by_key: dict[str, str] = {}
    for s in people:
        by_key[s.name.lower()] = s.id
        by_key[s.id.lower()] = s.id
    keys = sorted(by_key, key=len, reverse=True)
    if not keys:
        return []
    pat = re.compile(r"(?<![\w@])@(" + "|".join(re.escape(k) for k in keys) + r")(?![\w-])", re.IGNORECASE)
    found = [(m.start(), by_key[m.group(1).lower()]) for m in pat.finditer(text or "")]
    out = list(dict.fromkeys(sid for _, sid in sorted(found)))
    known = {s.id for s in people}
    for sid in ids or []:
        if sid in known and sid not in out:
            out.append(sid)
    return out


def general(db: Session) -> Thread:
    """The team's main room, made on first use."""
    th = db.scalar(select(Thread).where(Thread.scope == "group", Thread.ref_id == GENERAL))
    if th:
        return th
    chief = S.chief(db)
    if not chief:
        raise S.DomainError("no Chief of Staff yet: create the team first", 409)
    th = Thread(scope="group", ref_id=GENERAL, staff_id=chief.id, title="General")
    db.add(th)
    db.commit()
    return th


def create(db: Session, title: str) -> Thread:
    chief = S.chief(db)
    if not chief:
        raise S.DomainError("no Chief of Staff yet: create the team first", 409)
    title = " ".join((title or "").split())[:80] or "New chat"
    th = Thread(scope="group", ref_id=f"grp_{secrets.token_hex(4)}", staff_id=chief.id, title=title)
    db.add(th)
    db.commit()
    return th


def post(db: Session, th: Thread, user_id: str, text: str, blocks: list | None, mention_ids: list[str] | None = None) -> Message:
    """The owner writes: who answers is the people named, else the room's default (the Chief of Staff in a team chat,
    the helper in a one-to-one chat). In a one-to-one chat the helper you are talking to answers too."""
    named = mentions(db, text, mention_ids)
    if th.scope == "group":
        who = named or [th.staff_id]
    else:
        who = list(dict.fromkeys([th.staff_id, *named]))
    who = who[:MAX_REPLIES]
    if named:
        blocks = [*(blocks or [{"type": "text", "text": text}]), {"type": "mentions", "ids": named}]
    th.pending = who
    return S.post_message(db, th, "owner", user_id, text, blocks, awaiting_reply=True)


def responders(th: Thread) -> list[str]:
    return list(th.pending or []) or [th.staff_id]


def handover(db: Session, th: Thread, author: str, text: str, answered: list[str]) -> list[str]:
    """Teammates a helper named in its reply, who haven't answered this message yet: they go next."""
    if len(answered) >= MAX_REPLIES:
        return []
    named = [s for s in mentions(db, text) if s != author and s not in answered and s not in (th.pending or [])]
    return named[: MAX_REPLIES - len(answered)]


def shared(th: Thread, staff_id: str) -> bool:
    """More than one helper talks in this thread (so an engine must not resume one helper's private session)."""
    return th.scope == "group" or staff_id != th.staff_id


def history(db: Session, th: Thread, me: Staff, msgs: list[Message]) -> list[dict]:
    """The conversation as `me` sees it: your words and teammates' words come in as the other side (named), its own
    words as its side; turns from the same side are joined so engines get a clean back-and-forth.

    The founder's most recent message is tagged as the one to answer, so a brought-in helper doesn't mistake a
    question a teammate put to the founder (merged into the same user turn) for its own cue."""
    names = {s.id: s.name for s in team(db)}
    last_owner = next((m.id for m in reversed(msgs) if m.role == "owner" and (m.text or "").strip()), None)
    out: list[dict] = []
    for m in msgs:
        if m.role not in ("owner", "agent") or not (m.text or "").strip():
            continue
        if m.role == "agent" and m.author == me.id:
            role, text = "agent", m.text
        elif m.role == "agent":
            role, text = "owner", f"[{names.get(m.author, m.author)}, your teammate, wrote]\n{m.text}"
        elif shared(th, me.id):
            tag = "The founder's latest message — this is what to answer" if m.id == last_owner else "The founder wrote"
            role, text = "owner", f"[{tag}]\n{m.text}"
        else:
            role, text = "owner", m.text
        if out and out[-1]["role"] == role:
            out[-1]["text"] += "\n\n" + text
        else:
            out.append({"role": role, "text": text})
    return out


def note(db: Session, th: Thread, me: Staff, answered: list[str]) -> str:
    """What the helper needs to know about the room it is answering in."""
    names = {s.id: s.name for s in team(db)}
    others = [n for sid, n in names.items() if sid != me.id]  # plain names: listing them must not hand over
    if th.scope == "group":
        head = (f"This is the team chat \"{th.title}\": the founder and the whole team. "
                f"{'The founder asked the team; as Chief of Staff you answer and route' if me.id == th.staff_id and not answered else 'You were brought in by name'}. "
                "Answer the founder's latest message; a question a teammate put to the founder is theirs, not yours to answer.")
    else:
        head = f"You were brought into the founder's chat with {names.get(th.staff_id, th.staff_id)}." if me.id != th.staff_id else ""
    done = f" Already answered this message: {', '.join(names.get(a, a) for a in answered)}." if answered else ""
    tail = (f" Answer only for your part, briefly. Teammates: {', '.join(others[:12])}. To hand over to one, put an @ right before "
            "their name in your reply; they answer right after you. Don't repeat what a teammate already said.")
    return (head + done + tail).strip() if (head or answered or th.scope == "group") else ""
