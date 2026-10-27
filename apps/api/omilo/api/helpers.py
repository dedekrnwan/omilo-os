"""Helpers endpoints: list, detail, create, patch.

Endpoints:
  GET  /v1/helpers              → HelperStat[]
      {id, name, area, role, status, jobs: <count>, success: <pct>, lastActive?}
  GET  /v1/helpers/{id}         → {helper, jobs: [recent], skills: []}
  POST /v1/helpers {name, area, role, job_description?, autonomy_cap?, is_chief?}
      → {id, name, area, role, status, ...}
      Guard: if is_chief=true and a Chief already exists → 409.
  PATCH /v1/helpers/{id} {status?, role?, job_description?, autonomy_cap?}
      → {id, name, area, role, status, ...}
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import Integer, case, func
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["helpers"])


# ── Request schemas ───────────────────────────────────────────────────────────


class CreateHelperBody(BaseModel):
    name: str
    area: str
    role: str
    job_description: Optional[str] = None
    autonomy_cap: Optional[str] = None
    is_chief: Optional[bool] = False


class PatchHelperBody(BaseModel):
    status: Optional[str] = None
    role: Optional[str] = None
    job_description: Optional[str] = None
    autonomy_cap: Optional[str] = None


# ── Internal helpers ──────────────────────────────────────────────────────────


def _helper_to_stat(helper: Helper, job_count: int, done_count: int) -> dict[str, Any]:
    """Build a HelperStat dict (camelCase) from a Helper ORM object + counts."""
    success = round(100 * done_count / job_count) if job_count > 0 else 0
    return {
        "id": helper.id,
        "name": helper.name,
        "area": helper.area,
        "role": helper.role,
        "status": helper.status,
        "jobs": job_count,
        "success": success,
        "isChief": helper.is_chief,
    }


def _helper_to_dict(helper: Helper) -> dict[str, Any]:
    """Full helper dict (camelCase) for create/patch responses."""
    return {
        "id": helper.id,
        "name": helper.name,
        "area": helper.area,
        "role": helper.role,
        "status": helper.status,
        "isChief": helper.is_chief,
        "autonomyCap": helper.autonomy_cap,
        "jobDescription": helper.job_description,
    }


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/helpers", status_code=status.HTTP_200_OK)
def list_helpers(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return HelperStat[] for the active company.

    Joins Job table to compute per-helper job count and success %.
    Company-scoped via RLS (get_tenant_db).
    """
    helpers = db.query(Helper).all()

    # Aggregate job counts per helper in one query
    job_counts = (
        db.query(
            Job.helper_id,
            func.count(Job.id).label("total"),
            func.sum(
                case((Job.status == "done", 1), else_=0)
            ).label("done"),
        )
        .group_by(Job.helper_id)
        .all()
    )
    counts: dict[str, tuple[int, int]] = {
        row.helper_id: (row.total, int(row.done or 0))
        for row in job_counts
    }

    return [
        _helper_to_stat(h, *counts.get(h.id, (0, 0)))
        for h in helpers
    ]


@router.get("/helpers/{helper_id}", status_code=status.HTTP_200_OK)
def get_helper_detail(
    helper_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return {helper, jobs: [recent 20], skills: []} for the helper.

    404 for a helper belonging to another company (RLS surfaces it as not found).
    """
    helper = db.query(Helper).filter(Helper.id == helper_id).first()
    if helper is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Helper not found.",
        )

    # Recent jobs — up to 20, newest first
    jobs = (
        db.query(Job)
        .filter(Job.helper_id == helper_id)
        .order_by(Job.created_at.desc())
        .limit(20)
        .all()
    )

    jobs_data = [
        {
            "id": j.id,
            "status": j.status,
            "origin": j.origin,
            "brief": j.brief,
            "tokensIn": j.tokens_in,
            "tokensOut": j.tokens_out,
            "costCredits": j.cost_credits,
            "createdAt": j.created_at.isoformat() if j.created_at else None,
        }
        for j in jobs
    ]

    return {
        "helper": _helper_to_dict(helper),
        "jobs": jobs_data,
        "skills": [],  # P3: skills stub
    }


@router.post("/helpers", status_code=status.HTTP_201_CREATED)
def create_helper(
    body: CreateHelperBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Helper for the active company.

    Guard: if is_chief=true and a Chief already exists → 409.
    """
    if body.is_chief:
        existing_chief = (
            db.query(Helper)
            .filter(Helper.is_chief.is_(True))
            .first()
        )
        if existing_chief is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A Chief Helper already exists for this company. Only one Chief is allowed.",
            )

    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=ctx.company_id,
        name=body.name,
        area=body.area,
        role=body.role,
        job_description=body.job_description or "",
        is_chief=body.is_chief or False,
        autonomy_cap=body.autonomy_cap,
        engine={"type": "fake"},
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()

    return _helper_to_dict(helper)


@router.patch("/helpers/{helper_id}", status_code=status.HTTP_200_OK)
def patch_helper(
    helper_id: str,
    body: PatchHelperBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update a Helper (status, role, job_description, autonomy_cap).

    404 for another company's helper (RLS).
    """
    helper = db.query(Helper).filter(Helper.id == helper_id).first()
    if helper is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Helper not found.",
        )

    if body.status is not None:
        helper.status = body.status
    if body.role is not None:
        helper.role = body.role
    if body.job_description is not None:
        helper.job_description = body.job_description
    if body.autonomy_cap is not None:
        helper.autonomy_cap = body.autonomy_cap

    db.flush()

    return _helper_to_dict(helper)
