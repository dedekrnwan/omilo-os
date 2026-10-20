"""Tests for ask.retrieve() — cross-surface retrieval (KB + Inbox + Plan + Docs).

Each test is self-contained: it seeds the rows it needs, calls retrieve(), and
asserts the expected shape.  The `owner` fixture (session-scoped) boots the app
once and sets up the Acme company; we add rows on top of that.

Run with:
    cd apps/api && uv run pytest tests/test_ask.py -v
"""
from __future__ import annotations

import pytest

from omilo_api import ask
from omilo_api.db import session_scope
from omilo_api.models import Goal, InboxItem


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_SOURCE_KEYS = {"title", "ref", "url", "surface", "score", "text"}

KEYWORD = "thunderstruck"   # deliberately odd word unlikely to collide with fixtures


def _has_source_keys(item: dict) -> bool:
    return _SOURCE_KEYS.issubset(item.keys())


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------

def test_retrieve_returns_kb_sources(owner):
    """After indexing a KB note that contains KEYWORD, retrieve() returns ≥1
    Source with surface=='kb' that has all required keys."""
    # Add a KB note via the API so it gets indexed properly.
    r = owner.post("/api/kb/notes", json={"title": f"Note about {KEYWORD}", "text": f"This is a test note about {KEYWORD} for the ask tests."})
    assert r.status_code == 200, r.text

    with session_scope() as db:
        results = ask.retrieve(db, KEYWORD, k=8)

    assert isinstance(results, list), "retrieve() must return a list"
    kb_hits = [s for s in results if s["surface"] == "kb"]
    assert len(kb_hits) >= 1, f"Expected ≥1 kb result for '{KEYWORD}', got: {results}"
    for hit in kb_hits:
        assert _has_source_keys(hit), f"Missing keys in kb hit: {hit}"


def test_retrieve_includes_other_surfaces(owner):
    """Seed an open InboxItem and an active Goal containing KEYWORD; retrieve()
    must return results with surface in {inbox, plan}."""
    unique = "zippyfrobnicator"   # another unique word to avoid cross-test collision

    with session_scope() as db:
        inbox_item = InboxItem(
            kind="alert",
            title=f"Alert about {unique}",
            body=f"Something happened with {unique} that needs attention.",
            status="open",
        )
        goal = Goal(
            title=f"Goal: achieve {unique} by Q4",
            target=f"Deliver the {unique} feature",
            due="2026-12-31",
            status="active",
        )
        db.add(inbox_item)
        db.add(goal)
        db.commit()
        inbox_id = inbox_item.id
        goal_id = goal.id

    with session_scope() as db:
        results = ask.retrieve(db, unique, k=8)

    assert isinstance(results, list)
    surfaces = {s["surface"] for s in results}
    assert "inbox" in surfaces and "plan" in surfaces, (
        f"Expected 'inbox' and 'plan' in surfaces for '{unique}', got: {surfaces}\nresults={results}"
    )

    inbox_hits = [s for s in results if s["surface"] == "inbox"]
    plan_hits = [s for s in results if s["surface"] == "plan"]

    for hit in inbox_hits:
        assert _has_source_keys(hit)
        assert hit["ref"] == inbox_id

    for hit in plan_hits:
        assert _has_source_keys(hit)
        assert hit["ref"] == goal_id


def test_retrieve_empty_surfaces_no_crash(owner):
    """A query that matches nothing on any surface must return a list (possibly empty),
    not raise any exception."""
    nonsense = "xyzzy_qqqq_7531_nonexistent_token_abc"

    with session_scope() as db:
        results = ask.retrieve(db, nonsense, k=8)

    assert isinstance(results, list), "retrieve() must return a list even when nothing matches"


def test_retrieve_capped_and_sorted(owner):
    """retrieve() returns at most k results and the scores are non-increasing."""
    with session_scope() as db:
        results = ask.retrieve(db, "the", k=4)

    assert len(results) <= 4, f"Expected ≤4 results (k=4), got {len(results)}"

    scores = [s["score"] for s in results]
    assert scores == sorted(scores, reverse=True), (
        f"Scores are not sorted descending: {scores}"
    )
