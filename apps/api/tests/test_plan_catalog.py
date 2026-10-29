"""Tests for P12-T1: billing model extensions + plan catalog seeding.

Covers:
- seed_plans twice → exactly one row per catalog plan (idempotent upsert)
- Starter / Team / Business tiers (sweep/control owner decision):
  team: monthly_price_idr==2_000_000, yearly_price_idr==20_000_000,
        included_credits==40_000, seats==5
- self_hosted plan: included_credits==0
- new Subscription column: billing_interval defaults to "monthly"
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from omilo.db import SessionLocal
from omilo.models.billing import Plan, Subscription
from omilo.models.base import prefixed_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _count_plans(session) -> int:
    from sqlalchemy import select, func
    return session.execute(select(func.count()).select_from(Plan)).scalar_one()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_seed_plans_idempotent() -> None:
    """Running seed_plans twice must not duplicate catalog rows."""
    from omilo.billing.catalog import seed_plans

    with SessionLocal() as db:
        with db.begin():
            before = _count_plans(db)

    seed_plans(None)  # first call — None → uses its own SessionLocal
    seed_plans(None)  # second call — must not create duplicates

    with SessionLocal() as db:
        from sqlalchemy import select
        plans = db.execute(select(Plan)).scalars().all()

    plan_ids = {p.id for p in plans}
    catalog_ids = ("plan_self_hosted", "plan_starter", "plan_team", "plan_business")
    for pid in catalog_ids:
        assert pid in plan_ids, f"{pid} must exist"
    assert "plan_cloud" not in plan_ids, "legacy plan_cloud is migrated to plan_team"

    # The key invariant: running seed_plans twice doesn't double-insert
    catalog_plans = [p for p in plans if p.id in catalog_ids]
    assert len(catalog_plans) == 4, (
        f"Expected exactly 4 catalog plans, found {len(catalog_plans)}"
    )


def test_cloud_plan_fields() -> None:
    """Starter / Team / Business match the control-panel Change plan dialog."""
    from omilo.billing.catalog import resolve_plan_id, seed_plans

    seed_plans(None)

    with SessionLocal() as db:
        starter = db.get(Plan, "plan_starter")
        plan = db.get(Plan, "plan_team")
        business = db.get(Plan, "plan_business")

    assert plan is not None, "plan_team must exist after seeding"
    assert plan.tier == "team"
    assert plan.monthly_price_idr == 2_000_000
    assert plan.yearly_price_idr == 20_000_000  # 2 months free
    assert plan.included_credits == 40_000
    assert plan.seats == 5
    assert plan.features["max_seats"] == 15
    assert plan.features["seat_price_idr"] == 150_000

    assert starter.monthly_price_idr == 500_000 and starter.seats == 2
    assert starter.features["seat_price_idr"] is None
    assert business.monthly_price_idr == 6_000_000 and business.seats == 20
    assert business.features["max_seats"] is None

    assert resolve_plan_id("plan_cloud") == "plan_team"
    assert resolve_plan_id("business") == "plan_business"


def test_self_hosted_plan_fields() -> None:
    """Self-hosted plan has zero credits and sentinel seats (9999)."""
    from omilo.billing.catalog import seed_plans

    seed_plans(None)

    with SessionLocal() as db:
        plan = db.get(Plan, "plan_self_hosted")

    assert plan is not None, "plan_self_hosted must exist after seeding"
    assert plan.tier == "self_hosted"
    assert plan.included_credits == 0
    assert plan.seats == 9999
    assert plan.monthly_price_idr == 0
    assert int(plan.monthly_price_usd) == 0
    assert plan.yearly_price_idr == 0
    assert int(plan.yearly_price_usd) == 0


def test_subscription_billing_interval_default() -> None:
    """A new Subscription row defaults billing_interval to 'monthly'."""
    from omilo.billing.catalog import seed_plans

    seed_plans(None)

    with SessionLocal() as db:
        with db.begin():
            sub = Subscription(
                id=prefixed_id("sub"),
                company_id="cmp_test_catalog",
                plan_id="plan_team",
                status="active",
                seats=1,
            )
            db.add(sub)
            db.flush()
            sub_id = sub.id

    with SessionLocal() as db:
        loaded = db.get(Subscription, sub_id)
        assert loaded is not None
        assert loaded.billing_interval == "monthly"

    # cleanup
    with SessionLocal() as db:
        with db.begin():
            row = db.get(Subscription, sub_id)
            if row:
                db.delete(row)


def test_plan_yearly_fields_present() -> None:
    """Plan model exposes yearly_price_usd and yearly_price_idr fields."""
    # Verify the ORM mapping exists by creating a Plan object in memory (not persisted)
    p = Plan(
        id="plan_tmp_test",
        tier="test",
        name="Test",
        monthly_price_usd=Decimal("0"),
        monthly_price_idr=0,
        yearly_price_usd=Decimal("99.00"),
        yearly_price_idr=1500000,
        included_credits=100,
        credit_overage_usd=Decimal("0"),
        seats=1,
        features={},
    )
    assert p.yearly_price_usd == Decimal("99.00")
    assert p.yearly_price_idr == 1500000
