"""Telemetry config endpoint — GET + POST /v1/telemetry-config.

Endpoints:
  GET  /v1/telemetry-config   → {enabled, key, host, mode, opted_out}
  POST /v1/telemetry-config   {opted_out: bool} → updated config

Privacy contract:
  - `key` is returned ONLY when `enabled=true` (never leak the key when
    disabled, local mode, or opted-out).
  - `enabled` mirrors get_telemetry()'s Noop-vs-PostHog decision AND the
    company's persisted opt-out flag.
  - `opted_out` is persisted per company (Company.telemetry_opted_out).

Enabled logic (mirrors factory.get_telemetry() via shared telemetry_is_active()):
  enabled = (
      TELEMETRY_ENABLED is not False           # kill-switch honored
      AND POSTHOG_API_KEY is set               # configured
      AND (mode != "local" OR TELEMETRY_ENABLED is True)  # local privacy default
      AND (NOT company.telemetry_opted_out)    # company opt-out
  )

Auth: valid Bearer session required (get_context). Company resolved from
ctx.company_id via a superuser SessionLocal — same pattern as /company.

Spec: P7 Task 3.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from omilo.config import get_settings
from omilo.control.factory import _normalize_mode
from omilo.db import SessionLocal
from omilo.telemetry.factory import telemetry_is_active
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["telemetry"])


# ---------------------------------------------------------------------------
# Response + request schemas
# ---------------------------------------------------------------------------


class TelemetryConfigOut(BaseModel):
    """Telemetry config shape returned by both GET and POST."""

    enabled: bool
    key: str | None
    host: str | None
    mode: str
    opted_out: bool


class TelemetryOptOutBody(BaseModel):
    """Request body for POST /v1/telemetry-config."""

    opted_out: bool


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _compute_config(
    *,
    settings,
    opted_out: bool,
) -> TelemetryConfigOut:
    """Compute the telemetry config dict from settings + the company's opt-out flag.

    Enabled iff:
      1. telemetry_is_active(settings) is True — mirrors factory.get_telemetry()
         exactly (honors kill-switch, key presence, local-privacy default).
      2. The company has NOT opted out.

    The key and host are returned ONLY when enabled.
    """
    api_key: str = (getattr(settings, "posthog_api_key", "") or "").strip()
    raw_mode: str = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode: str = _normalize_mode(raw_mode)
    posthog_host: str = (
        getattr(settings, "posthog_host", "https://us.i.posthog.com") or "https://us.i.posthog.com"
    )

    # Use the shared predicate so backend and frontend always agree.
    # telemetry_is_active() mirrors get_telemetry()'s Noop-vs-PostHog decision,
    # including the explicit TELEMETRY_ENABLED=False kill-switch.
    active = telemetry_is_active(settings)
    enabled = active and not opted_out

    return TelemetryConfigOut(
        enabled=enabled,
        key=api_key if enabled else None,
        host=posthog_host if enabled else None,
        mode=mode,
        opted_out=opted_out,
    )


def _get_company(company_id: str) -> Company:
    """Load the Company by ID; raise 404 if not found."""
    with SessionLocal() as session:
        company = session.get(Company, company_id)
    if company is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Company not found.",
        )
    return company


# ---------------------------------------------------------------------------
# GET /v1/telemetry-config
# ---------------------------------------------------------------------------


@router.get("/telemetry-config", response_model=TelemetryConfigOut)
def get_telemetry_config(
    ctx: RequestContext = Depends(get_context),
) -> TelemetryConfigOut:
    """Return the current telemetry config for the authenticated company.

    The frontend uses this to decide whether to initialise posthog-js.
    `key` is ONLY returned when `enabled=true` — never exposed when
    local mode, unconfigured, or the company has opted out.
    """
    settings = get_settings()
    company = _get_company(ctx.company_id)
    opted_out: bool = getattr(company, "telemetry_opted_out", False) or False

    return _compute_config(settings=settings, opted_out=opted_out)


# ---------------------------------------------------------------------------
# POST /v1/telemetry-config
# ---------------------------------------------------------------------------


@router.post("/telemetry-config", response_model=TelemetryConfigOut)
def post_telemetry_config(
    body: TelemetryOptOutBody,
    ctx: RequestContext = Depends(get_context),
) -> TelemetryConfigOut:
    """Persist the company's telemetry opt-out preference and return updated config.

    Any authenticated member can toggle the company's opt-out (not just owners)
    because opting OUT is a privacy action and should be accessible to all users.
    Opting back IN is also allowed to keep the UX symmetrical.

    Returns the recomputed config reflecting the persisted value.
    """
    settings = get_settings()

    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, ctx.company_id)
            if company is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Company not found.",
                )
            company.telemetry_opted_out = body.opted_out
            session.flush()
            opted_out: bool = company.telemetry_opted_out

    return _compute_config(settings=settings, opted_out=opted_out)
