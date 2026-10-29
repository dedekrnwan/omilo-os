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

import math
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from omilo.billing.balance import balance as get_balance, grant_credits
from omilo.billing.doit_provider import DoitProvider
from omilo.billing.provider import get_payment_provider
from omilo.config import get_settings
from omilo.control.factory import _normalize_mode
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

# Canonical packs live in omilo.billing.catalog (the control-panel "Buy
# credits" dialog: 2,000 / 5,000 / 20,000 credits at Rp 100 rb / 238 rb /
# 800 rb).  Re-exported here for existing importers.
from omilo.billing.catalog import (  # noqa: E402
    CLOUD_PLAN_IDS,
    PACK_CATALOG,
    PACKS,
    SELF_HOSTED_PLAN_ID,
    plan_features,
    resolve_pack_id,
    resolve_plan_id,
)


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class ChangePlanBody(BaseModel):
    plan_id: str
    interval: str = "monthly"  # "monthly" | "yearly"


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
    is_trial = sub.status == "trialing"
    now = datetime.now(timezone.utc)

    trial_ends_at = None
    trial_days_left = None
    if is_trial and sub.current_period_end is not None:
        # Ensure period_end is timezone-aware
        period_end = sub.current_period_end
        if period_end.tzinfo is None:
            period_end = period_end.replace(tzinfo=timezone.utc)
        trial_ends_at = period_end.isoformat()
        remaining_seconds = (period_end - now).total_seconds()
        # ceil to give full days remaining; clamp to 0 for expired trials
        trial_days_left = max(0, math.ceil(remaining_seconds / 86400))

    return {
        "id": sub.id,
        "company_id": sub.company_id,
        "plan_id": sub.plan_id,
        "status": sub.status,
        "billing_interval": sub.billing_interval or "monthly",
        "seats": sub.seats,
        "provider": sub.provider,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
        "created_at": (
            sub.created_at.isoformat() if sub.created_at else None
        ),
        # Trial fields
        "is_trial": is_trial,
        "trial_ends_at": trial_ends_at,
        "trial_days_left": trial_days_left,
    }


def _plan_dict(plan: Plan) -> dict[str, Any]:
    return {
        "id": plan.id,
        "tier": plan.tier,
        "name": plan.name,
        "monthly_price_usd": float(plan.monthly_price_usd),
        "monthly_price_idr": plan.monthly_price_idr,
        "yearly_price_usd": float(plan.yearly_price_usd),
        "yearly_price_idr": plan.yearly_price_idr,
        "included_credits": plan.included_credits,
        "credit_overage_usd": float(plan.credit_overage_usd),
        "seats": plan.seats,
        "trial_days": 14 if plan.id != SELF_HOSTED_PLAN_ID else 0,
        # sweep/control — seat + helper limits and the marketing bullets.
        "max_seats": plan_features(plan).get("max_seats"),
        "max_helpers": plan_features(plan).get("max_helpers"),
        "seat_price_idr": plan_features(plan).get("seat_price_idr"),
        "storage_gb": plan_features(plan).get("storage_gb"),
        "features": plan_features(plan).get("bullets", []),
        "badge": plan_features(plan).get("badge"),
    }


def _is_cloud_or_hybrid() -> bool:
    """Return True when mode is cloud or hybrid (billing-enabled)."""
    settings = get_settings()
    raw = getattr(settings, "omilo_mode", "cloud") or "cloud"
    return _normalize_mode(raw) in {"cloud", "hybrid"}


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
# GET /v1/billing/plans
# ---------------------------------------------------------------------------


