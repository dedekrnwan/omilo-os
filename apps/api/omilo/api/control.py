"""Cloud /control/* federation endpoints (mounted only in cloud mode).

These endpoints allow a remote local-runtime to federate identity + billing
to the cloud control plane.  They are authenticated by a per-install token
(company-scoped, revocable) rather than a user JWT.

Endpoints
---------
GET  /control/jwks          — public; return the RS256 JWKS (or empty keys).
POST /control/register      — verify user JWT, issue an InstallToken (raw once).
GET  /control/entitlements  — company's plan / limits.
GET  /control/balance       — credit balance + overage policy.
POST /control/usage         — idempotent credit debit per (company_id, job_id).
POST /control/heartbeat     — liveness + revocation check; updates last_seen_at.

Auth
----
All endpoints EXCEPT /jwks and /register require a Bearer install token.
The raw token is hashed (sha256) and looked up in install_token by token_hash
via a privileged session.  If the row is not found or is revoked → 401/403.
company_id is always resolved from the install token row, NEVER from the body.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.auth.tokens import get_jwks
from omilo.control import UsageEvent
from omilo.control.local import LocalControlPlane
from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.install import InstallToken

router = APIRouter(prefix="/control", tags=["control"])
logger = logging.getLogger(__name__)

_cp = LocalControlPlane()


# ---------------------------------------------------------------------------
# Internal auth helpers
# ---------------------------------------------------------------------------


def _privileged_session() -> Session:
    """Return a new (not-yet-entered) privileged session context manager."""
    return SessionLocal()


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _resolve_install_token(raw: str) -> InstallToken:
    """Look up and return an active InstallToken by raw token.

    Raises 401 if not found, 403 if found but revoked.
    Also updates last_seen_at on success.
    """
    token_hash = _hash_token(raw)
    with SessionLocal() as db:
        with db.begin():
            row: InstallToken | None = (
                db.query(InstallToken).filter_by(token_hash=token_hash).first()
            )
            if row is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid install token.",
                )
            now = datetime.now(timezone.utc)
            if not row.is_active(now):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Install token has been revoked.",
                )
            # Update last_seen_at
            row.last_seen_at = now
            # Return a detached copy of the data we need
            company_id = row.company_id
            row_id = row.id
            row_token_hash = row.token_hash

    # Build a lightweight result object (the session is closed; row is detached)
    return _DetachedToken(id=row_id, company_id=company_id, token_hash=row_token_hash)


class _DetachedToken:
    """Minimal install token info after session close."""
    __slots__ = ("id", "company_id", "token_hash")

    def __init__(self, *, id: str, company_id: str, token_hash: str) -> None:
        self.id = id
        self.company_id = company_id
        self.token_hash = token_hash


def _get_install_token(authorization: str | None = Header(default=None)) -> _DetachedToken:
    """FastAPI dependency: extract + validate the install token from Bearer header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header.",
        )
    raw = authorization[len("Bearer "):]
    return _resolve_install_token(raw)


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------


class RegisterBody(BaseModel):
    user_jwt: str


class UsageBody(BaseModel):
    job_id: str
    engine_type: str
    model: str | None = None
    tokens_in: int = 0
    tokens_out: int = 0
    credits: int = 0
    # company_id is intentionally NOT a field — it comes from the install token.
    # Any extra fields in the body with that name are ignored.
    model_config = {"extra": "ignore"}


# ---------------------------------------------------------------------------
# GET /control/jwks — unauthenticated
# ---------------------------------------------------------------------------


@router.get("/jwks")
def control_jwks() -> dict[str, Any]:
    """Return the RS256 JWKS (public, no auth required).

    Returns {"keys": [...]} or {"keys": []} when HS256-only mode.
    """
    return get_jwks()


# ---------------------------------------------------------------------------
# POST /control/register — verify user JWT, issue InstallToken
# ---------------------------------------------------------------------------


