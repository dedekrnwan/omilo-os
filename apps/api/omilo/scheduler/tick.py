"""omilo.scheduler.tick — Company-scoped scheduler tick.

Public API:
    scheduler_tick(db, now) -> int

Design:
- Company-scoped: caller opens a company-scoped DB session with app.company_id GUC.
- Finds all Routines: enabled=True, paused=False, next_at <= now.
- For each: start_job(origin="routine"), create RoutineRun, set last_at=now,
  advance next_at via croniter.
- Also calls fire_scheduled_flows(db, now) and poll_connector_flows(db, now)
  from omilo.flows.triggers to fire due schedule/connector_poll flows.
- Returns total count of routines + flows fired.
- Idempotent-ish: advancing next_at/poll_cursor past `now` ensures each item
  fires once per due window — a second tick with the same `now` skips.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from omilo.models.routines import Routine
from omilo.scheduler.cadence import _tz, is_holiday, next_fire
from omilo.scheduler.runs import fire_routine, record_skip


def scheduler_tick(db: Session, now: datetime) -> int:
    """Find and fire all due Routines for the company in this session.

    Args:
        db:  Company-scoped SQLAlchemy session (caller owns the transaction).
             Must have SET LOCAL app.company_id so RLS restricts to one company.
        now: The reference "current time" for this tick.  Must be timezone-aware
             (UTC).  Passing a controlled value makes the function deterministic
             and testable.

    Returns:
        Number of routines fired in this tick.
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    # Auto-resume routines whose pause window ended (paused_until <= now).
    for r in (
        db.query(Routine)
        .filter(Routine.paused.is_(True), Routine.paused_until.isnot(None), Routine.paused_until <= now)
        .all()
    ):
        r.paused = False
        r.paused_until = None
        r.next_at = next_fire(r, now)
    db.flush()

    # Find all due, enabled, non-paused routines visible in this session.
    # RLS restricts to the company whose GUC is set on this db session.
    due: list[Routine] = (
        db.query(Routine)
        .filter(
            Routine.enabled.is_(True),
            Routine.paused.is_(False),
            Routine.next_at <= now,
        )
        .all()
    )

    # Also fire due schedule flows and poll connector_poll flows.
    # Import here (lazy) to avoid circular import at module level.
    from omilo.flows.triggers import fire_scheduled_flows, poll_connector_flows

    fired = 0

    # Fire schedule flows before routines (order doesn't matter functionally)
    fired += fire_scheduled_flows(db, now)
    fired += poll_connector_flows(db, now)

    for routine in due:
        # Advance next_at BEFORE firing so a successful tick moves the window
        # forward and a second tick with the same `now` finds next_at > now → skips.
        # If start_job raises, the transaction rolls back (including the next_at
        # advance), so the routine remains due and will be retried on the next tick.
        due_at = routine.next_at or now
        routine.next_at = next_fire(routine, now)
        routine.last_at = now
        db.flush()

        # Skip public holidays when the routine asks for it (records a skip).
        local_day = due_at.astimezone(_tz(routine.timezone)).date()
        if routine.skip_holidays and is_holiday(local_day):
            record_skip(db, routine, due_at, "a public holiday")
            continue

        fire_routine(db, routine, trigger="schedule", when=now)
        fired += 1

    return fired
