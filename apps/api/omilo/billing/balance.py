"""omilo.billing.balance — Credit balance helpers and gate checks.

Public API:
    balance(db, company) -> int
        Return the cached Company.credit_balance.

    recompute_balance(db, company) -> int
        Recompute from SUM(CreditLedger.delta) and reconcile the cache.

    grant_credits(db, company, amount, reason="grant", meta=None) -> CreditLedger
        Append a positive-delta ledger row, increment Company.credit_balance.

    debit_credits(db, company, amount, reason="refund", meta=None) -> CreditLedger
        Append a negative-delta ledger row, decrement Company.credit_balance.
        Mirror of grant_credits() for reversals (refunds, adjustments).

    check_can_start_job(db, company, helper, engine_type=None) -> tuple[bool, str | None]
        Gate function called by the runner BEFORE starting a consequential job:
          - paused helper         → (False, "helper_paused")
          - helper budget exceeded → pause helper, return (False, "helper_budget_exceeded")
          - 0-credit engine (BYO/local/pool): always allowed, even offline
          - CLOUD mode, hard overage: block + alert InboxItem, (False, "insufficient_credits")
          - RUNTIME mode, credit-consuming job:
              check_balance via ControlPlane; on ControlPlaneUnreachable →
              (False, "paused_offline"); on balance ≤ 0 + hard policy →
              (False, "insufficient_credits"); otherwise (True, None).
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
- Runtime mode: gate routes credit-consuming jobs through get_control_plane()
  so the cloud is the authority. BYO/local (0-credit) jobs always pass even
  when the control plane is offline.
- CLOUD mode (LocalControlPlane): behavior is identical to pre-T4 — no change.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from omilo.control import ControlPlaneUnreachable
from omilo.control.factory import get_control_plane, is_local_mode
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger

if TYPE_CHECKING:
    from omilo.models.agents import Helper
    from omilo.models.tenancy import Company

# Engine types that consume credits (cloud-billed) — mirrors meter._CLOUD_ENGINE_TYPES.
# Kept in sync manually; both are the canonical classification.
_CREDIT_ENGINE_TYPES = frozenset({"litellm"})

# Public API summary (keep docstring at top of module in sync):
#   debit_credits(db, company, amount, reason="refund", meta=None) -> CreditLedger


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
# debit_credits
# ---------------------------------------------------------------------------


def debit_credits(
    db: Session,
    company: "Company",
    amount: int,
    reason: str = "refund",
    meta: dict | None = None,
) -> CreditLedger:
    """Append a negative-delta CreditLedger row and decrement Company.credit_balance.

    Mirror of grant_credits() but for reversals (refunds, manual adjustments).

    Args:
        db:      Company-scoped session.  Caller owns the transaction.
        company: The Company ORM object.
        amount:  Number of credits to deduct (must be > 0; stored as delta=-amount).
        reason:  Ledger reason string — "refund", "adjustment", etc.
        meta:    Optional JSON metadata dict.

    Returns:
        The new CreditLedger row (already flushed).

    Raises:
        ValueError: if amount <= 0.
    """
    if amount <= 0:
        raise ValueError(f"debit_credits: amount must be positive, got {amount!r}")

    company.credit_balance = (company.credit_balance or 0) - amount
    db.flush()

    balance_after = int(company.credit_balance)

    entry = CreditLedger(
        id=prefixed_id("cl"),
        company_id=company.id,
        delta=-amount,
        balance_after=balance_after,
        reason=reason,
        job_id=None,
        helper_id=None,
        provider_cost_usd=0,
        # credits_charged tracks CONSUMPTION (job spend) for MTD budget/analytics
        # aggregation; a refund debit is not consumption, so it stays 0 — matching
        # grant_credits. The balance movement is carried by `delta` alone.
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
    engine_type: str | None = None,
) -> tuple[bool, str | None]:
    """Gate: determine whether starting a new consequential job is permitted.

    Called by the runner BEFORE creating/running a job.  Never raises.

    Evaluation order:
      1. Helper already paused → (False, "helper_paused")
      2. Per-helper monthly budget exceeded → pause helper,
         (False, "helper_budget_exceeded")
      3. If engine_type is 0-credit (BYO/local/pool) → ALWAYS allowed,
         even when the control plane is offline. Skip credit checks entirely.
      4a. CLOUD mode (LocalControlPlane):
          Hard-overage: balance ≤ 0 + overage_policy=="hard" →
          create alert InboxItem, (False, "insufficient_credits")
      4b. RUNTIME mode (RemoteControlPlane):
          - Call get_control_plane().check_balance(company_id).
          - On ControlPlaneUnreachable → (False, "paused_offline")
            (caller handles this by creating the job with paused_offline status)
          - On balance ≤ 0 + hard policy → create alert InboxItem,
            (False, "insufficient_credits")
          - Soft overage or positive balance → (True, None)
      5. Allowed → (True, None)

    Args:
        db:          Company-scoped session.
        company:     Company ORM object.
        helper:      Helper ORM object.
        engine_type: The engine type for the job (from helper.engine["type"]).
                     Used to determine if the job consumes credits.
                     If None, defaults to 0-credit path (conservative safe).

    Returns:
        (allowed, reason) — if allowed is False, reason is a short string
        explaining why. "paused_offline" is a special reason handled by runner.
    """
    # ── 1. Already paused ────────────────────────────────────────────────────
    if getattr(helper, "status", "active") == "paused":
        return False, "helper_paused"
    if getattr(helper, "status", "active") == "retired":  # sweep/team-analytics: let go
        return False, "helper_retired"

    # ── 2. Per-helper monthly budget ─────────────────────────────────────────
    budget = getattr(helper, "budget_credits_month", None)
    if budget is not None:
        mtd = _helper_mtd_credits(db, company.id, helper.id)
        if mtd >= budget:
            # sweep/team-analytics: one-off "Allow one more job" override.
            allow = getattr(helper, "budget_allow_jobs", 0) or 0
            if allow > 0:
                helper.budget_allow_jobs = allow - 1
                db.flush()
                budget = None  # fall through to the credit checks below
        if budget is not None and mtd >= budget:
            # Pause the helper
            helper.status = "paused"
            db.flush()
            return False, "helper_budget_exceeded"

    # ── 3. LOCAL MODE early-return — free BYO-only posture (P6b) ─────────────
    # In local mode every job is 0-credit and always allowed — no balance
    # check, no CreditLedger, no cloud contact.  Pooled/litellm engines are
    # refused separately at the engine factory layer (engine/__init__.py).
    if is_local_mode():
        return True, None

    # ── 4. Determine mode (cloud vs hybrid/runtime) and resolve balance ───────
    # Route through get_control_plane() so:
    #   - CLOUD mode (LocalControlPlane) → current in-process behavior (P4 unchanged):
    #       checks balance for ALL engine types (BYO/local jobs also gated).
    #   - HYBRID mode (RemoteControlPlane):
    #       0-credit (BYO/local/pool) → ALWAYS allowed, even offline.
    #       Credit-consuming (litellm) → check_balance via cloud; on
    #       ControlPlaneUnreachable → paused_offline.
    from omilo.control.local import LocalControlPlane

    resolved_engine_type = engine_type or "fake"
    is_credit_consuming = resolved_engine_type in _CREDIT_ENGINE_TYPES

    cp = get_control_plane()
    is_cloud_mode = isinstance(cp, LocalControlPlane)

    if not is_cloud_mode and not is_credit_consuming:
        # RUNTIME MODE + 0-credit engine: always allowed, even offline.
        return True, None

    # For cloud mode (all engines) and runtime mode (credit-consuming engines):
    # check balance via the control plane.
    # Both LocalControlPlane and RemoteControlPlane accept **kw (including db=);
    # FakeControlPlane in tests must also accept **kw — see ControlPlane Protocol.
    try:
        balance_state = cp.check_balance(company.id, db=db)
        current_balance = balance_state.balance
        overage_policy = balance_state.overage_policy or "soft"
    except ControlPlaneUnreachable:
        if not is_cloud_mode and is_credit_consuming:
            # Runtime mode + credit-consuming + unreachable → paused_offline
            return False, "paused_offline"
        # Cloud mode should never raise ControlPlaneUnreachable (LocalControlPlane)
        # but if it does, fall back to local balance
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