@router.get("/billing/plans", status_code=200)
def get_plans(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return the plan catalog available in the current mode.

    Cloud/hybrid: returns [plan_starter, plan_team, plan_business].
    Local: returns [plan_self_hosted] (free, 0 credits).

    Also lazy-starts a trial for a fresh cloud/hybrid company with no subscription.

    All keys are snake_case: monthly_price_usd, monthly_price_idr,
    yearly_price_usd, yearly_price_idr, included_credits, trial_days.
    """
    company = _load_company(db, ctx.company_id)

    if _is_cloud_or_hybrid():
        # Lazy trial start for companies with no subscription
        existing_any = (
            db.query(Subscription)
            .filter(Subscription.company_id == company.id)
            .first()
        )
        if existing_any is None:
            from omilo.billing.trial import start_trial
            start_trial(db, company)
            db.flush()

        plans = [db.get(Plan, pid) for pid in CLOUD_PLAN_IDS]
        return [_plan_dict(p) for p in plans if p is not None]
    else:
        # local mode — self-hosted plan only
        plan = db.get(Plan, SELF_HOSTED_PLAN_ID)
        if plan is None:
            return []
        return [_plan_dict(plan)]


# ---------------------------------------------------------------------------
# GET /v1/billing/subscription
# ---------------------------------------------------------------------------


@router.get("/billing/subscription", status_code=200)
def get_subscription(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the company's current subscription in spec §7 shape.

    Shape: {plan, status, period_end, seats, provider, payment_method?,
            billing_interval, is_trial, trial_ends_at, trial_days_left}
    Returns nulls when no active subscription exists.

    Lazy trial: if the company is in cloud/hybrid mode and has no subscription,
    a 14-day trial is started on the first call here (idempotent).
    """
    company = _load_company(db, ctx.company_id)

    # ── Lazy trial start for cloud/hybrid companies ───────────────────────────
    if _is_cloud_or_hybrid():
        existing_any = (
            db.query(Subscription)
            .filter(Subscription.company_id == company.id)
            .first()
        )
        if existing_any is None:
            from omilo.billing.trial import start_trial
            start_trial(db, company)
            db.flush()

    # ── Find most recent active or trialing subscription ─────────────────────
    sub = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.status.in_(["active", "trialing"]),
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
            "billing_interval": None,
            "is_trial": False,
            "trial_ends_at": None,
            "trial_days_left": None,
        }

    plan = db.get(Plan, sub.plan_id) if sub.plan_id else None

    sub_dict = _subscription_dict(sub)

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
        "billing_interval": sub_dict["billing_interval"],
        "is_trial": sub_dict["is_trial"],
        "trial_ends_at": sub_dict["trial_ends_at"],
        "trial_days_left": sub_dict["trial_days_left"],
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
    plan = db.get(Plan, resolve_plan_id(body.plan_id))
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plan {body.plan_id!r} not found",
        )

    company = _load_company(db, ctx.company_id)

    # ── Seats carry over (extra paid seats stay), capped by the new plan ──────
    seats_for_plan = _seats_after_change(db, company.id, plan)
    used = _seat_usage(db, company.id)["used"]
    max_seats = plan_features(plan).get("max_seats")
    if max_seats is not None and used > max_seats:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{plan.name} allows {max_seats} people, but {used} seats are in use. "
                "Remove people or revoke invites first."
            ),
        )

    # ── Resolve billing interval ──────────────────────────────────────────────
    interval = (body.interval or "monthly").lower()
    if interval not in ("monthly", "yearly"):
        interval = "monthly"

    # ── Compute amount and period_end based on interval ───────────────────────
    now = datetime.now(timezone.utc)
    if interval == "yearly":
        amount_idr = plan.yearly_price_idr
        amount_usd = float(plan.yearly_price_usd)
        period_end = now + timedelta(days=365)
    else:
        amount_idr = plan.monthly_price_idr
        amount_usd = float(plan.monthly_price_usd)
        period_end = now + timedelta(days=30)

    # -----------------------------------------------------------------------
    # DoitProvider path — create a pending payment; do NOT activate subscription
    # -----------------------------------------------------------------------
    if isinstance(provider, DoitProvider):
        short_id = uuid.uuid4().hex[:8]
        reference = f"sub:{company.id}:{plan.id}:{short_id}"

        # Call provider to create a Doit billing plan + subscription → get hosted_url
        sub_result = provider.change_subscription(company, plan)

        # Use interval-specific amount for the charge
        charge_result = provider.charge_one_off(
            company,
            amount_idr,
            reference,
            metadata={"plan_id": plan.id, "credits": plan.included_credits, "interval": interval},
        )

        # Persist a pending Subscription row (status="pending" — not yet active)
        new_sub = Subscription(
            id=prefixed_id("sub"),
            company_id=company.id,
            plan_id=plan.id,
            status="pending",
            billing_interval=interval,
            seats=seats_for_plan,
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

    # Deactivate existing active/trialing subscriptions for this company
    existing_subs = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.status.in_(["active", "trialing"]),
        )
        .all()
    )
    for s in existing_subs:
        s.status = "canceled"
    db.flush()

    # Create new active subscription with interval and period_end
    new_sub = Subscription(
        id=prefixed_id("sub"),
        company_id=company.id,
        plan_id=plan.id,
        status="active",
        billing_interval=interval,
        seats=seats_for_plan,
        provider="manual",
        external_ref=None,
        current_period_end=period_end,
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

    from omilo import audit
    audit.record_ctx(
        ctx, type="billing", action="changed plan to", target=f"{plan.name} · {interval}",
        meta={"plan_id": plan.id, "interval": interval},
    )

    # Emit telemetry: plan changed — best-effort, never raises.
    try:
        from omilo.telemetry import PLAN_CHANGED
        from omilo.telemetry.factory import get_telemetry
        get_telemetry().capture(
            PLAN_CHANGED,
            company_id=company.id,
            props={"plan_id": plan.id},
        )
    except Exception:
        pass

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
    pack_name = resolve_pack_id(body.pack)
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

    from omilo import audit
    audit.record_ctx(
        ctx, type="billing", action="bought", target=f"{credits:,} credits",
        meta={"pack": pack_name, "amount_idr": amount_idr},
    )

    # Emit telemetry: credit topup — best-effort, never raises.
    try:
        from omilo.telemetry import CREDIT_TOPUP
        from omilo.telemetry.factory import get_telemetry
        get_telemetry().capture(
            CREDIT_TOPUP,
            company_id=company.id,
            props={"pack": pack_name},
        )
    except Exception:
        pass

    return {
        "balance": new_balance,
        "invoice": _invoice_dict(inv),
    }


# ── sweep/control ────────────────────────────────────────────────────────────
# Seats, packs and seat checkout.
#
#   GET  /v1/billing/packs          → canonical credit packs
#   GET  /v1/billing/seats          → {included, total, max, used, pending, …}
#   POST /v1/billing/seats {count}  → add seats (Manual: instant; Doit: hosted checkout)
# ─────────────────────────────────────────────────────────────────────────────


class SeatsBody(BaseModel):
    count: int


def _active_subscription(db: Session, company_id: str) -> Subscription | None:
    return (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company_id,
            Subscription.status.in_(["active", "trialing"]),
        )
        .order_by(Subscription.created_at.desc())
        .first()
    )


