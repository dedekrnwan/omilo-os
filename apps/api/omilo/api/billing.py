"""Billing API endpoints.

Endpoints:
  GET  /v1/usage                         → {balance, included, used_this_period, by_helper[], by_day[]}
  GET  /v1/billing/ledger                → CreditLedger[] (newest first, limit 100)
  GET  /v1/billing/subscription          → {plan, status, period_end, seats, provider, payment_method?}
  GET  /v1/billing/invoices              → Invoice[] (newest first)
  POST /v1/billing/change-plan {plan_id} → {subscription, balance} (Manual) | {payment_id, hosted_url, status, plan_id} (Doit)
  POST /v1/billing/topup {pack}          → {balance, invoice} (Manual) | {payment_id, hosted_url, status, credits, amount_idr} (Doit)

All endpoints are company-scoped via the tenant session dependency (RLS-enforced).
ManualProvider is the default — all operations work offline with no Stripe/Xendit.
DoitProvider creates a pending DoitPayment + returns hosted_url; credits are
granted by the webhook handler (T3) on payment.paid.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from omilo.billing.balance import balance as get_balance, grant_credits
from omilo.billing.doit_provider import DoitProvider
from omilo.billing.provider import get_payment_provider
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Invoice, Plan, Subscription
from omilo.models.commerce import DoitPayment
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["billing"])

# ---------------------------------------------------------------------------
# Credit pack catalogue
# See plan spec §7; these values are the offline defaults.
# amount_idr values: small=15 000 IDR, medium=70 000 IDR, large=250 000 IDR
# (spec §7 pinned prices; 1 credit ≈ Rp 12.5 for topups)
# ---------------------------------------------------------------------------

PACKS: dict[str, dict[str, int]] = {
    "small": {"credits": 1_000, "amount_idr": 15_000},
    "medium": {"credits": 5_000, "amount_idr": 70_000},
    "large": {"credits": 20_000, "amount_idr": 250_000},
}


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ChangePlanBody(BaseModel):
    plan_id: str


class TopupBody(BaseModel):
    pack: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _current_period_label() -> str:
    """Return 'YYYY-MM' for the current billing month."""
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m")


def _month_start() -> datetime:
    """Return UTC midnight on the first of the current month."""
    now = datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _load_company(db: Session, company_id: str) -> Company:
    """Load the Company row (global table — no RLS filter needed)."""
    company = db.get(Company, company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _subscription_dict(sub: Subscription) -> dict[str, Any]:
    return {
        "id": sub.id,
        "company_id": sub.company_id,
        "plan_id": sub.plan_id,
        "status": sub.status,
        "seats": sub.seats,
        "provider": sub.provider,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
        "created_at": (
            sub.created_at.isoformat() if sub.created_at else None
        ),
    }


def _plan_dict(plan: Plan) -> dict[str, Any]:
    return {
        "id": plan.id,
        "tier": plan.tier,
        "name": plan.name,
        "monthly_price_usd": float(plan.monthly_price_usd),
        "included_credits": plan.included_credits,
        "credit_overage_usd": float(plan.credit_overage_usd),
        "seats": plan.seats,
    }


def _invoice_dict(inv: Invoice) -> dict[str, Any]:
    return {
        "id": inv.id,
        "company_id": inv.company_id,
        "amount": float(inv.amount),
        "currency": inv.currency,
        "status": inv.status,
        "period": inv.period,
        "provider": inv.provider,
        "external_ref": inv.external_ref,
        "created_at": (
            inv.created_at.isoformat() if inv.created_at else None
        ),
    }


# ---------------------------------------------------------------------------
# GET /v1/usage
# ---------------------------------------------------------------------------


@router.get("/usage", status_code=200)
def get_usage(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return credit usage summary for the active company.

    Response:
      {
        balance: int,
        included: int,               # plan included_credits (0 if no plan)
        used_this_period: int,       # SUM of credits_charged (reason="job") this month
        by_helper: [{helper_id, credits}],
        by_day: [{day, credits}]
      }
    """
    company = _load_company(db, ctx.company_id)
    current_balance = get_balance(db, company)

    # Included credits from the company's plan (0 if no plan linked)
    included = 0
    if company.plan_id:
        plan = db.get(Plan, company.plan_id)
        if plan:
            included = plan.included_credits

    month_start = _month_start()

    # All job-charged ledger rows this month (credits_charged > 0 when reason="job")
    job_rows = (
        db.query(CreditLedger)
        .filter(
            CreditLedger.company_id == company.id,
            CreditLedger.reason == "job",
            CreditLedger.at >= month_start,
        )
        .all()
    )

    used_this_period = sum(row.credits_charged for row in job_rows)

    # by_helper — group by helper_id
    helper_sums: dict[str, int] = {}
    for row in job_rows:
        if row.helper_id:
            helper_sums[row.helper_id] = (
                helper_sums.get(row.helper_id, 0) + row.credits_charged
            )
    by_helper = [
        {"helper_id": hid, "credits": credits}
        for hid, credits in helper_sums.items()
    ]

    # by_day — group by date (UTC)
    day_sums: dict[str, int] = {}
    for row in job_rows:
        day = row.at.astimezone(timezone.utc).strftime("%Y-%m-%d")
        day_sums[day] = day_sums.get(day, 0) + row.credits_charged
    by_day = [
        {"day": day, "credits": credits}
        for day, credits in sorted(day_sums.items())
    ]

    # ── pending_topups: count + total credits of pending topup DoitPayments ──
    pending_topup_rows = (
        db.query(DoitPayment)
        .filter(
            DoitPayment.company_id == company.id,
            DoitPayment.status == "pending",
            DoitPayment.kind == "topup",
        )
        .all()
    )
    pending_topup_count = len(pending_topup_rows)
    pending_topup_credits = sum(row.credits for row in pending_topup_rows)

    # ── last_payment: most recent DoitPayment (any kind/status) ──────────────
    last_pay = (
        db.query(DoitPayment)
        .filter(DoitPayment.company_id == company.id)
        .order_by(DoitPayment.created_at.desc())
        .first()
    )
    last_payment = None
    if last_pay is not None:
        last_payment = {
            "id": last_pay.id,
            "kind": last_pay.kind,
            "status": last_pay.status,
            "amount_idr": last_pay.amount_idr,
            "created_at": last_pay.created_at.isoformat() if last_pay.created_at else None,
        }

    return {
        "balance": current_balance,
        "included": included,
        "used_this_period": used_this_period,
        "by_helper": by_helper,
        "by_day": by_day,
        "pending_topups": {
            "count": pending_topup_count,
            "total_credits": pending_topup_credits,
        },
        "last_payment": last_payment,
    }


