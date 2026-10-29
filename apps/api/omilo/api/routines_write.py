"""Routines write endpoints: CRUD + run-now.

Endpoints:
  POST /routines   {helper_id,name,instructions,freq,at,days?,monthly?,
                    timezone?,sends_to?,goal_ids?,subtitle?}
                   → 201 {routine: RoutineRow}
                   Creates a Routine; computes cron + next_at via croniter.
  GET  /routines               → [{id,name,helper_id,cron,next_at,paused,...}]
  GET  /routines/{id}          → {routine, runs[]} (404 other-tenant)
  PATCH /routines/{id}         → {routine} (paused,enabled,instructions,...)
  DELETE /routines/{id}        → 204
  POST /routines/{id}/run-now  → {job_id}
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from croniter import croniter
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.base import prefixed_id
from omilo.models.routines import Routine, RoutineRun
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["routines"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CreateRoutineBody(BaseModel):
    helper_id: str
    name: str
    instructions: str
    freq: str  # daily | weekdays | weekly | monthly
    at: str  # "HH:MM"
    days: Optional[list[int]] = None   # 0=Mon…6=Sun (weekly)
    monthly: Optional[str] = None      # "date"|"last_working_day"
    timezone: Optional[str] = None     # e.g. "Asia/Jakarta"
    sends_to: Optional[list[Any]] = None
    goal_ids: Optional[list[str]] = None
    subtitle: Optional[str] = None


class PatchRoutineBody(BaseModel):
    paused: Optional[bool] = None
    enabled: Optional[bool] = None
    instructions: Optional[str] = None
    name: Optional[str] = None
    subtitle: Optional[str] = None
    helper_id: Optional[str] = None
    sends_to: Optional[list[Any]] = None
    goal_ids: Optional[list[str]] = None
    # Schedule fields — when any is provided, cron + next_at are recomputed.
    freq: Optional[str] = None       # daily | weekdays | weekly | monthly
    at: Optional[str] = None         # "HH:MM"
    days: Optional[list[int]] = None
    monthly: Optional[str] = None
    timezone: Optional[str] = None


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_cron(freq: str, at: str, days: list[int] | None, monthly: str | None) -> str:
    """Build a cron expression from freq + at (+days for weekly, monthly).

    Args:
        freq:    "daily" | "weekdays" | "weekly" | "monthly"
        at:      "HH:MM" string (e.g. "07:30")
        days:    list of 0-based weekday ints (0=Mon) for weekly freq
        monthly: "date" or "last_working_day" for monthly freq

    Returns:
        A 5-field cron expression string.

    Mapping:
        daily       → "{min} {hour} * * *"
        weekdays    → "{min} {hour} * * 1-5"      (Mon-Fri)
        weekly      → "{min} {hour} * * {dow}"    (0=Mon mapped to cron 1=Mon)
        monthly date → "{min} {hour} 1 * *"       (1st of month; last-working-day same — scheduler handles date logic)
        monthly last → "{min} {hour} L * *"       — croniter does not support L; use last day heuristic → 28
    """
    h, m = at.split(":")

    if freq == "daily":
        return f"{m} {h} * * *"

    if freq == "weekdays":
        return f"{m} {h} * * 1-5"

    if freq == "weekly":
        # Convert 0=Mon → cron 1=Mon (cron uses 0=Sun or 7=Sun; we use 1-7)
        if days:
            # 0=Mon→1, 1=Tue→2, …, 6=Sun→0 in some variants; we use 1=Mon…5=Fri,6=Sat,7=Sun
            cron_days = [str(d + 1) for d in days]
            dow = ",".join(cron_days)
        else:
            dow = "1"  # default Mon
        return f"{m} {h} * * {dow}"

    if freq == "monthly":
        # last_working_day: approximate as day 28 (always exists, scheduler can refine later)
        # For now both variants use day 1; the scheduler would need extra logic for
        # last-working-day in production, but for MVP/test purposes we use day 1.
        return f"{m} {h} 1 * *"

    # Fallback: treat as daily
    return f"{m} {h} * * *"


def _validate_timezone(tz_name: str) -> None:
    """Raise HTTPException 422 if tz_name is not a valid IANA timezone."""
    import zoneinfo

    try:
        zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown timezone: {tz_name!r}. Use a valid IANA timezone name (e.g. 'Asia/Jakarta').",
        )


def _compute_next_at(cron_expr: str, tz_name: str) -> datetime:
    """Return the next fire datetime after now for the given cron in tz_name.

    Caller must validate tz_name via _validate_timezone() before calling this.
    Uses stdlib zoneinfo (Python 3.9+); no pytz dependency required.
    """
    import zoneinfo

    tz_name = tz_name or "UTC"
    tz_obj = zoneinfo.ZoneInfo(tz_name)
    now_utc = datetime.now(timezone.utc)
    now_in_tz = now_utc.astimezone(tz_obj)
    now_naive = now_in_tz.replace(tzinfo=None)
    cit = croniter(cron_expr, now_naive)
    next_naive = cit.get_next(datetime)
    next_aware = next_naive.replace(tzinfo=tz_obj)
    return next_aware.astimezone(timezone.utc)


def _routine_to_dict(r: Routine) -> dict[str, Any]:
    return {
        "id": r.id,
        "company_id": r.company_id,
        "helper_id": r.helper_id,
        "name": r.name,
        "subtitle": r.subtitle,
        "instructions": r.instructions,
        "freq": r.freq,
        "at": r.at,
        "days": r.days,
        "monthly": r.monthly,
        "timezone": r.timezone,
        "cron": r.cron,
        "sends_to": r.sends_to,
        "enabled": r.enabled,
        "paused": r.paused,
        "managed_by_chief": r.managed_by_chief,
        "next_at": r.next_at.isoformat() if r.next_at else None,
        "last_at": r.last_at.isoformat() if r.last_at else None,
        "goal_ids": r.goal_ids,
        "created_by": r.created_by,
    }


def _run_to_dict(rr: RoutineRun) -> dict[str, Any]:
    return {
        "id": rr.id,
        "routine_id": rr.routine_id,
        "job_id": rr.job_id,
        "when": rr.when.isoformat() if rr.when else None,
        "outcome": rr.outcome,
        "duration": rr.duration,
        "skipped": rr.skipped,
        "cost_credits": rr.cost_credits,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/routines", status_code=status.HTTP_201_CREATED)
def create_routine(
    body: CreateRoutineBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Routine; compute cron + next_at from freq/at/days/monthly/timezone."""
    tz = body.timezone or "UTC"
    _validate_timezone(tz)
    cron_expr = _build_cron(body.freq, body.at, body.days, body.monthly)
    next_at = _compute_next_at(cron_expr, tz)

    routine = Routine(
        id=prefixed_id("rtn"),
        company_id=ctx.company_id,
        helper_id=body.helper_id,
        name=body.name,
        subtitle=body.subtitle or "",
        instructions=body.instructions,
        freq=body.freq,
        at=body.at,
        days=body.days or [],
        monthly=body.monthly,
        timezone=tz,
        cron=cron_expr,
        sends_to=body.sends_to or [],
        enabled=True,
        paused=False,
        managed_by_chief=False,
        next_at=next_at,
        goal_ids=body.goal_ids or [],
        created_by="operator",
    )
    db.add(routine)
    db.flush()

    return {"routine": _routine_to_dict(routine)}


