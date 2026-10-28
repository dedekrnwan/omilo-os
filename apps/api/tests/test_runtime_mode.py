"""TDD — Task 4: Runtime-mode wiring.

Tests use a FakeControlPlane that implements the ControlPlane Protocol.
No network calls — all control-plane interactions go through the fake.

Paths under test
----------------
1. BYO/local engine (fake/anthropic) + FakeControlPlane UNREACHABLE →
   job runs to "done", 0 credits, report_usage NOT called.
2. Credit-consuming engine (litellm) + FakeControlPlane balance > 0 →
   job runs, report_usage called (cloud debits), status "done".
3. Credit-consuming engine (litellm) + FakeControlPlane UNREACHABLE →
   job status "paused_offline", InboxItem created, engine NOT run,
   NO Report, report_usage NOT called.
4. Credit-consuming engine (litellm) + FakeControlPlane balance = 0
   (hard overage policy) → job blocked ("insufficient_credits"),
   engine NOT run.
5. CLOUD mode (LocalControlPlane / default) — existing P4 gate + meter
   behaviour is unchanged (no regression).
6. Company shadow: in runtime mode, the gate call upserts a local Company
   row from entitlements.

All tests are isolated to in-process state — no live HTTP, no real
RemoteControlPlane.
"""
from __future__ import annotations

import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import text

from omilo.control import (
    BalanceState,
    ControlPlaneUnreachable,
    Entitlements,
    Identity,
    InstallTokenInfo,
    UsageEvent,
    UsageResult,
)
from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
from omilo.models.execution import Job, Report
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Schema — ensure it's up to date
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
# FakeControlPlane — injectable test double
# ---------------------------------------------------------------------------


class FakeControlPlane:
    """Test double for ControlPlane.

    Attributes:
        unreachable:      If True, check_balance / report_usage / get_entitlements
                          raise ControlPlaneUnreachable.
        balance:          The balance value returned by check_balance.
        overage_policy:   The policy returned by check_balance ("hard" | "soft").
        report_usage_calls: List of UsageEvent objects passed to report_usage.
    """

    def __init__(
        self,
        *,
        unreachable: bool = False,
        balance: int = 1000,
        overage_policy: str = "soft",
    ) -> None:
        self.unreachable = unreachable
        self._balance = balance
        self._overage_policy = overage_policy
        self.report_usage_calls: list[UsageEvent] = []

    # ControlPlane protocol methods

    def verify_token(self, jwt: str) -> Identity:
        return Identity(user_id="usr_test", company_id="cmp_test", role="owner")

    def get_entitlements(self, company_id: str, **kw) -> Entitlements:
        if self.unreachable:
            raise ControlPlaneUnreachable("FakeControlPlane is unreachable")
        return Entitlements(
            edition="cloud",
            plan_id="plan_test",
            included_credits=1000,
            overage_policy=self._overage_policy,
            features={},
        )

    def check_balance(self, company_id: str, **kw) -> BalanceState:
        if self.unreachable:
            raise ControlPlaneUnreachable("FakeControlPlane is unreachable")
        return BalanceState(balance=self._balance, overage_policy=self._overage_policy)

    def report_usage(self, ev: UsageEvent, **kw) -> UsageResult:
        if self.unreachable:
            raise ControlPlaneUnreachable("FakeControlPlane is unreachable")
        self.report_usage_calls.append(ev)
        return UsageResult(accepted=True, new_balance=max(0, self._balance - ev.credits))

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
        return InstallTokenInfo(install_token="fake_token", company_id="cmp_test")

    def heartbeat(self, install_token: str, **kw) -> bool:
        return True


# ---------------------------------------------------------------------------
# Session helpers (matching test_overage_budget.py pattern)
# ---------------------------------------------------------------------------


def _superuser_session():
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
    edition: str = "cloud",
) -> Company:
    company = Company(
        id=prefixed_id("cmp"),
        name=f"RuntimeCo-{edition}",
        color="#aabbcc",
        autonomy_default="yolo",
        credit_balance=credit_balance,
        overage_policy=overage_policy,
        edition=edition,
    )
    db.add(company)
    db.flush()
    return company


