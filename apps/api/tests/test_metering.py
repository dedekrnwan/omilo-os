"""TDD: Task 2 — Credit metering (meter_job, idempotent, margin).

Tests (company-scoped session, real DB):

1. litellm-engine job with known tokens → CreditLedger row with
   credits_charged == ceil(cost*1.4*100); Company.credit_balance decremented
   by that amount; delta == -credits_charged.
2. Idempotency: meter_job on the SAME job a second time → returns existing row,
   count still == 1, balance unchanged.
3. fake-engine (pool/BYO) job → CreditLedger row with credits_charged == 0,
   balance unchanged.
4. Company-scoped isolation: ledger rows for company A are invisible to company B.

RED → implement → GREEN.
"""
from __future__ import annotations

import math
from decimal import Decimal

import pytest
from sqlalchemy import text

from omilo.billing.meter import (
    CREDITS_PER_USD,
    MARGIN,
    PRICE_TABLE,
    meter_job,
    provider_cost_usd,
)
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.agents import Helper
from omilo.models.billing import CreditLedger
from omilo.models.execution import Job
from omilo.models.tenancy import Company


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _superuser_session():
    """Open a privileged (superuser) session — for global tables."""
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
    """Open a company-scoped session (mimics get_db)."""
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
# Fixtures / factories
# ---------------------------------------------------------------------------


def _make_company(db, *, credit_balance: int = 1000) -> Company:
    company = Company(
        id=prefixed_id("cmp"),
        name=f"MeterCo-{credit_balance}",
        color="#aabbcc",
        autonomy_default="ask",
        credit_balance=credit_balance,
    )
    db.add(company)
    db.flush()
    return company


def _make_helper(db, *, company_id: str) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="MeterHelper",
        area="ops",
        is_chief=True,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


def _make_job(
    db,
    *,
    company_id: str,
    helper_id: str,
    engine_type: str = "fake",
    model: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
) -> Job:
    job = Job(
        id=prefixed_id("job"),
        company_id=company_id,
        helper_id=helper_id,
        origin="chat",
        brief="test metering",
        status="done",
        engine_type=engine_type,
        cost_credits=0,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        attempts=1,
        checkpoint={},
    )
    # Store model on the object (not a DB column, used by meter_job via getattr)
    job.model = model  # type: ignore[attr-defined]
    db.add(job)
    db.flush()
    return job


# ---------------------------------------------------------------------------
# Test 1: litellm cloud path → credits charged, balance decremented
# ---------------------------------------------------------------------------


class TestLitellmCloudPath:
    """meter_job on a litellm job → credits charged, balance decremented."""

    # Use a known PRICE_TABLE entry for exact math.
    ENGINE = "litellm"
    MODEL = "anthropic/claude-sonnet-4-6"
    TOKENS_IN = 1000
    TOKENS_OUT = 500

    def _expected_credits(self) -> int:
        cost = provider_cost_usd(self.ENGINE, self.MODEL, self.TOKENS_IN, self.TOKENS_OUT)
        return int(math.ceil(cost * MARGIN * CREDITS_PER_USD))

    def test_ledger_row_created(self):
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            entry = meter_job(db, job)
            assert entry is not None, "meter_job should return a CreditLedger row"
            assert isinstance(entry, CreditLedger)

    def test_credits_charged_exact(self):
        """credits_charged == ceil(provider_cost * 1.4 * 100)."""
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            entry = meter_job(db, job)
            expected = self._expected_credits()

            # Verify the math against the price table directly.
            # in_per_1k=0.003, out_per_1k=0.015
            # cost = (1000/1000)*0.003 + (500/1000)*0.015 = 0.003 + 0.0075 = 0.0105
            # credits = ceil(0.0105 * 1.4 * 100) = ceil(1.47) = 2
            assert entry.credits_charged == expected, (
                f"Expected credits_charged={expected}, got {entry.credits_charged}"
            )
            assert entry.credits_charged == 2, (
                "Exact value for (1000 in, 500 out) on claude-sonnet-4-6 must be 2"
            )

    def test_delta_is_negative_credits(self):
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            entry = meter_job(db, job)
            expected = self._expected_credits()
            assert entry.delta == -expected, (
                f"delta must be -{expected}, got {entry.delta}"
            )

    def test_balance_decremented(self):
        initial_balance = 1000
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=initial_balance)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            entry = meter_job(db, job)
            expected = self._expected_credits()
            expected_balance = initial_balance - expected

            # Reload company to check persisted balance
            from omilo.models.tenancy import Company as CompanyModel
            db.expire_all()
            company_after = db.get(CompanyModel, company_id)
            assert company_after.credit_balance == expected_balance, (
                f"Expected balance {expected_balance}, "
                f"got {company_after.credit_balance}"
            )
            assert entry.balance_after == expected_balance

    def test_reason_is_job(self):
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            entry = meter_job(db, job)
            assert entry.reason == "job"
            assert entry.job_id == job.id
            assert entry.helper_id == job.helper_id


