"""omilo.billing.reconcile — Missed-webhook safety net.

Public API:
    reconcile_pending(db, company, provider, *, older_than_minutes=0) -> int
        For each pending DoitPayment belonging to *company*, poll the provider
        to get its current status and settle it if paid, or mark it expired/failed
        if the provider reports so.  Returns the count of newly-settled payments.

Design / safety guarantees:
    - Idempotent with the webhook path: both paths call ``apply_payment_paid``
      which checks ``DoitPayment.granted`` under a FOR UPDATE lock.  A payment
      already settled by the webhook is a no-op for reconcile, and vice-versa.
    - Caller owns the session scope: ``db`` must already be a tenant-scoped
      session for ``company`` (SET LOCAL ROLE omilo_app + set_company applied,
      transaction open).  This mirrors the webhook handler (T3) and the wallet
      endpoints.
    - Optional age filter: only consider payments created more than
      ``older_than_minutes`` minutes ago (useful for avoiding race with the
      in-flight webhook delivery window).  Default 0 = process all pending.
    - No scheduler wiring required for P5a (follow-up: wire a periodic task
      that calls reconcile_pending per company).

Usage:
    with SessionLocal() as db:
        with db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)
            company = db.get(Company, company_id)
            count = reconcile_pending(db, company, provider)
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy import select

from omilo.billing.settle import apply_payment_paid
from omilo.models.commerce import DoitPayment

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)


def reconcile_pending(
    db: "Session",
    company: "Company",
    provider: object,
    *,
    older_than_minutes: int = 0,
) -> int:
    """Reconcile all pending DoitPayments for *company* against the provider.

    For each pending payment:
      - If provider reports "paid" → load FOR UPDATE and call apply_payment_paid
        (shared idempotent settle; no-op if already granted by webhook).
      - If provider reports "expired" or "failed" → set status accordingly.
      - Any other status → skip (still pending on provider side).

    Args:
        db:                  Tenant-scoped session for company (caller owns txn).
        company:             Company ORM object.
        provider:            A provider with a ``get_payment(provider_payment_id)``
                             method (e.g. DoitProvider or FakeDoitClient-backed).
        older_than_minutes:  Only process payments created before this many minutes
                             ago.  0 (default) = process all pending payments.

    Returns:
        Number of payments newly settled (granted=True set for the first time).
    """
    # Build the base query for pending payments belonging to this company
    stmt = (
        select(DoitPayment)
        .where(
            DoitPayment.company_id == company.id,
            DoitPayment.status == "pending",
        )
    )

    if older_than_minutes > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=older_than_minutes)
        stmt = stmt.where(DoitPayment.created_at <= cutoff)

    pending_payments = db.execute(stmt).scalars().all()

    settled_count = 0

    for payment in pending_payments:
        if not payment.provider_payment_id:
            logger.debug(
                "reconcile_pending: payment %r has no provider_payment_id; skipping",
                payment.id,
            )
            continue

        # Poll provider for current status
        try:
            provider_data = provider.get_payment(payment.provider_payment_id)
        except Exception as exc:
            logger.warning(
                "reconcile_pending: get_payment(%r) failed for payment %r: %s",
                payment.provider_payment_id,
                payment.id,
                exc,
            )
            continue

        provider_status: str = provider_data.get("status", "")

        if provider_status == "paid":
            # Re-load FOR UPDATE to serialise against concurrent webhook delivery
            locked_payment = db.execute(
                select(DoitPayment)
                .where(DoitPayment.id == payment.id)
                .with_for_update()
            ).scalar_one_or_none()

            if locked_payment is None:
                logger.warning(
                    "reconcile_pending: payment %r disappeared under lock; skipping",
                    payment.id,
                )
                continue

            settled = apply_payment_paid(db, locked_payment, company)
            if settled:
                settled_count += 1
                logger.info(
                    "reconcile_pending: payment %r settled (first grant)",
                    payment.id,
                )
            else:
                logger.info(
                    "reconcile_pending: payment %r already granted (webhook beat us)",
                    payment.id,
                )

        elif provider_status in ("expired", "failed"):
            # Re-load FOR UPDATE for safety
            locked_payment = db.execute(
                select(DoitPayment)
                .where(DoitPayment.id == payment.id)
                .with_for_update()
            ).scalar_one_or_none()

            if locked_payment is None:
                continue

            if locked_payment.status not in ("expired", "failed"):
                locked_payment.status = provider_status
                db.flush()
                logger.info(
                    "reconcile_pending: payment %r marked %r",
                    payment.id,
                    provider_status,
                )

        else:
            logger.debug(
                "reconcile_pending: payment %r provider_status=%r; still pending",
                payment.id,
                provider_status,
            )

    return settled_count
