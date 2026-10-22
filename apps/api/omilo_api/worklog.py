"""Unified live work-state read model.

``live_state(db)`` is the single source of truth for *what is happening right now*
across every surface (Inbox board, Monitor, future dashboards).  It unions three
slices — active Tasks, awaiting-reply Threads, and open inbox proposals/questions —
into a flat list of ``WorkItem`` dicts.

This is READ-ONLY and deliberately surface-agnostic: it makes no decisions about
layout, grouping, or display labels.  Later tasks (A2 …) will make the board and
Monitor consume this function instead of their own bespoke queries.

WorkItem shape
--------------
{
    "kind":     "task" | "chat" | "proposal" | "question",
    "id":       str,          # task_id | thread_id | inbox_item_id
    "staff_id": str,
    "status":   "running" | "queued" | "waiting" | "working",
    "title":    str,          # first line of brief (task) or thread title / inbox title
    "goal_id":  str | None,   # populated from TaskGoal row when present, else None
    "since":    str | None,   # ISO-8601 timestamp (started_at/created_at/updated_at)
}
"""
from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import InboxItem, Task, TaskGoal, Thread

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _iso(d: dt.datetime | None) -> str | None:
    """Return UTC ISO-8601 string or None."""
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=dt.UTC)
    return d.isoformat()


def _first_line(text: str) -> str:
    """Return the first non-empty line of *text* (brief / title)."""
    for line in (text or "").splitlines():
        line = line.strip()
        if line:
            return line
    return text or ""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def live_state(db: Session) -> dict:
    """Return the unified live work-state as ``{"items": [WorkItem, ...]}``.

    Mirrors the three unions already computed inside ``office.state()`` (running
    Tasks, awaiting-reply Threads, open inbox proposals/questions) but returns a
    flat, surface-agnostic list instead of the per-agent nested structure.

    Queries
    -------
    1. Tasks with status in ("running", "queued", "waiting")
       — same WHERE clause as office.state's ``running`` + ``queued`` dicts.
    2. Threads with ``awaiting_reply IS TRUE``
       — same as office.state's ``chats`` dict.
    3. InboxItems with status="open" and kind in ("proposal", "question")
       — same as office.state's ``waiting`` dict (alerts excluded).

    For each task we do a best-effort JOIN against TaskGoal to populate goal_id.
    Everything is read-only; no writes, no bus calls, no engine calls.
    """
    items: list[dict] = []

    # ---- 1. Tasks (running | queued | waiting) ---------------------------
    tasks = list(db.scalars(
        select(Task)
        .where(Task.status.in_(["running", "queued", "waiting"]))
        .order_by(Task.started_at.nullsfirst(), Task.created_at)
    ))

    # Bulk-fetch TaskGoal rows for all active tasks in one query.
    task_ids = [t.id for t in tasks]
    goal_map: dict[str, str] = {}
    if task_ids:
        for row in db.execute(
            select(TaskGoal.task_id, TaskGoal.goal_id).where(TaskGoal.task_id.in_(task_ids))
        ):
            goal_map[row.task_id] = row.goal_id

    for task in tasks:
        since = task.started_at or task.created_at
        items.append({
            "kind": "task",
            "id": task.id,
            "staff_id": task.staff_id,
            "status": task.status,          # "running" | "queued" | "waiting"
            "title": _first_line(task.brief),
            "goal_id": goal_map.get(task.id),
            "since": _iso(since),
        })

    # ---- 2. Threads with awaiting_reply ----------------------------------
    threads = list(db.scalars(
        select(Thread)
        .where(Thread.awaiting_reply.is_(True))
        .order_by(Thread.updated_at)
    ))
    for thread in threads:
        items.append({
            "kind": "chat",
            "id": thread.id,
            "staff_id": thread.staff_id,
            "status": "working",
            "title": thread.title or "Replying to you",
            "goal_id": None,
            "since": _iso(thread.updated_at),
        })

    # ---- 3. Open InboxItems (proposals and questions) --------------------
    inbox_items = list(db.scalars(
        select(InboxItem)
        .where(
            InboxItem.status == "open",
            InboxItem.kind.in_(["proposal", "question"]),
        )
        .order_by(InboxItem.created_at)
    ))
    for item in inbox_items:
        if not item.staff_id:
            continue  # skip items not associated with a staff member
        items.append({
            "kind": item.kind,              # "proposal" | "question"
            "id": item.id,
            "staff_id": item.staff_id,
            "status": "working",            # helper is blocked, awaiting owner decision
            "title": item.title,
            "goal_id": None,
            "since": _iso(item.created_at),
        })

    return {"items": items}
