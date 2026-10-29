"""Canonical plan + credit-pack catalog for Omilo billing.

Cloud tiers (owner decision, sweep/control): **Starter / Team / Business**,
priced as the control-panel "Change plan" dialog shows them.  The free
**Self-Hosted** plan stays for local mode.

  plan_starter   Rp 500 rb / mo   2 seats (no extra seats)   2 helpers
  plan_team      Rp 2 jt  / mo    5 seats, add up to 15      6 helpers
  plan_business  Rp 6 jt  / mo    20 seats, add any time     unlimited helpers
  plan_self_hosted  free          unlimited

Yearly = 10 × monthly ("Pay yearly · 2 months free").  Extra seats cost
Rp 150 rb / seat / month (Team, Business).  Included credits are the plan's
"AI spend included" at Rp 50 / credit (the 2,000-credit pack price).

Legacy ids: ``plan_cloud`` (the old single cloud tier) maps to ``plan_team``
— migration 0024 moves existing subscriptions/companies over and
``resolve_plan_id`` keeps old clients working.

Plan IDs are stable strings so application code and tests can reference them
without a DB lookup.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from omilo.db import SessionLocal
from omilo.models.billing import Plan

# Rupiah per credit (2,000 credits = Rp 100 rb).
IDR_PER_CREDIT = 50

# Extra seat price (Team + Business), per seat per month.
SEAT_PRICE_IDR = 150_000

TRIAL_PLAN_ID = "plan_team"
SELF_HOSTED_PLAN_ID = "plan_self_hosted"
CLOUD_PLAN_IDS = ("plan_starter", "plan_team", "plan_business")

# Old / short ids → canonical plan id.
PLAN_ALIASES: dict[str, str] = {
    "plan_cloud": "plan_team",
    "cloud": "plan_team",
    "starter": "plan_starter",
    "team": "plan_team",
    "business": "plan_business",
    "self_hosted": "plan_self_hosted",
    "self-hosted": "plan_self_hosted",
}


def resolve_plan_id(plan_id: str) -> str:
    """Map legacy/short plan ids to the canonical catalog id."""
    return PLAN_ALIASES.get(plan_id, plan_id)


# ---------------------------------------------------------------------------
# Canonical plan definitions
# ---------------------------------------------------------------------------

PLAN_CATALOG: list[dict[str, Any]] = [
    {
        "id": "plan_self_hosted",
        "tier": "self_hosted",
        "name": "Self-Hosted",
        "monthly_price_usd": Decimal("0"),
        "monthly_price_idr": 0,
        "yearly_price_usd": Decimal("0"),
        "yearly_price_idr": 0,
        "included_credits": 0,
        "credit_overage_usd": Decimal("0"),
        "seats": 9999,  # sentinel: unlimited
        "features": {
            "max_seats": None,
            "max_helpers": None,
            "seat_price_idr": 0,
            "bullets": [
                "Unlimited people and helpers",
                "Your own AI keys",
                "No payment needed",
            ],
        },
    },
    {
        "id": "plan_starter",
        "tier": "starter",
        "name": "Starter",
        "monthly_price_usd": Decimal("30"),
        "monthly_price_idr": 500_000,
        "yearly_price_usd": Decimal("300"),
        "yearly_price_idr": 5_000_000,
        "included_credits": 6_000,  # Rp 300 rb AI spend
        "credit_overage_usd": Decimal("0"),
        "seats": 2,
        "features": {
            "max_seats": 2,
            "max_helpers": 2,
            "storage_gb": 5,
            "seat_price_idr": None,  # no extra seats on Starter
            "bullets": [
                "2 people · no extra seats",
                "2 helpers",
                "1 channel per helper",
                "Rp 300 rb AI spend included",
                "Community support",
            ],
        },
    },
    {
        "id": "plan_team",
        "tier": "team",
        "name": "Team",
        "monthly_price_usd": Decimal("120"),
        "monthly_price_idr": 2_000_000,
        "yearly_price_usd": Decimal("1200"),
        "yearly_price_idr": 20_000_000,
        "included_credits": 40_000,  # Rp 2 jt AI spend
        "credit_overage_usd": Decimal("0"),
        "seats": 5,
        "features": {
            "max_seats": 15,
            "max_helpers": 6,
            "storage_gb": 10,
            "seat_price_idr": SEAT_PRICE_IDR,
            "bullets": [
                "5 people · add seats up to 15",
                "6 helpers",
                "All channels",
                "Rp 2 jt AI spend included",
                "Bring your own AI key",
                "Email support",
            ],
        },
    },
    {
        "id": "plan_business",
        "tier": "business",
        "name": "Business",
        "monthly_price_usd": Decimal("360"),
        "monthly_price_idr": 6_000_000,
        "yearly_price_usd": Decimal("3600"),
        "yearly_price_idr": 60_000_000,
        "included_credits": 120_000,  # Rp 6 jt AI spend
        "credit_overage_usd": Decimal("0"),
        "seats": 20,
        "features": {
            "max_seats": None,
            "max_helpers": None,
            "storage_gb": 50,
            "seat_price_idr": SEAT_PRICE_IDR,
            "badge": "For growing estates",
            "bullets": [
                "20 people · add more any time",
                "Unlimited helpers",
                "MCP servers & custom skills",
                "Rp 6 jt AI spend included",
                "SSO and audit log",
                "Priority WhatsApp support",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Credit packs (control-panel "Buy credits" dialog is canonical)
# ---------------------------------------------------------------------------

PACK_CATALOG: list[dict[str, Any]] = [
    {
        "id": "2000",
        "credits": 2_000,
        "amount_idr": 100_000,
        "label": "2,000 credits",
        "sub": "About 3 weeks · small team",
        "badge": None,
    },
    {
        "id": "5000",
        "credits": 5_000,
        "amount_idr": 238_000,
        "label": "5,000 credits",
        "sub": "About 2 months · most popular",
        "badge": "Save 6%",
    },
    {
        "id": "20000",
        "credits": 20_000,
        "amount_idr": 800_000,
        "label": "20,000 credits",
        "sub": "For busy teams",
        "badge": "Save 22%",
    },
]

PACKS: dict[str, dict[str, int]] = {
    p["id"]: {"credits": p["credits"], "amount_idr": p["amount_idr"]} for p in PACK_CATALOG
}

# Old pack names (wallet auto-topup rows, older clients) → canonical pack id.
PACK_ALIASES: dict[str, str] = {"small": "2000", "medium": "5000", "large": "20000"}


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
