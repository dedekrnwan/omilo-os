"""Canonical plan catalog for Omilo billing.

Defines the two production plans with stable IDs and provides an idempotent
``seed_plans`` function that can be called from the demo seeder, bootstrap
scripts, or CI fixtures.

Plan IDs are stable strings (not prefixed ULIDs) so that application code
and tests can reference them without a DB lookup.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from omilo.db import SessionLocal
from omilo.models.billing import Plan

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
        "features": {},
    },
    {
        "id": "plan_cloud",
        "tier": "cloud",
        "name": "Cloud",
        "monthly_price_usd": Decimal("19"),
        "monthly_price_idr": 299000,
        "yearly_price_usd": Decimal("190"),
        "yearly_price_idr": 2990000,
        "included_credits": 2000,
        "credit_overage_usd": Decimal("0"),
        "seats": 5,
        "features": {},
    },
]


# ---------------------------------------------------------------------------
# Idempotent seeder
# ---------------------------------------------------------------------------


def seed_plans(db: Any = None) -> None:
    """Upsert the canonical plan catalog into the database.

    Idempotent: calling this twice results in exactly 2 catalog rows — no
    duplicates, no errors.  Existing rows are updated in-place.

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
