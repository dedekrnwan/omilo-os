"""Canonical plan catalog for Omilo billing.

Owner decision (2026-10-29): the subscription pays for **Omilo Cloud** — hosting
and storage — per **company**. AI is not part of the plan: companies bring their
own AI (API key) now, and a partner's per-token pricing comes later.

  plan_self_hosted  free         your computer, your AI, no limits
  plan_starter      Rp 149 rb    5 GB storage
  plan_team         Rp 499 rb    50 GB storage   (the 14-day free trial)
  plan_business     Rp 1,5 jt    250 GB storage

Per company, unlimited people and helpers. Storage counts docs, artifacts
(files, skills, exports) and knowledge; chats and run logs are free. At the
limit, new uploads pause until the company upgrades — nothing is deleted or
charged automatically. Yearly = 10 × monthly.

Prices are placeholders for the owner to set: change them here; the API syncs
the catalog into the ``plan`` table on start-up.

Legacy ids: ``plan_cloud`` maps to ``plan_team`` (``resolve_plan_id``).
Credits remain an *internal* unit for AI-spend caps (Rp 50 each, see
IDR_PER_CREDIT); customers never buy them.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from omilo.db import SessionLocal
from omilo.models.billing import Plan

# Internal unit for AI-spend caps (helper / flow / company budgets): Rp 50 per credit.
IDR_PER_CREDIT = 50

# No per-seat billing: plans are per company with unlimited people.
SEAT_PRICE_IDR = 0

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
        "monthly_price_usd": Decimal("0.0"),
        "monthly_price_idr": 0,
        "yearly_price_usd": Decimal("0.0"),
        "yearly_price_idr": 0,
        "included_credits": 0,
        "credit_overage_usd": Decimal("0"),
        "seats": 9999,  # unlimited people
        "features": {"max_seats": None, 'max_helpers': None, 'storage_gb': None, 'seat_price_idr': None, 'bullets': ['Runs on your computer', 'Unlimited people, helpers and storage', 'Your own AI']},
    },
    {
        "id": "plan_starter",
        "tier": "starter",
        "name": "Starter",
        "monthly_price_usd": Decimal("9.31"),
        "monthly_price_idr": 149_000,
        "yearly_price_usd": Decimal("93.12"),
        "yearly_price_idr": 1_490_000,
        "included_credits": 0,
        "credit_overage_usd": Decimal("0"),
        "seats": 9999,  # unlimited people
        "features": {"max_seats": None, 'max_helpers': None, 'storage_gb': 5, 'seat_price_idr': None, 'bullets': ['5 GB for docs, files and knowledge', 'Unlimited people and helpers', 'Always on in Omilo Cloud', 'Your own AI key']},
    },
    {
        "id": "plan_team",
        "tier": "team",
        "name": "Team",
        "monthly_price_usd": Decimal("31.19"),
        "monthly_price_idr": 499_000,
        "yearly_price_usd": Decimal("311.88"),
        "yearly_price_idr": 4_990_000,
        "included_credits": 0,
        "credit_overage_usd": Decimal("0"),
        "seats": 9999,  # unlimited people
        "features": {"max_seats": None, 'max_helpers': None, 'storage_gb': 50, 'seat_price_idr': None, 'bullets': ['50 GB for docs, files and knowledge', 'Unlimited people and helpers', 'Always on in Omilo Cloud', 'Email support'], 'badge': 'Most popular'},
    },
    {
        "id": "plan_business",
        "tier": "business",
        "name": "Business",
        "monthly_price_usd": Decimal("93.69"),
        "monthly_price_idr": 1_499_000,
        "yearly_price_usd": Decimal("936.88"),
        "yearly_price_idr": 14_990_000,
        "included_credits": 0,
        "credit_overage_usd": Decimal("0"),
        "seats": 9999,  # unlimited people
        "features": {"max_seats": None, 'max_helpers': None, 'storage_gb': 250, 'seat_price_idr': None, 'bullets': ['250 GB for docs, files and knowledge', 'Unlimited people and helpers', 'SSO and audit log', 'Priority WhatsApp support']},
    },
]

# Credit packs: NOT offered to customers today (Cloud plans are storage-priced
# and AI is bring-your-own). Kept for the partner AI (OMILO_POOL_AI=1), which
# will be prepaid; the UI doesn't show them.
PACK_CATALOG: list[dict[str, Any]] = [
    {"id": "2000", "credits": 2_000, "amount_idr": 100_000, "label": "2,000 credits",
     "sub": "About 3 weeks · small team", "badge": None},
    {"id": "5000", "credits": 5_000, "amount_idr": 238_000, "label": "5,000 credits",
     "sub": "About 2 months · most popular", "badge": "Save 6%"},
    {"id": "20000", "credits": 20_000, "amount_idr": 800_000, "label": "20,000 credits",
     "sub": "For busy teams", "badge": "Save 22%"},
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
