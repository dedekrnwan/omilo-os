"""Goals write endpoints: create, detail, replan.

Endpoints:
  POST /goals        {channel_id, title, target, due?, autonomy_override?}
                     → {goal: GoalDTO-extended, job_count: int}
                     Creates a Goal (status=active, owner=Chief), then runs
                     plan_goal() to spawn a Chief plan Job + delegated child Jobs.
  GET  /goals/{id}  → {goal, jobs[], proposals[]}   (404 for other-tenant)
  POST /goals/{id}/replan → {job_id}   (re-runs plan_goal; 404 for other-tenant)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.loop.runner import start_job
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.models.workspace import Goal
from omilo.schemas.read import GoalDTO
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["goals-write"])


# ── Request schemas ───────────────────────────────────────────────────────────


class CreateGoalBody(BaseModel):
    channel_id: str
    title: str
    target: str
    due: Optional[str] = None
    autonomy_override: Optional[str] = None


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

    goal_data = {
        "id": goal.id,
        "channelId": goal.channel_id,
        "title": goal.title,
        "target": goal.target,
        "status": goal.status,
        "progress": goal.progress,
        "autonomyOverride": goal.autonomy_override,
        "ownerHelperId": goal.owner_helper_id,
    }

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
    """Create a Goal and kick off Chief planning + delegation fan-out.

    Steps:
    a. Find the company's Chief Helper (409 if missing).
    b. Create the Goal (status=active, owner=Chief, progress=0).
    c. Run plan_goal() to spawn plan + delegated Jobs.
    d. Return {goal, job_count}.
    """
    # ── a. Chief ──────────────────────────────────────────────────────────────
    chief = _get_chief(db, ctx.company_id)

    # ── b. Create Goal ────────────────────────────────────────────────────────
    goal = Goal(
        id=prefixed_id("goal"),
        company_id=ctx.company_id,
        channel_id=body.channel_id,
        title=body.title,
        target=body.target,
        status="active",
        autonomy_override=body.autonomy_override,
        owner_helper_id=chief.id,
        progress=0,
    )
    db.add(goal)
    db.flush()

    # ── c. Plan + delegate ────────────────────────────────────────────────────
    jobs = plan_goal(db, goal, chief)

    # ── d. Return ─────────────────────────────────────────────────────────────
    goal_dto = {
        "id": goal.id,
        "channelId": goal.channel_id,
        "title": goal.title,
        "target": goal.target,
        "status": goal.status,
        "progress": goal.progress,
        "ownerHelperId": goal.owner_helper_id,
    }
    return {
        "goal": goal_dto,
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
