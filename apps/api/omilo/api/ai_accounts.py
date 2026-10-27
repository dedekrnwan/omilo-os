"""AI-accounts pool endpoints (§06 of 06-llm-routing-account-pool.md).

Endpoints:
  GET  /v1/ai-accounts                   → PoolAccount rows (list)
  POST /v1/ai-accounts                   → create HarnessAccount
  PATCH /v1/ai-accounts/{id}             → update name/tag/status
  POST /v1/ai-accounts/{id}/test         → offline probe stub {ok:true, status:...}
  POST /v1/ai-accounts/check             → reclassify all accounts from pct_window → status

All endpoints are company-scoped via get_tenant_db (FORCE RLS).

Field-name mapping (spec "PoolAccount" vs HarnessAccount model):
  spec `name`      ↔ model `label`
  spec `pct`       ↔ model `pct_window`
  spec `last_used` ↔ model `last_used_at`
  spec `tag`       ↔ model tokens field (used as tag storage, see note below)

Note on `tag`: HarnessAccount has no dedicated `tag` column. The spec lists
`tag` as a PoolAccount field. We store it in `tokens` (a Text column with
server_default="") as a lightweight tag/label until a dedicated migration adds
a proper column. This mirrors omilo-os convention for optional metadata fields.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.engine.pool import classify, WARN_THRESHOLD
from omilo.models.accounts import HarnessAccount
from omilo.models.base import prefixed_id
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["ai-accounts"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateAccountBody(BaseModel):
    harness: str
    name: str                          # stored as label
    tag: str = ""                      # stored as tokens field (see module note)
    token_enc: str = ""
    token_hint: str = "...****"


class PatchAccountBody(BaseModel):
    name: str | None = None            # updates label
    tag: str | None = None             # updates tokens
    status: str | None = None


# ---------------------------------------------------------------------------
# Serialiser
# ---------------------------------------------------------------------------


def _account_to_dict(acc: HarnessAccount) -> dict[str, Any]:
    """Serialise a HarnessAccount to the PoolAccount response shape."""
    last_used: str | None = None
    if acc.last_used_at is not None:
        lu = acc.last_used_at
        if lu.tzinfo is None:
            lu = lu.replace(tzinfo=datetime.now().astimezone().tzinfo)
        last_used = lu.isoformat()

    return {
        "id": acc.id,
        "harness": acc.harness,
        "name": acc.label,           # spec: name ↔ model: label
        "tag": acc.tokens,           # spec: tag ↔ model: tokens (see module note)
        "status": acc.status,
        "pct": acc.pct_window,       # spec: pct ↔ model: pct_window
        "tokens": acc.token_hint,    # token hint (never the encrypted value)
        "last_used": last_used,
    }


# ---------------------------------------------------------------------------
# GET /v1/ai-accounts
# ---------------------------------------------------------------------------


@router.get("/ai-accounts")
def list_ai_accounts(
    db: Session = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    """Return all HarnessAccount rows for the active company (RLS-enforced)."""
    rows = db.query(HarnessAccount).all()
    return [_account_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /v1/ai-accounts
# ---------------------------------------------------------------------------


@router.post("/ai-accounts", status_code=status.HTTP_201_CREATED)
def create_ai_account(
    body: CreateAccountBody,
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Create a new HarnessAccount for the active company."""
    acc = HarnessAccount(
        id=prefixed_id("acc"),
        company_id=ctx.company_id,
        harness=body.harness,
        label=body.name,
        token_enc=body.token_enc,
        token_hint=body.token_hint,
        tokens=body.tag,             # tag stored in tokens field
        status="ready",
        pct_window=0,
        runs=0,
        cost_credits=0,
    )
    db.add(acc)
    db.flush()
    return _account_to_dict(acc)


# ---------------------------------------------------------------------------
# POST /v1/ai-accounts/check  (must come BEFORE /{id} routes)
# ---------------------------------------------------------------------------


@router.post("/ai-accounts/check")
def check_ai_accounts(
    db: Session = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    """Recompute status for all company accounts from pct_window (classify).

    Accounts with pct_window >= WARN_THRESHOLD → near_limit.
    Accounts with pct_window < WARN_THRESHOLD and status in ("ready","near_limit")
      → ready.
    cooling/error accounts are left unchanged.
    """
    rows = db.query(HarnessAccount).all()
    for acc in rows:
        new_status = classify(acc)
        if new_status != acc.status:
            acc.status = new_status
    db.flush()
    return [_account_to_dict(r) for r in rows]


# ---------------------------------------------------------------------------
# POST /v1/ai-accounts/{id}/test  (must come BEFORE /{id} PATCH)
# ---------------------------------------------------------------------------


@router.post("/ai-accounts/{account_id}/test")
def test_ai_account(
    account_id: str,
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Offline probe: return a stub response without making any real CLI call."""
    acc = db.get(HarnessAccount, account_id)
    if acc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_id!r} not found.",
        )
    # Structural stub: no subprocess, no network call
    return {"ok": True, "status": acc.status}


# ---------------------------------------------------------------------------
# PATCH /v1/ai-accounts/{id}
# ---------------------------------------------------------------------------


@router.patch("/ai-accounts/{account_id}")
def patch_ai_account(
    account_id: str,
    body: PatchAccountBody,
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    """Update name (label), tag (tokens), or status of an account."""
    acc = db.get(HarnessAccount, account_id)
    if acc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_id!r} not found.",
        )
    if body.name is not None:
        acc.label = body.name
    if body.tag is not None:
        acc.tokens = body.tag
    if body.status is not None:
        acc.status = body.status
    db.flush()
    return _account_to_dict(acc)
