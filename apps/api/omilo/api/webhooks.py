"""omilo.api.webhooks — Doit payment gateway webhook endpoint.

POST /v1/webhooks/doit

UNAUTHENTICATED — called by Doit, not by our users.

Security model:
  1. Read the raw request body bytes BEFORE any parsing.
  2. Call DoitProvider.parse_webhook(headers, raw_body) — internally calls
     verify_doit_signature over the EXACT bytes Doit sent.  On bad / missing /
     stale signature → raises WebhookVerificationError → we return HTTP 401.
  3. Company resolution is done by looking up the DoitPayment row via a
     PRIVILEGED bootstrap session (no RLS, superuser) by provider_payment_id.
     We NEVER trust a company_id from the request body.
  4. All DB writes (grant_credits, Subscription activation) run inside a
     TENANT-SCOPED transaction (SET LOCAL ROLE omilo_app + set_company) so
     Postgres FORCE RLS enforces isolation.
  5. The ``granted`` flag on DoitPayment is the idempotency guard — a
     re-delivered webhook grants credits exactly once.

Handled event types:
  payment.paid   — grant credits (topup) or activate subscription + grant
  payment.expired — mark payment expired, no grant
  refund.succeeded — negative grant (if previously granted), mark refunded
  refund.failed   — log, no change
  invoice.created — upsert pending DoitPayment / Invoice
  (all other types — 200, no-op)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from omilo.billing.balance import debit_credits, grant_credits
from omilo.billing.doit_provider import WebhookVerificationError
from omilo.billing.provider import get_payment_provider
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import Plan, Subscription
from omilo.models.commerce import DoitPayment
from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webhooks"])


# ---------------------------------------------------------------------------
# POST /v1/webhooks/doit
# ---------------------------------------------------------------------------


@router.post("/webhooks/doit", status_code=200)
async def doit_webhook(
    request: Request,
    provider=Depends(get_payment_provider),
) -> Response:
    """Receive and process a Doit payment gateway webhook.

    UNAUTHENTICATED — Doit calls this directly.  Signature verification happens
    inside provider.parse_webhook before any business logic executes.
    """
    # ── Step 1: Read raw bytes (HMAC is over the exact wire bytes) ──────────
    raw: bytes = await request.body()

    # ── Step 2: Verify signature + parse events ──────────────────────────────
    try:
        events = provider.parse_webhook(dict(request.headers), raw)
    except WebhookVerificationError as exc:
        logger.warning("Doit webhook signature verification failed: %s", exc)
        return Response(status_code=401)

    # ── Step 3: Handle each event ────────────────────────────────────────────
    for event in events:
        try:
            _handle_event(event)
        except Exception as exc:
            # Log but still return 200 to stop Doit retrying a broken event.
            logger.exception(
                "Error handling Doit event type=%r data=%r: %s",
                event.type,
                event.data,
                exc,
            )

    return Response(status_code=200)


# ---------------------------------------------------------------------------
# Event dispatcher
# ---------------------------------------------------------------------------


def _handle_event(event) -> None:
    """Dispatch a BillingEvent to the appropriate handler."""
    event_type = event.type
    payment_data = event.data  # dict — the payment object from the webhook body

    provider_payment_id: str | None = payment_data.get("id")
    if not provider_payment_id:
        logger.warning("Doit event type=%r has no data.id; skipping", event_type)
        return

    if event_type == "payment.paid":
        _handle_payment_paid(provider_payment_id, payment_data)
    elif event_type == "payment.expired":
        _handle_payment_expired(provider_payment_id)
    elif event_type == "refund.succeeded":
        _handle_refund_succeeded(provider_payment_id)
    elif event_type == "refund.failed":
        logger.info("Doit refund.failed for payment %r; no action", provider_payment_id)
    elif event_type == "invoice.created":
        _handle_invoice_created(provider_payment_id, payment_data)
    else:
        logger.info("Doit event type=%r not handled; acking", event_type)


# ---------------------------------------------------------------------------
# payment.paid
# ---------------------------------------------------------------------------


def _handle_payment_paid(provider_payment_id: str, payment_data: dict) -> None:
    """Idempotently grant credits on payment.paid.

    Steps:
    1. Look up DoitPayment by provider_payment_id via PRIVILEGED session (no RLS)
       to get the correct company_id.  We NEVER trust a company_id from the body.
    2. Open a TENANT-SCOPED transaction for that company (SET LOCAL ROLE omilo_app
       + set_company) so all writes are scoped by Postgres FORCE RLS.
    3. Re-load the DoitPayment inside the tenant session (RLS ensures it belongs
       to the company we resolved in step 1).
    4. If already granted → return (idempotent no-op).
    5. Mark status="paid", set granted=True; grant credits based on kind.
    """
    # ── 1. Privileged lookup: resolve company_id from stored row ─────────────
    with SessionLocal() as priv:
        # Runs as superuser omilo — no SET LOCAL ROLE, RLS bypassed.
        # This is intentional: we need to find the row across tenants by
        # provider_payment_id to discover which company owns it.
        payment_priv = (
            priv.query(DoitPayment)
            .filter(DoitPayment.provider_payment_id == provider_payment_id)
            .first()
        )
        if payment_priv is None:
            logger.info(
                "payment.paid: no DoitPayment with provider_payment_id=%r; acking",
                provider_payment_id,
            )
            return
        company_id = payment_priv.company_id
        payment_id = payment_priv.id

    # ── 2–5. Tenant-scoped transaction ─────────────────────────────────────
    with SessionLocal() as db:
        with db.begin():
            # SET LOCAL ROLE drops to non-superuser so FORCE RLS kicks in
            db.execute(text("SET LOCAL ROLE omilo_app"))
            # Set the GUC that tenant_isolation policies read
            set_company(db, company_id)

            # Load Company (global table — visible under omilo_app)
            company = db.get(Company, company_id)
            if company is None:
                logger.error("payment.paid: Company %r not found in DB", company_id)
                return

            # Re-load DoitPayment inside RLS scope.
            # FOR UPDATE: serialises concurrent re-deliveries of the same event —
            # the second delivery blocks here until the first transaction commits,
            # then reads granted=True and no-ops (double-grant window closed).
            payment = db.execute(
                select(DoitPayment)
                .where(DoitPayment.id == payment_id)
                .with_for_update()
            ).scalar_one_or_none()
            if payment is None:
                logger.error(
                    "payment.paid: DoitPayment %r not visible in tenant scope for company %r",
                    payment_id,
                    company_id,
                )
                return

            # ── Idempotency guard ───────────────────────────────────────────
            if payment.granted:
                logger.info(
                    "payment.paid: DoitPayment %r already granted; skipping (idempotent)",
                    payment_id,
                )
                return

            # ── Mark paid ──────────────────────────────────────────────────
            payment.status = "paid"

            # ── Grant by kind ──────────────────────────────────────────────
            if payment.kind == "topup":
                _grant_topup(db, company, payment)
            elif payment.kind == "subscription":
                _grant_subscription(db, company, payment)
            else:
                logger.warning(
                    "payment.paid: unknown kind=%r for payment %r",
                    payment.kind,
                    payment_id,
                )

            # ── Set idempotency flag ────────────────────────────────────────
            payment.granted = True
            db.flush()
            # Transaction commits on context-manager exit


def _grant_topup(db: Session, company: Company, payment: DoitPayment) -> None:
    """Grant topup credits to a company."""
    grant_credits(
        db,
        company,
        payment.credits,
        reason="topup",
        meta={"doit_payment_id": payment.id},
    )
    logger.info(
        "Topup granted: company=%r credits=%r payment=%r",
        company.id,
        payment.credits,
        payment.id,
    )


def _grant_subscription(db: Session, company: Company, payment: DoitPayment) -> None:
    """Activate the Subscription and grant included credits."""
    plan = db.get(Plan, payment.plan_id)
    if plan is None:
        logger.error(
            "subscription grant: Plan %r not found for payment %r",
            payment.plan_id,
            payment.id,
        )
        return

    # Activate the most recent pending subscription for this company + plan
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
            provider="doit",
            provider_ref=payment.provider_payment_id,
            seats=plan.seats,
        )
        db.add(sub)
    else:
        sub.status = "active"
        sub.provider = "doit"
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
            "Subscription grant: company=%r plan=%r credits=%r payment=%r",
            company.id,
            plan.id,
            plan.included_credits,
            payment.id,
        )


# ---------------------------------------------------------------------------
# payment.expired
# ---------------------------------------------------------------------------


def _handle_payment_expired(provider_payment_id: str) -> None:
    """Mark the DoitPayment as expired; no credit grant."""
    with SessionLocal() as priv:
        payment = (
            priv.query(DoitPayment)
            .filter(DoitPayment.provider_payment_id == provider_payment_id)
            .first()
        )
        if payment is None:
            logger.info(
                "payment.expired: no DoitPayment with provider_payment_id=%r; acking",
                provider_payment_id,
            )
            return
        payment_id = payment.id
        company_id = payment.company_id

    with SessionLocal() as db:
        with db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)

            payment = db.get(DoitPayment, payment_id)
            if payment is None:
                return
            if payment.status == "expired":
                return  # already handled
            payment.status = "expired"
            db.flush()

    logger.info("payment.expired: DoitPayment %r marked expired", payment_id)


# ---------------------------------------------------------------------------
# refund.succeeded
# ---------------------------------------------------------------------------


def _handle_refund_succeeded(provider_payment_id: str) -> None:
    """Apply a credit debit via debit_credits() if the payment was previously granted.

    Guards:
    - Payment never granted → mark refunded, no debit (nothing to reverse).
    - Payment already refunded → no-op (idempotent re-delivery guard).
    - FOR UPDATE lock on the DoitPayment row serialises concurrent re-deliveries.
    """
    with SessionLocal() as priv:
        payment = (
            priv.query(DoitPayment)
            .filter(DoitPayment.provider_payment_id == provider_payment_id)
            .first()
        )
        if payment is None:
            logger.info(
                "refund.succeeded: no DoitPayment with provider_payment_id=%r; acking",
                provider_payment_id,
            )
            return
        payment_id = payment.id
        company_id = payment.company_id

    with SessionLocal() as db:
        with db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)

            company = db.get(Company, company_id)
            # FOR UPDATE: serialises concurrent re-deliveries — second delivery
            # blocks until the first commits, then reads status="refunded" and no-ops.
            payment = db.execute(
                select(DoitPayment)
                .where(DoitPayment.id == payment_id)
                .with_for_update()
            ).scalar_one_or_none()

            if company is None or payment is None:
                return

            # ── Double-refund guard (re-delivered refund.succeeded) ─────────
            if payment.status == "refunded":
                logger.info(
                    "refund.succeeded: DoitPayment %r already refunded; skipping (idempotent)",
                    payment_id,
                )
                return

            credits = payment.credits

            # ── Guard: only debit if previously granted ─────────────────────
            if payment.granted and credits > 0:
                debit_credits(
                    db,
                    company,
                    credits,
                    reason="refund",
                    meta={"doit_payment_id": payment.id},
                )
            elif not payment.granted:
                logger.info(
                    "refund.succeeded: DoitPayment %r was never granted; marking refunded, no debit",
                    payment_id,
                )

            payment.status = "refunded"
            db.flush()

    logger.info("refund.succeeded: DoitPayment %r refunded, credits reversed", payment_id)


# ---------------------------------------------------------------------------
# invoice.created
# ---------------------------------------------------------------------------


def _handle_invoice_created(provider_payment_id: str, payment_data: dict) -> None:
    """Upsert a pending DoitPayment with hosted_url on invoice.created."""
    # For invoice.created we don't have an existing DoitPayment yet (Doit creates
    # the invoice before payment); we upsert by provider_payment_id.
    # If no matching DoitPayment exists, we can't resolve the company → skip.
    with SessionLocal() as priv:
        payment = (
            priv.query(DoitPayment)
            .filter(DoitPayment.provider_payment_id == provider_payment_id)
            .first()
        )
        if payment is None:
            logger.info(
                "invoice.created: no existing DoitPayment for provider_payment_id=%r; skipping",
                provider_payment_id,
            )
            return
        payment_id = payment.id
        company_id = payment.company_id

    hosted_url = payment_data.get("hosted_url")

    with SessionLocal() as db:
        with db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)

            payment = db.get(DoitPayment, payment_id)
            if payment is None:
                return

            if hosted_url:
                payment.hosted_url = hosted_url
            db.flush()

    logger.info("invoice.created: DoitPayment %r updated with hosted_url", payment_id)
