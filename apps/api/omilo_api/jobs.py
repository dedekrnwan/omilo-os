"""A helper proposes its own job, the founder approves.

Right after onboarding every helper writes to the founder in its own chat: how it understands its job for this business
(what it will own, measurable goals, first moves, a question). The founder approves with one click, or replies and the
helper sends a new version (the propose_job tool). Approving adds the agreed job to the helper's job description, which
it reads before every task.
"""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from . import services as S
from .models import Message, Staff, Thread

BLOCK = "job_proposal"


def dm_thread(db: Session, st: Staff) -> Thread:
    if st.is_chief:
        return S.get_or_create_thread(db, "master", None, st.id, "Chief of Staff")
    return S.get_or_create_thread(db, "staff", None, st.id, st.name)


def _clean(p: dict) -> dict:
    return {k: [str(x).strip()[:300] for x in (p.get(k) or []) if str(x).strip()][:8] for k in ("responsibilities", "goals", "ideas", "questions")}


def propose(db: Session, st: Staff, proposal: dict, intro: str = "", th: Thread | None = None) -> Message:
    """Post a job proposal card in the helper's chat (or `th`). Earlier open proposals in that chat are replaced."""
    th = th or dm_thread(db, st)
    p = _clean(proposal)
    if not p["responsibilities"]:
        raise S.DomainError("a job proposal needs at least one responsibility")
    for m in db.query(Message).filter(Message.thread_id == th.id, Message.author == st.id):
        blocks = list(m.blocks or [])
        if any(b.get("type") == BLOCK and b.get("status") == "pending" for b in blocks if isinstance(b, dict)):
            m.blocks = [{**b, "status": "replaced"} if isinstance(b, dict) and b.get("type") == BLOCK and b.get("status") == "pending" else b for b in blocks]
    text = intro.strip() or f"Here is how I see my job at {S.get_setting(db, 'company_name', '') or 'the company'}. Approve it, or tell me what to change."
    lines = [text, "", "**What I'll own**", *[f"- {x}" for x in p["responsibilities"]]]
    if p["goals"]:
        lines += ["", "**Goals I suggest**", *[f"- {x}" for x in p["goals"]]]
    if p["ideas"]:
        lines += ["", "**First moves**", *[f"- {x}" for x in p["ideas"]]]
    if p["questions"]:
        lines += ["", "**A question for you**", *[f"- {x}" for x in p["questions"]]]
    return S.post_message(db, th, "agent", st.id, "\n".join(lines),
                          blocks=[{"type": "text", "text": text}, {"type": BLOCK, "staff_id": st.id, "status": "pending", **p}])


AGREED = re.compile(r"\n*## Agreed with the founder\n.*?(?=\n## |\Z)", re.S)


def decide(db: Session, m: Message, decision: str, by: str) -> dict:
    """approve: the proposal becomes part of the helper's job description. Anything else is a reply in the chat."""
    from . import interview as I

    block = next((b for b in (m.blocks or []) if isinstance(b, dict) and b.get("type") == BLOCK), None)
    if block is None:
        raise S.DomainError("not a job proposal", 404)
    if block.get("status") != "pending":
        raise S.DomainError(f"this proposal is already {block.get('status')}", 409)
    st = db.get(Staff, block["staff_id"])
    if st is None:
        raise S.DomainError("unknown helper", 404)
    if decision != "approve":
        raise S.DomainError("decision must be approve (reply in the chat to ask for changes)", 400)
    job = AGREED.sub("", st.job or "").rstrip()
    st.job = (job + "\n\n" + I.job_text(block)).strip()
    m.blocks = [{**b, "status": "approved"} if b is block else b for b in m.blocks]
    S.audit(db, by, "staff.job_agreed", st.id)
    db.commit()
    return {"staff_id": st.id, "job": st.job}
