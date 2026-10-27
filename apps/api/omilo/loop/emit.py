"""omilo.loop.emit — RunEvent writer + optional publish hook.

``make_emitter`` is the single RunEvent sink used by both inline (T5) and
WS (T6) callers.  Every event dict ``{"kind": ..., "data": {...}}`` is:

1. Written as a ``RunEvent`` row (company_id from job, job_id, helper_id,
   session_id, kind, data).
2. Forwarded to the optional ``publish`` hook (Task 8's SSE/WS broker fills
   this seam; the default is a no-op).
"""
from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.orm import Session

from omilo.models.base import prefixed_id
from omilo.models.execution import RunEvent


def make_emitter(
    db: Session,
    job: object,  # omilo.models.execution.Job (avoids circular import)
    session_id: str | None = None,
    publish: Callable[[str, dict], None] | None = None,
) -> Callable[[dict], None]:
    """Return an emit callable scoped to *job*.

    The returned function accepts an event dict::

        emit({"kind": "thinking", "data": {"text": "..."}})

    It writes a ``RunEvent`` row and, if *publish* is provided, calls::

        publish(company_id, event_dict)

    Args:
        db:         The company-scoped SQLAlchemy session.  Must already have
                    a transaction open (the caller owns the transaction).
        job:        The Job ORM object (provides company_id, id, helper_id).
        session_id: Optional chat session ID to record on the event.
        publish:    Optional hook — ``(company_id: str, event: dict) -> None``.
                    Task 8's SSE broker will supply this at runtime.

    Returns:
        ``emit(event: dict) -> None`` — the single RunEvent sink.
    """
    def emit(event: dict) -> None:
        kind = event.get("kind", "unknown")
        data = event.get("data", {})

        run_event = RunEvent(
            id=prefixed_id("evt"),
            company_id=job.company_id,
            job_id=job.id,
            helper_id=job.helper_id,
            session_id=session_id,
            kind=kind,
            data=data,
        )
        db.add(run_event)
        db.flush()  # persist within the outer transaction

        if publish is not None:
            publish(job.company_id, event)

    return emit
