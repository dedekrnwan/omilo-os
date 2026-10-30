"""TDD — Task 3: Balance, overage policy, per-helper budgets at the gate.

Tests (company-scoped session, real DB):

1. soft overage: Company balance 0, overage_policy="soft" → start_job STILL
   runs the job (status "done", not blocked).
2. hard overage: Company balance 0, overage_policy="hard" → start_job returns
   a blocked job (status "blocked", error "insufficient_credits"), the engine
   did NOT run (no Report), and an alert InboxItem exists.
3. helper budget: Helper budget_tokens_month=50k, jobs for this
   helper this month using ≥ 50k tokens → start_job → helper gets
   paused (status "paused"), job blocked ("helper_budget_exceeded").
4. paused helper: helper.status="paused" → start_job blocked ("helper_paused").
5. grant_credits: adds balance + positive ledger row.

RED → implement → GREEN.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from omilo.billing.balance import balance, grant_credits, recompute_balance
from omilo.db import SessionLocal, set_company
from omilo.loop.runner import start_job
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
from omilo.models.execution import Job, Report
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Ensure schema is current (including 0008_helper_budget_credits_month)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=_API_DIR,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _superuser_session():
    """Open a privileged (superuser) session — for global Company table writes."""
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
# Factories
# ---------------------------------------------------------------------------


def _make_company(
    db,
    *,
    credit_balance: int = 1000,
    overage_policy: str = "soft",
) -> Company:
    company = Company(
        id=prefixed_id("cmp"),
        name=f"BudgetCo-{overage_policy}-{credit_balance}",
        color="#aabbcc",
        autonomy_default="yolo",  # yolo so the fake engine doesn't block
        credit_balance=credit_balance,
        overage_policy=overage_policy,
    )
    db.add(company)
    db.flush()
    return company


def _make_helper(
    db,
    *,
    company_id: str,
    status: str = "active",
    budget_tokens_month: int | None = None,
) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="BudgetHelper",
        area="ops",
        is_chief=True,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status=status,
        channel_ids=[],
        budget_tokens_month=budget_tokens_month,
    )
    db.add(helper)
    db.flush()
    return helper


def _seed_token_job(db, *, company_id: str, helper_id: str, tokens: int) -> None:
    """A finished job this month that used *tokens* AI tokens."""
    from omilo.models.execution import Job

    db.add(Job(
        id=prefixed_id("job"), company_id=company_id, helper_id=helper_id, origin="chat",
        brief="earlier work", status="done", tokens_in=tokens, tokens_out=0, attempts=1, checkpoint={},
    ))
    db.flush()


def _seed_ledger_rows(
    db,
    *,
    company_id: str,
    helper_id: str,
    credits_charged: int,
) -> None:
    """Insert a CreditLedger row for the current month for the given helper."""
    entry = CreditLedger(
        id=prefixed_id("cl"),
        company_id=company_id,
        delta=-credits_charged,
        balance_after=0,
        reason="job",
        job_id=None,
        helper_id=helper_id,
        provider_cost_usd=0,
        credits_charged=credits_charged,
        meta={},
        at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.flush()


# ---------------------------------------------------------------------------
# Test 1: Soft overage — balance 0, overage_policy="soft" → job still runs
# ---------------------------------------------------------------------------


class TestSoftOverage:
    """Company balance=0, overage_policy='soft' → start_job runs the job."""

    def test_soft_overage_job_runs(self):
        # Create company (global table — superuser session)
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=0, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid)
            hid = helper.id

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Soft overage test",
            )

        assert job.status == "done", (
            f"Expected 'done' for soft overage but got {job.status!r} "
            f"(error={job.error!r})"
        )

        # A Report must exist (engine ran)
        with _tenant_session(cid) as db:
            report = db.query(Report).filter_by(job_id=job.id).first()
        assert report is not None, "Engine ran → Report should exist"


# ---------------------------------------------------------------------------
# Test 2: Hard overage — balance 0, overage_policy="hard" → job blocked + alert
# ---------------------------------------------------------------------------


class TestHardOverage:
    """Company balance=0, overage_policy='hard' → job blocked, alert InboxItem."""

    def test_hard_overage_job_blocked(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=0, overage_policy="hard"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid)
            hid = helper.id

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Hard overage test",
            )

        assert job.status in ("blocked", "failed"), (
            f"Expected blocked/failed for hard overage but got {job.status!r}"
        )
        assert job.error == "insufficient_credits", (
            f"Expected error='insufficient_credits' got {job.error!r}"
        )

    def test_hard_overage_no_report(self):
        """Engine must NOT have run — no Report for the blocked job."""
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=0, overage_policy="hard"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid)
            hid = helper.id

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Hard overage no-report test",
            )

        with _tenant_session(cid) as db:
            report = db.query(Report).filter_by(job_id=job.id).first()
        assert report is None, "Engine must NOT run for a hard-overage blocked job"

    def test_hard_overage_alert_inbox_item(self):
        """An alert InboxItem must be created for the hard-overage block."""
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=0, overage_policy="hard"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid)
            hid = helper.id

        with _tenant_session(cid) as db:
            start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Hard overage alert test",
            )

        with _tenant_session(cid) as db:
            alert = (
                db.query(InboxItem)
                .filter_by(company_id=cid, kind="alert")
                .first()
            )
        assert alert is not None, "An alert InboxItem must be created on hard overage"
        assert "credits" in alert.title.lower(), (
            f"Alert title should mention credits: {alert.title!r}"
        )


# ---------------------------------------------------------------------------
# Test 3: Helper budget exceeded → helper paused, job blocked
# ---------------------------------------------------------------------------


class TestHelperBudgetExceeded:
    """Helper budget_tokens_month=50k, tokens this month ≥ 50k → paused + job blocked."""

    def test_helper_paused_and_job_blocked(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=5000, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, budget_tokens_month=50_000)
            hid = helper.id
            # Jobs this month used 55k tokens (≥ 50k budget)
            _seed_token_job(db, company_id=cid, helper_id=hid, tokens=30_000)
            _seed_token_job(db, company_id=cid, helper_id=hid, tokens=25_000)

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Budget exceeded test",
            )

        assert job.status in ("blocked", "failed"), (
            f"Expected blocked job but got {job.status!r}"
        )
        assert job.error == "helper_budget_exceeded", (
            f"Expected 'helper_budget_exceeded' got {job.error!r}"
        )

        # Helper must be paused
        with _tenant_session(cid) as db:
            refreshed_helper = db.get(Helper, hid)
        assert refreshed_helper.status == "paused", (
            f"Helper must be paused after budget exceeded; got {refreshed_helper.status!r}"
        )

    def test_helper_budget_not_exceeded(self):
        """Helper budget_tokens_month=100k, 30k used → job allowed (status done)."""
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=5000, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, budget_tokens_month=100_000)
            hid = helper.id
            # Only 30k tokens used — under budget
            _seed_token_job(db, company_id=cid, helper_id=hid, tokens=30_000)

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Budget not exceeded test",
            )

        assert job.status == "done", (
            f"Expected 'done' when under budget but got {job.status!r}"
        )


# ---------------------------------------------------------------------------
# Test 4: Paused helper → start_job blocked
# ---------------------------------------------------------------------------


class TestPausedHelper:
    """Helper already paused → start_job returns blocked job."""

    def test_paused_helper_blocks_job(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=5000, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, status="paused")
            hid = helper.id

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Paused helper test",
            )

        assert job.status in ("blocked", "failed"), (
            f"Expected blocked job for paused helper but got {job.status!r}"
        )
        assert job.error == "helper_paused", (
            f"Expected 'helper_paused' got {job.error!r}"
        )


# ---------------------------------------------------------------------------
# Test 5: grant_credits
# ---------------------------------------------------------------------------


class TestGrantCredits:
    """grant_credits adds balance + a positive ledger row."""

    def test_grant_credits_increments_balance(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=100, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            company_obj = db.get(Company, cid)
            initial = balance(db, company_obj)
            entry = grant_credits(db, company_obj, 500)
            new_bal = balance(db, company_obj)

        assert new_bal == initial + 500, (
            f"Expected balance {initial + 500} after grant, got {new_bal}"
        )
        assert entry.delta == 500, f"Expected positive delta=500, got {entry.delta}"
        assert entry.credits_charged == 0
        assert entry.reason == "grant"

    def test_grant_credits_custom_reason(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=50, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            company_obj = db.get(Company, cid)
            entry = grant_credits(
                db, company_obj, 200, reason="subscription_grant"
            )

        assert entry.reason == "subscription_grant"
        assert entry.delta == 200

    def test_grant_credits_invalid_amount_raises(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=100, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            company_obj = db.get(Company, cid)
            with pytest.raises(ValueError, match="positive"):
                grant_credits(db, company_obj, 0)


# ---------------------------------------------------------------------------
# Test 6: recompute_balance reconciles from ledger
# ---------------------------------------------------------------------------


class TestRecomputeBalance:
    """recompute_balance() SUM(delta) and updates company.credit_balance."""

    def test_recompute_matches_ledger(self):
        with _superuser_session() as sdb:
            company = _make_company(
                sdb, credit_balance=0, overage_policy="soft"
            )
            cid = company.id

        with _tenant_session(cid) as db:
            company_obj = db.get(Company, cid)
            # Directly seed two ledger rows (positive)
            for amt in (300, 200):
                entry = CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=cid,
                    delta=amt,
                    balance_after=amt,
                    reason="grant",
                    job_id=None,
                    helper_id=None,
                    provider_cost_usd=0,
                    credits_charged=0,
                    meta={},
                    at=datetime.now(timezone.utc),
                )
                db.add(entry)
            db.flush()

            computed = recompute_balance(db, company_obj)

        assert computed == 500, f"Expected 500 from 300+200 ledger, got {computed}"
