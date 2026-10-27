"""TDD: Task 6 — Periodic external learning (relevance-gated, offline).

Setup: two companies; each with a company-scoped session + Helper + Goal.

Tests:
1. learn_external returns {fetched, kept, dropped} with kept>=1 and dropped>=1.
2. A kept source is KB-indexed as kind='web' and recall-able.
3. KbSource.meta has url + fetched_at provenance.
4. A dropped (irrelevant) source is NOT in the KB.
5. Budget cap: budget=1 → kept <= 1 even if more would qualify.
6. No Proposal / side-effecting action was created (Proposal count unchanged).
7. Company-scoped: learning for company A's helper doesn't touch company B's KB.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company
from omilo.models.workspace import Channel, Goal

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Module schema guard
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_API_DIR,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _superuser_session():
    """Context manager: privileged (superuser) session — bypasses RLS."""
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _tenant_session(company_id: str):
    """Context manager: omilo_app-scoped session with RLS GUC set."""
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            self._sess.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self._sess, company_id)
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------

def _make_company(name: str) -> str:
    """Insert a Company row; return company_id."""
    with _superuser_session() as db:
        cmp = Company(
            id=prefixed_id("cmp"),
            name=name,
            color="#3b82f6",
            timezone="UTC",
        )
        db.add(cmp)
        db.flush()
        return cmp.id


def _make_channel(company_id: str, name: str = "General") -> str:
    """Insert a Channel row; return channel_id."""
    with _superuser_session() as db:
        ch = Channel(
            id=prefixed_id("ch"),
            company_id=company_id,
            name=name,
            accent="general",
            is_default=True,
            agent_count=0,
            chat_count=0,
            open_items=0,
        )
        db.add(ch)
        db.flush()
        return ch.id


def _make_helper(company_id: str, role: str = "Growth") -> str:
    """Insert a Helper row; return helper_id."""
    with _superuser_session() as db:
        h = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name=f"{role} Helper",
            area="marketing",
            role=role,
            job_description=f"Responsible for {role.lower()} strategy and execution",
            is_chief=False,
            engine={"type": "fake"},
            autonomy_cap=None,
            permissions=[],
            status="active",
            channel_ids=[],
        )
        db.add(h)
        db.flush()
        return h.id


def _make_goal(company_id: str, channel_id: str, title: str) -> str:
    """Insert a Goal row; return goal_id."""
    with _superuser_session() as db:
        g = Goal(
            id=prefixed_id("gol"),
            company_id=company_id,
            channel_id=channel_id,
            title=title,
            progress=0,
            target="Q4 2026",
            status="active",
            autonomy_override=None,
            owner_helper_id=None,
        )
        db.add(g)
        db.flush()
        return g.id


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cmp_a() -> str:
    return _make_company("Co A External Learning")


@pytest.fixture(scope="module")
def cmp_b() -> str:
    return _make_company("Co B External Learning")


@pytest.fixture(scope="module")
def channel_a(cmp_a) -> str:
    return _make_channel(cmp_a, "Marketing")


@pytest.fixture(scope="module")
def channel_b(cmp_b) -> str:
    return _make_channel(cmp_b, "General B")


@pytest.fixture(scope="module")
def helper_a(cmp_a) -> str:
    """A Growth/marketing helper for company A."""
    return _make_helper(cmp_a, "Growth")


@pytest.fixture(scope="module")
def helper_b(cmp_b) -> str:
    """An unrelated helper for company B."""
    return _make_helper(cmp_b, "Finance")


@pytest.fixture(scope="module")
def goal_a(cmp_a, channel_a) -> str:
    """Active Goal for company A: 'Launch referral program'."""
    return _make_goal(cmp_a, channel_a, "Launch referral program")


@pytest.fixture(scope="module")
def goal_b(cmp_b, channel_b) -> str:
    """Active Goal for company B (unrelated topic)."""
    return _make_goal(cmp_b, channel_b, "Reduce invoice processing time")


# ---------------------------------------------------------------------------
# Tests: basic return shape
# ---------------------------------------------------------------------------

def test_learn_external_returns_dict_with_kept_and_dropped(cmp_a, helper_a, goal_a):
    """learn_external must return {fetched, kept, dropped} with kept>=1, dropped>=1."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)

    with _tenant_session(cmp_a) as db:
        result = learn_external(db, helper_obj)

    assert isinstance(result, dict), f"Expected dict, got {type(result)}"
    assert "fetched" in result, f"Missing 'fetched' key: {result}"
    assert "kept" in result, f"Missing 'kept' key: {result}"
    assert "dropped" in result, f"Missing 'dropped' key: {result}"

    assert result["fetched"] >= 1, f"fetched must be >= 1, got {result}"
    assert result["kept"] >= 1, f"kept must be >= 1 (at least one relevant source): {result}"
    assert result["dropped"] >= 1, f"dropped must be >= 1 (at least one irrelevant source): {result}"
    assert result["fetched"] == result["kept"] + result["dropped"], (
        f"fetched must equal kept + dropped: {result}"
    )