# ---------------------------------------------------------------------------
# Test 2: Idempotency
# ---------------------------------------------------------------------------


class TestIdempotency:
    """Calling meter_job twice on the same job must not double-charge."""

    ENGINE = "litellm"
    MODEL = "anthropic/claude-sonnet-4-6"
    TOKENS_IN = 1000
    TOKENS_OUT = 500

    def test_second_call_returns_existing_row(self):
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            first = meter_job(db, job)
            second = meter_job(db, job)

            assert first is not None
            assert second is not None
            assert first.id == second.id, "Second call must return the existing row"

    def test_count_is_one(self):
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=1000)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            meter_job(db, job)
            meter_job(db, job)

            count = (
                db.query(CreditLedger)
                .filter_by(company_id=company_id, job_id=job.id, reason="job")
                .count()
            )
            assert count == 1, f"Expected exactly 1 ledger row, got {count}"

    def test_balance_unchanged_on_second_call(self):
        initial_balance = 1000
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=initial_balance)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=self.TOKENS_IN,
                tokens_out=self.TOKENS_OUT,
            )
            first = meter_job(db, job)
            balance_after_first = first.balance_after

            # Reload to confirm DB state, then call again
            db.expire_all()
            second = meter_job(db, job)

            assert second.balance_after == balance_after_first, (
                "Balance must not change on the second call"
            )

            from omilo.models.tenancy import Company as CompanyModel
            db.expire_all()
            company_db = db.get(CompanyModel, company_id)
            assert company_db.credit_balance == balance_after_first


# ---------------------------------------------------------------------------
# Test 3: Pool / BYO (fake engine) → credits_charged == 0, balance unchanged
# ---------------------------------------------------------------------------


class TestPoolBYOPath:
    """fake/anthropic/claude_code engine jobs → no credits charged."""

    def _run_pool_test(self, engine_type: str):
        initial_balance = 500
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=initial_balance)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type=engine_type,
                tokens_in=2000,
                tokens_out=800,
            )
            entry = meter_job(db, job)

            assert entry is not None
            assert entry.credits_charged == 0, (
                f"Pool engine {engine_type!r} must have credits_charged==0, "
                f"got {entry.credits_charged}"
            )
            assert entry.delta == 0, f"delta must be 0 for pool engine, got {entry.delta}"

            # Balance must be unchanged
            from omilo.models.tenancy import Company as CompanyModel
            db.expire_all()
            company_db = db.get(CompanyModel, company_id)
            assert company_db.credit_balance == initial_balance, (
                f"Balance must remain {initial_balance} for pool engine, "
                f"got {company_db.credit_balance}"
            )
            return entry

    def test_fake_engine_zero_credits(self):
        self._run_pool_test("fake")

    def test_claude_code_engine_zero_credits(self):
        self._run_pool_test("claude_code")

    def test_anthropic_engine_zero_credits(self):
        self._run_pool_test("anthropic")

    def test_fake_ledger_row_still_created(self):
        """Analytics: a ledger row is always created, even for 0-credit jobs."""
        initial_balance = 500
        with _superuser_session() as su:
            company = _make_company(su, credit_balance=initial_balance)
            company_id = company.id

        with _tenant_session(company_id) as db:
            helper = _make_helper(db, company_id=company_id)
            job = _make_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                engine_type="fake",
                tokens_in=2000,
                tokens_out=800,
            )
            entry = meter_job(db, job)

            assert entry is not None
            assert entry.reason == "job"
            assert entry.credits_charged == 0
            # provider_cost_usd is recorded for analytics even at 0 credits
            assert entry.provider_cost_usd >= 0


