"""Goals write endpoints: create, detail, replan.

Endpoints:
  POST /goals        {channel_id, title, target, due?, autonomy_override?,
                      measured_by?, helper_ids?, period?, draft_key_results?}
                     → {goal: GoalDTO, job_count: int}
                     Creates a Goal (owner=Chief). When draft_key_results
                     (default true) runs plan_goal() to spawn a Chief plan Job
                     + delegated child Jobs.
  PATCH /goals/{id}  {title?,target?,due?,status?,channel_id?,measured_by?,
                      helper_ids?,period?}  → {goal}
                     status ∈ on_track|at_risk|blocked|needs_you|done marks a
                     user override; status='auto' hands it back to the system.
  POST /goals/{id}/session → SessionDTO (the goal's chat session; created once)
  GET  /goals/{id}  → {goal, jobs[], proposals[]}   (404 for other-tenant)
  POST /goals/{id}/replan → {job_id}   (re-runs plan_goal; 404 for other-tenant)
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.chat import ChatSession
from omilo.models.execution import Job
from omilo.models.workspace import Goal
from omilo.schemas.read import GoalDTO, SessionDTO
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["goals-write"])


# ── Request schemas ───────────────────────────────────────────────────────────


class CreateGoalBody(BaseModel):
    channel_id: str
    title: str
    target: str = ""
    due: Optional[str] = None
    autonomy_override: Optional[str] = None
    measured_by: Optional[str] = None
    helper_ids: Optional[list[str]] = None
    period: Optional[str] = None
    draft_key_results: bool = True


class PatchGoalBody(BaseModel):
    title: Optional[str] = None
    target: Optional[str] = None
    due: Optional[str] = None
    status: Optional[str] = None
    channel_id: Optional[str] = None
    measured_by: Optional[str] = None
    helper_ids: Optional[list[str]] = None
    period: Optional[str] = None


# ── Goal status (sweep/goals-routines) ────────────────────────────────────────

GOAL_STATUSES = ("on_track", "at_risk", "blocked", "needs_you", "done")


def _parse_due(due: str | None) -> date | None:
    if not due:
        return None
    try:
        return date.fromisoformat(due.strip()[:10])
    except ValueError:
        return None


def period_for(d: date) -> str:
    return f"{d.year}-Q{(d.month - 1) // 3 + 1}"


def derive_goal_status(goal: Goal, jobs: list[Job], pending_proposals: int) -> str:
    """Effective status. A user override wins; otherwise derived:

    done      — progress ≥ 100 (or stored 'done')
    needs_you — a proposal from one of the goal's jobs awaits approval
    blocked   — the latest delegated work failed/was blocked and nothing is running
    at_risk   — past due, or due within 14 days with progress < 50
    on_track  — everything else
    """
    if goal.status_set_by == "user" and goal.status in GOAL_STATUSES:
        return goal.status
    if goal.progress >= 100 or goal.status == "done":
        return "done"
    if pending_proposals > 0:
        return "needs_you"
    work = [j for j in jobs if j.origin == "delegation"] or jobs
    if work:
        bad = [j for j in work if j.status in ("failed", "blocked", "paused_offline")]
        active = [j for j in work if j.status in ("queued", "running", "waiting")]
        if bad and not active and len(bad) >= max(1, len(work) // 2):
            return "blocked"
    due = _parse_due(goal.due)
    if due is not None:
        today = datetime.now(timezone.utc).date()
        if due < today or ((due - today).days <= 14 and goal.progress < 50):
            return "at_risk"
    return "on_track"


def goal_dtos(db: Session, goals: list[Goal]) -> list[dict[str, Any]]:
    """GoalDTO dicts (camelCase, None omitted) with the derived status."""
    if not goals:
        return []
    ids = [g.id for g in goals]
    jobs = db.query(Job).filter(Job.goal_id.in_(ids)).all()
    jobs_by_goal: dict[str, list[Job]] = {}
    for j in jobs:
        jobs_by_goal.setdefault(j.goal_id, []).append(j)
    pending: dict[str, int] = {}
    job_goal = {j.id: j.goal_id for j in jobs}
    if job_goal:
        for p in (
            db.query(Proposal)
            .filter(Proposal.job_id.in_(list(job_goal)), Proposal.status == "pending")
            .all()
        ):
            gid = job_goal.get(p.job_id)
            pending[gid] = pending.get(gid, 0) + 1
    out = []
    for g in goals:
        dto = GoalDTO(
            id=g.id,
            channel_id=g.channel_id,
            title=g.title,
            progress=g.progress,
            status=derive_goal_status(g, jobs_by_goal.get(g.id, []), pending.get(g.id, 0)),
            target=g.target or None,
            due=g.due,
            measured_by=g.measured_by,
            helper_ids=list(g.helper_ids or []),
            period=g.period,
            session_id=g.session_id,
            status_set_by=g.status_set_by,
        )
        out.append(dto.model_dump(by_alias=True, exclude_none=True))
    return out


def goal_dto(db: Session, goal: Goal) -> dict[str, Any]:
    d = goal_dtos(db, [goal])[0]
    d["autonomyOverride"] = goal.autonomy_override
    d["ownerHelperId"] = goal.owner_helper_id
    return d


# ── Internal helpers ──────────────────────────────────────────────────────────


def _get_chief(db: Session, company_id: str) -> Helper:
    """Return the active Chief Helper for the company. Raises 409 if missing."""
    chief = (
        db.query(Helper)
        .filter(
            Helper.company_id == company_id,
            Helper.is_chief.is_(True),
            Helper.status == "active",
        )
        .first()
    )
    if chief is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No Chief Helper found. Create a Helper with is_chief=true.",
        )
    return chief


def _get_worker_helpers(db: Session, company_id: str) -> list[Helper]:
    """Return all non-chief active Helpers for the company.

    Falls back to an empty list (callers use Chief if empty).
    """
    return (
        db.query(Helper)
        .filter(
            Helper.company_id == company_id,
            Helper.is_chief.is_(False),
            Helper.status == "active",
        )
        .all()
    )


def recompute_goal_progress(db: Session, goal: Goal) -> int:
    """Recompute goal.progress from done delegated Jobs.

    progress = round(100 * done_delegated / total_delegated)
    Writes updated value to goal and flushes. Returns the new value.
    When all delegated jobs are done, flips goal.status to 'done'.
    """
    delegated = (
        db.query(Job)
        .filter(Job.goal_id == goal.id, Job.origin == "delegation")
        .all()
    )
    total = len(delegated)
    if total == 0:
        return goal.progress

    done_count = sum(1 for j in delegated if j.status == "done")
    new_progress = round(100 * done_count / total)
    goal.progress = new_progress
    db.flush()
    return new_progress


def plan_goal(db: Session, goal: Goal, chief: Helper) -> list[Job]:
    """Deterministic Python planner: Chief plan Job + 1–3 delegated child Jobs.

    Steps:
    1. Create a Chief plan Job (origin="goal") via start_job.
    2. Get non-chief workers (fall back to Chief if none).
    3. Create up to 3 delegated child Jobs (origin="delegation") round-robin
       assigned to workers, each with parent_job_id = plan job and goal_id = goal.
    4. Recompute goal progress from the newly created delegated jobs.

    Returns all created Jobs (plan + delegated).
    """
    company_id = goal.company_id

    # ── Chief plan Job ────────────────────────────────────────────────────────
    plan_job = start_job(
        db,
        company_id=company_id,
        helper_id=chief.id,
        origin="goal",
        brief=f"Plan goal: {goal.target}",
        goal_id=goal.id,
    )

    # ── Delegate to workers (or Chief if no workers) ──────────────────────────
    workers = _get_worker_helpers(db, company_id)
    if goal.helper_ids:
        picked = [w for w in workers if w.id in set(goal.helper_ids)]
        workers = picked or workers
    assignees: list[Helper] = workers if workers else [chief]

    # Decompose target into 1–3 steps deterministically (word-count heuristic)
    words = goal.target.split()
    n_steps = min(3, max(1, len(words) // 3 + 1))

    created: list[Job] = [plan_job]
    for i in range(n_steps):
        assignee = assignees[i % len(assignees)]
        child = start_job(
            db,
            company_id=company_id,
            helper_id=assignee.id,
            origin="delegation",
            brief=f"Step {i + 1} toward: {goal.target}",
            goal_id=goal.id,
            operator_note=None,
        )
        # Link back to the plan job
        child.parent_job_id = plan_job.id
        db.flush()
        created.append(child)

    # Recompute progress now that delegated jobs exist (fake engine finishes inline)
    recompute_goal_progress(db, goal)

    return created


def _goal_detail_response(db: Session, goal: Goal) -> dict[str, Any]:
    """Build the GET /goals/{id} response body."""
    # Recompute progress on each read
    recompute_goal_progress(db, goal)

    # All jobs linked to this goal
    jobs = db.query(Job).filter(Job.goal_id == goal.id).all()

    # Proposals from those jobs
    job_ids = [j.id for j in jobs]
    proposals: list[Proposal] = []
    if job_ids:
        proposals = (
            db.query(Proposal)
            .filter(Proposal.job_id.in_(job_ids))
            .all()
        )

    goal_data = goal_dto(db, goal)

    jobs_data = [
        {
            "id": j.id,
            "origin": j.origin,
            "status": j.status,
            "helperId": j.helper_id,
            "brief": j.brief,
            "parentJobId": j.parent_job_id,
            "goalId": j.goal_id,
        }
        for j in jobs
    ]

    proposals_data = [
        {
            "id": p.id,
            "jobId": p.job_id,
            "type": p.type,
            "status": p.status,
            "title": p.title,
            "risk": p.risk,
        }
        for p in proposals
    ]

    return {
        "goal": goal_data,
        "jobs": jobs_data,
        "proposals": proposals_data,
    }


# ── Routes ────────────────────────────────────────────────────────────────────


@router.post("/goals", status_code=status.HTTP_200_OK)
def create_goal(
    body: CreateGoalBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Goal and (optionally) kick off Chief planning + delegation.

    Steps:
    a. Find the company's Chief Helper (409 if missing).
    b. Create the Goal (owner=Chief, progress=0, status derived).
    c. When ``draft_key_results`` (default) run plan_goal() to spawn plan +
       delegated Jobs; otherwise the goal is created without any work.
    d. Return {goal, job_count}.
    """
    chief = _get_chief(db, ctx.company_id)

    due_d = _parse_due(body.due)
    period = body.period or period_for(due_d or datetime.now(timezone.utc).date())
    goal = Goal(
        id=prefixed_id("goal"),
        company_id=ctx.company_id,
        channel_id=body.channel_id,
        title=body.title,
        target=body.target or "",
        status="on_track",
        status_set_by=None,
        autonomy_override=body.autonomy_override,
        owner_helper_id=chief.id,
        progress=0,
        due=body.due or None,
        measured_by=body.measured_by or None,
        helper_ids=body.helper_ids or [],
        period=period,
    )
    db.add(goal)
    db.flush()

    jobs: list[Job] = []
    if body.draft_key_results:
        jobs = plan_goal(db, goal, chief)

    return {
        "goal": goal_dto(db, goal),
        "job_count": len(jobs),
    }


