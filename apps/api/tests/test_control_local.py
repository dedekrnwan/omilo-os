"""TDD: P6 Task 1 — ControlPlane port + LocalControlPlane.

Tests:
1. LocalControlPlane.verify_token(valid_jwt) → Identity with correct user_id/company_id/role
2. verify_token(invalid/expired) → raises (jwt.PyJWTError)
3. check_balance(company) returns the same value as billing.balance.balance(db, company)
4. report_usage(UsageEvent) debits the ledger idempotently:
   - first call moves the balance
   - second call with same (company_id, job_id) does NOT move the balance again
5. get_entitlements(company_id) → included_credits matches the company's Plan
6. get_control_plane() in default (cloud) mode → isinstance LocalControlPlane
"""
from __future__ import annotations

import math
from decimal import Decimal

import pytest
from jwt.exceptions import PyJWTError
from sqlalchemy import text

from omilo.auth.tokens import make_access_token
from omilo.billing.balance import balance as billing_balance
from omilo.billing.meter import CREDITS_PER_USD, MARGIN, PRICE_TABLE, provider_cost_usd
from omilo.control import UsageEvent
from omilo.control.factory import get_control_plane
from omilo.control.local import LocalControlPlane
from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger, Plan
from omilo.models.execution import Job
from omilo.models.tenancy import Company, User


# ---------------------------------------------------------------------------
# Session helpers (mirrored from test_metering.py)
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


def _make_plan(db, *, included_credits: int = 500) -> Plan:
    plan = Plan(
        id=prefixed_id("pln"),
        tier="starter",
        name=f"TestPlan-{included_credits}",
        monthly_price_usd=Decimal("0"),
        monthly_price_idr=0,
        included_credits=included_credits,
        credit_overage_usd=Decimal("0"),
        seats=1,
        features={},
    )
    db.add(plan)
    db.flush()
    return plan


def _make_company(db, *, credit_balance: int = 1000, plan_id: str | None = None) -> Company:
    company = Company(
        id=prefixed_id("cmp"),
        name="CtrlPlaneCo",
        color="#112233",
        autonomy_default="ask",
        credit_balance=credit_balance,
        overage_policy="soft",
        edition="cloud",
        plan_id=plan_id,
    )
    db.add(company)
    db.flush()
    return company


def _make_user(db) -> User:
    user = User(
        id=prefixed_id("usr"),
        email=f"ctrl_{prefixed_id('x')}@test.example",
        name="Control Test User",
        password_hash=None,
    )
    db.add(user)
    db.flush()
    return user


def _make_helper(db, *, company_id: str) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="CtrlHelper",
        area="ops",
        is_chief=True,
        engine={"type": "litellm"},
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
    engine_type: str = "litellm",
    model: str = "anthropic/claude-sonnet-4-6",
    tokens_in: int = 1000,
    tokens_out: int = 500,
) -> Job:
    job = Job(
        id=prefixed_id("job"),
        company_id=company_id,
        helper_id=helper_id,
        origin="chat",
        brief="test control plane",
        status="done",
        engine_type=engine_type,
        cost_credits=0,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        attempts=1,
        checkpoint={},
    )
    job.model = model  # type: ignore[attr-defined]
    db.add(job)
    db.flush()
    return job


# ---------------------------------------------------------------------------
# Test 1: verify_token with a valid JWT → Identity
# ---------------------------------------------------------------------------


class TestVerifyToken:
    """LocalControlPlane.verify_token with valid and invalid JWTs."""

    def test_valid_jwt_returns_identity(self):
        """verify_token returns Identity with correct user_id/company_id/role."""
        user_id = prefixed_id("usr")
        company_id = prefixed_id("cmp")
        role = "owner"

        token, _ = make_access_token(user_id, company_id, role)

        cp = LocalControlPlane()
        identity = cp.verify_token(token)

        assert identity.user_id == user_id
        assert identity.company_id == company_id
        assert identity.role == role

    def test_invalid_jwt_raises(self):
        """verify_token raises on an invalid token."""
        cp = LocalControlPlane()
        with pytest.raises(PyJWTError):
            cp.verify_token("not.a.valid.jwt")

    def test_expired_jwt_raises(self):
        """verify_token raises on an expired JWT."""
        import jwt as pyjwt
        from datetime import datetime, timedelta, timezone

        from omilo.config import get_settings

        settings = get_settings()
        expired_payload = {
            "sub": prefixed_id("usr"),
            "cmp": prefixed_id("cmp"),
            "role": "member",
            "exp": datetime.now(tz=timezone.utc) - timedelta(seconds=3600),
        }
        expired_token = pyjwt.encode(expired_payload, settings.jwt_secret, algorithm="HS256")

        cp = LocalControlPlane()
        with pytest.raises(PyJWTError):
            cp.verify_token(expired_token)


# ---------------------------------------------------------------------------
# Test 2: check_balance matches billing.balance.balance
# ---------------------------------------------------------------------------


