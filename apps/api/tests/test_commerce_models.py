"""TDD — P5a Task 1: Commerce models (DoitPayment, WalletSettings) + billing extensions.

Tests (company-scoped tenant sessions, real DB):

1. Create DoitPayment(kind="topup", amount_idr=50000, credits=5000,
   reference="INV/1", status="pending") and WalletSettings(auto_topup_enabled=True,
   auto_topup_threshold_credits=1000, auto_topup_pack="medium") in company A's
   tenant session; flush/commit; read back and assert fields.
2. Company B's tenant session sees NEITHER row (RLS isolation).
3. Uniqueness: two DoitPayment rows in company A with the SAME non-null
   provider_payment_id → IntegrityError.
4. Invoice and Subscription each have provider_ref column (additive from 0011).

RED → implement → GREEN.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.commerce import DoitPayment, WalletSettings
from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _superuser_session():
    """Open a privileged (superuser) session — bypasses RLS."""
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _S()


def _tenant_session(company_id: str):
    """Open a company-scoped session (mimics get_db / RLS enforced)."""
    class _T:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            self._sess.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(self._sess, company_id)
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type is not None:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _T()


# ---------------------------------------------------------------------------
# Fixtures: two companies seeded via superuser
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def company_a():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="Commerce Test Co A",
        color="#1a1a2e",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


@pytest.fixture(scope="module")
def company_b():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="Commerce Test Co B",
        color="#16213e",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


# ---------------------------------------------------------------------------
# Test 1: Persistence — DoitPayment + WalletSettings round-trip
# ---------------------------------------------------------------------------


def test_doit_payment_persists(company_a):
    """Create a DoitPayment in company A's tenant session; assert all fields read back."""
    pay_id = prefixed_id("pay")
    with _tenant_session(company_a) as sess:
        pay = DoitPayment(
            id=pay_id,
            company_id=company_a,
            kind="topup",
            amount_idr=50000,
            credits=5000,
            reference="INV/1",
            status="pending",
        )
        sess.add(pay)
        sess.flush()

    # Read back in a fresh tenant session
    with _tenant_session(company_a) as sess:
        result = sess.get(DoitPayment, pay_id)
        assert result is not None, "DoitPayment not found after commit"
        assert result.company_id == company_a
        assert result.kind == "topup"
        assert result.amount_idr == 50000
        assert result.credits == 5000
        assert result.reference == "INV/1"
        assert result.status == "pending"
        assert result.provider == "doit"
        assert result.granted is False
        assert result.rail is None
        assert result.hosted_url is None
        assert result.provider_payment_id is None
        assert result.plan_id is None
        assert result.raw is None
        assert result.created_at is not None
        assert result.updated_at is not None


def test_wallet_settings_persists(company_a):
    """Create WalletSettings in company A's tenant session; assert fields read back."""
    with _tenant_session(company_a) as sess:
        ws = WalletSettings(
            company_id=company_a,
            auto_topup_enabled=True,
            auto_topup_threshold_credits=1000,
            auto_topup_pack="medium",
        )
        sess.add(ws)
        sess.flush()

    with _tenant_session(company_a) as sess:
        result = sess.get(WalletSettings, company_a)
        assert result is not None, "WalletSettings not found after commit"
        assert result.company_id == company_a
        assert result.auto_topup_enabled is True
        assert result.auto_topup_threshold_credits == 1000
        assert result.auto_topup_pack == "medium"
        assert result.updated_at is not None


# ---------------------------------------------------------------------------
# Test 2: RLS isolation — company B sees nothing
# ---------------------------------------------------------------------------


def test_rls_isolation_company_b_sees_no_doit_payments(company_a, company_b):
    """Company B's tenant session must not see company A's DoitPayment rows."""
    with _tenant_session(company_b) as sess:
        rows = sess.execute(select(DoitPayment)).scalars().all()
    assert rows == [], (
        f"Company B should see zero DoitPayment rows, got: {rows}"
    )


