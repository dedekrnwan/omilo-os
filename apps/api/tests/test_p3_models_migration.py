"""
TDD — Task 1: P3 RAG/memory/skill/improvement models + pgvector migration.

Runs `alembic upgrade head` against the live DB, then verifies:
  1. The `vector` extension exists (pg_extension).
  2. All 5 new P3 tables exist (kb_source, kb_chunk, memory_doc, skill, improvement).
  3. Every P3 tenant table has relforcerowsecurity = true.
  4. The `tenant_isolation` policy exists on every P3 tenant table.
  5. The `omilo_app` role has SELECT/INSERT/UPDATE/DELETE on every P3 table.
  6. The HNSW index on kb_chunk.embedding exists (pg_indexes).
  7. The GIN index on kb_chunk.tsv exists (pg_indexes).

The fixture reuses the session-scoped `ensure_schema` from conftest.py, so
`alembic upgrade head` is already applied before this module runs.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal

# ── Constants ─────────────────────────────────────────────────────────────────

NEW_P3_TABLES = [
    "kb_source",
    "kb_chunk",
    "memory_doc",
    "skill",
    "improvement",
]


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_vector_extension_exists():
    """The pgvector extension must be installed in the DB."""
    with SessionLocal() as session:
        row = session.execute(
            text(
                "SELECT extname FROM pg_extension WHERE extname = 'vector'"
            )
        ).fetchone()
    assert row is not None, "pgvector extension 'vector' is not installed"


def test_all_p3_tables_exist():
    """Every P3 table must be present in the public schema."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).fetchall()
    existing = {r.tablename for r in rows}
    missing = set(NEW_P3_TABLES) - existing
    assert not missing, f"Missing P3 tables: {missing}"


def test_p3_tenant_tables_have_force_rls():
    """All P3 tenant tables must have relforcerowsecurity = true."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT relname, relforcerowsecurity "
                "FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": NEW_P3_TABLES},
        ).fetchall()

    by_name = {r.relname: r.relforcerowsecurity for r in rows}
    for tbl in NEW_P3_TABLES:
        assert by_name.get(tbl) is True, (
            f"Table '{tbl}' does not have FORCE RLS "
            f"(relforcerowsecurity={by_name.get(tbl)!r})"
        )


def test_p3_tenant_isolation_policy_exists():
    """The tenant_isolation policy must exist on every P3 tenant table."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT c.relname "
                "FROM pg_policy p "
                "JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = ANY(:tables) AND p.polname = 'tenant_isolation'"
            ),
            {"tables": NEW_P3_TABLES},
        ).fetchall()

    found = {r.relname for r in rows}
    missing = set(NEW_P3_TABLES) - found
    assert not missing, (
        f"tenant_isolation policy missing on P3 tables: {missing}"
    )


def test_omilo_app_has_crud_grants_on_p3_tables():
    """omilo_app must have SELECT, INSERT, UPDATE, DELETE on every P3 table."""
    required_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    with SessionLocal() as session:
        for tbl in NEW_P3_TABLES:
            rows = session.execute(
                text(
                    "SELECT privilege_type "
                    "FROM information_schema.role_table_grants "
                    "WHERE table_name = :tbl "
                    "  AND grantee = 'omilo_app' "
                    "  AND table_schema = 'public'"
                ),
                {"tbl": tbl},
            ).fetchall()
            granted = {r.privilege_type for r in rows}
            missing = required_privileges - granted
            assert not missing, (
                f"omilo_app is missing {missing} on table '{tbl}'. "
                f"Granted: {granted}"
            )


def test_hnsw_index_on_kb_chunk_embedding_exists():
    """HNSW index on kb_chunk.embedding must exist in pg_indexes."""
    with SessionLocal() as session:
        row = session.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'kb_chunk' "
                "  AND indexname = 'ix_kb_chunk_embedding_hnsw'"
            )
        ).fetchone()
    assert row is not None, (
        "HNSW index 'ix_kb_chunk_embedding_hnsw' not found on kb_chunk"
    )


def test_gin_index_on_kb_chunk_tsv_exists():
    """GIN index on kb_chunk.tsv must exist in pg_indexes."""
    with SessionLocal() as session:
        row = session.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE tablename = 'kb_chunk' "
                "  AND indexname = 'ix_kb_chunk_tsv'"
            )
        ).fetchone()
    assert row is not None, (
        "GIN index 'ix_kb_chunk_tsv' not found on kb_chunk"
    )
