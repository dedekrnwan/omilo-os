"""omilo.scheduler.tick — Company-scoped scheduler tick.

Public API:
    scheduler_tick(db, now) -> int

Design:
- Company-scoped: caller opens a company-scoped DB session with app.company_id GUC.
- Finds all Routines: enabled=True, paused=False, next_at <= now.
- For each: start_job(origin="routine"), create RoutineRun, set last_at=now,
  advance next_at via croniter.
- Returns count of routines fired.
- Idempotent-ish: advancing next_at past `now` ensures a routine fires once per
  due window — a second tick with the same `now` finds next_at > now → skips.
"""
from __future__ import annotations

from datetime import datetime, timezone

from croniter import croniter
from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.base import prefixed_id
from omilo.models.routines import Routine, RoutineRun


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

    fired = 0
    for routine in due:
        # Advance next_at BEFORE firing so a successful tick moves the window
        # forward and a second tick with the same `now` finds next_at > now → skips.
        # If start_job raises, the transaction rolls back (including the next_at
        # advance), so the routine remains due and will be retried on the next tick.
        cron_expr = routine.cron or "0 9 * * *"
        tz = routine.timezone or "UTC"
        try:
            import pytz  # type: ignore[import-untyped]
            tz_obj = pytz.timezone(tz)
        except Exception:
            import zoneinfo
            tz_obj = zoneinfo.ZoneInfo(tz)

        # croniter needs a naive datetime in the routine's timezone
        now_in_tz = now.astimezone(tz_obj)
        now_naive = now_in_tz.replace(tzinfo=None)
        cit = croniter(cron_expr, now_naive)
        next_naive = cit.get_next(datetime)
        # Convert back to UTC-aware
        try:
            next_aware = tz_obj.localize(next_naive)  # pytz
        except AttributeError:
            next_aware = next_naive.replace(tzinfo=tz_obj)  # zoneinfo
        next_utc = next_aware.astimezone(timezone.utc)

        # Advance next_at and record last_at
        routine.next_at = next_utc
        routine.last_at = now
        db.flush()

        # Fire: create a Job via the shared runner
        job = start_job(
            db,
            company_id=routine.company_id,
            helper_id=routine.helper_id,
            origin="routine",
            brief=routine.instructions,
        )

        # Record the run
        run = RoutineRun(
            id=prefixed_id("rrn"),
            company_id=routine.company_id,
            routine_id=routine.id,
            job_id=job.id,
            when=now,
            outcome="ok",
            skipped=False,
            cost_credits=job.cost_credits or 0,
        )
        db.add(run)
        db.flush()

        fired += 1

    return fired
