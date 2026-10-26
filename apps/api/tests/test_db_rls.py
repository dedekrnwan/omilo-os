"""
TDD: RLS SET LOCAL mechanism — proves tenant isolation before real schema exists.

A throwaway table `rls_probe` is created, RLS-enabled with a tenant_isolation
policy, and torn down after each test module run.  The real schema arrives in
Task 3; this test proves the mechanism only.

RLS enforcement note
--------------------
The `omilo` DB user is a Postgres superuser, and superusers bypass RLS
unconditionally — even FORCE ROW LEVEL SECURITY does not apply to them.
To prove real enforcement we:
  1. Create a non-superuser role `omilo_rls_test` (idempotent).
  2. Grant it SELECT/INSERT on rls_probe.
  3. Inside each test transaction, issue ``SET LOCAL ROLE omilo_rls_test``
     before querying.  The connection reverts to superuser at COMMIT/ROLLBACK.
"""
import pytest
from sqlalchemy import text

from omilo.db import SessionLocal, set_company

# ---------------------------------------------------------------------------
# Name of the unprivileged role used to prove RLS enforcement
# ---------------------------------------------------------------------------
TEST_ROLE = "omilo_rls_test"


# ---------------------------------------------------------------------------
# Fixture: tiny RLS-enabled throwaway table
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def rls_table():
    """Create rls_probe (with FORCE RLS + policy), insert rows, yield, then drop."""
    with SessionLocal() as session:
        # Ensure the non-superuser test role exists (idempotent)
        session.execute(text(f"""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{TEST_ROLE}') THEN
                    CREATE ROLE {TEST_ROLE} LOGIN PASSWORD '{TEST_ROLE}';
                END IF;
            END $$
        """))

        session.execute(text("DROP TABLE IF EXISTS rls_probe"))
        session.execute(text("""
            CREATE TABLE rls_probe (
                id         serial PRIMARY KEY,
                company_id text NOT NULL,
                val        text NOT NULL
            )
        """))
        # Enable RLS — prevents owner from bypassing via ownership exemption.
        # FORCE RLS is the belt-and-suspenders for table owners; for superusers
        # we additionally SET LOCAL ROLE to the unprivileged role in each test.
        session.execute(text("ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY"))
        session.execute(text("ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY"))
        session.execute(text(f"""
            CREATE POLICY tenant_isolation ON rls_probe
                USING (company_id = current_setting('app.company_id', true))
        """))
        # Grant the test role read access
        session.execute(text(f"GRANT SELECT ON rls_probe TO {TEST_ROLE}"))

        # Seed rows for two tenants
        session.execute(text(
            "INSERT INTO rls_probe (company_id, val) VALUES ('cmp_a', 'alpha')"
        ))
        session.execute(text(
            "INSERT INTO rls_probe (company_id, val) VALUES ('cmp_b', 'beta')"
        ))
        session.commit()

    yield

    with SessionLocal() as session:
        session.execute(text("DROP TABLE IF EXISTS rls_probe"))
        session.commit()
    # Leave the role in place (idempotent; it has no objects after table drop)


# ---------------------------------------------------------------------------
# Helper: drop to unprivileged role so RLS is not bypassed by superuser
# ---------------------------------------------------------------------------

def _set_test_role(session) -> None:
    """Switch to the non-superuser role so RLS is enforced."""
    session.execute(text(f"SET LOCAL ROLE {TEST_ROLE}"))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_rls_scoped_session_sees_only_own_rows(rls_table):
    """A session with set_company('cmp_a') must only see cmp_a rows."""
    with SessionLocal() as session:
        with session.begin():
            _set_test_role(session)          # enforce RLS (non-superuser)
            set_company(session, "cmp_a")   # SET LOCAL app.company_id
            rows = session.execute(
                text("SELECT company_id, val FROM rls_probe ORDER BY id")
            ).fetchall()

    assert len(rows) == 1, f"Expected 1 row for cmp_a, got {len(rows)}: {rows}"
    assert rows[0].company_id == "cmp_a"
    assert rows[0].val == "alpha"


def test_rls_unscoped_session_sees_no_rows(rls_table):
    """A session with NO company set must see zero rows (missing_ok → NULL → no match)."""
    with SessionLocal() as session:
        with session.begin():
            _set_test_role(session)          # enforce RLS (non-superuser)
            # Deliberately do NOT call set_company — GUC is unset → NULL → policy fails
            rows = session.execute(
                text("SELECT company_id, val FROM rls_probe")
            ).fetchall()

    assert len(rows) == 0, f"Expected 0 rows (unscoped), got {len(rows)}: {rows}"


def test_rls_cmp_b_sees_only_own_rows(rls_table):
    """Symmetry check: cmp_b session sees only its own row."""
    with SessionLocal() as session:
        with session.begin():
            _set_test_role(session)          # enforce RLS (non-superuser)
            set_company(session, "cmp_b")   # SET LOCAL app.company_id
            rows = session.execute(
                text("SELECT company_id, val FROM rls_probe ORDER BY id")
            ).fetchall()

    assert len(rows) == 1, f"Expected 1 row for cmp_b, got {len(rows)}: {rows}"
    assert rows[0].company_id == "cmp_b"
    assert rows[0].val == "beta"
