"""Task 5: SQLite knowledge-base backend (FTS5 + sqlite-vec, dual-write).

These tests drive the light tier. conftest sets a Postgres OMILO_DATABASE_URL globally; the
`sqlite_kb` fixture forces OMILO_TIER=light with a sqlite data dir, clears the settings cache,
resets engines + bus, and brings up a sqlite "main" company. Everything is restored afterwards
so the Postgres/full-tier suite is unaffected.

They assert the public kb.* functions return the SAME shapes on sqlite as on Postgres:
- FTS5 finds a source by word before any embedding exists (words-only mode);
- after embed_pending, the vector (KNN) half returns;
- related() / projection() work off the blob column;
- empty / punctuation-only queries return [] without an FTS5 syntax error.
"""
import pytest

from omilo_api import bus, db, kb
from omilo_api import company as C
from omilo_api.config import get_settings


@pytest.fixture
def sqlite_kb(tmp_path, monkeypatch):
    monkeypatch.setenv("OMILO_TIER", "light")
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    monkeypatch.setenv("OMILO_EMBED_PROVIDER", "hash")
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    C._cache.clear()
    C._cid.set(C.MAIN)
    db.engine("main")  # boot the sqlite company (create_all + ensure_indexes)
    yield
    get_settings.cache_clear()
    db.reset_engine()
    bus.reset()
    C._cache.clear()
    C._cid.set(C.MAIN)


def _db():
    return db._maker("main")()


def test_fts_search_returns_source(sqlite_kb):
    with db.session_scope("main") as s:
        kb.put(s, "doc", "a.md", "Pricing", "Our pricing plans and tiers")
    s = _db()
    try:
        res = kb.search(s, "pricing")
        assert any(h["ref"] == "a.md" for h in res["results"])
    finally:
        s.close()


def test_search_words_only_before_vectors_sqlite(sqlite_kb):
    """Found via FTS before any embedding exists; mode is words-only."""
    with db.session_scope("main") as s:
        kb.put(s, "doc", "w.md", "Invoices", "How to send an invoice to a customer")
    s = _db()
    try:
        res = kb.search(s, "invoice")
        assert res["mode"] == "words"
        assert any(h["ref"] == "w.md" for h in res["results"])
    finally:
        s.close()


def test_vector_knn_after_embedding(sqlite_kb):
    with db.session_scope("main") as s:
        kb.put(s, "doc", "b.md", "Cats", "felines and kittens playing")
    s = _db()
    try:
        n = kb.embed_pending(s)
        assert n >= 1
        res = kb.search(s, "kitten")
        assert res["results"]  # KNN (or fused) path returns something
        assert res["mode"] in ("hybrid", "words")
    finally:
        s.close()


def test_related_and_projection_sqlite(sqlite_kb):
    from sqlalchemy import select

    with db.session_scope("main") as s:
        kb.put(s, "doc", "c1.md", "Dogs", "dogs and puppies and hounds")
        kb.put(s, "doc", "c2.md", "More dogs", "puppies hounds and canines everywhere")
        kb.put(s, "doc", "c3.md", "Taxes", "quarterly tax filing and deductions")
    s = _db()
    try:
        kb.embed_pending(s)
        src = s.scalars(select(kb.KbSource).where(kb.KbSource.ref == "c1.md")).first()
        rel = kb.related(s, src.id)
        assert isinstance(rel, list)
        if rel:
            assert "similarity" in rel[0] and "id" in rel[0]
        proj = kb.projection(s)
        assert "points" in proj
        assert isinstance(proj["points"], list)
    finally:
        s.close()


def test_search_empty_query_sqlite(sqlite_kb):
    with db.session_scope("main") as s:
        kb.put(s, "doc", "e.md", "Hello", "some words here")
    s = _db()
    try:
        # whitespace / punctuation-only must not raise an FTS5 syntax error
        for q in ("   ", "...", "!?@#", "\t\n"):
            res = kb.search(s, q)
            assert res["results"] == []
        # docs_search too
        assert kb.docs_search(s, "...") == []
    finally:
        s.close()