class TestCheckBalance:
    """LocalControlPlane.check_balance matches billing.balance.balance."""

    def test_check_balance_matches_billing_balance(self):
        """check_balance returns the same int as billing.balance.balance(db, company)."""
        initial_balance = 750

        with _superuser_session() as su:
            company = _make_company(su, credit_balance=initial_balance)
            company_id = company.id

        with _tenant_session(company_id) as db:
            company = db.get(Company, company_id)
            direct_balance = billing_balance(db, company)

        cp = LocalControlPlane()
        with _superuser_session() as su:
            company = su.get(Company, company_id)
            state = cp.check_balance(company_id, db=su)

        assert state.balance == direct_balance
        assert state.balance == initial_balance
        assert state.overage_policy == "soft"


# ---------------------------------------------------------------------------
# Test 3: report_usage — debits ledger; idempotent on same (company_id, job_id)
# ---------------------------------------------------------------------------


class TestReportUsage:
    """report_usage debits the ledger; second call for same job_id is a no-op."""

    ENGINE = "litellm"
    MODEL = "anthropic/claude-sonnet-4-6"
    TOKENS_IN = 1000
    TOKENS_OUT = 500

    def _expected_credits(self) -> int:
        cost = provider_cost_usd(self.ENGINE, self.MODEL, self.TOKENS_IN, self.TOKENS_OUT)
        return int(math.ceil(cost * MARGIN * CREDITS_PER_USD))

    def test_report_usage_debits_ledger(self):
        """First call to report_usage debits the balance by the correct credits."""
        initial_balance = 2000

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
            job_id = job.id

        expected_credits = self._expected_credits()

        cp = LocalControlPlane()
        ev = UsageEvent(
            company_id=company_id,
            job_id=job_id,
            engine_type=self.ENGINE,
            model=self.MODEL,
            tokens_in=self.TOKENS_IN,
            tokens_out=self.TOKENS_OUT,
            credits=expected_credits,
        )

        with _superuser_session() as su:
            result = cp.report_usage(ev, db=su)

        assert result.accepted is True
        assert result.new_balance == initial_balance - expected_credits

    def test_report_usage_idempotent(self):
        """Second call for the same (company_id, job_id) does NOT double-debit."""
        initial_balance = 2000

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
            job_id = job.id

        expected_credits = self._expected_credits()

        cp = LocalControlPlane()
        ev = UsageEvent(
            company_id=company_id,
            job_id=job_id,
            engine_type=self.ENGINE,
            model=self.MODEL,
            tokens_in=self.TOKENS_IN,
            tokens_out=self.TOKENS_OUT,
            credits=expected_credits,
        )

        # First call
        with _superuser_session() as su:
            result1 = cp.report_usage(ev, db=su)

        # Second call — same event
        with _superuser_session() as su:
            result2 = cp.report_usage(ev, db=su)

        # Balance should have moved only once
        with _superuser_session() as su:
            final_company = su.get(Company, company_id)
            final_balance = int(final_company.credit_balance)

        assert result1.new_balance == initial_balance - expected_credits
        assert result2.new_balance == initial_balance - expected_credits  # same result (idempotent)
        assert final_balance == initial_balance - expected_credits  # moved only once

        # Confirm exactly one ledger row for this job
        with _superuser_session() as su:
            ledger_count = (
                su.query(CreditLedger)
                .filter_by(company_id=company_id, job_id=job_id, reason="job")
                .count()
            )
        assert ledger_count == 1


# ---------------------------------------------------------------------------
# Test 4: get_entitlements → included_credits from Plan
# ---------------------------------------------------------------------------


class TestGetEntitlements:
    """get_entitlements returns Entitlements with Plan.included_credits."""

    def test_entitlements_match_plan(self):
        """get_entitlements returns included_credits from the company's Plan."""
        plan_credits = 750

        with _superuser_session() as su:
            plan = _make_plan(su, included_credits=plan_credits)
            company = _make_company(su, plan_id=plan.id)
            company_id = company.id

        cp = LocalControlPlane()
        with _superuser_session() as su:
            ents = cp.get_entitlements(company_id, db=su)

        assert ents.included_credits == plan_credits
        assert ents.plan_id == plan.id
        assert ents.edition == "cloud"
        assert ents.overage_policy == "soft"

    def test_entitlements_no_plan(self):
        """get_entitlements with no plan_id → included_credits is 0."""
        with _superuser_session() as su:
            company = _make_company(su, plan_id=None)
            company_id = company.id

        cp = LocalControlPlane()
        with _superuser_session() as su:
            ents = cp.get_entitlements(company_id, db=su)

        assert ents.included_credits == 0
        assert ents.plan_id is None


# ---------------------------------------------------------------------------
# Test 5: get_control_plane() → LocalControlPlane in default (cloud) mode
# ---------------------------------------------------------------------------


class TestFactory:
    """get_control_plane() returns LocalControlPlane in default cloud mode."""

    def test_default_mode_is_local(self):
        """In cloud mode (default), get_control_plane() returns LocalControlPlane."""
        cp = get_control_plane()
        assert isinstance(cp, LocalControlPlane)