# ---------------------------------------------------------------------------
# GET /v1/billing/ledger
# ---------------------------------------------------------------------------


@router.get("/billing/ledger", status_code=200)
def get_ledger(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return recent CreditLedger rows for the active company, newest first."""
    company = _load_company(db, ctx.company_id)

    rows = (
        db.query(CreditLedger)
        .filter(CreditLedger.company_id == company.id)
        .order_by(CreditLedger.at.desc())
        .limit(100)
        .all()
    )

    return [
        {
            "id": row.id,
            "delta": row.delta,
            "reason": row.reason,
            "credits_charged": row.credits_charged,
            "created_at": row.at.isoformat(),
            "job_id": row.job_id,
            "helper_id": row.helper_id,
            "balance_after": row.balance_after,
        }
        for row in rows
    ]


# ---------------------------------------------------------------------------
# GET /v1/billing/subscription
# ---------------------------------------------------------------------------


@router.get("/billing/subscription", status_code=200)
def get_subscription(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the company's current subscription in spec §7 shape.

    Shape: {plan, status, period_end, seats, provider, payment_method?}
    Returns nulls when no active subscription exists.
    """
    company = _load_company(db, ctx.company_id)

    sub = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.status == "active",
        )
        .order_by(Subscription.created_at.desc())
        .first()
    )

    if sub is None:
        return {
            "plan": None,
            "status": None,
            "period_end": None,
            "seats": None,
            "provider": None,
            "payment_method": None,
        }

    plan = db.get(Plan, sub.plan_id) if sub.plan_id else None

    return {
        "plan": _plan_dict(plan) if plan else None,
        "status": sub.status,
        "period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
        "seats": sub.seats,
        "provider": sub.provider,
        # ManualProvider has no stored payment method; wired providers may populate this.
        "payment_method": None,
    }


