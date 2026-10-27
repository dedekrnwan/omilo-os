"""Wallet API endpoints — company-scoped auto-topup settings + payment history.

Endpoints:
  GET  /v1/wallet                        → WalletSettings (created with defaults if absent)
  PUT  /v1/wallet                        → upsert WalletSettings
  GET  /v1/wallet/payments               → DoitPayment[] newest first (company-scoped)
  GET  /v1/wallet/payments/{id}          → one DoitPayment (status/hosted_url)

All endpoints are company-scoped via the tenant session dependency (RLS-enforced).
"""
from __future__ import annotations

from typing import Any

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.models.commerce import DoitPayment, WalletSettings
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["wallet"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class WalletSettingsBody(BaseModel):
    auto_topup_enabled: bool = False
    auto_topup_threshold_credits: int = 0
    auto_topup_pack: str | None = None


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------


def _wallet_dict(ws: WalletSettings) -> dict[str, Any]:
    return {
        "company_id": ws.company_id,
        "auto_topup_enabled": ws.auto_topup_enabled,
        "auto_topup_threshold_credits": ws.auto_topup_threshold_credits,
        "auto_topup_pack": ws.auto_topup_pack,
        "updated_at": ws.updated_at.isoformat() if ws.updated_at else None,
    }


def _payment_dict(pay: DoitPayment) -> dict[str, Any]:
    return {
        "id": pay.id,
        "company_id": pay.company_id,
        "kind": pay.kind,
        "status": pay.status,
        "credits": pay.credits,
        "amount_idr": pay.amount_idr,
        "reference": pay.reference,
        "provider_payment_id": pay.provider_payment_id,
        "hosted_url": pay.hosted_url,
        "plan_id": pay.plan_id,
        "granted": pay.granted,
        "created_at": pay.created_at.isoformat() if pay.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/wallet
# ---------------------------------------------------------------------------


@router.get("/wallet", status_code=200)
def get_wallet(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return WalletSettings for the active company.

    Creates a default row (auto_topup_enabled=false) if none exists.
    """
    ws = db.get(WalletSettings, ctx.company_id)
    if ws is None:
        ws = WalletSettings(
            company_id=ctx.company_id,
            auto_topup_enabled=False,
            auto_topup_threshold_credits=0,
            auto_topup_pack=None,
        )
        db.add(ws)
        db.flush()
    return _wallet_dict(ws)


# ---------------------------------------------------------------------------
# PUT /v1/wallet
# ---------------------------------------------------------------------------


@router.put("/wallet", status_code=200)
def update_wallet(
    body: WalletSettingsBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Upsert WalletSettings for the active company."""
    ws = db.get(WalletSettings, ctx.company_id)
    if ws is None:
        ws = WalletSettings(company_id=ctx.company_id)
        db.add(ws)

    ws.auto_topup_enabled = body.auto_topup_enabled
    ws.auto_topup_threshold_credits = body.auto_topup_threshold_credits
    ws.auto_topup_pack = body.auto_topup_pack
    db.flush()

    return _wallet_dict(ws)


# ---------------------------------------------------------------------------
# GET /v1/wallet/payments
# ---------------------------------------------------------------------------


@router.get("/wallet/payments", status_code=200)
def list_payments(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
    payment_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict[str, Any]]:
    """Return the company's DoitPayment rows, newest first.

    Optional query params:
      status — filter by payment status (pending|paid|expired|failed|refunded)
      limit  — max rows to return (default 50, max 200)
    """
    q = (
        db.query(DoitPayment)
        .filter(DoitPayment.company_id == ctx.company_id)
    )
    if payment_status:
        q = q.filter(DoitPayment.status == payment_status)

    rows = q.order_by(DoitPayment.created_at.desc()).limit(limit).all()
    return [_payment_dict(pay) for pay in rows]


# ---------------------------------------------------------------------------
# GET /v1/wallet/payments/{id}
# ---------------------------------------------------------------------------


@router.get("/wallet/payments/{payment_id}", status_code=200)
def get_payment(
    payment_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return one DoitPayment by id (company-scoped).

    Returns 404 if not found or belongs to another company.
    """
    pay = db.get(DoitPayment, payment_id)
    if pay is None or pay.company_id != ctx.company_id:
        raise HTTPException(status_code=404, detail="Payment not found")
    return _payment_dict(pay)
