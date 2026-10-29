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
    # sweep: child tables first (FKs into helper / folder / memory_doc)
    "helper_channel",
    "folder_file",
    "chief_nudge_state",
    "memory_doc_version",
    "handbook_suggestion",
    "lesson",
    "connector",
    "email_log",
    "credit_ledger",
    "doit_payment",
    "flow_run",
    "flow_version",  # sweep/inbox-flows
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
    # sweep/control
    "audit_event",
    "data_export",
    "mcp_server",
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


class CompanyDetailOut(CompanyOut):
    """GET /v1/company — CompanyOut plus control-panel fields (sweep/control)."""

    timezone: str = "UTC"
    logo_url: str | None = None
    plan_id: str | None = None
    edition: str | None = None


def _company_detail(company: Company) -> CompanyDetailOut:
    base = _company_out(company)
    return CompanyDetailOut(
        **base.model_dump(),
        timezone=company.timezone or "UTC",
        logo_url=getattr(company, "logo_url", None),
        plan_id=company.plan_id,
        edition=company.edition,
    )


@router.get("/company", response_model=CompanyDetailOut)
def get_company(ctx: RequestContext = Depends(get_context)) -> CompanyDetailOut:
    """Return the authenticated user's company including profile fields."""
    with SessionLocal() as session:
        company = session.get(Company, ctx.company_id)

    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        )

    return _company_detail(company)


# ---------------------------------------------------------------------------
# PATCH /v1/company
# ---------------------------------------------------------------------------


@router.patch("/company", response_model=CompanyDetailOut)
def patch_company(
    body: CompanyPatchBody,
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> CompanyDetailOut:
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
            out = _company_detail(company)

    if update_data:
        from omilo import audit

        labels = {"autonomy_default": "autonomy", "pic_role": "contact role", "team_size": "team size"}
        changed = ", ".join(labels.get(k, k.replace("_", " ")) for k in update_data)
        audit.record_ctx(ctx, type="settings", action="changed", target=f"Company · {changed}")
    return out


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
            result = dict(merged)

    if body:
        from omilo import audit

        sections = {
            "safety": "Safety & limits",
            "aiEngine": "AI engine",
            "knowledge": "Knowledge",
            "notifications": "Notifications",
            "data": "Data & storage",
            "about": "General",
            "language": "General",
            "hours": "General",
        }
        names = sorted({sections.get(k, k) for k in body})
        audit.record_ctx(ctx, type="settings", action="changed", target=", ".join(names))
    return result


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



# ── sweep/control ────────────────────────────────────────────────────────────
# Company logo: POST /v1/company/logo {data_url} · DELETE /v1/company/logo
# Stored as a data: URL on company.logo_url (≤ 512 KB) and returned by
# GET /v1/company as ``logo_url`` (the rail + General page read it).
# ─────────────────────────────────────────────────────────────────────────────


class LogoBody(BaseModel):
    data_url: str


@router.post("/company/logo", response_model=CompanyDetailOut)
def upload_company_logo(
    body: LogoBody,
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> CompanyDetailOut:
    from omilo.api.me_account import validate_image_data_url

    url = validate_image_data_url(body.data_url)
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)
            if company is None:
                raise HTTPException(status_code=404, detail="Company not found.")
            company.logo_url = url
            out = _company_detail(company)
    from omilo import audit

    audit.record_ctx(ctx, type="settings", action="changed", target="Company logo")
    return out


@router.delete("/company/logo", response_model=CompanyDetailOut)
def delete_company_logo(
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> CompanyDetailOut:
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)
            if company is None:
                raise HTTPException(status_code=404, detail="Company not found.")
            company.logo_url = None
            return _company_detail(company)