def _seat_usage(db: Session, company_id: str) -> dict[str, int]:
    """Count seat holders: members/admins/owners + open non-viewer invites.

    Viewers are free and never hold a seat.
    """
    from omilo.models.auth_codes import Invite
    from omilo.models.tenancy import Member

    members = db.query(Member).filter(Member.company_id == company_id).all()
    used = sum(1 for m in members if m.role != "viewer")
    viewers = sum(1 for m in members if m.role == "viewer")
    now = datetime.now(timezone.utc)
    invites = (
        db.query(Invite)
        .filter(Invite.company_id == company_id, Invite.accepted_at.is_(None))
        .all()
    )
    pending = sum(1 for i in invites if i.is_open(now) and i.role != "viewer")
    return {"used": used, "pending": pending, "viewers": viewers}


def _seats_after_change(db: Session, company_id: str, plan: Plan) -> int:
    """Seats on a new plan: included seats + extra seats already paid for."""
    current = _active_subscription(db, company_id)
    extra = 0
    if current is not None and current.status == "active":
        old_plan = db.get(Plan, current.plan_id) if current.plan_id else None
        if old_plan is not None:
            extra = max(0, (current.seats or 0) - (old_plan.seats or 0))
    if plan_features(plan).get("seat_price_idr") is None:
        extra = 0  # plan sells no extra seats (Starter)
    total = (plan.seats or 0) + extra
    max_seats = plan_features(plan).get("max_seats")
    if max_seats is not None:
        total = min(total, max_seats)
    return total


def seats_summary(db: Session, company_id: str) -> dict[str, Any]:
    """Seat state for the Members page + invite gating (also used by auth invites)."""
    usage = _seat_usage(db, company_id)
    if not _is_cloud_or_hybrid():
        return {
            "self_hosted": True,
            "unlimited": True,
            "plan_id": SELF_HOSTED_PLAN_ID,
            "plan_name": "Self-Hosted",
            "included": None,
            "total": None,
            "max": None,
            "available": None,
            "seat_price_idr": 0,
            "can_add": False,
            **usage,
        }
    sub = _active_subscription(db, company_id)
    plan = db.get(Plan, sub.plan_id) if sub and sub.plan_id else None
    feats = plan_features(plan)
    if plan is None or (feats.get("max_seats") is None and feats.get("seat_price_idr") is None):
        # Cloud plans are per company: unlimited people, nothing to buy.
        return {
            "self_hosted": False,
            "unlimited": True,
            "plan_id": plan.id if plan else None,
            "plan_name": plan.name if plan else None,
            "included": None,
            "total": None,
            "max": None,
            "available": None,
            "seat_price_idr": None,
            "can_add": False,
            "billing_interval": sub.billing_interval if sub else "monthly",
            "period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            **usage,
        }
    total = (sub.seats if sub else (plan.seats if plan else 0)) or 0
    return {
        "self_hosted": False,
        "plan_id": plan.id if plan else None,
        "plan_name": plan.name if plan else None,
        "included": plan.seats if plan else 0,
        "total": total,
        "max": feats.get("max_seats"),
        "available": max(0, total - usage["used"] - usage["pending"]),
        "seat_price_idr": feats.get("seat_price_idr"),
        "can_add": feats.get("seat_price_idr") is not None,
        "billing_interval": sub.billing_interval if sub else "monthly",
        "period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
        **usage,
    }