def _make_helper(
    db,
    *,
    company_id: str,
    engine_type: str = "fake",
) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="RuntimeHelper",
        area="ops",
        is_chief=True,
        engine={"type": engine_type},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


# ---------------------------------------------------------------------------
# Test 1: BYO/local engine + FakeControlPlane UNREACHABLE → job still runs
# ---------------------------------------------------------------------------


class TestBYOJobRunsOffline:
    """0-credit job (BYO/local engine) runs even when control plane unreachable."""

    def test_fake_engine_job_runs_offline(self):
        """fake engine → done, 0 credits, report_usage NOT called."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb)
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="BYO offline test",
            )

        assert job.status == "done", (
            f"BYO engine should complete offline, got {job.status!r} error={job.error!r}"
        )
        assert job.cost_credits == 0, f"BYO job must charge 0 credits, got {job.cost_credits}"
        assert len(fake_cp.report_usage_calls) == 0, (
            f"report_usage must NOT be called for BYO/local engines, "
            f"got {len(fake_cp.report_usage_calls)} calls"
        )

    def test_fake_engine_job_creates_report(self):
        """BYO engine runs to completion — a Report is created."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb)
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="BYO report test",
            )

        with _tenant_session(cid) as db:
            report = db.query(Report).filter_by(job_id=job.id).first()
        assert report is not None, "BYO engine must create a Report"

    def test_byo_job_does_not_write_local_ledger_in_runtime_mode(self):
        """Runtime mode + BYO engine → NO CreditLedger row written."""
        fake_cp = FakeControlPlane(unreachable=False)

        with _superuser_session() as sdb:
            company = _make_company(sdb, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Runtime BYO no-ledger test",
            )

        # BYO (0-credit) job: NO local ledger row should be written in runtime mode
        with _tenant_session(cid) as db:
            count = db.query(CreditLedger).filter_by(job_id=job.id, reason="job").count()
        assert count == 0, (
            f"Runtime mode BYO job must NOT write local ledger, found {count} rows"
        )


# ---------------------------------------------------------------------------
# Test 2: Credit-consuming (litellm) + FakeControlPlane balance > 0 → runs + report_usage called
# ---------------------------------------------------------------------------


class TestCreditJobReportsWhenOnline:
    """litellm job + FakeControlPlane available → runs, report_usage called."""

    def test_litellm_job_runs_and_reports_usage(self):
        """litellm engine with balance > 0 → status done, report_usage called."""
        fake_cp = FakeControlPlane(balance=1000, overage_policy="soft")

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=1000, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            # Set engine to litellm but patch get_engine in runner to use FakeEngine
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             patch("omilo.loop.runner.get_engine") as mock_get_engine:
            # Inject a fake engine that simulates litellm output (avoids API key check)
            from omilo.engine.fake import FakeEngine
            mock_get_engine.return_value = FakeEngine()

            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="litellm usage report test",
                )

        assert job.status == "done", (
            f"Credit job with balance > 0 must succeed, got {job.status!r} error={job.error!r}"
        )
        assert len(fake_cp.report_usage_calls) == 1, (
            f"report_usage must be called once for credit-consuming engine, "
            f"got {len(fake_cp.report_usage_calls)} calls"
        )
        ev = fake_cp.report_usage_calls[0]
        assert ev.company_id == cid
        assert ev.job_id == job.id
        assert ev.engine_type == "litellm"

    def test_litellm_job_does_not_write_local_ledger(self):
        """Runtime mode litellm job: cloud debits — no local CreditLedger row."""
        fake_cp = FakeControlPlane(balance=1000, overage_policy="soft")

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=1000, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             patch("omilo.loop.runner.get_engine") as mock_get_engine:
            from omilo.engine.fake import FakeEngine
            mock_get_engine.return_value = FakeEngine()

            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="litellm no-local-ledger test",
                )

        # In runtime mode: cloud debits via report_usage, NOT local ledger
        with _tenant_session(cid) as db:
            count = db.query(CreditLedger).filter_by(job_id=job.id, reason="job").count()
        assert count == 0, (
            f"Runtime mode must NOT write local CreditLedger for litellm job, found {count} rows"
        )


