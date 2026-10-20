"""C1: autonomy_policy resolver — permissive default, company override, per-helper override.
C2: _cos_rule generalization — CoS auto-approves low/medium proposals for any brain when permissive.

Self-contained: uses an in-memory SQLite database; no HTTP server required.
"""
import json
from unittest.mock import MagicMock, patch

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from omilo_api.db import Base
from omilo_api.models import Proposal, Setting, Staff
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


# ---------------------------------------------------------------------------
# C2: _cos_rule generalization — all brains, gated by autonomy_policy mode
# ---------------------------------------------------------------------------

_COS_ID = "chief-of-staff"


def _make_cos(db: Session) -> Staff:
    """Insert a CoS (is_chief=True) and return it."""
    cos = Staff(id=_COS_ID, name="Chief of Staff", engine={"type": "fake"}, is_chief=True)
    db.add(cos)
    db.flush()
    return cos


def _make_staff_with_brain(db: Session, brain: str, autonomy: str = "standard") -> Staff:
    """Insert a Staff with the given brain and autonomy setting."""
    st = Staff(
        id=f"worker-{brain}-{autonomy}",
        name="Worker",
        engine={"type": "fake"},
        brain=brain,
        autonomy=autonomy,
    )
    db.add(st)
    db.flush()
    return st


def _make_proposal(db: Session, st: Staff, action_type: str = "knowledge.write") -> Proposal:
    """Insert a minimal pending Proposal for ``st``."""
    p = Proposal(
        staff_id=st.id,
        type=action_type,
        risk="medium",
        title="draft an internal note",
    )
    db.add(p)
    db.flush()
    return p


# -- C2-1: single_engine + permissive + low/medium → CoS auto-approves (THE GENERALIZATION) --

def test_single_engine_permissive_low_medium_cos_approves(db):
    """A low/medium ASK proposal from single_engine staff is auto-approved by CoS when permissive."""
    _make_cos(db)
    st = _make_staff_with_brain(db, "single_engine", autonomy="standard")  # standard → permissive
    p = _make_proposal(db, st, "knowledge.write")  # medium risk

    decide_calls = []

    with patch("omilo_api.services.decide_proposal", side_effect=lambda db, prop, dec, note, by: decide_calls.append((dec, by)) or prop) as mock_decide, \
         patch("omilo_api.graph.delegation.cos_id", return_value=_COS_ID):
        result = services._cos_rule(db, st, p)

    assert result is not None, "CoS should auto-approve single_engine staff in permissive mode"
    assert result["decision"] == "allowed"
    assert result["level"] == "cos"
    assert len(decide_calls) == 1, "decide_proposal must be called exactly once"
    assert decide_calls[0] == ("approve", _COS_ID), f"expected ('approve', CoS id), got {decide_calls[0]}"


# -- C2-2: single_engine + strict → escalate to owner (returns None) --

def test_single_engine_strict_escalates_to_owner(db):
    """A single_engine staff with autonomy='guided' (strict mode) → _cos_rule returns None."""
    _make_cos(db)
    st = _make_staff_with_brain(db, "single_engine", autonomy="guided")  # guided → strict

    p = _make_proposal(db, st, "knowledge.write")

    with patch("omilo_api.services.decide_proposal") as mock_decide, \
         patch("omilo_api.graph.delegation.cos_id", return_value=_COS_ID):
        result = services._cos_rule(db, st, p)

    assert result is None, "strict mode must escalate to owner (return None)"
    mock_decide.assert_not_called()


# -- C2-3: any brain + permissive + HIGH risk → escalate to owner --

def test_permissive_high_risk_escalates_to_owner(db):
    """Even in permissive mode, a high-risk proposal is NOT auto-approved by the CoS."""
    _make_cos(db)
    st = _make_staff_with_brain(db, "single_engine", autonomy="standard")  # permissive
    p = _make_proposal(db, st, "content.publish")  # classify_risk returns "high" for this

    with patch("omilo_api.services.decide_proposal") as mock_decide, \
         patch("omilo_api.graph.delegation.cos_id", return_value=_COS_ID):
        result = services._cos_rule(db, st, p)

    assert result is None, "high-risk must always escalate to owner even in permissive mode"
    mock_decide.assert_not_called()


# -- C2-4: graph + permissive → still auto-approves (NO REGRESSION) --

def test_graph_permissive_still_auto_approves(db):
    """graph-brain staff under permissive mode behaves exactly as before (no regression)."""
    _make_cos(db)
    st = _make_staff_with_brain(db, "graph", autonomy="standard")  # graph + permissive
    p = _make_proposal(db, st, "knowledge.write")  # medium risk → auto-approve

    decide_calls = []

    with patch("omilo_api.services.decide_proposal", side_effect=lambda db, prop, dec, note, by: decide_calls.append((dec, by)) or prop), \
         patch("omilo_api.graph.delegation.cos_id", return_value=_COS_ID):
        result = services._cos_rule(db, st, p)

    assert result is not None, "graph staff in permissive must still be auto-approved (no regression)"
    assert result["decision"] == "allowed"
    assert result["level"] == "cos"
    assert len(decide_calls) == 1
    assert decide_calls[0] == ("approve", _COS_ID)
