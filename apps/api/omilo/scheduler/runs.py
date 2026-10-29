"""omilo.scheduler.runs — fire a routine and record its RoutineRun.

Shared by the scheduler tick, ``POST /routines/{id}/run-now`` and the run
re-send endpoint so every run row carries a real outcome, duration, cost and
error taken from the Job the engine produced.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.base import prefixed_id
from omilo.models.routines import Routine, RoutineRun

# Job.status → RoutineRun.outcome
_FAIL_STATUSES = {"failed", "blocked", "cancelled", "paused_offline"}


def outcome_for_job_status(status: str | None) -> str:
    if status in _FAIL_STATUSES:
        return "fail"
    if status in ("queued", "running"):
        return "running"
    return "ok"  # done | waiting (awaiting approval still counts as a good run)


def fire_routine(
    db: Session,
    routine: Routine,
    *,
    trigger: str,
    when: datetime | None = None,
) -> tuple[object, RoutineRun]:
    """Start a Job for ``routine`` and record a RoutineRun. Returns (job, run)."""
    when = when or datetime.now(timezone.utc)
    job = start_job(
        db,
        company_id=routine.company_id,
        helper_id=routine.helper_id,
        origin="routine",
        brief=routine.instructions,
    )
    job.routine_id = routine.id

    duration = None
    if job.started_at and job.ended_at:
        duration = max(0, int((job.ended_at - job.started_at).total_seconds()))

    run = RoutineRun(
        id=prefixed_id("rrn"),
        company_id=routine.company_id,
        routine_id=routine.id,
        job_id=job.id,
        when=when,
        outcome=outcome_for_job_status(job.status),
        duration=duration,
        skipped=False,
        cost_credits=job.cost_credits or 0,
        trigger=trigger,
        error=job.error if job.status in _FAIL_STATUSES else None,
    )
    db.add(run)
    routine.last_at = when
    db.flush()
    return job, run


def record_skip(db: Session, routine: Routine, when: datetime, reason: str) -> RoutineRun:
    run = RoutineRun(
        id=prefixed_id("rrn"),
        company_id=routine.company_id,
        routine_id=routine.id,
        job_id=None,
        when=when,
        outcome="skip",
        duration=None,
        skipped=True,
        cost_credits=0,
        trigger="schedule",
        error=reason,
    )
    db.add(run)
    db.flush()
    return run


def sync_run_from_job(run: RoutineRun, job: object) -> None:
    """Refresh a run's outcome/duration/cost from its (possibly finished) Job."""
    status = getattr(job, "status", None)
    run.outcome = outcome_for_job_status(status) if not run.skipped else "skip"
    started = getattr(job, "started_at", None)
    ended = getattr(job, "ended_at", None)
    if started and ended:
        run.duration = max(0, int((ended - started).total_seconds()))
    run.cost_credits = getattr(job, "cost_credits", 0) or 0
    if status in _FAIL_STATUSES:
        run.error = getattr(job, "error", None) or run.error