@router.get("/goals/{goal_id}", status_code=status.HTTP_200_OK)
def get_goal_detail(
    goal_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return GoalDetail {goal, jobs[], proposals[]}.

    RLS enforces company scoping; we raise 404 explicitly for clarity.
    """
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")
    return _goal_detail_response(db, goal)


@router.patch("/goals/{goal_id}", status_code=status.HTTP_200_OK)
def patch_goal(
    goal_id: str,
    body: PatchGoalBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update a Goal's editable fields. 404 for another tenant's goal (RLS).

    ``status`` must be one of GOAL_STATUSES (a user override) or ``auto``
    (clear the override; status is derived again).
    """
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    if body.title is not None:
        goal.title = body.title
    if body.target is not None:
        goal.target = body.target
    if body.status is not None:
        if body.status == "auto":
            goal.status_set_by = None
            goal.status = "on_track"
        elif body.status in GOAL_STATUSES:
            goal.status = body.status
            goal.status_set_by = "user"
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"status must be one of {', '.join(GOAL_STATUSES)} or 'auto'.",
            )
    if body.channel_id is not None:
        goal.channel_id = body.channel_id
    if body.due is not None:
        goal.due = body.due or None
    if body.measured_by is not None:
        goal.measured_by = body.measured_by or None
    if body.helper_ids is not None:
        goal.helper_ids = body.helper_ids
    if body.period is not None:
        goal.period = body.period or None

    db.flush()

    return {"goal": goal_dto(db, goal)}


