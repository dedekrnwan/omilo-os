"""Thread-grouping, focus aggregation and participant derivation helpers.

All computations are derived at read time — no new DB columns.

Grouping cutoffs (documented here as the definitive record):
  - needs_you: thread.awaiting_reply is True
  - active:    awaiting_reply is False AND updated within the last 4 hours
  - earlier:   awaiting_reply is False AND updated more than 4 hours ago

4 hours was chosen because it spans a typical half-day work block; threads that
had activity "this morning" still feel live, while threads from yesterday
naturally fall into "earlier".

Participant derivation:
  participants = thread.pending (helpers yet to reply to the latest message)
                 ∪ distinct authors of agent-role messages in the thread

This is purely read-time and covers the "persistent membership" need:
- pending already tracks who is in the current conversational loop.
- Past agent-message authors record every helper that has *ever* spoken.
No nullable Thread.participants column is needed; derivation is sufficient.
(Ruling: a helper who is @mentioned once stays in the participants set for
the lifetime of the thread because their agent-message author record persists.
The only edge case—a helper who was pending but the message was cancelled before
they answered—is acceptable: they drop off pending but their older messages
still anchor them. This edge is not worth a DB column.)
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Checkpoint, KbSource, Message, Proposal, Task, Thread

# Cutoff separating "active" from "earlier" (non-awaiting threads).
_ACTIVE_CUTOFF_HOURS = 4


# ---------------------------------------------------------------------------
# Grouping
# ---------------------------------------------------------------------------

def group(th: Thread) -> str:
    """Return 'needs_you' | 'active' | 'earlier' for a thread."""
    if th.awaiting_reply:
        return "needs_you"
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(hours=_ACTIVE_CUTOFF_HOURS)
    updated = th.updated_at
    if updated is not None and updated.tzinfo is None:
        updated = updated.replace(tzinfo=dt.UTC)
    if updated is not None and updated >= cutoff:
        return "active"
    return "earlier"


# ---------------------------------------------------------------------------
# Participant derivation
# ---------------------------------------------------------------------------

def participants(db: Session, th: Thread) -> list[str]:
    """staff ids = thread.pending ∪ distinct agent/system-message authors.

    Both 'agent' (AI replies) and 'system' (join events written by add-helper)
    are counted so a helper added via POST /add-helper shows up immediately.
    'owner' role messages are excluded (the owner is not a helper participant).
    """
    pending = list(th.pending or [])
    authors = list(
        db.scalars(
            select(Message.author)
            .where(
                Message.thread_id == th.id,
                Message.role.in_(["agent", "system"]),
            )
            .distinct()
        )
    )
    seen: set[str] = set()
    result: list[str] = []
    for sid in pending + authors:
        if sid not in seen:
            seen.add(sid)
            result.append(sid)
    return result


# ---------------------------------------------------------------------------
# Subtitle
# ---------------------------------------------------------------------------

def subtitle(db: Session, th: Thread) -> str:
    """One-line subtitle: last message text truncated, or the thread title."""
    last_msg = db.scalar(
        select(Message)
        .where(Message.thread_id == th.id)
        .order_by(Message.at.desc())
        .limit(1)
    )
    if last_msg and last_msg.text:
        return last_msg.text[:120].replace("\n", " ")
    return th.title or ""


# ---------------------------------------------------------------------------
# Serialisation extras (added onto the base X.thread() dict)
# ---------------------------------------------------------------------------

def enrich(db: Session, th: Thread) -> dict:
    """Return the derived extra fields to merge into a serialised thread dict."""
    _updated = th.updated_at
    if _updated is not None and _updated.tzinfo is None:
        _updated = _updated.replace(tzinfo=dt.UTC)
    last_at = _updated.isoformat() if _updated else None

    extras: dict = {
        "group": group(th),
        "subtitle": subtitle(db, th),
        "participants": participants(db, th),
        "last_at": last_at,
    }

    if th.scope == "task" and th.ref_id:
        task = db.get(Task, th.ref_id)
        if task:
            extras["task_id"] = task.id
            extras["task_status"] = task.status

    # Bug #3 + Bug #4: enrich proposal threads so the frontend can surface proposal context,
    # and mark a pending proposal thread as needs_you so the workspace rail matches the inbox count.
    if th.scope == "proposal" and th.ref_id:
        from .services import current_body
        proposal = db.get(Proposal, th.ref_id)
        if proposal:
            extras["proposal_id"] = proposal.id
            extras["proposal_title"] = proposal.title
            extras["proposal_status"] = proposal.status
            extras["proposal_risk"] = proposal.risk
            extras["proposal_body"] = current_body(proposal)
            # Bug #4: a pending proposal needs the founder — surface it as needs_you in the workspace rail.
            if proposal.status == "pending":
                extras["group"] = "needs_you"

    return extras


# ---------------------------------------------------------------------------
# Focus aggregation
# ---------------------------------------------------------------------------

def _iso_dur_minutes(started_at, ended_at) -> int:
    if not started_at or not ended_at:
        return 0
    s = started_at if started_at.tzinfo else started_at.replace(tzinfo=dt.UTC)
    e = ended_at if ended_at.tzinfo else ended_at.replace(tzinfo=dt.UTC)
    return max(0, int((e - s).total_seconds() / 60))


def focus(db: Session, th: Thread) -> dict:
    """Aggregate progress, files, and cost for the Focus panel.

    If the thread has scope='task' and ref_id pointing to a Task, all three
    sections are populated from that task.  Otherwise returns empty/zeroed.
    """
    empty = {"progress": [], "files": [], "cost": {"usd": 0.0, "tokens": 0, "minutes": 0}}

    if th.scope != "task" or not th.ref_id:
        return empty

    task = db.get(Task, th.ref_id)
    if not task:
        return empty

    # --- progress: from the latest Checkpoint.plan ---
    progress: list[dict] = []
    ckp = db.scalar(
        select(Checkpoint)
        .where(Checkpoint.task_id == task.id)
        .order_by(Checkpoint.at.desc())
        .limit(1)
    )
    if ckp and ckp.plan:
        plan = ckp.plan
        if isinstance(plan, list):
            for step in plan:
                if isinstance(step, dict):
                    progress.append({
                        "label": step.get("label", str(step)),
                        "status": step.get("status", "done"),
                    })
        elif isinstance(plan, dict):
            for k, v in plan.items():
                progress.append({"label": k, "status": str(v)})

    # --- files: KbSource where ref ∈ {thread_id, task_id} ---
    refs = list({th.id, task.id})
    kb_rows = list(db.scalars(select(KbSource).where(KbSource.ref.in_(refs))))
    files = [
        {"title": k.title or k.ref, "kind": k.kind, "ref": k.ref, "url": k.url or ""}
        for k in kb_rows
    ]

    # --- cost: from task ---
    minutes = _iso_dur_minutes(task.started_at, task.ended_at)
    cost = {
        "usd": round(task.cost_usd or 0.0, 4),
        "tokens": task.tokens or 0,
        "minutes": minutes,
    }

    return {"progress": progress, "files": files, "cost": cost}