@router.post("/register")
def control_register(body: RegisterBody) -> dict[str, Any]:
    """Register a local runtime to a company.

    Verifies the user JWT (via LocalControlPlane.verify_token), creates an
    InstallToken for that company, returns the raw token ONCE.

    The raw token is NOT stored in the DB — only sha256(raw) is stored.

    Args:
        body.user_jwt: A valid user access JWT (issued by /auth/sign-in).

    Returns:
        {install_token: <raw>, company_id: <str>}

    Raises:
        401: If the JWT is invalid or expired.
    """
    try:
        identity = _cp.verify_token(body.user_jwt)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid user JWT: {exc}",
        ) from exc

    # Mint a fresh install token
    raw = secrets.token_urlsafe(32)
    token_hash = _hash_token(raw)

    row = InstallToken(
        id=prefixed_id("itk"),
        company_id=identity.company_id,
        label="default",
        token_hash=token_hash,
    )

    with SessionLocal() as db:
        with db.begin():
            db.add(row)

    logger.info(
        "control/register: issued install token for company_id=%s",
        identity.company_id,
    )

    return {
        "install_token": raw,
        "company_id": identity.company_id,
    }


# ---------------------------------------------------------------------------
# GET /control/entitlements — install-token-authed
# ---------------------------------------------------------------------------


@router.get("/entitlements")
def control_entitlements(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Return the company's plan/limits/features.

    Authenticated by install token.  company_id resolved from the token.
    """
    tok = _get_install_token(authorization)
    ents = _cp.get_entitlements(tok.company_id)
    return {
        "edition": ents.edition,
        "plan_id": ents.plan_id,
        "included_credits": ents.included_credits,
        "overage_policy": ents.overage_policy,
        "features": ents.features,
    }


# ---------------------------------------------------------------------------
# GET /control/balance — install-token-authed
# ---------------------------------------------------------------------------


@router.get("/balance")
def control_balance(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Return the company's current credit balance + overage policy.

    Authenticated by install token.  company_id resolved from the token.
    """
    tok = _get_install_token(authorization)
    state = _cp.check_balance(tok.company_id)
    return {
        "balance": state.balance,
        "overage_policy": state.overage_policy,
    }


# ---------------------------------------------------------------------------
# POST /control/usage — install-token-authed, idempotent
# ---------------------------------------------------------------------------


@router.post("/usage")
def control_usage(
    body: UsageBody,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Debit the credit ledger for a completed job.

    Idempotent per (company_id, job_id) — re-posting the same job_id returns
    the current balance without double-debiting.

    company_id ALWAYS comes from the install token, never from the request body
    (any body company_id field is ignored by schema `extra="ignore"`).

    Args:
        body.job_id:      Unique job identifier (idempotency key).
        body.engine_type: e.g. "litellm", "fake", "anthropic".
        body.model:       Model name or None.
        body.tokens_in:   Input token count.
        body.tokens_out:  Output token count.
        body.credits:     Pre-computed credit cost (informational; cloud recalculates).

    Returns:
        {accepted: true, new_balance: <int>}
    """
    tok = _get_install_token(authorization)

    ev = UsageEvent(
        company_id=tok.company_id,
        job_id=body.job_id,
        engine_type=body.engine_type,
        model=body.model,
        tokens_in=body.tokens_in,
        tokens_out=body.tokens_out,
        credits=body.credits,
    )
    result = _cp.report_usage(ev)
    return {
        "accepted": result.accepted,
        "new_balance": result.new_balance,
    }


# ---------------------------------------------------------------------------
# POST /control/heartbeat — install-token-authed
# ---------------------------------------------------------------------------


@router.post("/heartbeat")
def control_heartbeat(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Liveness + revocation check.

    Updates last_seen_at (already done by _get_install_token).
    Returns {ok: true, revoked: false} for active tokens.
    Returns 401/403 for invalid/revoked tokens (via _get_install_token).
    """
    _get_install_token(authorization)  # raises 401/403 if revoked/unknown
    return {"ok": True, "revoked": False}