# ---------------------------------------------------------------------------
# Test 4: Company-scoped isolation
# ---------------------------------------------------------------------------


class TestCompanyIsolation:
    """Ledger rows for company A are invisible to company B."""

    ENGINE = "litellm"
    MODEL = "anthropic/claude-sonnet-4-6"

    def test_company_b_cannot_see_company_a_ledger(self):
        with _superuser_session() as su:
            company_a = _make_company(su, credit_balance=1000)
            company_b = _make_company(su, credit_balance=1000)
            cid_a = company_a.id
            cid_b = company_b.id

        # Meter a job for company A
        with _tenant_session(cid_a) as db_a:
            helper_a = _make_helper(db_a, company_id=cid_a)
            job_a = _make_job(
                db_a,
                company_id=cid_a,
                helper_id=helper_a.id,
                engine_type=self.ENGINE,
                model=self.MODEL,
                tokens_in=1000,
                tokens_out=500,
            )
            meter_job(db_a, job_a)

        # Company B's session must not see A's ledger row (RLS)
        with _tenant_session(cid_b) as db_b:
            count_a_in_b = (
                db_b.query(CreditLedger)
                .filter_by(company_id=cid_a)
                .count()
            )
            assert count_a_in_b == 0, (
                f"Company B should see 0 of Company A's ledger rows, "
                f"got {count_a_in_b}"
            )

        # Company A's session sees exactly 1
        with _tenant_session(cid_a) as db_a2:
            count = db_a2.query(CreditLedger).filter_by(company_id=cid_a).count()
            assert count == 1, f"Company A should have 1 ledger row, got {count}"


# ---------------------------------------------------------------------------
# Test 5: provider_cost_usd unit tests
# ---------------------------------------------------------------------------


class TestProviderCostUsd:
    """Unit-test the cost formula independent of the DB."""

    def test_known_price_table_entry(self):
        """Verify math for claude-sonnet-4-6 (in_per_1k=0.003, out_per_1k=0.015)."""
        cost = provider_cost_usd(
            "litellm", "anthropic/claude-sonnet-4-6", 1000, 500
        )
        # (1000/1000)*0.003 + (500/1000)*0.015 = 0.003 + 0.0075 = 0.0105
        assert cost == Decimal("0.0105"), f"Expected 0.0105, got {cost}"

    def test_fallback_price(self):
        """Unknown engine/model falls back to ('*','*') defaults."""
        cost = provider_cost_usd("unknown_engine", "some/model", 1000, 1000)
        # (1000/1000)*0.001 + (1000/1000)*0.005 = 0.001 + 0.005 = 0.006
        assert cost == Decimal("0.006"), f"Expected 0.006 fallback, got {cost}"

    def test_zero_tokens(self):
        cost = provider_cost_usd("litellm", "anthropic/claude-sonnet-4-6", 0, 0)
        assert cost == Decimal("0")

    def test_credits_math(self):
        """Cross-check the full credits formula end-to-end."""
        cost = provider_cost_usd("litellm", "anthropic/claude-sonnet-4-6", 1000, 500)
        credits = int(math.ceil(cost * MARGIN * CREDITS_PER_USD))
        # ceil(0.0105 * 1.4 * 100) = ceil(1.47) = 2
        assert credits == 2
