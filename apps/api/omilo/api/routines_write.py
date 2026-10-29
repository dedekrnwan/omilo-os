"""Routines endpoints: CRUD, run-now, schedule, run detail, suggestions.

Endpoints:
  POST /routines   {helper_id,name,instructions,freq,at,days?,monthly?,
                    timezone?,sends_to?,goal_ids?,subtitle?,allow_chief_shift?,
                    skip_holidays?,ask_before_sending?}
                   → 201 {routine: RoutineRow}
  GET  /routines                       → [RoutineRow + recent_runs[≤8]]
  GET  /routines/schedule?from&to      → {from,to,items[]} (cron expanded + past runs)
  POST /routines/preview               → {next_at,next_dates[],clashes[],suggested_slots[]}
  GET  /routines/suggestions           → [Suggestion]
  POST /routines/suggestions/{id}/apply   → {applied:[routine_id], routines:[RoutineRow]}
  POST /routines/suggestions/{id}/dismiss → {dismissed:true}
  POST /routines/runs/{run_id}/feedback {vote:'up'|'down'|null} → {run}
  POST /routines/runs/{run_id}/resend  → {resent,job_id,run_id,message}
  GET  /routines/{id}                  → {routine, runs[]} (404 other-tenant)
  GET  /routines/{id}/runs/{run_id}    → RunDetail (job, steps, logs, output, sources, delivery)
  PATCH /routines/{id}                 → {routine}
  DELETE /routines/{id}                → 204
  POST /routines/{id}/skip-next        → {next_at}
  POST /routines/{id}/run-now          → {job_id, run_id, outcome}
  POST /jobs/{job_id}/cancel           → {job_id, status}

Route order matters: the literal ``/routines/<word>`` paths are declared before
``/routines/{routine_id}`` so they are not captured by it.
"""
from __future__ import annotations

import hashlib
import zoneinfo
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.models.agents import Helper
from omilo.models.execution import Job, Report, RunEvent
from omilo.models.routines import Routine, RoutineRun
from omilo.scheduler.cadence import (
    at_of,
    build_cron,
    describe,
    iter_fires,
    local_weekdays,
    minutes_of,
    next_fire,
    normalize_freq,
    normalize_monthly,
)
from omilo.scheduler.runs import fire_routine, sync_run_from_job
from omilo.models.base import prefixed_id
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
    freq: str  # daily | weekdays | weekly | monthly (case-insensitive)
    at: str  # "HH:MM"
    days: Optional[list[int]] = None   # 0=Mon…6=Sun (weekly)
    monthly: Optional[str] = None      # "date"|"last_working_day"
    timezone: Optional[str] = None     # e.g. "Asia/Jakarta"
    sends_to: Optional[list[Any]] = None
    goal_ids: Optional[list[str]] = None
    subtitle: Optional[str] = None
    allow_chief_shift: Optional[bool] = None
    skip_holidays: Optional[bool] = None
    ask_before_sending: Optional[bool] = None


class PatchRoutineBody(BaseModel):
    paused: Optional[bool] = None
    paused_until: Optional[str] = None  # ISO datetime; "" clears
    enabled: Optional[bool] = None
    instructions: Optional[str] = None
    name: Optional[str] = None
    subtitle: Optional[str] = None
    helper_id: Optional[str] = None
    sends_to: Optional[list[Any]] = None
    goal_ids: Optional[list[str]] = None
    allow_chief_shift: Optional[bool] = None
    skip_holidays: Optional[bool] = None
    ask_before_sending: Optional[bool] = None
    # Schedule fields — when any is provided, cron + next_at are recomputed.
    freq: Optional[str] = None
    at: Optional[str] = None
    days: Optional[list[int]] = None
    monthly: Optional[str] = None
    timezone: Optional[str] = None


class PreviewBody(BaseModel):
    freq: str
    at: str
    days: Optional[list[int]] = None
    monthly: Optional[str] = None
    timezone: Optional[str] = None
    helper_id: Optional[str] = None
    exclude_id: Optional[str] = None  # the routine being edited


