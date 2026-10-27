"""McpAccessToken API — company-scoped mint / list / revoke endpoints.

Endpoints:
  POST   /v1/mcp-access-tokens              → mint a new token (owner/admin only)
  GET    /v1/mcp-access-tokens              → list company tokens (no secret)
  DELETE /v1/mcp-access-tokens/{id}         → soft-revoke (idempotent)

Auth protocol:
  All endpoints require a valid Bearer session (get_context).
  POST (mint) and DELETE (revoke) further require owner or admin role.

Token security:
  - Raw secret: secrets.token_urlsafe(32)
  - Stored: token_hash = sha256(raw.encode()).hexdigest()
  - Raw token returned ONCE on mint; NEVER stored; NEVER returned on GET.

Spec: docs/technical/05-mcp-surfaces.md §8, P5b Task-2.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.mcp_token import McpAccessToken
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db, require_role

router = APIRouter(tags=["mcp-tokens"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class MintTokenBody(BaseModel):
    label: str
    helper_id: str
    scopes: list[str] = []
    expires_at: datetime | None = None


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------


def _token_to_list_dict(tok: McpAccessToken, now: datetime) -> dict[str, Any]:
    """Serialise a McpAccessToken for the GET list response (no secret)."""
    return {
        "id": tok.id,
        "label": tok.label,
        "helper_id": tok.helper_id,
        "scopes": tok.scopes,
        "expires_at": tok.expires_at.isoformat() if tok.expires_at else None,
        "last_used_at": tok.last_used_at.isoformat() if tok.last_used_at else None,
        "revoked_at": tok.revoked_at.isoformat() if tok.revoked_at else None,
        "created_at": tok.created_at.isoformat() if tok.created_at else None,
        "active": tok.is_active(now),
    }


def _token_to_mint_dict(tok: McpAccessToken, raw_token: str) -> dict[str, Any]:
    """Serialise a McpAccessToken for the POST mint response (raw token included ONCE)."""
    return {
        "id": tok.id,
        "label": tok.label,
        "helper_id": tok.helper_id,
        "scopes": tok.scopes,
        "token": raw_token,
        "expires_at": tok.expires_at.isoformat() if tok.expires_at else None,
        "created_at": tok.created_at.isoformat() if tok.created_at else None,
    }


# ---------------------------------------------------------------------------
# POST /v1/mcp-access-tokens — mint
# ---------------------------------------------------------------------------


@router.post("/mcp-access-tokens")
def mint_mcp_access_token(
    body: MintTokenBody,
    _: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Mint a new McpAccessToken for a company Helper.

    Access: owner or admin only (require_role guard).
    The raw token is returned ONCE; the sha256 hash is stored; the raw
    token is never stored and never returned again.
    """
    # Validate helper belongs to this company (RLS enforced by tenant session,
    # but we do an explicit check for a clean 404 rather than a silent miss).
    helper = db.get(Helper, body.helper_id)
    if helper is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Helper not found in this company.",
        )

    # Generate raw secret + hash
    raw_secret = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_secret.encode()).hexdigest()

    # Create the McpAccessToken row
    tok = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=ctx.company_id,
        label=body.label,
        token_hash=token_hash,
        helper_id=body.helper_id,
        scopes=body.scopes,
        expires_at=body.expires_at,
    )
    db.add(tok)
    db.flush()

    return _token_to_mint_dict(tok, raw_secret)


# ---------------------------------------------------------------------------
# GET /v1/mcp-access-tokens — list
# ---------------------------------------------------------------------------


@router.get("/mcp-access-tokens")
def list_mcp_access_tokens(
    db: Session = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    """List all McpAccessToken rows for the active company.

    Secret (token / token_hash) is NEVER included.
    Results are ordered newest-first.
    """
    now = datetime.now(timezone.utc)
    rows = (
        db.query(McpAccessToken)
        .order_by(McpAccessToken.created_at.desc())
        .all()
    )
    return [_token_to_list_dict(r, now) for r in rows]


# ---------------------------------------------------------------------------
# DELETE /v1/mcp-access-tokens/{id} — soft-revoke
# ---------------------------------------------------------------------------


@router.delete("/mcp-access-tokens/{token_id}", status_code=status.HTTP_200_OK)
def revoke_mcp_access_token(
    token_id: str,
    _: None = Depends(require_role("owner", "admin")),
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Soft-revoke a McpAccessToken by setting revoked_at = now.

    Idempotent: re-revoking an already-revoked token returns ok (200).
    404 if the token id is not found in this company (RLS-enforced).
    """
    tok = db.get(McpAccessToken, token_id)
    if tok is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="MCP access token not found.",
        )

    if tok.revoked_at is None:
        tok.revoked_at = datetime.now(timezone.utc)
        db.flush()

    now = datetime.now(timezone.utc)
    return _token_to_list_dict(tok, now)
