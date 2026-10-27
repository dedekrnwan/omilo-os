"""Billing API endpoints.

Endpoints:
  GET  /v1/usage                         → {balance, included, used_this_period, by_helper[], by_day[]}
  GET  /v1/billing/ledger                → CreditLedger[] (newest first, limit 100)
  GET  /v1/billing/subscription          → {plan, status, period_end, seats, provider, payment_method?}
  GET  /v1/billing/invoices              → Invoice[] (newest first)
  POST /v1/billing/change-plan {plan_id} → {subscription, balance}
  POST /v1/billing/topup {pack}          → {balance, invoice}

All endpoints are company-scoped via the tenant session dependency (RLS-enforced).
ManualProvider is the default — all operations work offline with no Stripe/Xendit.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from omilo.billing.balance import balance as get_balance, grant_credits
from omilo.billing.provider import get_payment_provider
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Invoice, Plan, Subscription
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["billing"])

# ---------------------------------------------------------------------------
# Credit pack catalogue
# See plan spec §7; these values are the offline defaults.
# ---------------------------------------------------------------------------

PACKS: dict[str, int] = {
    "small": 1_000,
    "medium": 5_000,
    "large": 20_000,
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

    return {
        "balance": current_balance,
        "included": included,
        "used_this_period": used_this_period,
        "by_helper": by_helper,
        "by_day": by_day,
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
) -> dict[str, Any]:
    """Change (or set) the company's billing plan.

    Internal effects (offline, no Stripe):
    1. Look up the Plan row.
    2. Call provider.change_subscription (ManualProvider → {"status":"offline"}).
    3. Deactivate existing active subscriptions.
    4. Create a new Subscription row (status="active").
    5. Update Company.plan_id.
    6. Grant plan.included_credits (reason="subscription_grant").

    Returns the new subscription + updated balance.
    """
    plan = db.get(Plan, body.plan_id)
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {body.plan_id!r} not found",
        )

    company = _load_company(db, ctx.company_id)
    provider = get_payment_provider()

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
) -> dict[str, Any]:
    """Top up credits using a named pack.

    Pack options: small (1 000), medium (5 000), large (20 000).

    Internal effects (offline):
    1. Map pack name → credit amount.
    2. Call provider.charge_one_off (ManualProvider → {"status":"offline"}).
    3. Grant credits (reason="topup").
    4. Create an Invoice row (status="offline"/"paid").

    Returns updated balance + invoice.
    """
    pack_name = body.pack
    credits = PACKS.get(pack_name)
    if credits is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown pack {pack_name!r}. Valid: {list(PACKS)}",
        )

    company = _load_company(db, ctx.company_id)
    provider = get_payment_provider()

    # Approximate USD amount (1 credit = $0.01)
    amount_usd = credits / 100.0

    # Provider call (ManualProvider → offline no-op)
    provider.charge_one_off(company, amount_usd, reason=f"topup:{pack_name}")

    # Grant credits
    grant_credits(
        db,
        company,
        credits,
        reason="topup",
        meta={"pack": pack_name},
    )

    # Create Invoice
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
