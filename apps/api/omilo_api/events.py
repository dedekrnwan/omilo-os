"""Live run events for the workspace view (what an agent is doing, step by step)."""
from __future__ import annotations

from sqlalchemy import select

from .db import session_scope
from .models import RunEvent, Task, Thread

MAX_TEXT = 4000


def _trim(v):
    if isinstance(v, str):
        return v if len(v) <= MAX_TEXT else v[:MAX_TEXT] + "…"
    if isinstance(v, dict):
        return {k: _trim(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_trim(x) for x in v[:50]]
    return v


def record(kind: str, data: dict, *, staff_id: str = "", task_id: str | None = None, thread_id: str | None = None, db=None) -> None:
    ev = RunEvent(kind=kind, data=_trim(data), staff_id=staff_id, task_id=task_id, thread_id=thread_id)
    if db is not None:
        db.add(ev)
        return
    with session_scope() as s:
        s.add(ev)


def current_run(db, staff_id: str, task_id: str | None = None) -> tuple[str | None, str | None]:
    """Which task or chat a tool call belongs to: the given task, else the helper's running task, else the chat awaiting its reply."""
    if task_id:
        return task_id, None
    t = db.scalar(select(Task.id).where(Task.staff_id == staff_id, Task.status == "running").order_by(Task.started_at.desc()))
    if t:
        return t, None
    th = db.scalar(select(Thread.id).where(Thread.staff_id == staff_id, Thread.awaiting_reply.is_(True)).order_by(Thread.updated_at.desc()))
    return None, th


class Emitter:
    """Handed to engines so they can report progress without knowing about the database."""

    def __init__(self, staff_id: str, task_id: str | None = None, thread_id: str | None = None):
        self.staff_id, self.task_id, self.thread_id = staff_id, task_id, thread_id

    def __call__(self, kind: str, **data) -> None:
        try:
            record(kind, data, staff_id=self.staff_id, task_id=self.task_id, thread_id=self.thread_id)
        except Exception:  # noqa: BLE001 - progress must never break the work
            pass


def noop(kind: str, **data) -> None:
    return None
