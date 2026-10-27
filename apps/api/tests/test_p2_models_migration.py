"""
TDD — Task 1: P2 platform models + migration.

Runs `alembic upgrade head` against the live DB, then verifies:
  1. All 5 new P2 tables exist (routine, routine_run, flow, flow_run, tool_call).
  2. Every P2 tenant table has relforcerowsecurity = true.
  3. The `tenant_isolation` policy exists on every P2 tenant table.
  4. The `omilo_app` role has SELECT/INSERT/UPDATE/DELETE on every P2 table.
  5. Goal now has the 4 new additive columns (target, status, autonomy_override,
     owner_helper_id).

The fixture reuses the session-scoped `ensure_schema` from conftest.py, so
`alembic upgrade head` is already applied before this module runs.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal

# ── Constants ─────────────────────────────────────────────────────────────────

NEW_P2_TABLES = [
    "routine",
    "routine_run",
    "flow",
    "flow_run",
    "tool_call",
]

NEW_GOAL_COLUMNS = ["target", "status", "autonomy_override", "owner_helper_id"]


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_all_p2_tables_exist():
    """Every P2 table must be present in the public schema."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).fetchall()
    existing = {r.tablename for r in rows}
    missing = set(NEW_P2_TABLES) - existing
    assert not missing, f"Missing P2 tables: {missing}"


def test_p2_tenant_tables_have_force_rls():
    """All P2 tenant tables must have relforcerowsecurity = true."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT relname, relforcerowsecurity "
                "FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": NEW_P2_TABLES},
        ).fetchall()

    by_name = {r.relname: r.relforcerowsecurity for r in rows}
    for tbl in NEW_P2_TABLES:
        assert by_name.get(tbl) is True, (
            f"Table '{tbl}' does not have FORCE RLS (relforcerowsecurity=False or missing)"
        )


def test_p2_tenant_isolation_policy_exists():
    """The tenant_isolation policy must exist on every P2 tenant table."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT c.relname "
                "FROM pg_policy p "
                "JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = ANY(:tables) AND p.polname = 'tenant_isolation'"
            ),
            {"tables": NEW_P2_TABLES},
        ).fetchall()

    found = {r.relname for r in rows}
    missing = set(NEW_P2_TABLES) - found
    assert not missing, (
        f"tenant_isolation policy missing on P2 tables: {missing}"
    )


def test_omilo_app_has_crud_grants_on_p2_tables():
    """omilo_app must have SELECT, INSERT, UPDATE, DELETE on every P2 table."""
    required_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    with SessionLocal() as session:
        for tbl in NEW_P2_TABLES:
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


def test_goal_has_new_p2_columns():
    """Goal table must have the 4 new additive columns from P2."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT column_name "
                "FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'goal'"
            )
        ).fetchall()
    existing = {r.column_name for r in rows}
    missing = set(NEW_GOAL_COLUMNS) - existing
    assert not missing, f"Goal is missing P2 columns: {missing}"