def _prorated_seat_amount(sub: Subscription | None, count: int, seat_price: int) -> tuple[int, int]:
    """Return (due_today_idr, days_left) for adding ``count`` seats now."""
    now = datetime.now(timezone.utc)
    yearly = bool(sub and sub.billing_interval == "yearly")
    period_days = 365 if yearly else 30
    unit = seat_price * (12 if yearly else 1)
    days_left = period_days
    if sub is not None and sub.current_period_end is not None:
        end = sub.current_period_end
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        days_left = max(1, min(period_days, math.ceil((end - now).total_seconds() / 86400)))
    due = int(round(count * unit * days_left / period_days))
    return due, days_left


@router.get("/billing/packs", status_code=200)
def get_packs(_ctx: RequestContext = Depends(get_context)) -> list[dict[str, Any]]:
    """Return the canonical credit packs (ids accepted by POST /billing/topup)."""
    return [dict(p) for p in PACK_CATALOG]


@router.get("/billing/seats", status_code=200)
def get_seats(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Seat summary for the Members page (local mode → unlimited)."""
    return seats_summary(db, ctx.company_id)


@router.post("/billing/seats", status_code=200)
def add_seats(
    body: SeatsBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
    provider: Any = Depends(get_payment_provider),
) -> dict[str, Any]:
    """Buy ``count`` extra seats on the current plan (owner/admin).

    ManualProvider: seats are added instantly → {seats, amount_idr}.
    DoitProvider: pending DoitPayment(kind="seats") → {payment_id, hosted_url, …};
    seats are added by the webhook/reconcile settle on payment.paid.
    """
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can add seats.")
    if body.count < 1 or body.count > 100:
        raise HTTPException(status_code=422, detail="count must be between 1 and 100.")
    if not _is_cloud_or_hybrid():
        raise HTTPException(status_code=409, detail="Self-hosted workspaces have unlimited seats.")

    company = _load_company(db, ctx.company_id)
    sub = _active_subscription(db, company.id)
    plan = db.get(Plan, sub.plan_id) if sub and sub.plan_id else None
    if sub is None or plan is None:
        raise HTTPException(status_code=409, detail="No active plan. Pick a plan first.")
    feats = plan_features(plan)
    seat_price = feats.get("seat_price_idr")
    if seat_price is None:
        raise HTTPException(
            status_code=409,
            detail=f"{plan.name} includes unlimited people — just invite them.",
        )
    max_seats = feats.get("max_seats")
    if max_seats is not None and (sub.seats or 0) + body.count > max_seats:
        raise HTTPException(
            status_code=409,
            detail=f"{plan.name} tops out at {max_seats} seats.",
        )

    amount_idr, days_left = _prorated_seat_amount(sub, body.count, int(seat_price))
    monthly_idr = body.count * int(seat_price)

    from omilo import audit

    if isinstance(provider, DoitProvider):
        short_id = uuid.uuid4().hex[:8]
        reference = f"seats:{company.id}:{body.count}:{short_id}"
        charge = provider.charge_one_off(
            company,
            max(amount_idr, 1),
            reference,
            metadata={"seats": body.count, "plan_id": plan.id},
        )
        raw = charge.get("raw") if isinstance(charge.get("raw"), dict) else {}
        pay = DoitPayment(
            id=prefixed_id("pay"),
            company_id=company.id,
            kind="seats",
            credits=0,
            amount_idr=max(amount_idr, 1),
            reference=reference,
            plan_id=plan.id,
            provider_payment_id=charge["provider_payment_id"],
            hosted_url=charge["hosted_url"],
            status="pending",
            raw={**(raw or {}), "omilo_seats": body.count},
        )
        db.add(pay)
        db.flush()
        audit.record_ctx(
            ctx, type="billing", action="started checkout for",
            target=f"{body.count} extra seat{'s' if body.count != 1 else ''}",
            meta={"payment_id": pay.id, "amount_idr": pay.amount_idr},
        )
        return {
            "payment_id": pay.id,
            "hosted_url": pay.hosted_url,
            "status": "pending",
            "count": body.count,
            "amount_idr": pay.amount_idr,
            "monthly_idr": monthly_idr,
            "days_left": days_left,
        }

    # Manual / offline: add instantly.
    provider.charge_one_off(company, amount_idr, f"seats:{body.count}")
    sub.seats = (sub.seats or 0) + body.count
    db.flush()
    audit.record_ctx(
        ctx, type="billing", action="added",
        target=f"{body.count} extra seat{'s' if body.count != 1 else ''}",
        meta={"amount_idr": amount_idr},
    )
    return {
        "status": "active",
        "count": body.count,
        "seats": sub.seats,
        "amount_idr": amount_idr,
        "monthly_idr": monthly_idr,
        "days_left": days_left,
    }
