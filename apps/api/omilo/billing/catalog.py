"""Plan catalog for Omilo billing.

The open-source app ships one plan: **Self-Hosted** — free, on your computer,
your own AI, no limits. What Omilo Cloud sells (plan prices, storage, credit
packs, the trial plan) comes from the private cloud plugin
(see ``omilo.cloud_plugin``); without it nothing is for sale.

Plans are per company. ``features`` carries the limits the app enforces:
``storage_gb`` (None = unlimited), ``max_seats`` / ``seat_price_idr``
(None = unlimited people) and ``max_helpers``. The catalog is synced into the
``plan`` table on start-up (``seed_plans``).

Credits are an *internal* unit for AI-spend caps (``IDR_PER_CREDIT`` rupiah each).
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from omilo.db import SessionLocal
from omilo.models.billing import Plan

from omilo import cloud_plugin

_plugin = cloud_plugin.get()

# Internal unit for AI-spend caps (helper / flow / company budgets), in rupiah.
IDR_PER_CREDIT: int = _plugin.idr_per_credit if _plugin else 50

# No per-seat billing: plans are per company with unlimited people.
SEAT_PRICE_IDR = 0

SELF_HOSTED_PLAN_ID = "plan_self_hosted"

SELF_HOSTED_PLAN: dict[str, Any] = {
    "id": SELF_HOSTED_PLAN_ID,
    "tier": "self_hosted",
    "name": "Self-Hosted",
    "monthly_price_usd": Decimal("0.0"),
    "monthly_price_idr": 0,
    "yearly_price_usd": Decimal("0.0"),
    "yearly_price_idr": 0,
    "included_credits": 0,
    "credit_overage_usd": Decimal("0"),
    "seats": 9999,  # unlimited people
    "features": {"max_seats": None, "max_helpers": None, "storage_gb": None, "seat_price_idr": None,
                 "bullets": ["Runs on your computer", "Unlimited people, helpers and storage", "Your own AI"]},
}

# Plans sold on Omilo Cloud — supplied by the cloud plugin.
PLAN_CATALOG: list[dict[str, Any]] = [SELF_HOSTED_PLAN, *(_plugin.plans if _plugin else [])]
CLOUD_PLAN_IDS: tuple[str, ...] = tuple(p["id"] for p in PLAN_CATALOG if p["id"] != SELF_HOSTED_PLAN_ID)

# The plan a new cloud company trials (None = no trial offered).
TRIAL_PLAN_ID: str | None = _plugin.trial_plan_id if _plugin else None

# Old / short ids → canonical plan id.
PLAN_ALIASES: dict[str, str] = {
    "self_hosted": SELF_HOSTED_PLAN_ID,
    "self-hosted": SELF_HOSTED_PLAN_ID,
    **(_plugin.plan_aliases if _plugin else {}),
}


def resolve_plan_id(plan_id: str) -> str:
    """Map legacy/short plan ids to the canonical catalog id."""
    return PLAN_ALIASES.get(plan_id, plan_id)


# Prepaid AI credit packs — supplied by the cloud plugin (only used with pooled AI).
PACK_CATALOG: list[dict[str, Any]] = list(_plugin.packs) if _plugin else []

PACKS: dict[str, dict[str, int]] = {
    p["id"]: {"credits": p["credits"], "amount_idr": p["amount_idr"]} for p in PACK_CATALOG
}

# Old pack names (wallet auto-topup rows, older clients) → canonical pack id.
PACK_ALIASES: dict[str, str] = dict(_plugin.pack_aliases) if _plugin else {}


def resolve_pack_id(pack: str) -> str:
    return PACK_ALIASES.get(pack, pack)


def plan_features(plan: Plan | None) -> dict[str, Any]:
    """Return the plan's feature dict, falling back to the catalog definition."""
    if plan is None:
        return {}
    feats = dict(plan.features or {})
    if not feats:
        spec = next((p for p in PLAN_CATALOG if p["id"] == plan.id), None)
        if spec:
            feats = dict(spec["features"])
    return feats


# ---------------------------------------------------------------------------
# Idempotent seeder
# ---------------------------------------------------------------------------


def seed_plans(db: Any = None) -> None:
    """Upsert the canonical plan catalog into the database.

    Idempotent: calling this twice results in exactly one row per catalog
    plan — no duplicates, no errors.  Existing rows are updated in-place.

    Args:
        db: Ignored (kept for API symmetry with callers that pass a session).
            The function always uses its own ``SessionLocal`` context so that
            it can be called from seeder scripts without an ambient session.
    """
    with SessionLocal() as session:
        with session.begin():
            for spec in PLAN_CATALOG:
                existing = session.get(Plan, spec["id"])
                if existing is None:
                    plan = Plan(**spec)
                    session.add(plan)
                else:
                    # Update all mutable fields in case the catalog changes.
                    for key, value in spec.items():
                        if key != "id":
                            setattr(existing, key, value)
