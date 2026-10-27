"""omilo.billing.balance — Credit balance helpers and gate checks.

Public API:
    balance(db, company) -> int
        Return the cached Company.credit_balance.

    recompute_balance(db, company) -> int
        Recompute from SUM(CreditLedger.delta) and reconcile the cache.

    grant_credits(db, company, amount, reason="grant", meta=None) -> CreditLedger
        Append a positive-delta ledger row, increment Company.credit_balance.

    check_can_start_job(db, company, helper) -> tuple[bool, str | None]
        Gate function called by the runner BEFORE starting a consequential job:
          - paused helper         → (False, "helper_paused")
          - helper budget exceeded → pause helper, return (False, "helper_budget_exceeded")
          - hard overage          → block + alert InboxItem, (False, "insufficient_credits")
          - soft overage / ok     → (True, None)

Design decisions:
- balance() reads Company.credit_balance (maintained by meter.py on every job).
- recompute_balance() is the audit/reconcile path — it queries the ledger.
- grant_credits() uses reason "grant" by default; callers pass "topup" or
  "subscription_grant" as needed.
- check_can_start_job() is the ONLY place that enforces per-helper budget caps
  and hard-overage blocks.  It never raises; always returns a (bool, reason).
- Alert InboxItem (kind="alert") is created for hard-overage so the owner
  sees "Out of credits" in their inbox.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger

if TYPE_CHECKING:
    from omilo.models.agents import Helper
    from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# balance
# ---------------------------------------------------------------------------


def balance(db: Session, company: "Company") -> int:
    """Return the cached credit balance for *company*.

    This is the fast path — reads Company.credit_balance, which is kept
    current by meter.py (decremented on each billed job) and grant_credits()
    (incremented on each grant/topup).

    Args:
        db:      SQLAlchemy session (unused but kept for API symmetry).
        company: The Company ORM object.

    Returns:
        Current credit balance as int (may be negative for soft-overage accounts).
    """
    return int(company.credit_balance or 0)


# ---------------------------------------------------------------------------
# recompute_balance
# ---------------------------------------------------------------------------


def recompute_balance(db: Session, company: "Company") -> int:
    """Recompute the balance from the ledger and reconcile Company.credit_balance.

    Queries SUM(CreditLedger.delta) for the company, writes the result back
    to Company.credit_balance, and returns it.  Use for audits and reconciliation
    runs — NOT on the hot path.

    Args:
        db:      Company-scoped (or superuser) SQLAlchemy session.
        company: The Company ORM object.

    Returns:
        Recomputed balance (also written to company.credit_balance).
    """
    total = (
        db.query(func.coalesce(func.sum(CreditLedger.delta), 0))
        .filter(CreditLedger.company_id == company.id)
        .scalar()
    )
    computed = int(total)
    company.credit_balance = computed
    db.flush()
    return computed


# ---------------------------------------------------------------------------
# grant_credits
# ---------------------------------------------------------------------------


def grant_credits(
    db: Session,
    company: "Company",
    amount: int,
    reason: str = "grant",
    meta: dict | None = None,
) -> CreditLedger:
    """Append a positive-delta CreditLedger row and increment Company.credit_balance.

    Args:
        db:      Company-scoped session.  Caller owns the transaction.
        company: The Company ORM object.
        amount:  Number of credits to add (must be > 0).
        reason:  Ledger reason string — "grant", "topup", "subscription_grant", etc.
        meta:    Optional JSON metadata dict.

    Returns:
        The new CreditLedger row (already flushed).

    Raises:
        ValueError: if amount <= 0.
    """
    if amount <= 0:
        raise ValueError(f"grant_credits: amount must be positive, got {amount!r}")

    company.credit_balance = (company.credit_balance or 0) + amount
    db.flush()

    balance_after = int(company.credit_balance)

    entry = CreditLedger(
        id=prefixed_id("cl"),
        company_id=company.id,
        delta=amount,
        balance_after=balance_after,
        reason=reason,
        job_id=None,
        helper_id=None,
        provider_cost_usd=0,
        credits_charged=0,
        meta=meta or {},
        at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()
    return entry


# ---------------------------------------------------------------------------
# check_can_start_job
# ---------------------------------------------------------------------------

# Month-to-date helper credit spend: SUM(credits_charged) in the current
# calendar month for a specific helper.
def _helper_mtd_credits(db: Session, company_id: str, helper_id: str) -> int:
    """Sum credits_charged for *helper_id* in the current calendar month."""
    now = datetime.now(timezone.utc)
    # Truncate to the first of the current month (UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total = (
        db.query(func.coalesce(func.sum(CreditLedger.credits_charged), 0))
        .filter(
            CreditLedger.company_id == company_id,
            CreditLedger.helper_id == helper_id,
            CreditLedger.at >= month_start,
        )
        .scalar()
    )
    return int(total)


def check_can_start_job(
    db: Session,
    company: "Company",
    helper: "Helper",
) -> tuple[bool, str | None]:
    """Gate: determine whether starting a new consequential job is permitted.

    Called by the runner BEFORE creating/running a job.  Never raises.

    Evaluation order:
      1. Helper already paused → (False, "helper_paused")
      2. Per-helper monthly budget exceeded → pause helper,
         (False, "helper_budget_exceeded")
      3. Hard-overage: balance ≤ 0 + overage_policy=="hard" →
         create alert InboxItem, (False, "insufficient_credits")
      4. Otherwise (soft overage or positive balance) → (True, None)

    Args:
        db:      Company-scoped session.
        company: Company ORM object.
        helper:  Helper ORM object.

    Returns:
        (allowed, reason) — if allowed is False, reason is a short string
        explaining why.
    """
    # ── 1. Already paused ────────────────────────────────────────────────────
    if getattr(helper, "status", "active") == "paused":
        return False, "helper_paused"

    # ── 2. Per-helper monthly budget ─────────────────────────────────────────
    budget = getattr(helper, "budget_credits_month", None)
    if budget is not None:
        mtd = _helper_mtd_credits(db, company.id, helper.id)
        if mtd >= budget:
            # Pause the helper
            helper.status = "paused"
            db.flush()
            return False, "helper_budget_exceeded"

    # ── 3. Hard overage ──────────────────────────────────────────────────────
    current_balance = balance(db, company)
    overage_policy = getattr(company, "overage_policy", "soft") or "soft"

    if current_balance <= 0 and overage_policy == "hard":
        _create_credit_alert(db, company, helper)
        return False, "insufficient_credits"

    # ── 4. Allowed (soft overage or positive balance) ─────────────────────────
    return True, None


# ---------------------------------------------------------------------------
# Internal: alert InboxItem
# ---------------------------------------------------------------------------


def _create_credit_alert(
    db: Session,
    company: "Company",
    helper: "Helper",
) -> None:
    """Create a 'Out of credits' alert InboxItem (best-effort, no raise)."""
    try:
        from omilo.models.inbox import InboxItem

        item = InboxItem(
            id=prefixed_id("inb"),
            company_id=company.id,
            title="Out of credits — new work paused",
            summary=(
                "Your credit balance has reached zero. "
                "New agent jobs are paused until you top up your credits. "
                "Existing work is unaffected."
            ),
            session_id="",
            channel_id=(
                helper.channel_ids[0]
                if getattr(helper, "channel_ids", None)
                else ""
            ),
            kind="alert",
            status="pending",
            asker=getattr(helper, "name", "system"),
            asker_area=getattr(helper, "area", "ops"),
            needs_you=True,
            proposals=None,
            actions=[{"label": "Top up credits"}],
        )
        db.add(item)
        db.flush()
    except Exception as exc:
        logger.warning(
            "credit alert InboxItem creation failed for company_id=%s helper_id=%s: %s",
            company.id,
            helper.id,
            exc,
        )  # alert creation must never break the gate
