"""
TDD — Task 3: Core P0 models + initial migration with RLS policies.

Runs `alembic upgrade head` against the live DB, then verifies:
  1. All 9 P0 tables exist.
  2. Tenant tables have both relrowsecurity AND relforcerowsecurity = true.
  3. The `tenant_isolation` policy exists on `channel` (spot-check).
  4. The `omilo_app` role exists and is NOT a superuser.
  5. Global tables (company, user) have no RLS enabled.

Cleanup: `alembic downgrade base` at the end, so the test is idempotent.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal
from tests.utils import run_alembic

# ── Constants ─────────────────────────────────────────────────────────────────

ALL_P0_TABLES = [
    "company",
    "user",
    "member",
    "channel",
    "folder",
    "goal",
    "session",
    "message",
    "inbox_item",
]

TENANT_TABLES = [
    "member",
    "channel",
    "folder",
    "goal",
    "session",
    "message",
    "inbox_item",
]

GLOBAL_TABLES = ["company", "user"]


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def migrated_db():
    """Upgrade to head, yield, then downgrade back to base, then re-upgrade.

    The re-upgrade in teardown is the test-ordering root-cause fix: without it,
    running this module before any other module leaves the DB with no tables,
    breaking every subsequent module.  Re-upgrading here guarantees the schema
    is always left at head, regardless of module order.
    """
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield result.stdout + result.stderr
    # Downgrade (proves migrations are reversible — the actual test assertion).
    run_alembic("downgrade", "base")
    # Re-upgrade so later modules find a clean schema (ordering fix).
    restore = run_alembic("upgrade", "head")
    assert restore.returncode == 0, (
        f"alembic upgrade head (restore) failed:\n{restore.stdout}\n{restore.stderr}"
    )


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_all_p0_tables_exist(migrated_db):
    """Every P0 table must be present in the public schema."""
    with SessionLocal() as session:
        rows = session.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).fetchall()
    existing = {r.tablename for r in rows}
    missing = set(ALL_P0_TABLES) - existing
    assert not missing, f"Missing tables: {missing}"


def test_tenant_tables_have_rls_enabled(migrated_db):
    """All tenant tables must have relrowsecurity = true."""
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


def test_tenant_tables_have_force_rls(migrated_db):
    """All tenant tables must have relforcerowsecurity = true."""
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


def test_tenant_isolation_policy_exists_on_channel(migrated_db):
    """The tenant_isolation policy must exist on the channel table (spot-check)."""
    with SessionLocal() as session:
        row = session.execute(
            text(
                "SELECT polname FROM pg_policy p "
                "JOIN pg_class c ON c.oid = p.polrelid "
                "WHERE c.relname = 'channel' AND p.polname = 'tenant_isolation'"
            )
        ).fetchone()
    assert row is not None, "Policy 'tenant_isolation' not found on table 'channel'"


def test_tenant_isolation_policy_exists_on_all_tenant_tables(migrated_db):
    """The tenant_isolation policy must exist on every tenant table."""
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
        f"tenant_isolation policy missing on: {missing}"
    )


def test_omilo_app_role_exists_and_is_not_superuser(migrated_db):
    """The omilo_app role must exist and must NOT be a superuser."""
    with SessionLocal() as session:
        row = session.execute(
            text(
                "SELECT rolname, rolsuper "
                "FROM pg_roles WHERE rolname = 'omilo_app'"
            )
        ).fetchone()
    assert row is not None, "Role 'omilo_app' does not exist"
    assert row.rolsuper is False, (
        "Role 'omilo_app' must NOT be a superuser"
    )


def test_global_tables_have_no_rls(migrated_db):
    """Global tables (company, user) must NOT have RLS enabled."""
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
            f"Global table '{tbl}' should NOT have RLS enabled, but relrowsecurity=True"
        )