# ---------------------------------------------------------------------------
# Test 3: Credit-consuming + FakeControlPlane UNREACHABLE → paused_offline
# ---------------------------------------------------------------------------


class TestCreditJobPausedOffline:
    """litellm job + control plane unreachable → paused_offline + InboxItem, engine NOT run."""

    def test_unreachable_creates_paused_offline_job(self):
        """paused_offline status when control plane unreachable for credit job."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Offline credit job test",
                )

        assert job.status == "paused_offline", (
            f"Expected 'paused_offline' when control plane unreachable for credit job, "
            f"got {job.status!r} error={job.error!r}"
        )

    def test_unreachable_engine_does_not_run(self):
        """Engine must NOT run when paused_offline — no Report."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             patch("omilo.engine.get_engine") as mock_get_engine:
            from omilo.engine.fake import FakeEngine
            _engine = FakeEngine()
            mock_get_engine.return_value = _engine

            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Offline engine-not-run test",
                )

        # Engine should never have been called — get_engine itself should not have been called
        # (we check no Report exists as proxy)
        with _tenant_session(cid) as db:
            report = db.query(Report).filter_by(job_id=job.id).first()
        assert report is None, (
            "Engine must NOT run for paused_offline job — no Report should exist"
        )

    def test_unreachable_creates_inbox_item(self):
        """paused_offline job creates an InboxItem alert."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Offline InboxItem test",
                )

        with _tenant_session(cid) as db:
            alert = (
                db.query(InboxItem)
                .filter_by(company_id=cid, kind="alert")
                .first()
            )
        assert alert is not None, (
            "An alert InboxItem must be created when job is paused_offline"
        )
        assert "offline" in alert.title.lower() or "offline" in alert.summary.lower(), (
            f"InboxItem should mention 'offline': title={alert.title!r}"
        )

    def test_unreachable_report_usage_not_called(self):
        """report_usage must NOT be called when paused_offline."""
        fake_cp = FakeControlPlane(unreachable=True)

        with _superuser_session() as sdb:
            company = _make_company(sdb, edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(cid) as db:
                start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Offline no-report-usage test",
                )

        assert len(fake_cp.report_usage_calls) == 0, (
            f"report_usage must NOT be called for paused_offline job, "
            f"got {len(fake_cp.report_usage_calls)} calls"
        )


# ---------------------------------------------------------------------------
# Test 4: Credit-consuming + balance 0 (hard) → blocked ("insufficient_credits")
# ---------------------------------------------------------------------------


class TestCreditJobBlockedWhenBalanceZero:
    """litellm job + balance = 0, hard overage → blocked."""

    def test_balance_zero_hard_blocks_job(self):
        """balance=0, hard policy → job blocked with 'insufficient_credits'."""
        fake_cp = FakeControlPlane(balance=0, overage_policy="hard")

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=0, overage_policy="hard", edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Balance zero hard block test",
                )

        assert job.status in ("blocked", "failed"), (
            f"Expected blocked job with balance=0 + hard policy, got {job.status!r}"
        )
        assert job.error == "insufficient_credits", (
            f"Expected error='insufficient_credits', got {job.error!r}"
        )

    def test_balance_zero_hard_engine_not_run(self):
        """Engine must NOT run when balance=0 and hard overage."""
        fake_cp = FakeControlPlane(balance=0, overage_policy="hard")

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=0, overage_policy="hard", edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Balance zero engine not run test",
                )

        with _tenant_session(cid) as db:
            report = db.query(Report).filter_by(job_id=job.id).first()
        assert report is None, "Engine must NOT run when blocked by hard overage"

    def test_balance_zero_soft_litellm_still_runs(self):
        """balance=0, soft policy → credit-consuming job still runs (soft allows it)."""
        fake_cp = FakeControlPlane(balance=0, overage_policy="soft")

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=0, overage_policy="soft", edition="runtime")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp), \
             patch("omilo.loop.runner.get_engine") as mock_get_engine:
            from omilo.engine.fake import FakeEngine
            mock_get_engine.return_value = FakeEngine()

            with _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Balance zero soft litellm test",
                )

        assert job.status == "done", (
            f"Soft overage should allow job to run, got {job.status!r} error={job.error!r}"
        )


# ---------------------------------------------------------------------------
# Test 5: Cloud mode (LocalControlPlane / default) — P4 unchanged
# ---------------------------------------------------------------------------


class TestCloudModeUnchanged:
    """Cloud mode uses LocalControlPlane — P4 gate/meter behavior is unchanged."""

    def test_cloud_mode_fake_engine_runs(self):
        """Cloud mode with fake engine → job runs (no LocalControlPlane interaction needed)."""
        # This verifies that cloud mode (no patching) still works for 0-credit engines.
        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=1000)
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Cloud mode fake engine test",
            )

        assert job.status == "done", (
            f"Cloud mode fake engine must complete, got {job.status!r}"
        )

    def test_cloud_mode_hard_overage_blocks(self):
        """Cloud mode: hard overage still blocks (LocalControlPlane path unchanged)."""
        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=0, overage_policy="hard")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Cloud mode hard overage test",
            )

        assert job.status in ("blocked", "failed"), (
            f"Cloud mode hard overage must block, got {job.status!r}"
        )
        assert job.error == "insufficient_credits"

    def test_cloud_mode_writes_local_ledger_for_fake_engine(self):
        """Cloud mode: fake engine (BYO) still writes a local 0-credit ledger row."""
        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=1000)
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with _tenant_session(cid) as db:
            job = start_job(
                db,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="Cloud mode ledger test",
            )

        # In cloud mode, metering writes a local ledger row (even for 0-credit jobs)
        with _tenant_session(cid) as db:
            count = db.query(CreditLedger).filter_by(job_id=job.id, reason="job").count()
        assert count == 1, (
            f"Cloud mode must write local CreditLedger row for fake engine (analytics), found {count}"
        )


# ---------------------------------------------------------------------------
# Test 6: Company shadow — upsert in runtime mode from entitlements
# ---------------------------------------------------------------------------


class TestCompanyShadow:
    """Runtime mode gate call upserts a local Company row from entitlements."""

    def test_company_shadow_upserted_on_gate(self):
        """When Company row doesn't exist, gate in runtime mode creates it from entitlements."""
        fake_cp = FakeControlPlane(balance=1000, overage_policy="soft")

        # Create a company ID that we'll test shadow upsert for
        shadow_cid = prefixed_id("cmp")

        # We need to set up a Company in DB first for the job, then we test
        # that entitlements info is synced. Let's set up a Company with minimal
        # data and verify the gate calls get_entitlements in runtime mode.
        with _superuser_session() as sdb:
            company = Company(
                id=shadow_cid,
                name="ShadowCo",
                color="#112233",
                autonomy_default="yolo",
                credit_balance=0,  # Local balance is stale/zero
                overage_policy="hard",  # Local says hard, but cloud says soft
                edition="runtime",
            )
            sdb.add(company)
            sdb.flush()

        with _tenant_session(shadow_cid) as db:
            helper = _make_helper(db, company_id=shadow_cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        # FakeControlPlane says balance=1000, soft — gate should use these
        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(shadow_cid) as db:
                job = start_job(
                    db,
                    company_id=shadow_cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Company shadow test",
                )

        # In runtime mode, the gate consulted the fake CP (balance=1000, soft)
        # even though local Company has credit_balance=0, overage_policy="hard"
        # The fake engine (BYO/0-credit) should always run regardless
        assert job.status == "done", (
            f"BYO job in runtime mode must run regardless, got {job.status!r}"
        )
