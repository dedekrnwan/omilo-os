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
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import text
from sqlalchemy.orm.attributes import flag_modified

from omilo.auth.router import CompanyOut, _company_out
from omilo.db import SessionLocal
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, require_role

# Tenant tables (every table carrying a company_id) — wiped on company delete.
# DB-level FKs among these are CASCADE/SET NULL, so delete order is safe.
_TENANT_TABLES = (
    "connector",
    "credit_ledger",
    "doit_payment",
    "flow_run",
    "flow",
    "goal",
    "harness_account",
    "helper_access",
    "helper",
    "improvement",
    "inbox_item",
    "install_token",
    "invite",
    "invoice",
    "job",
    "kb_chunk",
    "kb_source",
    "mcp_access_token",
    "memory_doc",
    "message",
    "proposal_revision",
    "proposal",
    "provider_key",
    "report",
    "routine_run",
    "routine",
    "run_event",
    "safety_limit",
    "session",
    "skill",
    "subscription",
    "tool_call",
    "wallet_settings",
    "channel",
    "folder",
)

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
    # Workspace autonomy dial — the real column the enforcement engine reads
    # (mcp/tools.py, loop/runner.py). Must be one of strict | ask | yolo.
    autonomy_default: str | None = None

    @field_validator("autonomy_default")
    @classmethod
    def _validate_autonomy(cls, v: str | None) -> str | None:
        if v is not None and v not in ("strict", "ask", "yolo"):
            raise ValueError("autonomy_default must be one of: strict, ask, yolo")
        return v


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
# GET + PATCH /v1/company/settings — free-form tenant-scoped settings
# ---------------------------------------------------------------------------


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``patch`` into ``base`` and return a new dict.

    Nested dicts are merged key-by-key (so a partial PATCH to one nested key
    does not clobber its siblings); non-dict values overwrite.
    """
    result = dict(base)
    for key, value in patch.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


@router.get("/company/settings")
def get_company_settings(
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the authed company's free-form settings object ({} by default)."""
    with SessionLocal() as session:
        company = session.get(Company, ctx.company_id)
        if company is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Company not found.",
            )
        return dict(company.settings or {})


@router.patch("/company/settings")
def patch_company_settings(
    body: dict[str, Any],
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Deep-merge the posted partial into company.settings. Owner/admin only.

    Returns the full merged settings object.
    """
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)
            if company is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Company not found.",
                )

            merged = _deep_merge(dict(company.settings or {}), body or {})
            company.settings = merged
            # JSONB mutation via reassignment is tracked, but flag to be safe.
            flag_modified(company, "settings")
            session.flush()
            return dict(merged)


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


# ---------------------------------------------------------------------------
# DELETE /v1/company — delete the workspace (owner only)
# ---------------------------------------------------------------------------


@router.delete("/company", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(
    _guard: None = Depends(require_role("owner")),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Hard-delete the authed company and all its tenant-scoped rows. Owner only.

    Deletes every company-scoped table's rows, then the members, then the
    Company row itself — all in one privileged transaction. DB-level FKs among
    tenant tables are CASCADE/SET NULL, so the delete order is safe.
    Global catalog tables (plan, piece) are never touched.
    """
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)
            if company is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Company not found.",
                )

            for table in _TENANT_TABLES:
                session.execute(
                    text(f"DELETE FROM {table} WHERE company_id = :cid"),
                    {"cid": ctx.company_id},
                )

            # Members are company-scoped but FK to the global user table.
            session.execute(
                text("DELETE FROM member WHERE company_id = :cid"),
                {"cid": ctx.company_id},
            )

            session.delete(company)