# ---------------------------------------------------------------------------
# GET /v1/billing/invoices
# ---------------------------------------------------------------------------


@router.get("/billing/invoices", status_code=200)
def get_invoices(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return all invoices for the active company, newest first.

    Always available (spec §7) — includes offline-marked invoices from topups
    and future provider-collected invoices.
    """
    company = _load_company(db, ctx.company_id)

    rows = (
        db.query(Invoice)
        .filter(Invoice.company_id == company.id)
        .order_by(Invoice.created_at.desc())
        .all()
    )

    return [_invoice_dict(inv) for inv in rows]


# ---------------------------------------------------------------------------
# POST /v1/billing/change-plan
# ---------------------------------------------------------------------------


@router.post("/billing/change-plan", status_code=200)
def change_plan(
    body: ChangePlanBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
    provider: Any = Depends(get_payment_provider),
) -> dict[str, Any]:
    """Change (or set) the company's billing plan.

    ManualProvider (default):
      Instant activation:
      1. Look up the Plan row.
      2. Call provider.change_subscription (ManualProvider → {"status":"offline"}).
      3. Deactivate existing active subscriptions.
      4. Create a new Subscription row (status="active").
      5. Update Company.plan_id.
      6. Grant plan.included_credits (reason="subscription_grant").
      Returns {subscription, balance, plan}.

    DoitProvider:
      Creates a pending DoitPayment (kind="subscription") + calls
      provider.change_subscription → gets hosted_url.
      Does NOT activate the Subscription or grant credits.
      Returns {payment_id, hosted_url, status:"pending", plan_id}.
      Activation + credit grant happen in the webhook handler (T3) on payment.paid.
    """
    plan = db.get(Plan, body.plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {body.plan_id!r} not found",
        )

    company = _load_company(db, ctx.company_id)

    # -----------------------------------------------------------------------
    # DoitProvider path — create a pending payment; do NOT activate subscription
    # -----------------------------------------------------------------------
    if isinstance(provider, DoitProvider):
        short_id = uuid.uuid4().hex[:8]
        reference = f"sub:{company.id}:{plan.id}:{short_id}"

        # Call provider to create a Doit billing plan + subscription → get hosted_url
        sub_result = provider.change_subscription(company, plan)

        # Use provider_ref from the subscription result to create a payment
        # We need a payment record; use charge_one_off for the initial payment
        amount_idr = plan.monthly_price_idr
        charge_result = provider.charge_one_off(
            company,
            amount_idr,
            reference,
            metadata={"plan_id": plan.id, "credits": plan.included_credits},
        )

        # Persist a pending Subscription row (status="pending" — not yet active)
        new_sub = Subscription(
            id=prefixed_id("sub"),
            company_id=company.id,
            plan_id=plan.id,
            status="pending",
            seats=plan.seats,
            provider="doit",
            external_ref=None,
            current_period_end=None,
            provider_ref=sub_result.get("provider_ref") if sub_result else None,
        )
        db.add(new_sub)
        db.flush()

        # Persist a pending DoitPayment row (kind="subscription")
        pay = DoitPayment(
            id=prefixed_id("pay"),
            company_id=company.id,
            kind="subscription",
            credits=plan.included_credits,
            amount_idr=amount_idr,
            reference=reference,
            plan_id=plan.id,
            provider_payment_id=charge_result["provider_payment_id"],
            hosted_url=charge_result["hosted_url"],
            status="pending",
            raw=charge_result.get("raw"),
        )
        db.add(pay)
        db.flush()

        return {
            "payment_id": pay.id,
            "hosted_url": pay.hosted_url,
            "status": "pending",
            "plan_id": plan.id,
        }

    # -----------------------------------------------------------------------
    # ManualProvider (and any other non-Doit provider) — instant activation (P4)
    # -----------------------------------------------------------------------

    # Provider call (ManualProvider → offline no-op)
    provider.change_subscription(company, plan)

    # Deactivate existing subscriptions for this company
    existing_subs = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.status == "active",
        )
        .all()
    )
    for s in existing_subs:
        s.status = "canceled"
    db.flush()

    # Create new active subscription
    new_sub = Subscription(
        id=prefixed_id("sub"),
        company_id=company.id,
        plan_id=plan.id,
        status="active",
        seats=plan.seats,
        provider="manual",
        external_ref=None,
        current_period_end=None,
    )
    db.add(new_sub)
    db.flush()

    # Update company plan reference
    company.plan_id = plan.id
    db.flush()

    # Grant included credits if any
    if plan.included_credits > 0:
        grant_credits(
            db,
            company,
            plan.included_credits,
            reason="subscription_grant",
            meta={"plan_id": plan.id, "subscription_id": new_sub.id},
        )

    new_balance = get_balance(db, company)

    return {
        "subscription": _subscription_dict(new_sub),
        "balance": new_balance,
        "plan": _plan_dict(plan),
    }


# ---------------------------------------------------------------------------
# POST /v1/billing/topup
# ---------------------------------------------------------------------------


@router.post("/billing/topup", status_code=200)
def topup(
    body: TopupBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
    provider: Any = Depends(get_payment_provider),
) -> dict[str, Any]:
    """Top up credits using a named pack.

    Pack options: small (1 000 cr / 15 000 IDR), medium (5 000 cr / 70 000 IDR),
                  large (20 000 cr / 250 000 IDR).

    ManualProvider (default):
      Instant grant — creates a CreditLedger + offline Invoice; returns {balance, invoice}.

    DoitProvider:
      Creates a pending DoitPayment + calls provider.charge_one_off → gets hosted_url.
      Does NOT touch the balance; returns {payment_id, hosted_url, status:"pending", credits, amount_idr}.
      Credits are granted by the webhook handler (T3) on payment.paid.
    """
    pack_name = body.pack
    pack = PACKS.get(pack_name)
    if pack is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown pack {pack_name!r}. Valid: {list(PACKS)}",
        )

    credits = pack["credits"]
    amount_idr = pack["amount_idr"]

    company = _load_company(db, ctx.company_id)

    # -----------------------------------------------------------------------
    # DoitProvider path — create a pending payment; no balance change
    # -----------------------------------------------------------------------
    if isinstance(provider, DoitProvider):
        # Unique reference for idempotency
        short_id = uuid.uuid4().hex[:8]
        reference = f"topup:{company.id}:{pack_name}:{short_id}"

        charge_result = provider.charge_one_off(
            company,
            amount_idr,
            reference,
            metadata={"pack": pack_name, "credits": credits},
        )

        # Persist a pending DoitPayment row
        pay = DoitPayment(
            id=prefixed_id("pay"),
            company_id=company.id,
            kind="topup",
            credits=credits,
            amount_idr=amount_idr,
            reference=reference,
            provider_payment_id=charge_result["provider_payment_id"],
            hosted_url=charge_result["hosted_url"],
            status="pending",
            raw=charge_result.get("raw"),
        )
        db.add(pay)
        db.flush()

        return {
            "payment_id": pay.id,
            "hosted_url": pay.hosted_url,
            "status": "pending",
            "credits": credits,
            "amount_idr": amount_idr,
        }

    # -----------------------------------------------------------------------
    # ManualProvider (and any other non-Doit provider) — instant grant (P4)
    # -----------------------------------------------------------------------

    # Provider call (ManualProvider → offline no-op)
    provider.charge_one_off(company, amount_idr, f"topup:{pack_name}")

    # Grant credits
    grant_credits(
        db,
        company,
        credits,
        reason="topup",
        meta={"pack": pack_name},
    )

    # Create Invoice (USD amount: 1 credit = $0.01 for offline/manual provider)
    amount_usd = credits / 100.0
    inv = Invoice(
        id=prefixed_id("inv"),
        company_id=company.id,
        amount=Decimal(str(amount_usd)),
        currency="USD",
        status="offline",
        period=_current_period_label(),
        provider="manual",
        external_ref=None,
        pdf_url=None,
    )
    db.add(inv)
    db.flush()

    new_balance = get_balance(db, company)

    return {
        "balance": new_balance,
        "invoice": _invoice_dict(inv),
    }
