"""omilo.billing.meter — Credit metering for AI jobs.

Public API:
    provider_cost_usd(engine_type, model, tokens_in, tokens_out) -> Decimal
    meter_job(db, job) -> CreditLedger | None

Design decisions:
- MARGIN=1.4 applied on top of raw provider cost to cover overhead + margin.
- CREDITS_PER_USD=100: 1 USD = 100 credits (1 credit = $0.01).
- PRICE_TABLE: keyed by (engine_type, model) → {in_per_1k, out_per_1k} USD.
  Fallback key ("*", "*") is used when no exact match found.
- Cloud/litellm path: charges credits (ceil), decrements Company.credit_balance.
- Pool/BYO path (fake|anthropic|claude_code): metered at credits_charged=0
  for analytics only; balance unchanged.
- Idempotent: a CreditLedger row for (company_id, job_id, reason="job") that
  already exists is returned as-is without double-charging.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

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
    """Record a CreditLedger entry for a completed job.

    Idempotent: if a ledger row for (company_id, job_id, reason="job") already
    exists, returns it immediately without creating another.

    Cloud/litellm path:
        credits_charged = ceil(provider_cost * MARGIN * CREDITS_PER_USD)
        delta           = -credits_charged
        Company.credit_balance decremented by credits_charged

    Pool/BYO path (fake|anthropic|claude_code|graph):
        credits_charged = 0, delta = 0 (metered for analytics only)
        balance unchanged

    Args:
        db:  Company-scoped SQLAlchemy session (caller owns the transaction).
        job: The Job ORM object (must have company_id, helper_id, job_id set).

    Returns:
        The CreditLedger row (new or existing), or None on unexpected failure.
    """
    from omilo.models.tenancy import Company

    # ── Idempotency check ─────────────────────────────────────────────────────
    existing = (
        db.query(CreditLedger)
        .filter_by(company_id=job.company_id, job_id=job.id, reason="job")
        .first()
    )
    if existing is not None:
        return existing

    # ── Load company (global table, visible in any session) ───────────────────
    company = db.get(Company, job.company_id)
    if company is None:
        return None

    engine_type = getattr(job, "engine_type", "fake") or "fake"
    model = getattr(job, "model", None)  # may not be set on all paths
    tokens_in = int(job.tokens_in or 0)
    tokens_out = int(job.tokens_out or 0)

    # ── Compute provider cost (informational on pool path too) ────────────────
    cost = provider_cost_usd(engine_type, model, tokens_in, tokens_out)

    # ── Determine billing path ────────────────────────────────────────────────
    if engine_type in _CLOUD_ENGINE_TYPES:
        # Cloud path: charge credits
        credits = int(math.ceil(cost * MARGIN * CREDITS_PER_USD))
        delta = -credits
        company.credit_balance = (company.credit_balance or 0) + delta
        db.flush()
    else:
        # Pool / BYO path: metered, no charge
        credits = 0
        delta = 0

    balance_after = company.credit_balance

    # ── Append ledger row ─────────────────────────────────────────────────────
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