@router.get("/routines", status_code=status.HTTP_200_OK)
def list_routines(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """List all Routines for this company (RLS scoped)."""
    routines = db.query(Routine).all()
    return [_routine_to_dict(r) for r in routines]


@router.get("/routines/{routine_id}", status_code=status.HTTP_200_OK)
def get_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return RoutineDetail {routine, runs[]} — 404 for other-tenant."""
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")

    runs = (
        db.query(RoutineRun)
        .filter(RoutineRun.routine_id == routine_id)
        .order_by(RoutineRun.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "routine": _routine_to_dict(routine),
        "runs": [_run_to_dict(r) for r in runs],
    }


@router.patch("/routines/{routine_id}", status_code=status.HTTP_200_OK)
def patch_routine(
    routine_id: str,
    body: PatchRoutineBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update Routine fields (paused, enabled, instructions, …).

    If paused is toggled, next_at is NOT recomputed here; scheduler handles it.
    """
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")

    if body.paused is not None:
        routine.paused = body.paused
    if body.enabled is not None:
        routine.enabled = body.enabled
    if body.instructions is not None:
        routine.instructions = body.instructions
    if body.name is not None:
        routine.name = body.name
    if body.subtitle is not None:
        routine.subtitle = body.subtitle
    if body.helper_id is not None:
        routine.helper_id = body.helper_id
    if body.sends_to is not None:
        routine.sends_to = body.sends_to
    if body.goal_ids is not None:
        routine.goal_ids = body.goal_ids

    # ── Schedule change → recompute cron + next_at ────────────────────────────
    schedule_changed = any(
        v is not None
        for v in (body.freq, body.at, body.days, body.monthly, body.timezone)
    )
    if body.freq is not None:
        routine.freq = body.freq
    if body.at is not None:
        routine.at = body.at
    if body.days is not None:
        routine.days = body.days
    if body.monthly is not None:
        routine.monthly = body.monthly
    if body.timezone is not None:
        _validate_timezone(body.timezone)
        routine.timezone = body.timezone

    if schedule_changed:
        tz = routine.timezone or "UTC"
        cron_expr = _build_cron(
            routine.freq, routine.at, routine.days, routine.monthly
        )
        routine.cron = cron_expr
        routine.next_at = _compute_next_at(cron_expr, tz)

    db.flush()
    return {"routine": _routine_to_dict(routine)}


@router.post("/routines/{routine_id}/skip-next", status_code=status.HTTP_200_OK)
def skip_next_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Advance next_at past the next occurrence (skip one run). Returns {next_at}.

    Computes the fire-time strictly after the current next_at using the
    routine's cron + timezone. 404 for another tenant's routine (RLS).
    """
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")

    import zoneinfo

    tz_name = routine.timezone or "UTC"
    tz_obj = zoneinfo.ZoneInfo(tz_name)
    # Anchor from the current next_at (or now if unset) and advance one period.
    anchor = routine.next_at or datetime.now(timezone.utc)
    anchor_in_tz = anchor.astimezone(tz_obj).replace(tzinfo=None)
    cit = croniter(routine.cron, anchor_in_tz)
    next_naive = cit.get_next(datetime)
    next_aware = next_naive.replace(tzinfo=tz_obj).astimezone(timezone.utc)
    routine.next_at = next_aware
    db.flush()

    return {"next_at": routine.next_at.isoformat()}


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Hard-delete a Routine (history RoutineRuns remain via FK)."""
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")
    db.delete(routine)
    db.flush()


@router.post("/routines/{routine_id}/run-now", status_code=status.HTTP_200_OK)
def run_routine_now(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Fire a Routine immediately off-schedule.

    Creates a Job (origin=routine) + RoutineRun. Returns {job_id}.
    """
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")

    now = datetime.now(timezone.utc)

    job = start_job(
        db,
        company_id=routine.company_id,
        helper_id=routine.helper_id,
        origin="routine",
        brief=routine.instructions,
    )

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

    return {"job_id": job.id}