def test_rls_isolation_company_b_sees_no_wallet_settings(company_a, company_b):
    """Company B's tenant session must not see company A's WalletSettings row."""
    with _tenant_session(company_b) as sess:
        rows = sess.execute(select(WalletSettings)).scalars().all()
    assert rows == [], (
        f"Company B should see zero WalletSettings rows, got: {rows}"
    )


# ---------------------------------------------------------------------------
# Test 3: Uniqueness — duplicate provider_payment_id within same company
# ---------------------------------------------------------------------------


def test_unique_provider_payment_id_within_company(company_a):
    """Two DoitPayments with the SAME non-null provider_payment_id in company A
    must raise IntegrityError."""
    ppid = "pay_test_unique_constraint_001"
    p1 = DoitPayment(
        id=prefixed_id("pay"),
        company_id=company_a,
        kind="topup",
        amount_idr=10000,
        credits=1000,
        reference="INV/U1",
        provider_payment_id=ppid,
    )
    p2 = DoitPayment(
        id=prefixed_id("pay"),
        company_id=company_a,
        kind="topup",
        amount_idr=10000,
        credits=1000,
        reference="INV/U2",
        provider_payment_id=ppid,
    )

    with pytest.raises(IntegrityError):
        with _tenant_session(company_a) as sess:
            sess.add(p1)
            sess.add(p2)
            sess.flush()


def test_multiple_null_provider_payment_ids_allowed(company_a):
    """Multiple DoitPayments with NULL provider_payment_id in the same company
    must NOT raise — Postgres treats NULLs as distinct in unique constraints."""
    p1 = DoitPayment(
        id=prefixed_id("pay"),
        company_id=company_a,
        kind="topup",
        amount_idr=20000,
        credits=2000,
        reference="INV/N1",
        provider_payment_id=None,
    )
    p2 = DoitPayment(
        id=prefixed_id("pay"),
        company_id=company_a,
        kind="topup",
        amount_idr=30000,
        credits=3000,
        reference="INV/N2",
        provider_payment_id=None,
    )
    with _tenant_session(company_a) as sess:
        sess.add(p1)
        sess.add(p2)
        sess.flush()  # must not raise


# ---------------------------------------------------------------------------
# Test 4: Invoice + Subscription have provider_ref column (additive from 0011)
# ---------------------------------------------------------------------------


def test_invoice_has_provider_ref_column():
    """Invoice table must have a provider_ref column (added in migration 0011)."""
    with SessionLocal() as sess:
        rows = sess.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'invoice' "
                "AND column_name = 'provider_ref'"
            )
        ).fetchall()
    assert rows, "invoice.provider_ref column is missing (migration 0011 not applied?)"


def test_subscription_has_provider_ref_column():
    """Subscription table must have a provider_ref column (added in migration 0011)."""
    with SessionLocal() as sess:
        rows = sess.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = 'subscription' "
                "AND column_name = 'provider_ref'"
            )
        ).fetchall()
    assert rows, "subscription.provider_ref column is missing (migration 0011 not applied?)"


# ---------------------------------------------------------------------------
# Test 5: New tables have RLS + grants (schema sanity)
# ---------------------------------------------------------------------------


def test_new_tables_have_force_rls():
    """doit_payment and wallet_settings must have FORCE RLS enabled."""
    with SessionLocal() as sess:
        rows = sess.execute(
            text(
                "SELECT relname, relforcerowsecurity FROM pg_class "
                "WHERE relname = ANY(:tables) AND relkind = 'r'"
            ),
            {"tables": ["doit_payment", "wallet_settings"]},
        ).fetchall()
    by_name = {r.relname: r.relforcerowsecurity for r in rows}
    for tbl in ["doit_payment", "wallet_settings"]:
        assert by_name.get(tbl) is True, (
            f"Table '{tbl}' does not have FORCE RLS "
            f"(relforcerowsecurity={by_name.get(tbl)!r})"
        )
