"""omilo.billing.meter — Credit metering for AI jobs.

Public API:
    provider_cost_usd(engine_type, model, tokens_in, tokens_out) -> Decimal
    meter_job(db, job) -> CreditLedger | None

Design decisions:
- MARGIN=1.4 applied on top of raw provider cost to cover overhead + margin.
- CREDITS_PER_USD=100: 1 USD = 100 credits (1 credit = $0.01).
- PRICE_TABLE: keyed by (engine_type, model) → {in_per_1k, out_per_1k} USD.
  Fallback key ("*", "*") is used when no exact match found.

Billing paths (routed through get_control_plane()):
- CLOUD mode (LocalControlPlane, default):
    Cloud/litellm: charges credits (ceil), decrements Company.credit_balance.
    Pool/BYO (fake|anthropic|claude_code): metered at credits_charged=0
    for analytics only; balance unchanged. Writes local CreditLedger always.
- RUNTIME mode (RemoteControlPlane):
    Credit-consuming (litellm): calls report_usage on the control plane
    (cloud debits). On ControlPlaneUnreachable, enqueues to outbox and
    swallows the error (best-effort). Does NOT write a local CreditLedger.
    0-credit (BYO/local/pool): no-op — no local ledger, no report_usage.

- Idempotent in cloud mode: a CreditLedger row for (company_id, job_id,
  reason="job") that already exists is returned as-is without double-charging.
  In runtime mode: idempotency is the cloud's responsibility (per job_id).
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from omilo.control import ControlPlaneUnreachable, UsageEvent
from omilo.control.factory import get_control_plane, is_local_mode
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MARGIN = Decimal("1.4")
CREDITS_PER_USD = 100  # 1 USD = 100 credits

# Price table: (engine_type_or_provider, model) -> {in_per_1k, out_per_1k} USD
# "in_per_1k": USD per 1000 input tokens
# "out_per_1k": USD per 1000 output tokens
# Use ("*", "*") as the catch-all fallback.
PRICE_TABLE: dict[tuple[str, str], dict[str, Decimal]] = {
    # Anthropic Claude Sonnet (via litellm)
    ("litellm", "anthropic/claude-sonnet-4-5"): {
        "in_per_1k": Decimal("0.003"),
        "out_per_1k": Decimal("0.015"),
    },
    ("litellm", "anthropic/claude-sonnet-4-6"): {
        "in_per_1k": Decimal("0.003"),
        "out_per_1k": Decimal("0.015"),
    },
    ("litellm", "anthropic/claude-haiku-3-5"): {
        "in_per_1k": Decimal("0.0008"),
        "out_per_1k": Decimal("0.004"),
    },
    ("litellm", "anthropic/claude-opus-4"): {
        "in_per_1k": Decimal("0.015"),
        "out_per_1k": Decimal("0.075"),
    },
    # Default / fallback (used when no exact match found)
    ("*", "*"): {
        "in_per_1k": Decimal("0.001"),
        "out_per_1k": Decimal("0.005"),
    },
}

# Engine types that are billed via credits (cloud path)
_CLOUD_ENGINE_TYPES = frozenset({"litellm"})

# Engine types that are NOT billed (pool / BYO / local)
_POOL_ENGINE_TYPES = frozenset({"fake", "anthropic", "claude_code", "graph"})


# ---------------------------------------------------------------------------
# provider_cost_usd
# ---------------------------------------------------------------------------

def provider_cost_usd(
    engine_type: str,
    model: str | None,
    tokens_in: int,
    tokens_out: int,
) -> Decimal:
    """Compute raw provider cost in USD for the given token counts.

    Looks up (engine_type, model) in PRICE_TABLE; falls back to ("*", "*").
    Always deterministic given the same inputs.

    Args:
        engine_type: e.g. "litellm", "fake", "anthropic"
        model:       e.g. "anthropic/claude-sonnet-4-6" or None
        tokens_in:   Number of input tokens consumed
        tokens_out:  Number of output tokens produced

    Returns:
        Cost in USD as a Decimal (may be 0 for unpriced engines).
    """
    key = (engine_type, model or "")
    prices = PRICE_TABLE.get(key) or PRICE_TABLE.get(("*", "*"))
    assert prices is not None  # fallback always present

    in_per_1k = prices["in_per_1k"]
    out_per_1k = prices["out_per_1k"]

    cost = (Decimal(tokens_in) / 1000) * in_per_1k + (
        Decimal(tokens_out) / 1000
    ) * out_per_1k
    return cost


# ---------------------------------------------------------------------------
# meter_job
# ---------------------------------------------------------------------------

def meter_job(db: Session, job: "Job") -> CreditLedger | None:  # noqa: F821
    """Record a CreditLedger entry or cloud usage event for a completed job.

    Routes through get_control_plane() so:
    - CLOUD mode (LocalControlPlane): behavior unchanged from P4 — writes a
      local CreditLedger row (even for 0-credit BYO jobs, for analytics).
    - RUNTIME mode (RemoteControlPlane):
        - Credit-consuming (litellm): calls report_usage on the control plane.
          On ControlPlaneUnreachable, enqueues to outbox + swallows (best-effort).
          Does NOT write a local CreditLedger row.
        - 0-credit (BYO/local/pool): no-op — no local ledger, no report_usage.

    Idempotent in cloud mode: if a ledger row for (company_id, job_id, reason="job")
    already exists, returns it without double-charging. Runtime mode idempotency
    is the cloud's responsibility.

    Args:
        db:  Company-scoped SQLAlchemy session (caller owns the transaction).
        job: The Job ORM object (must have company_id, helper_id, job_id set).

    Returns:
        The CreditLedger row (new or existing) in cloud mode, or None in runtime
        mode / on unexpected failure.
    """
    from omilo.control.local import LocalControlPlane
    from omilo.models.tenancy import Company

    engine_type = getattr(job, "engine_type", "fake") or "fake"
    model = getattr(job, "model", None)  # may not be set on all paths
    tokens_in = int(job.tokens_in or 0)
    tokens_out = int(job.tokens_out or 0)

    # ── LOCAL MODE early-return — no-op (P6b) ────────────────────────────────
    # In local mode all jobs are 0-credit BYO; no CreditLedger row is written
    # and no usage is reported to any control plane.
    if is_local_mode():
        return None

    # ── Determine control plane mode ──────────────────────────────────────────
    cp = get_control_plane()
    is_runtime_mode = not isinstance(cp, LocalControlPlane)

    # ── Compute provider cost (informational on pool path too) ────────────────
    cost = provider_cost_usd(engine_type, model, tokens_in, tokens_out)
    is_credit_consuming = engine_type in _CLOUD_ENGINE_TYPES
    credits = int(math.ceil(cost * MARGIN * CREDITS_PER_USD)) if is_credit_consuming else 0

    # ── RUNTIME MODE ──────────────────────────────────────────────────────────
    if is_runtime_mode:
        if is_credit_consuming and credits > 0:
            # Delegate billing to the cloud control plane.
            ev = UsageEvent(
                company_id=job.company_id,
                job_id=job.id,
                engine_type=engine_type,
                model=model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                credits=credits,
            )
            try:
                cp.report_usage(ev)
            except ControlPlaneUnreachable as exc:
                # RemoteControlPlane already enqueues to outbox; just log.
                logger.warning(
                    "meter_job: control plane unreachable for job_id=%s — "
                    "usage queued to outbox: %s",
                    job.id,
                    exc,
                )
        # 0-credit job in runtime mode: no-op (no local ledger, no report_usage)
        # Credit-consuming: cloud handles the ledger; we never write locally.
        return None

    # ── CLOUD MODE (LocalControlPlane) ────────────────────────────────────────
    # Behavior is IDENTICAL to pre-T4 — unchanged for P4 test compat.

    # Idempotency check
    existing = (
        db.query(CreditLedger)
        .filter_by(company_id=job.company_id, job_id=job.id, reason="job")
        .first()
    )
    if existing is not None:
        return existing

    # Load company (global table, visible in any session)
    company = db.get(Company, job.company_id)
    if company is None:
        return None

    # Determine billing path
    if is_credit_consuming:
        # Cloud path: charge credits, decrement Company.credit_balance
        delta = -credits
        company.credit_balance = (company.credit_balance or 0) + delta
        db.flush()
    else:
        # Pool / BYO path: metered, no charge (analytics only)
        credits = 0
        delta = 0

    balance_after = company.credit_balance

    # Append ledger row
    entry = CreditLedger(
        id=prefixed_id("cl"),
        company_id=job.company_id,
        delta=delta,
        balance_after=balance_after,
        reason="job",
        job_id=job.id,
        helper_id=job.helper_id,
        provider_cost_usd=cost,
        credits_charged=credits,
        meta={},
        at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()

    return entry