# ---------------------------------------------------------------------------
# Tests: KB indexing + recall of kept sources
# ---------------------------------------------------------------------------

def test_kept_source_is_kb_indexed_as_web_kind(cmp_a, helper_a, goal_a):
    """A kept source must appear in the KB as kind='web'."""
    from omilo.kb.retrieve import recall
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)

    # Run learning (may have already run; idempotent on ref)
    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_obj)

    # The fake fetch for a "Growth" / "referral" topic includes a relevant source
    # whose text mentions "referral" and "growth" — recall with those terms
    with _tenant_session(cmp_a) as db:
        results = recall(db, "referral growth marketing", kinds=["web"], k=10)

    assert results, (
        "recall with kinds=['web'] must return at least one result after learn_external"
    )
    assert all(r["kind"] == "web" for r in results), (
        "All returned chunks from kinds=['web'] filter must have kind='web'"
    )


def test_kept_source_kbsource_has_provenance_meta(cmp_a, helper_a, goal_a):
    """KbSource for a kept web source must have url + fetched_at in meta."""
    from omilo.models.knowledge import KbSource
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)

    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_obj)

        # Find web sources for this company
        web_sources = db.query(KbSource).filter_by(kind="web").all()

    assert web_sources, "At least one KbSource with kind='web' must exist"

    for src in web_sources:
        meta = src.meta or {}
        assert "url" in meta, f"KbSource.meta must have 'url'; got {meta}"
        assert "fetched_at" in meta, f"KbSource.meta must have 'fetched_at'; got {meta}"
        assert "score" in meta, f"KbSource.meta must have 'score'; got {meta}"


# ---------------------------------------------------------------------------
# Tests: dropped sources NOT in KB
# ---------------------------------------------------------------------------

def test_dropped_source_not_in_kb(cmp_a, helper_a, goal_a):
    """A dropped (irrelevant) source must NOT appear in the KB."""
    from omilo.models.knowledge import KbSource
    from omilo.learning.external import _fake_fetch, _relevance_score, learn_external
    from omilo.models.agents import Helper
    from omilo.models.workspace import Goal

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)

    # Find what the fake fetch produces for this helper's topics and identify
    # which sources would be dropped
    from omilo.models.workspace import Goal as GoalModel

    with _superuser_session() as db:
        goals = db.query(GoalModel).filter_by(company_id=cmp_a).all()

    # Derive topics as learn_external does
    topics = [helper_obj.role]
    for g in goals:
        if g.status == "active":
            topics.append(g.title)

    dropped_urls = set()
    for topic in topics:
        sources = _fake_fetch(topic)
        for src in sources:
            score = _relevance_score(src, helper_obj, goals)
            if score < 0.2:
                dropped_urls.add(src["url"])

    # If no sources were dropped with these topics, the test is trivially satisfied
    # (the implementation's _fake_fetch guarantees at least one irrelevant per topic)
    if not dropped_urls:
        pytest.skip("No dropped sources detected — check _fake_fetch implementation")

    # Assert none of the dropped URLs are in the KB
    with _tenant_session(cmp_a) as db:
        for url in dropped_urls:
            src_in_kb = db.query(KbSource).filter_by(ref=url).first()
            assert src_in_kb is None, (
                f"Dropped source with url={url!r} must NOT be in the KB"
            )


# ---------------------------------------------------------------------------
# Tests: budget cap
# ---------------------------------------------------------------------------

