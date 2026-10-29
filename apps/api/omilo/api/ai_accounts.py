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
  spec `tag`       ↔ model `tag` (dedicated nullable Text column, migration 0010)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.engine.pool import classify, WARN_THRESHOLD
from omilo.harness.detect import detect_harnesses
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
    tag: str | None = None             # stored as tag column
    token_enc: str = ""
    token_hint: str = "...****"


class PatchAccountBody(BaseModel):
    name: str | None = None            # updates label
    tag: str | None = None             # updates tag column
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
        "tag": acc.tag,              # spec: tag ↔ model: tag
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
# GET /v1/ai-accounts/detect  (local-harness detection — self-host/runtime)
# ---------------------------------------------------------------------------


@router.get("/ai-accounts/detect")
def detect_ai_harnesses(
    _ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Probe this machine for installed/signed-in AI-harness CLIs.

    Read-only. In a cloud deployment this returns everything not-installed (there
    is no user machine to inspect), which the UI renders as "connect manually".
    """
    return {"harnesses": detect_harnesses()}


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
        tag=body.tag,                # tag stored in dedicated tag column
        status="ready",
        pct_window=0,
        runs=0,
        cost_credits=0,
    )
    db.add(acc)
    db.flush()
    from omilo import audit  # sweep/control

    audit.record_ctx(ctx, type="settings", action="connected AI account", target=acc.label)
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
    """Update name (label), tag, or status of an account."""
    acc = db.get(HarnessAccount, account_id)
    if acc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Account {account_id!r} not found.",
        )
    if body.name is not None:
        if not body.name.strip():
            raise HTTPException(status_code=422, detail="Name must not be empty.")
        acc.label = body.name.strip()
    if body.tag is not None:
        acc.tag = body.tag
    if body.status is not None:
        # sweep/control — "paused" takes an account out of the pool (pool.py
        # only selects status == "ready"); "ready" puts it back.
        if body.status not in ("ready", "paused", "near_limit", "cooling", "error"):
            raise HTTPException(status_code=422, detail="Unknown account status.")
        acc.status = body.status
    db.flush()
    return _account_to_dict(acc)