@router.post("/goals/{goal_id}/session", status_code=status.HTTP_200_OK)
def open_goal_session(
    goal_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the goal's chat session, creating it once on first open."""
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")
    session = None
    if goal.session_id:
        session = db.query(ChatSession).filter(ChatSession.id == goal.session_id).first()
    if session is None:
        session = ChatSession(
            id=prefixed_id("ses"),
            company_id=ctx.company_id,
            title=goal.title,
            channel_id=goal.channel_id,
            goal=goal.title,
            updated="now",
        )
        db.add(session)
        db.flush()
        goal.session_id = session.id
        db.flush()
    return SessionDTO.model_validate(session, from_attributes=True).model_dump(
        by_alias=True, exclude_none=True
    )


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Hard-delete a Goal. 404 for another tenant's goal (RLS)."""
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")
    db.delete(goal)
    db.flush()


@router.post("/goals/{goal_id}/replan", status_code=status.HTTP_200_OK)
def replan_goal(
    goal_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Re-decompose a goal by running plan_goal again.

    Creates a new Chief plan Job + fresh delegated child Jobs.
    Returns {job_id} of the new plan Job.
    """
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if goal is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found.")

    chief = _get_chief(db, ctx.company_id)
    jobs = plan_goal(db, goal, chief)

    plan_job = next((j for j in jobs if j.origin == "goal"), jobs[0])
    return {"job_id": plan_job.id}
