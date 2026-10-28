"""Public pre-auth config endpoint — GET /v1/public-config.

Requires NO authentication. Returns the deployment's mode so the frontend
auth gate can branch before login.

Contract:
  GET /v1/public-config → 200 JSON {"mode": "local"|"hybrid"|"cloud", "signupEnabled": bool}

Rules:
  - mode = _normalize_mode(settings.omilo_mode) — same helper used in telemetry_config.py
  - signupEnabled = mode != "cloud"
    (cloud self-serve signup is gated for later; local/hybrid allow signup)

Spec: P9 T1.
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from omilo.config import get_settings
from omilo.control.factory import _normalize_mode

router = APIRouter(tags=["public"])


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


class PublicConfigOut(BaseModel):
    """Public deployment config returned to unauthenticated clients."""

    mode: str
    signupEnabled: bool


# ---------------------------------------------------------------------------
# GET /v1/public-config
# ---------------------------------------------------------------------------


@router.get("/public-config", response_model=PublicConfigOut)
def get_public_config() -> PublicConfigOut:
    """Return the deployment's mode and signup availability.

    No authentication required — used by the frontend before login to decide
    which auth flow to present (cloud login-only vs. local/hybrid signup).
    """
    settings = get_settings()
    raw_mode: str = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode: str = _normalize_mode(raw_mode)
    signup_enabled: bool = mode != "cloud"

    return PublicConfigOut(mode=mode, signupEnabled=signup_enabled)
