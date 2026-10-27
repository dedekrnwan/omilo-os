"""
TDD — Task 1: P4 billing/engine-pool/connector models + migration.

Runs `alembic upgrade head` against the live DB, then verifies:
  1. Plan and Piece exist and are GLOBAL (relrowsecurity=false, no RLS policy,
     omilo_app has CRUD grants).
  2. The 6 tenant tables (credit_ledger, subscription, invoice, harness_account,
     provider_key, connector) have FORCE RLS + tenant_isolation policy + grants.
  3. Company has the 4 new additive columns: plan_id, credit_balance, edition,
     overage_policy.
  4. 3 Plan rows are seeded (free, growth, scale).

The fixture reuses the session-scoped `ensure_schema` from conftest.py, so
`alembic upgrade head` is already applied before this module runs.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal

# ── Constants ─────────────────────────────────────────────────────────────────

GLOBAL_TABLES = ["plan", "piece"]

TENANT_TABLES = [
    "credit_ledger",
    "subscription",
    "invoice",
    "harness_account",
    "provider_key",
    "connector",
]

ALL_P4_TABLES = GLOBAL_TABLES + TENANT_TABLES

NEW_COMPANY_COLUMNS = ["plan_id", "credit_balance", "edition", "overage_policy"]

PLAN_TIERS = {"free", "growth", "scale"}


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_all_p4_tables_exist():
    """Every P4 table must be present in the public schema."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).fetchall()
    existing = {r.tablename for r in rows}
    missing = set(ALL_P4_TABLES) - existing
    assert not missing, f"Missing P4 tables: {missing}"


def test_global_tables_have_no_rls():
    """Plan and Piece must be global: relrowsecurity must be false."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT relname, relrowsecurity "
                "FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": GLOBAL_TABLES},
        ).fetchall()

    by_name = {r.relname: r.relrowsecurity for r in rows}
    for tbl in GLOBAL_TABLES:
        assert by_name.get(tbl) is False, (
            f"Global table '{tbl}' unexpectedly has RLS enabled "
            f"(relrowsecurity={by_name.get(tbl)!r})"
        )


def test_global_tables_have_no_tenant_isolation_policy():
    """Plan and Piece must NOT have a tenant_isolation policy."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT c.relname "
                "FROM pg_policy p "
                "JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = ANY(:tables) AND p.polname = 'tenant_isolation'"
            ),
            {"tables": GLOBAL_TABLES},
        ).fetchall()

    found = {r.relname for r in rows}
    assert not found, (
        f"Global tables unexpectedly have tenant_isolation policy: {found}"
    )


def test_omilo_app_has_crud_grants_on_global_tables():
    """omilo_app must have SELECT, INSERT, UPDATE, DELETE on Plan and Piece."""
    required_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    with SessionLocal() as session:
        for tbl in GLOBAL_TABLES:
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
                f"omilo_app is missing {missing} on global table '{tbl}'. "
                f"Granted: {granted}"
            )


def test_tenant_tables_have_force_rls():
    """All 6 P4 tenant tables must have relforcerowsecurity = true."""
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
            f"Table '{tbl}' does not have FORCE RLS "
            f"(relforcerowsecurity={by_name.get(tbl)!r})"
        )


def test_tenant_isolation_policy_exists():
    """The tenant_isolation policy must exist on every P4 tenant table."""
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
        f"tenant_isolation policy missing on P4 tenant tables: {missing}"
    )


def test_omilo_app_has_crud_grants_on_tenant_tables():
    """omilo_app must have SELECT, INSERT, UPDATE, DELETE on every P4 tenant table."""
    required_privileges = {"SELECT", "INSERT", "UPDATE", "DELETE"}

    with SessionLocal() as session:
        for tbl in TENANT_TABLES:
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


def test_company_has_new_p4_columns():
    """Company table must have the 4 new additive columns from P4."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT column_name "
                "FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'company'"
            )
        ).fetchall()
    existing = {r.column_name for r in rows}
    missing = set(NEW_COMPANY_COLUMNS) - existing
    assert not missing, f"Company is missing P4 columns: {missing}"


def test_three_plans_seeded():
    """Three Plan rows (free, growth, scale) must be seeded."""
    with SessionLocal() as session:
        rows = session.execute(
            text("SELECT tier FROM plan")
        ).fetchall()
    seeded_tiers = {r.tier for r in rows}
    missing = PLAN_TIERS - seeded_tiers
    assert not missing, f"Missing seeded plan tiers: {missing}"