def test_budget_cap_respected(cmp_a, helper_a, goal_a):
    """With budget=1, kept must be <= 1 even if more sources qualify."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper

    # Use a fresh company+helper to avoid interference from prior kept sources
    cmp_budget = _make_company("Co Budget Test")
    ch_budget = _make_channel(cmp_budget, "Budget Channel")
    h_budget = _make_helper(cmp_budget, "Growth")
    _make_goal(cmp_budget, ch_budget, "Launch referral program")

    with _superuser_session() as db:
        helper_obj = db.get(Helper, h_budget)

    with _tenant_session(cmp_budget) as db:
        result = learn_external(db, helper_obj, budget=1)

    assert result["kept"] <= 1, (
        f"budget=1 must cap kept at 1; got kept={result['kept']}"
    )


# ---------------------------------------------------------------------------
# Tests: no side-effecting actions (no Proposals created)
# ---------------------------------------------------------------------------

def test_no_proposal_created_by_learn_external(cmp_a, helper_a, goal_a):
    """learn_external must NOT create any Proposal rows."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper
    from omilo.models.approvals import Proposal

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)
        count_before = db.query(Proposal).filter_by(
            company_id=cmp_a, helper_id=helper_a
        ).count()

    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_obj)

    with _superuser_session() as db:
        count_after = db.query(Proposal).filter_by(
            company_id=cmp_a, helper_id=helper_a
        ).count()

    assert count_after == count_before, (
        f"learn_external must not create Proposals; count before={count_before}, after={count_after}"
    )


# ---------------------------------------------------------------------------
# Tests: company-scoped isolation
# ---------------------------------------------------------------------------

def test_company_a_learning_does_not_touch_company_b_kb(
    cmp_a, cmp_b, helper_a, helper_b, goal_a, goal_b
):
    """Learning for company A's helper must not create KB entries in company B."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper
    from omilo.models.knowledge import KbSource

    with _superuser_session() as db:
        helper_a_obj = db.get(Helper, helper_a)

    # Count company B's web sources before
    with _superuser_session() as db:
        count_b_before = db.query(KbSource).filter_by(
            company_id=cmp_b, kind="web"
        ).count()

    # Run learning for company A
    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_a_obj)

    # Company B's KB should be unchanged
    with _superuser_session() as db:
        count_b_after = db.query(KbSource).filter_by(
            company_id=cmp_b, kind="web"
        ).count()

    assert count_b_after == count_b_before, (
        f"Company A's learning must not touch company B's KB; "
        f"count_b before={count_b_before}, after={count_b_after}"
    )


def test_company_b_recall_does_not_see_company_a_web_sources(
    cmp_a, cmp_b, helper_a, helper_b, goal_a, goal_b
):
    """Company B's recall must not return web sources created by company A's learning."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper
    from omilo.kb.retrieve import recall
    from omilo.models.knowledge import KbSource

    with _superuser_session() as db:
        helper_a_obj = db.get(Helper, helper_a)

    # Run learning for company A
    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_a_obj)

    # Get company A's web source IDs (superuser)
    with _superuser_session() as db:
        a_web_src_ids = {
            s.id for s in db.query(KbSource).filter_by(company_id=cmp_a, kind="web").all()
        }

    # Company B recall — must not include company A's web sources
    with _tenant_session(cmp_b) as db:
        results = recall(db, "referral growth marketing", kinds=["web"], k=20)

    b_source_ids = {r["source_id"] for r in results}
    leaked = a_web_src_ids & b_source_ids
    assert not leaked, (
        f"Company A's web source IDs leaked into company B's recall: {leaked}"
    )


# ---------------------------------------------------------------------------
# Tests: memory note created for kept sources
# ---------------------------------------------------------------------------

def test_kept_source_creates_memory_note(cmp_a, helper_a, goal_a):
    """For each kept source, a Memory note must be created for the helper."""
    from omilo.learning.external import learn_external
    from omilo.models.agents import Helper
    from omilo.models.memory import MemoryDoc

    with _superuser_session() as db:
        helper_obj = db.get(Helper, helper_a)

    with _tenant_session(cmp_a) as db:
        learn_external(db, helper_obj)

    # Notes.md should mention at least one "Learned:" entry
    with _tenant_session(cmp_a) as db:
        notes_doc = db.query(MemoryDoc).filter_by(
            helper_id=helper_a,
            path=f"Memory/{helper_a}/Notes.md",
        ).first()

    assert notes_doc is not None, (
        "Notes.md must exist for the helper after learn_external"
    )
    assert "Learned:" in notes_doc.content, (
        f"Notes.md must contain 'Learned:' entries; got:\n{notes_doc.content}"
    )
