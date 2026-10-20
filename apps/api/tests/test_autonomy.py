"""C1: autonomy_policy resolver — permissive default, company override, per-helper override.

Self-contained: uses an in-memory SQLite database; no HTTP server required.
"""
import json

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from omilo_api.db import Base
from omilo_api.models import Setting, Staff
from omilo_api import services


# ---------------------------------------------------------------------------
# Fixtures: a fresh in-memory SQLite db per test function
# ---------------------------------------------------------------------------

@pytest.fixture()
def db():
    engine = sa.create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _staff(db: Session, autonomy: str = "standard") -> Staff:
    """Insert a minimal Staff row and return it."""
    st = Staff(
        id=f"helper-{autonomy}",
        name="Test Helper",
        engine={"type": "fake"},
        autonomy=autonomy,
    )
    db.add(st)
    db.flush()
    return st


# ---------------------------------------------------------------------------
# Default (nothing configured)
# ---------------------------------------------------------------------------

DEFAULT_TIERS = {"send_external", "payment", "destructive", "publish"}


def test_permissive_default_no_config(db):
    """With nothing configured, autonomy_policy returns the permissive defaults."""
    policy = services.autonomy_policy(db)
    assert policy["mode"] == "permissive"
    assert policy["budget_stop_usd"] is None
    assert set(policy["escalate_tiers"]) == DEFAULT_TIERS


def test_permissive_default_staff_none(db):
    """Explicit staff=None also yields the permissive default."""
    policy = services.autonomy_policy(db, staff=None)
    assert policy["mode"] == "permissive"
    assert policy["budget_stop_usd"] is None
    assert set(policy["escalate_tiers"]) == DEFAULT_TIERS


def test_returns_fresh_dict(db):
    """Each call returns a new dict (no shared mutable state)."""
    p1 = services.autonomy_policy(db)
    p2 = services.autonomy_policy(db)
    assert p1 is not p2
    p1["mode"] = "strict"
    assert p2["mode"] == "permissive"


# ---------------------------------------------------------------------------
# Company-level overrides via Setting rows
# ---------------------------------------------------------------------------

def test_company_mode_override(db):
    """A company Setting for autonomy_mode changes the mode."""
    db.add(Setting(key="autonomy_mode", value="strict"))
    db.flush()
    policy = services.autonomy_policy(db)
    assert policy["mode"] == "strict"


def test_company_budget_override(db):
    """A company Setting for autonomy_budget_stop_usd sets the budget."""
    db.add(Setting(key="autonomy_budget_stop_usd", value=50.0))
    db.flush()
    policy = services.autonomy_policy(db)
    assert policy["budget_stop_usd"] == 50.0


def test_company_escalate_tiers_override(db):
    """A company Setting for autonomy_escalate_tiers replaces the default list."""
    db.add(Setting(key="autonomy_escalate_tiers", value=["payment", "legal"]))
    db.flush()
    policy = services.autonomy_policy(db)
    assert set(policy["escalate_tiers"]) == {"payment", "legal"}


def test_company_full_override(db):
    """All three company settings at once are resolved correctly."""
    db.add(Setting(key="autonomy_mode", value="strict"))
    db.add(Setting(key="autonomy_budget_stop_usd", value=100.0))
    db.add(Setting(key="autonomy_escalate_tiers", value=["destructive"]))
    db.flush()
    policy = services.autonomy_policy(db)
    assert policy == {"mode": "strict", "budget_stop_usd": 100.0, "escalate_tiers": ["destructive"]}


# ---------------------------------------------------------------------------
# Per-helper overrides
# ---------------------------------------------------------------------------

def test_guided_staff_maps_to_strict(db):
    """staff.autonomy='guided' → mode='strict', overriding the permissive default."""
    st = _staff(db, "guided")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["mode"] == "strict"


def test_standard_staff_maps_to_permissive(db):
    """staff.autonomy='standard' → mode='permissive' (the default)."""
    st = _staff(db, "standard")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["mode"] == "permissive"


def test_trusted_staff_maps_to_permissive(db):
    """staff.autonomy='trusted' → mode='permissive'."""
    st = _staff(db, "trusted")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["mode"] == "permissive"


def test_per_helper_wins_over_company_mode(db):
    """Per-helper autonomy overrides the company autonomy_mode setting."""
    db.add(Setting(key="autonomy_mode", value="strict"))
    db.flush()
    # 'standard' helper → permissive, despite company saying strict
    st = _staff(db, "standard")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["mode"] == "permissive"


def test_guided_wins_over_permissive_company(db):
    """guided helper overrides a permissive company setting."""
    db.add(Setting(key="autonomy_mode", value="permissive"))
    db.flush()
    st = _staff(db, "guided")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["mode"] == "strict"


def test_budget_and_tiers_still_use_company_when_staff_present(db):
    """When a staff is given, budget + tiers still come from company/default (not per-helper)."""
    db.add(Setting(key="autonomy_budget_stop_usd", value=75.5))
    db.add(Setting(key="autonomy_escalate_tiers", value=["publish"]))
    db.flush()
    st = _staff(db, "trusted")
    policy = services.autonomy_policy(db, staff=st)
    assert policy["budget_stop_usd"] == 75.5
    assert policy["escalate_tiers"] == ["publish"]
