"""omilo.billing.trial — Trial subscription logic.

Public API:
    start_trial(db, company) -> Subscription | None
        Lazily start a 14-day trial for a cloud/hybrid company.
        Returns None for local mode (no-op).
        Returns the existing subscription if one already exists.
        Creates a trialing Subscription + grants 2000 credits ONCE (idempotent).

Idempotency:
    Credits are granted via a CreditLedger row with reason="trial_grant".
    Before granting, we check whether a trial_grant ledger row already exists
    for this company. If so, the grant is skipped — the second call returns
    the existing subscription unchanged, without touching the balance.

Caller contract:
    db must be an open session for the company.
    Caller owns the transaction (or the function will flush into the caller's
    transaction; the caller must commit).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from sqlalchemy import text

from omilo.billing.balance import grant_credits
from omilo.billing.catalog import PLAN_CATALOG, TRIAL_PLAN_ID
from omilo.config import get_settings
from omilo.control.factory import _normalize_mode
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Plan, Subscription

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from omilo.models.tenancy import Company

logger = logging.getLogger(__name__)

TRIAL_DAYS = 14
# Trial runs on Team (catalog.TRIAL_PLAN_ID).


def start_trial(db: "Session", company: "Company") -> "Subscription | None":
    """Lazily start a 14-day trial subscription for a cloud/hybrid company.

    CLOUD/HYBRID mode only:
        - If the company already has ANY subscription, return it (no-op).
        - Else: create Subscription(status="trialing", current_period_end=now+14d)
          and grant plan.included_credits (2000) ONCE via an idempotent
          CreditLedger row (reason="trial_grant").

    LOCAL mode:
        - Returns None immediately; company stays free self_hosted with 0 credits
          and no subscription.

    Idempotency:
        A second call for a cloud company that already has a subscription returns
        the existing subscription without granting credits again.  If somehow
        called twice concurrently before the first transaction commits, the
        trial_grant ledger guard prevents double-grant.

    Args:
        db:      Open SQLAlchemy session for the company.
        company: Company ORM object.

    Returns:
        The trialing (or existing) Subscription, or None in local mode.
    """
    # ── Mode guard: local = free BYO, no trial ───────────────────────────────
    settings = get_settings()
    raw_mode = getattr(settings, "omilo_mode", "cloud") or "cloud"
    mode = _normalize_mode(raw_mode)

    if mode == "local":
        logger.debug(
            "start_trial: local mode — no trial for company %r", company.id
        )
        return None

    # ── Serialize concurrent first-touch (advisory lock, released at txn end) ─
    # start_trial is invoked lazily from TWO endpoints (GET /plans + /subscription).
    # Two simultaneous requests for a brand-new company could both pass the
    # "no existing sub / no trial_grant" checks and double-grant. A per-company
    # Postgres advisory xact lock serializes them so only the first creates the
    # trial; the second then sees the committed sub and no-ops.
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:k)::bigint)"),
            {"k": company.id},
        )

    # ── If ANY subscription exists, return it (idempotent) ───────────────────
    existing_sub = (
        db.query(Subscription)
        .filter(Subscription.company_id == company.id)
        .order_by(Subscription.created_at.desc())
        .first()
    )
    if existing_sub is not None:
        logger.debug(
            "start_trial: company %r already has subscription %r (status=%r); no-op",
            company.id,
            existing_sub.id,
            existing_sub.status,
        )
        return existing_sub

    # ── Look up the trial plan ────────────────────────────────────────────────
    plan = db.get(Plan, TRIAL_PLAN_ID)
    if plan is None:
        logger.error(
            "start_trial: trial plan %r not found; cannot start trial for company %r",
            TRIAL_PLAN_ID,
            company.id,
        )
        return None

    # ── Create trialing Subscription ─────────────────────────────────────────
    now = datetime.now(timezone.utc)
    period_end = now + timedelta(days=TRIAL_DAYS)

    sub = Subscription(
        id=prefixed_id("sub"),
        company_id=company.id,
        plan_id=plan.id,
        status="trialing",
        billing_interval="monthly",
        current_period_end=period_end,
        provider="manual",
        seats=plan.seats,
    )
    db.add(sub)

    # ── Trial must NOT run into debt: hard-overage so pooled blocks at 0 ──────
    # A trial grants 2000 credits; when they're spent (or the 14 days lapse),
    # the balance gate (balance.py) blocks pooled/litellm jobs ONLY under a
    # "hard" policy. BYO/local keys stay free regardless. Without this, the
    # default "soft" policy lets a trial run unpaid into a negative balance.
    company.overage_policy = "hard"

    db.flush()

    # ── Grant trial credits — idempotent via trial_grant ledger guard ─────────
    # Check if a trial_grant already exists (race-condition or retry guard)
    existing_grant = (
        db.query(CreditLedger)
        .filter(
            CreditLedger.company_id == company.id,
            CreditLedger.reason == "trial_grant",
        )
        .first()
    )

    if existing_grant is not None:
        logger.warning(
            "start_trial: trial_grant already exists for company %r; skipping grant",
            company.id,
        )
    elif plan.included_credits > 0:
        grant_credits(
            db,
            company,
            plan.included_credits,
            reason="trial_grant",
            meta={"plan_id": plan.id, "subscription_id": sub.id},
        )
        logger.info(
            "start_trial: granted %d trial credits to company %r (sub %r)",
            plan.included_credits,
            company.id,
            sub.id,
        )

    db.flush()

    logger.info(
        "start_trial: created trialing subscription %r for company %r (period_end=%s)",
        sub.id,
        company.id,
        period_end.isoformat(),
    )
    return sub
