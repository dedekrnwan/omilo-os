"""Company profile endpoints — GET + PATCH /v1/company + POST /v1/company/onboard.

Endpoints:
  GET   /v1/company         → return authed user's company with profile fields
  PATCH /v1/company         → update writable profile fields (owner/admin only)
  POST  /v1/company/onboard → mark the company as onboarded (idempotent)

Company is the global tenant-root (no RLS). Loaded by ctx.company_id via
a bootstrap (superuser) session — same pattern as /me.

Auth: all endpoints require a valid Bearer session (get_context).
      PATCH additionally requires owner or admin role (require_role guard).

Spec: P5d Task 1b (profile), P13 (onboarding gate).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.auth.router import CompanyOut, _company_out
from omilo.db import SessionLocal
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, require_role

router = APIRouter(tags=["company"])


# ---------------------------------------------------------------------------
# Request schema
# ---------------------------------------------------------------------------


class CompanyPatchBody(BaseModel):
    """Fields that can be updated by an admin/owner."""

    name: str | None = None
    timezone: str | None = None
    industry: str | None = None
    team_size: str | None = None
    region: str | None = None
    currency: str | None = None
    pic_role: str | None = None


# ---------------------------------------------------------------------------
# GET /v1/company
# ---------------------------------------------------------------------------


@router.get("/company", response_model=CompanyOut)
def get_company(ctx: RequestContext = Depends(get_context)) -> CompanyOut:
    """Return the authenticated user's company including profile fields."""
    with SessionLocal() as session:
        company = session.get(Company, ctx.company_id)

    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        )

    return _company_out(company)


# ---------------------------------------------------------------------------
# PATCH /v1/company
# ---------------------------------------------------------------------------


@router.patch("/company", response_model=CompanyOut)
def patch_company(
    body: CompanyPatchBody,
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> CompanyOut:
    """Update the authed company's profile fields. Requires owner or admin role."""
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)

            if company is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Company not found.",
                )

            # Apply only the provided (non-None) fields — partial update.
            update_data = body.model_dump(exclude_none=True)
            for field, value in update_data.items():
                setattr(company, field, value)

            session.flush()

            # Snapshot fields before session closes (expire_on_commit default).
            return _company_out(company)


# ---------------------------------------------------------------------------
# POST /v1/company/onboard
# ---------------------------------------------------------------------------


@router.post("/company/onboard", response_model=CompanyOut)
def onboard_company(ctx: RequestContext = Depends(get_context)) -> CompanyOut:
    """Mark the authed company as onboarded (idempotent).

    Sets ``onboarded_at`` to now() if not already set; if the company has
    already been onboarded the timestamp is left unchanged (idempotent).
    Returns the updated CompanyOut with ``onboarded=True``.
    """
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)

            if company is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Company not found.",
                )

            # Idempotent: only set if not already onboarded.
            if company.onboarded_at is None:
                company.onboarded_at = datetime.now(timezone.utc)

            session.flush()

            return _company_out(company)
