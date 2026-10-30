"""omilo.billing.settle — Shared idempotent payment-paid settle logic.

Public API:
    apply_payment_paid(db, payment, company) -> bool
        The single idempotent paid-transition, callable from BOTH the webhook
        handler (webhooks.py T3) and the reconcile safety-net (reconcile.py T6).

Contract / caller invariants:
    1. ``db`` must already be a tenant-scoped session for ``payment.company_id``
       (SET LOCAL ROLE omilo_app + set_company applied, transaction open).
    2. The ``payment`` row must be loaded FOR UPDATE by the caller before this
       function is called.  The FOR UPDATE lock serialises concurrent invocations
       (e.g. a re-delivered webhook and a concurrent reconcile run) so that the
       second caller blocks until the first transaction commits, then reads
       ``granted=True`` and returns False — closing the double-grant window.

Returns:
    True  — credits were granted (first settle).
    False — payment was already granted; this call is a no-op (idempotent).
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from omilo.billing.balance import grant_credits
from omilo.models.base import prefixed_id
from omilo.models.billing import Plan, Subscription

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from omilo.models.commerce import DoitPayment
    from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)


def apply_payment_paid(
    db: "Session",
    payment: "DoitPayment",
    company: "Company",
) -> bool:
    """Idempotently settle a payment.paid transition.

    Caller contract (see module docstring):
        - ``db`` is a tenant-scoped session for payment.company_id.
        - ``payment`` was loaded FOR UPDATE (lock held by caller).

    Args:
        db:      Tenant-scoped session (caller owns the transaction).
        payment: DoitPayment row, loaded FOR UPDATE by the caller.
        company: Company ORM object for the payment's owner.

    Returns:
        True if credits were granted (first settle); False if already granted.
    """
    # ── Idempotency guard ────────────────────────────────────────────────────
    if payment.granted:
        logger.info(
            "apply_payment_paid: DoitPayment %r already granted; no-op (idempotent)",
            payment.id,
        )
        return False

    # ── Mark paid ────────────────────────────────────────────────────────────
    payment.status = "paid"

    # ── Grant by kind ────────────────────────────────────────────────────────
    if payment.kind == "topup":
        _settle_topup(db, company, payment)
    elif payment.kind == "subscription":
        _settle_subscription(db, company, payment)
    elif payment.kind == "seats":
        _settle_seats(db, company, payment)
    else:
        logger.warning(
            "apply_payment_paid: unknown kind=%r for payment %r; marking paid, no grant",
            payment.kind,
            payment.id,
        )

    # ── Set idempotency flag ─────────────────────────────────────────────────
    payment.granted = True
    db.flush()

    logger.info(
        "apply_payment_paid: DoitPayment %r settled (kind=%r)",
        payment.id,
        payment.kind,
    )
    return True


# ---------------------------------------------------------------------------
# Internal settle helpers (mirrors webhooks.py _grant_topup / _grant_subscription)
# ---------------------------------------------------------------------------


def _settle_topup(db: "Session", company: "Company", payment: "DoitPayment") -> None:
    """Grant topup credits."""
    grant_credits(
        db,
        company,
        payment.credits,
        reason="topup",
        meta={"doit_payment_id": payment.id},
    )
    logger.info(
        "apply_payment_paid: topup granted company=%r credits=%r payment=%r",
        company.id,
        payment.credits,
        payment.id,
    )


def _settle_subscription(
    db: "Session",
    company: "Company",
    payment: "DoitPayment",
) -> None:
    """Activate the Subscription and grant included credits."""
    plan = db.get(Plan, payment.plan_id)
    if plan is None:
        logger.error(
            "apply_payment_paid: Plan %r not found for payment %r; cannot grant",
            payment.plan_id,
            payment.id,
        )
        return

    # Deactivate any existing active OR trialing subscriptions for this company
    # (mirrors the Manual path in omilo/api/billing.py which cancels
    # ["active","trialing"]). Including "trialing" ensures a company that pays
    # via Doit during its trial doesn't end up with a stale trialing row.
    existing_active = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.status.in_(["active", "trialing"]),
        )
        .all()
    )
    for s in existing_active:
        s.status = "canceled"
        logger.info(
            "apply_payment_paid: canceled prior active subscription %r for company %r",
            s.id,
            company.id,
        )
    if existing_active:
        db.flush()

    # Activate the most recent pending/inactive subscription for this company + plan
    sub = (
        db.query(Subscription)
        .filter(
            Subscription.company_id == company.id,
            Subscription.plan_id == plan.id,
            Subscription.status.in_(["pending", "inactive"]),
        )
        .order_by(Subscription.created_at.desc())
        .first()
    )

    if sub is None:
        # Create a fresh active subscription if none was pre-seeded
        sub = Subscription(
            id=prefixed_id("sub"),
            company_id=company.id,
            plan_id=plan.id,
            status="active",
            provider="hosted",
            provider_ref=payment.provider_payment_id,
            seats=plan.seats,
        )
        db.add(sub)
    else:
        sub.status = "active"
        sub.provider = sub.provider or "hosted"
        sub.provider_ref = payment.provider_payment_id

    db.flush()

    # Update company's active plan reference
    company.plan_id = plan.id
    db.flush()

    # Grant included credits
    if plan.included_credits > 0:
        grant_credits(
            db,
            company,
            plan.included_credits,
            reason="subscription_grant",
            meta={"doit_payment_id": payment.id, "plan_id": plan.id},
        )
        logger.info(
            "apply_payment_paid: subscription_grant company=%r plan=%r credits=%r payment=%r",
            company.id,
            plan.id,
            plan.included_credits,
            payment.id,
        )


def _settle_seats(db: "Session", company: "Company", payment: "DoitPayment") -> None:
    """Add the paid extra seats to the active subscription (sweep/control)."""
    count = 0
    if isinstance(payment.raw, dict):
        count = int(payment.raw.get("omilo_seats") or 0)
    if count <= 0 and payment.reference and payment.reference.startswith("seats:"):
        try:
            count = int(payment.reference.split(":")[2])
        except (IndexError, ValueError):
            count = 0
    if count <= 0:
        logger.warning("apply_payment_paid: seats payment %r has no seat count", payment.id)
        return
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
        logger.error("apply_payment_paid: no active subscription for seats payment %r", payment.id)
        return
    sub.seats = (sub.seats or 0) + count
    db.flush()
    logger.info(
        "apply_payment_paid: +%d seats company=%r payment=%r", count, company.id, payment.id
    )