class FeedbackBody(BaseModel):
    vote: Optional[str] = None  # 'up' | 'down' | None (clear)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _build_cron(freq: str, at: str, days: list[int] | None, monthly: str | None) -> str:
    """Back-compat shim; see omilo.scheduler.cadence.build_cron."""
    return build_cron(freq, at, days, monthly)


def _validate_timezone(tz_name: str) -> None:
    """Raise HTTPException 422 if tz_name is not a valid IANA timezone."""
    try:
        zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown timezone: {tz_name!r}. Use a valid IANA timezone name (e.g. 'Asia/Jakarta').",
        )


def _validate_at(at: str) -> str:
    try:
        h, m = at.strip().split(":")
        h_i, m_i = int(h), int(m)
        assert 0 <= h_i < 24 and 0 <= m_i < 60
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid time {at!r}; use HH:MM.",
        )
    return f"{h_i:02d}:{m_i:02d}"


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _parse_iso(value: str, field: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid {field}: {value!r}",
        )
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _run_to_dict(rr: RoutineRun) -> dict[str, Any]:
    return {
        "id": rr.id,
        "routine_id": rr.routine_id,
        "job_id": rr.job_id,
        "when": _iso(rr.when),
        "outcome": rr.outcome,
        "duration": rr.duration,
        "skipped": rr.skipped,
        "cost_credits": rr.cost_credits,
        "trigger": rr.trigger,
        "error": rr.error,
        "feedback": rr.feedback,
    }


def _routine_to_dict(r: Routine, recent: list[RoutineRun] | None = None) -> dict[str, Any]:
    d = {
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
        "paused_until": _iso(r.paused_until),
        "managed_by_chief": r.managed_by_chief,
        "allow_chief_shift": r.allow_chief_shift,
        "skip_holidays": r.skip_holidays,
        "ask_before_sending": r.ask_before_sending,
        "next_at": _iso(r.next_at),
        "last_at": _iso(r.last_at),
        "goal_ids": r.goal_ids,
        "created_by": r.created_by,
    }
    if recent is not None:
        d["recent_runs"] = [_run_to_dict(x) for x in recent]
    return d


def _recent_runs_by_routine(db: Session, routine_ids: list[str], n: int = 8) -> dict[str, list[RoutineRun]]:
    """Last ``n`` runs per routine, oldest → newest (bar order)."""
    out: dict[str, list[RoutineRun]] = {rid: [] for rid in routine_ids}
    if not routine_ids:
        return out
    rows = (
        db.query(RoutineRun)
        .filter(RoutineRun.routine_id.in_(routine_ids))
        .order_by(RoutineRun.created_at.desc())
        .all()
    )
    for row in rows:
        lst = out.setdefault(row.routine_id, [])
        if len(lst) < n:
            lst.append(row)
    return {k: list(reversed(v)) for k, v in out.items()}


def _get_routine_or_404(db: Session, routine_id: str) -> Routine:
    routine = db.query(Routine).filter(Routine.id == routine_id).first()
    if routine is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Routine not found.")
    return routine


def _get_run_or_404(db: Session, run_id: str) -> RoutineRun:
    run = db.query(RoutineRun).filter(RoutineRun.id == run_id).first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")
    return run


def _recompute_schedule(routine: Routine) -> None:
    routine.cron = build_cron(routine.freq, routine.at, routine.days, routine.monthly)
    routine.next_at = next_fire(routine)


# ---------------------------------------------------------------------------
# Create / list
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
    at = _validate_at(body.at)
    freq = normalize_freq(body.freq)
    monthly = normalize_monthly(body.monthly) if freq == "monthly" else None
    if freq == "monthly" and monthly is None:
        monthly = "date"

    routine = Routine(
        id=prefixed_id("rtn"),
        company_id=ctx.company_id,
        helper_id=body.helper_id,
        name=body.name,
        subtitle=body.subtitle or "",
        instructions=body.instructions,
        freq=freq,
        at=at,
        days=body.days or [],
        monthly=monthly,
        timezone=tz,
        sends_to=body.sends_to or [],
        enabled=True,
        paused=False,
        managed_by_chief=False,
        goal_ids=body.goal_ids or [],
        created_by="operator",
        allow_chief_shift=True if body.allow_chief_shift is None else body.allow_chief_shift,
        skip_holidays=bool(body.skip_holidays),
        ask_before_sending=bool(body.ask_before_sending),
        dismissed_suggestions=[],
    )
    _recompute_schedule(routine)
    db.add(routine)
    db.flush()

    return {"routine": _routine_to_dict(routine, recent=[])}


