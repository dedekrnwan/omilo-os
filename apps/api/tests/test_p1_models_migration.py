"""
TDD — Task 1: P1 execution + approval models + migration with RLS policies.

Runs `alembic upgrade head` against the live DB, then verifies:
  1. All 7 new P1 tables exist.
  2. Every P1 tenant table has both relrowsecurity AND relforcerowsecurity = true.
  3. The `tenant_isolation` policy exists on every P1 tenant table.
  4. The `omilo_app` role has SELECT/INSERT/UPDATE/DELETE on every P1 table.

All 7 P1 tables are tenant tables (they all carry company_id).

The fixture reuses the session-scoped `ensure_schema` from conftest.py, so
`alembic upgrade head` is already applied before this module runs.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal

# ── Constants ─────────────────────────────────────────────────────────────────

ALL_P1_TABLES = [
    "helper",
    "job",
    "report",
    "run_event",
    "proposal",
    "proposal_revision",
    "safety_limit",
]

# All P1 tables are tenant tables
TENANT_TABLES = ALL_P1_TABLES


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_all_p1_tables_exist():
    """Every P1 table must be present in the public schema."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).fetchall()
    existing = {r.tablename for r in rows}
    missing = set(ALL_P1_TABLES) - existing
    assert not missing, f"Missing P1 tables: {missing}"


def test_p1_tenant_tables_have_rls_enabled():
    """All P1 tenant tables must have relrowsecurity = true."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT relname, relrowsecurity "
                "FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": TENANT_TABLES},
        ).fetchall()

    by_name = {r.relname: r.relrowsecurity for r in rows}
    for tbl in TENANT_TABLES:
        assert by_name.get(tbl) is True, (
            f"Table '{tbl}' does not have RLS enabled (relrowsecurity=False or missing)"
        )


def test_p1_tenant_tables_have_force_rls():
    """All P1 tenant tables must have relforcerowsecurity = true."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT relname, relforcerowsecurity "
                "FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": TENANT_TABLES},
        ).fetchall()

    by_name = {r.relname: r.relforcerowsecurity for r in rows}
    for tbl in TENANT_TABLES:
        assert by_name.get(tbl) is True, (
            f"Table '{tbl}' does not have FORCE RLS (relforcerowsecurity=False or missing)"
        )


def test_p1_tenant_isolation_policy_exists_on_all_tenant_tables():
    """The tenant_isolation policy must exist on every P1 tenant table."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT c.relname "
                "FROM pg_policy p "
                "JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = ANY(:tables) AND p.polname = 'tenant_isolation'"
            ),
            {"tables": TENANT_TABLES},
        ).fetchall()

    found = {r.relname for r in rows}
    missing = set(TENANT_TABLES) - found
    assert not missing, (
        f"tenant_isolation policy missing on P1 tables: {missing}"
    )


def test_omilo_app_has_crud_grants_on_p1_tables():
    """omilo_app must have SELECT, INSERT, UPDATE, DELETE on every P1 table."""
    required_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    with SessionLocal() as session:
        for tbl in ALL_P1_TABLES:
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