@router.get("/routines", status_code=status.HTTP_200_OK)
def list_routines(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """List all Routines for this company (RLS scoped) with their last 8 runs."""
    routines = db.query(Routine).order_by(Routine.created_at.asc()).all()
    recent = _recent_runs_by_routine(db, [r.id for r in routines])
    return [_routine_to_dict(r, recent.get(r.id, [])) for r in routines]


# ---------------------------------------------------------------------------
# Schedule (Week view)
# ---------------------------------------------------------------------------


@router.get("/routines/schedule", status_code=status.HTTP_200_OK)
def routine_schedule(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Expand every routine's cadence between ``from`` and ``to`` (ISO datetimes).

    Past slots carry the matching run's status (ok|fail|skip|running); future
    slots are ``scheduled`` (or ``paused``). Manual runs inside the window are
    included too, flagged ``trigger: manual``.
    """
    start = _parse_iso(from_, "from")
    end = _parse_iso(to, "to")
    if end <= start:
        raise HTTPException(status_code=422, detail="'to' must be after 'from'.")
    if end - start > timedelta(days=62):
        raise HTTPException(status_code=422, detail="Range too large (max 62 days).")

    now = datetime.now(timezone.utc)
    routines = db.query(Routine).all()
    runs = (
        db.query(RoutineRun)
        .filter(RoutineRun.when >= start, RoutineRun.when <= end)
        .all()
    )
    runs_by_routine: dict[str, list[RoutineRun]] = {}
    for run in runs:
        runs_by_routine.setdefault(run.routine_id, []).append(run)

    items: list[dict[str, Any]] = []
    for r in routines:
        if not r.enabled:
            continue
        r_runs = sorted(runs_by_routine.get(r.id, []), key=lambda x: x.when)
        used: set[str] = set()
        for t in iter_fires(r, start - timedelta(seconds=1), end, include_holidays=True):
            item: dict[str, Any] = {
                "routine_id": r.id,
                "helper_id": r.helper_id,
                "name": r.name,
                "at": t.isoformat(),
                "status": "scheduled",
                "run_id": None,
                "trigger": "schedule",
            }
            # A run within 15 min of the slot belongs to it.
            match = next(
                (x for x in r_runs if x.id not in used and abs((x.when - t).total_seconds()) <= 900),
                None,
            )
            if match is not None:
                used.add(match.id)
                item["status"] = match.outcome or "ok"
                item["run_id"] = match.id
            elif t <= now:
                item["status"] = "missed"
            elif r.paused and (r.paused_until is None or t < r.paused_until):
                item["status"] = "paused"
            items.append(item)
        # Runs that didn't match a slot (run-now / re-runs).
        for x in r_runs:
            if x.id in used:
                continue
            items.append({
                "routine_id": r.id,
                "helper_id": r.helper_id,
                "name": r.name,
                "at": x.when.isoformat(),
                "status": x.outcome or "ok",
                "run_id": x.id,
                "trigger": x.trigger or "manual",
            })

    items.sort(key=lambda i: i["at"])
    return {"from": start.isoformat(), "to": end.isoformat(), "items": items}


# ---------------------------------------------------------------------------
# Preview (clash check for the New routine drawer)
# ---------------------------------------------------------------------------


_CLASH_WINDOW_MIN = 30


def _clashes_for(
    candidate: dict[str, Any],
    others: list[Routine],
    horizon_start: datetime,
    horizon_days: int = 14,
) -> list[dict[str, Any]]:
    end = horizon_start + timedelta(days=horizon_days)
    fires = iter_fires(candidate, horizon_start, end)
    if not fires:
        return []
    found: dict[str, dict[str, Any]] = {}
    for o in others:
        o_fires = iter_fires(o, horizon_start, end)
        for f in fires:
            hit = next((g for g in o_fires if abs((g - f).total_seconds()) < _CLASH_WINDOW_MIN * 60), None)
            if hit is not None:
                found[o.id] = {
                    "routine_id": o.id,
                    "name": o.name,
                    "helper_id": o.helper_id,
                    "at": o.at,
                    "cadence": describe(o),
                    "when": hit.isoformat(),
                }
                break
    return list(found.values())


def _preview(db: Session, body: PreviewBody) -> dict[str, Any]:
    tz = body.timezone or "UTC"
    _validate_timezone(tz)
    at = _validate_at(body.at)
    cand = {
        "freq": normalize_freq(body.freq),
        "at": at,
        "days": body.days or [],
        "monthly": normalize_monthly(body.monthly),
        "timezone": tz,
    }
    now = datetime.now(timezone.utc)
    q = db.query(Routine).filter(Routine.enabled.is_(True), Routine.paused.is_(False))
    if body.helper_id:
        q = q.filter(Routine.helper_id == body.helper_id)
    others = [o for o in q.all() if o.id != body.exclude_id]

    nexts = iter_fires(cand, now, now + timedelta(days=400), limit=3)
    clashes = _clashes_for(cand, others, now)

    slots: list[dict[str, Any]] = []
    if clashes:
        base = minutes_of(at)
        for delta in (30, 60, -60, 90, 120, -120, 180):
            m = base + delta
            if m < 6 * 60 or m > 21 * 60:  # stay inside working hours
                continue
            alt = {**cand, "at": at_of(m)}
            if not _clashes_for(alt, others, now):
                alt_next = iter_fires(alt, now, now + timedelta(days=400), limit=1)
                slots.append({
                    "freq": alt["freq"],
                    "at": alt["at"],
                    "days": alt["days"],
                    "monthly": alt["monthly"],
                    "label": describe(alt),
                    "next_at": alt_next[0].isoformat() if alt_next else None,
                    "recommended": not slots,
                    "reason": (
                        f"Right after {clashes[0]['name']}" if delta > 0 else f"Before {clashes[0]['name']}"
                    ),
                })
            if len(slots) >= 3:
                break

    return {
        "next_at": nexts[0].isoformat() if nexts else None,
        "next_dates": [n.isoformat() for n in nexts],
        "label": describe(cand),
        "clashes": clashes,
        "suggested_slots": slots,
    }


@router.post("/routines/preview", status_code=status.HTTP_200_OK)
def preview_routine(
    body: PreviewBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Next fire times + clashes with the same Helper's routines + open slots."""
    return _preview(db, body)


# ---------------------------------------------------------------------------
# Chief suggestions (deterministic rules, no LLM)
# ---------------------------------------------------------------------------


def _key(*parts: str) -> str:
    return "sug_" + hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]


def _helper_names(db: Session) -> dict[str, str]:
    return {h.id: h.name for h in db.query(Helper).all()}


def _derive_suggestions(db: Session) -> list[dict[str, Any]]:
    """Rules:

    1. clash   — two active routines of the same Helper start within 30 min on
                 a shared weekday → move the later, Chief-movable one to the
                 first free slot after (+60/+90/+120 min).
    2. failing — a routine whose last 3 runs all failed → pause it.

    Routines with ``allow_chief_shift = false`` are never moved. A suggestion
    disappears once dismissed (key stored on every routine it touches).
    """
    routines = (
        db.query(Routine)
        .filter(Routine.enabled.is_(True), Routine.paused.is_(False))
        .order_by(Routine.created_at.asc())
        .all()
    )
    names = _helper_names(db)
    out: list[dict[str, Any]] = []

    # ── 1. Same-helper clashes ────────────────────────────────────────────
    by_helper: dict[str, list[Routine]] = {}
    for r in routines:
        if r.freq != "monthly":
            by_helper.setdefault(r.helper_id, []).append(r)
    moved: set[str] = set()
    for helper_id, rs in by_helper.items():
        for i, a in enumerate(rs):
            for b in rs[i + 1:]:
                if a.id in moved or b.id in moved:
                    continue
                if not (local_weekdays(a) & local_weekdays(b)):
                    continue
                if abs(minutes_of(a.at) - minutes_of(b.at)) >= _CLASH_WINDOW_MIN:
                    continue
                # Move the later one (or b on a tie) if Chief may move it.
                later, earlier = (b, a) if minutes_of(b.at) >= minutes_of(a.at) else (a, b)
                if not later.allow_chief_shift:
                    later, earlier = earlier, later
                    if not later.allow_chief_shift:
                        continue
                busy = {minutes_of(x.at) for x in rs if x.id != later.id}
                target = None
                for delta in (60, 90, 120, -60):
                    m = minutes_of(earlier.at) + delta
                    if 6 * 60 <= m <= 21 * 60 and all(abs(m - bm) >= _CLASH_WINDOW_MIN for bm in busy):
                        target = at_of(m)
                        break
                if target is None:
                    continue
                key = _key("clash", later.id, later.at, target)
                if key in (later.dismissed_suggestions or []):
                    continue
                helper = names.get(helper_id, "This helper")
                moved.add(later.id)
                out.append({
                    "id": key,
                    "kind": "clash",
                    "title": f"{helper} has two routines at the same time",
                    "desc": (
                        f"{earlier.name} and {later.name} both start around {earlier.at}. "
                        f"Moving {later.name} keeps {helper} free to finish one before the next."
                    ),
                    "moves": [{
                        "routine_id": later.id,
                        "name": later.name,
                        "helper_id": later.helper_id,
                        "helper_name": helper,
                        "from": describe(later),
                        "to": describe({**_as_dict(later), "at": target}),
                        "from_at": later.at,
                        "to_at": target,
                    }],
                    "note": "Chief never moves routines you’ve locked (Let Chief move this: off).",
                })

    # ── 2. Repeated failures ─────────────────────────────────────────────
    recent = _recent_runs_by_routine(db, [r.id for r in routines], n=3)
    for r in routines:
        last = recent.get(r.id, [])
        if len(last) == 3 and all(x.outcome == "fail" for x in last):
            key = _key("failing", r.id, last[-1].id)
            if key in (r.dismissed_suggestions or []):
                continue
            reason = last[-1].error or "the last 3 runs failed"
            out.append({
                "id": key,
                "kind": "failing",
                "title": f"{r.name} keeps failing",
                "desc": f"The last 3 runs failed ({reason}). Pause it until it’s fixed?",
                "moves": [{
                    "routine_id": r.id,
                    "name": r.name,
                    "helper_id": r.helper_id,
                    "helper_name": names.get(r.helper_id, ""),
                    "from": describe(r),
                    "to": "Paused",
                    "from_at": r.at,
                    "to_at": None,
                }],
                "note": "You can resume it any time from the routine.",
            })
    return out


def _as_dict(r: Routine) -> dict[str, Any]:
    return {
        "freq": r.freq, "at": r.at, "days": r.days, "monthly": r.monthly,
        "timezone": r.timezone, "skip_holidays": r.skip_holidays,
    }


def _mark_dismissed(db: Session, sug: dict[str, Any]) -> None:
    for mv in sug["moves"]:
        r = db.query(Routine).filter(Routine.id == mv["routine_id"]).first()
        if r is None:
            continue
        keys = list(r.dismissed_suggestions or [])
        if sug["id"] not in keys:
            keys.append(sug["id"])
            r.dismissed_suggestions = keys
            flag_modified(r, "dismissed_suggestions")
    db.flush()


def _find_suggestion(db: Session, suggestion_id: str) -> dict[str, Any]:
    sug = next((s for s in _derive_suggestions(db) if s["id"] == suggestion_id), None)
    if sug is None:
        raise HTTPException(status_code=404, detail="Suggestion not found (it may no longer apply).")
    return sug


@router.get("/routines/suggestions", status_code=status.HTTP_200_OK)
def list_suggestions(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    return _derive_suggestions(db)


@router.post("/routines/suggestions/{suggestion_id}/apply", status_code=status.HTTP_200_OK)
def apply_suggestion(
    suggestion_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    sug = _find_suggestion(db, suggestion_id)
    changed: list[Routine] = []
    for mv in sug["moves"]:
        r = db.query(Routine).filter(Routine.id == mv["routine_id"]).first()
        if r is None:
            continue
        if sug["kind"] == "failing":
            r.paused = True
        elif mv.get("to_at"):
            r.at = mv["to_at"]
            _recompute_schedule(r)
        changed.append(r)
    _mark_dismissed(db, sug)
    return {
        "applied": [r.id for r in changed],
        "routines": [_routine_to_dict(r) for r in changed],
        "suggestion": sug,
    }


@router.post("/routines/suggestions/{suggestion_id}/dismiss", status_code=status.HTTP_200_OK)
def dismiss_suggestion(
    suggestion_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    sug = _find_suggestion(db, suggestion_id)
    _mark_dismissed(db, sug)
    return {"dismissed": True, "id": suggestion_id}


# ---------------------------------------------------------------------------
# Run feedback / resend
# ---------------------------------------------------------------------------


@router.post("/routines/runs/{run_id}/feedback", status_code=status.HTTP_200_OK)
def run_feedback(
    run_id: str,
    body: FeedbackBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    if body.vote not in (None, "up", "down"):
        raise HTTPException(status_code=422, detail="vote must be 'up', 'down' or null.")
    run = _get_run_or_404(db, run_id)
    run.feedback = body.vote
    db.flush()
    return {"run": _run_to_dict(run)}


@router.post("/routines/runs/{run_id}/resend", status_code=status.HTTP_200_OK)
def resend_run(
    run_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Re-deliver a run's output to the routine's ``sends_to``.

    There is no outbound delivery infrastructure (WhatsApp/email/chat posting)
    for routines yet, so this re-runs the routine instead and says so.
    """
    run = _get_run_or_404(db, run_id)
    routine = _get_routine_or_404(db, run.routine_id)
    job, new_run = fire_routine(db, routine, trigger="resend")
    return {
        "resent": False,
        "job_id": job.id,
        "run_id": new_run.id,
        "outcome": new_run.outcome,
        "message": "Delivery isn’t connected yet, so the routine ran again instead.",
    }


# ---------------------------------------------------------------------------
# Jobs: cancel (Stop run)
# ---------------------------------------------------------------------------


@router.post("/jobs/{job_id}/cancel", status_code=status.HTTP_200_OK)
def cancel_job(
    job_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Cancel a queued/running/waiting Job (409 when it already finished)."""
    job = db.query(Job).filter(Job.id == job_id).first()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    if job.status not in ("queued", "running", "waiting"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Job already {job.status}; nothing to stop.",
        )
    job.status = "cancelled"
    job.error = "Stopped by you"
    job.ended_at = datetime.now(timezone.utc)
    db.flush()
    for run in db.query(RoutineRun).filter(RoutineRun.job_id == job.id).all():
        sync_run_from_job(run, job)
    db.flush()
    return {"job_id": job.id, "status": job.status}


# ---------------------------------------------------------------------------
# Single routine
# ---------------------------------------------------------------------------


@router.get("/routines/{routine_id}", status_code=status.HTTP_200_OK)
def get_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return RoutineDetail {routine, runs[]} — 404 for other-tenant."""
    routine = _get_routine_or_404(db, routine_id)
    runs = (
        db.query(RoutineRun)
        .filter(RoutineRun.routine_id == routine_id)
        .order_by(RoutineRun.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "routine": _routine_to_dict(routine, recent=list(reversed(runs[:8]))),
        "runs": [_run_to_dict(r) for r in runs],
    }


def _event_text(ev: RunEvent) -> str:
    data = ev.data or {}
    if ev.kind == "tool":
        name = data.get("name") or data.get("tool") or "a tool"
        return f"Used {name}"
    if ev.kind == "sources":
        items = data.get("items") or data.get("sources") or []
        return f"Read {len(items)} source{'s' if len(items) != 1 else ''}" if items else "Read sources"
    if ev.kind == "approval":
        return str(data.get("text") or data.get("decision") or "Approval checkpoint")
    if ev.kind == "usage":
        return f"Used {data.get('tokens_in', 0)}+{data.get('tokens_out', 0)} tokens"
    text = data.get("text") or data.get("status") or data.get("message") or ""
    return str(text)[:200] or ev.kind


def _level(ev: RunEvent) -> str:
    data = ev.data or {}
    if ev.kind == "approval" and data.get("decision") == "refused":
        return "error"
    if data.get("error"):
        return "error"
    return "info"


@router.get("/routines/{routine_id}/runs/{run_id}", status_code=status.HTTP_200_OK)
def get_run_detail(
    routine_id: str,
    run_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Full run detail: job status, step timeline, logs, output, sources, delivery.

    Poll while ``running`` is true.
    """
    routine = _get_routine_or_404(db, routine_id)
    run = _get_run_or_404(db, run_id)
    if run.routine_id != routine.id:
        raise HTTPException(status_code=404, detail="Run not found.")

    job = db.query(Job).filter(Job.id == run.job_id).first() if run.job_id else None
    if job is not None and not run.skipped:
        sync_run_from_job(run, job)
        db.flush()

    events: list[RunEvent] = []
    report: Report | None = None
    if job is not None:
        events = (
            db.query(RunEvent).filter(RunEvent.job_id == job.id).order_by(RunEvent.at.asc()).all()
        )
        report = db.query(Report).filter(Report.job_id == job.id).first()

    steps: list[dict[str, Any]] = []
    logs: list[dict[str, Any]] = []
    if job is not None:
        start_at = job.started_at or job.created_at
        steps.append({
            "at": _iso(start_at),
            "text": f"Run started · {'schedule' if run.trigger == 'schedule' else 'manual'} trigger",
            "error": False,
        })
        for ev in events:
            txt = _event_text(ev)
            logs.append({"at": _iso(ev.at), "level": _level(ev), "text": f"{ev.kind}: {txt}"})
            if ev.kind in ("status", "tool", "sources", "approval"):
                steps.append({"at": _iso(ev.at), "text": txt, "error": _level(ev) == "error"})
        if job.status in ("failed", "blocked", "cancelled", "paused_offline"):
            steps.append({"at": _iso(job.ended_at), "text": job.error or f"Run {job.status}", "error": True})
            logs.append({"at": _iso(job.ended_at), "level": "error", "text": f"{job.status}: {job.error or ''}".strip()})
        elif job.status == "done":
            steps.append({"at": _iso(job.ended_at), "text": "Produced output", "error": False})
        elif job.status == "waiting":
            steps.append({"at": _iso(job.updated_at), "text": "Waiting for your approval in Inbox", "error": False})
    elif run.skipped:
        steps.append({"at": _iso(run.when), "text": f"Skipped — {run.error or 'nothing to do'}", "error": False})
        logs.append({"at": _iso(run.when), "level": "info", "text": f"skipped: {run.error or ''}".strip()})

    output = None
    body = (report.body_md if report else None) or (job.result_text if job else None)
    if body:
        lines = [ln.strip().lstrip("-*• ").strip() for ln in body.splitlines()]
        output = {
            "headline": report.headline if report else body[:80],
            "body_md": body,
            "lines": [ln for ln in lines if ln][:12],
        }

    names = _helper_names(db)
    delivered = job is not None and job.status == "done"
    return {
        "run": _run_to_dict(run),
        "routine": {
            "id": routine.id,
            "name": routine.name,
            "helper_id": routine.helper_id,
            "helper_name": names.get(routine.helper_id, ""),
            "sends_to": routine.sends_to or [],
        },
        "job": None if job is None else {
            "id": job.id,
            "status": job.status,
            "error": job.error,
            "attempts": job.attempts,
            "cost_credits": job.cost_credits,
            "tokens_in": job.tokens_in,
            "tokens_out": job.tokens_out,
            "started_at": _iso(job.started_at),
            "ended_at": _iso(job.ended_at),
        },
        "running": job is not None and job.status in ("queued", "running"),
        "steps": steps,
        "logs": logs,
        "output": output,
        "sources": (report.sources if report else []) or [],
        "delivery": {
            "sends_to": routine.sends_to or [],
            # No outbound delivery infra yet: outputs land in the activity log only.
            "delivered": False,
            "note": "Saved to the activity log" if delivered else None,
        },
    }


@router.patch("/routines/{routine_id}", status_code=status.HTTP_200_OK)
def patch_routine(
    routine_id: str,
    body: PatchRoutineBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update Routine fields (paused, paused_until, flags, schedule, …)."""
    routine = _get_routine_or_404(db, routine_id)

    if body.paused is not None:
        was_paused = routine.paused
        routine.paused = body.paused
        if not body.paused:
            routine.paused_until = None
            if was_paused:
                routine.next_at = next_fire(routine)
    if body.paused_until is not None:
        if body.paused_until == "":
            routine.paused_until = None
        else:
            routine.paused_until = _parse_iso(body.paused_until, "paused_until")
            routine.paused = True
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
    if body.allow_chief_shift is not None:
        routine.allow_chief_shift = body.allow_chief_shift
    if body.ask_before_sending is not None:
        routine.ask_before_sending = body.ask_before_sending

    # ── Schedule change → recompute cron + next_at ────────────────────────────
    schedule_changed = any(
        v is not None
        for v in (body.freq, body.at, body.days, body.monthly, body.timezone, body.skip_holidays)
    )
    if body.freq is not None:
        routine.freq = normalize_freq(body.freq)
    if body.at is not None:
        routine.at = _validate_at(body.at)
    if body.days is not None:
        routine.days = body.days
    if body.monthly is not None:
        routine.monthly = normalize_monthly(body.monthly)
    if routine.freq == "monthly" and not routine.monthly:
        routine.monthly = "date"
    if body.timezone is not None:
        _validate_timezone(body.timezone)
        routine.timezone = body.timezone
    if body.skip_holidays is not None:
        routine.skip_holidays = body.skip_holidays

    if schedule_changed:
        _recompute_schedule(routine)

    db.flush()
    return {"routine": _routine_to_dict(routine)}


@router.post("/routines/{routine_id}/skip-next", status_code=status.HTTP_200_OK)
def skip_next_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Advance next_at past the next occurrence (skip one run). Returns {next_at}.

    Records a ``skip`` RoutineRun for the skipped slot so it shows in history.
    404 for another tenant's routine (RLS).
    """
    routine = _get_routine_or_404(db, routine_id)
    anchor = routine.next_at or next_fire(routine) or datetime.now(timezone.utc)
    skipped = RoutineRun(
        id=prefixed_id("rrn"),
        company_id=routine.company_id,
        routine_id=routine.id,
        job_id=None,
        when=anchor,
        outcome="skip",
        skipped=True,
        cost_credits=0,
        trigger="schedule",
        error="you skipped it",
    )
    db.add(skipped)
    routine.next_at = next_fire(routine, anchor)
    db.flush()
    return {"next_at": _iso(routine.next_at)}


@router.delete("/routines/{routine_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_routine(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Hard-delete a Routine (history RoutineRuns remain)."""
    routine = _get_routine_or_404(db, routine_id)
    db.delete(routine)
    db.flush()


@router.post("/routines/{routine_id}/run-now", status_code=status.HTTP_200_OK)
def run_routine_now(
    routine_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Fire a Routine immediately off-schedule. Returns {job_id, run_id, outcome}."""
    routine = _get_routine_or_404(db, routine_id)
    job, run = fire_routine(db, routine, trigger="manual")
    return {"job_id": job.id, "run_id": run.id, "outcome": run.outcome}
