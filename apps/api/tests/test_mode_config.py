"""TDD — Task 5: Mode config + register + Company shadow.

Tests (RED first):
A. Mode selection
   A1. Default (cloud mode): get_control_plane() returns LocalControlPlane.
   A2. Default (cloud mode): /control/* is mounted (app exposes it).
   A3. OMILO_MODE=runtime + URL → RemoteControlPlane.
   A4. OMILO_MODE=runtime + URL → /control NOT mounted.
   A5. OMILO_MODE=runtime + no URL → NotConfiguredError at get_control_plane().

B. omilo-register / register.py
   B1. register_install against FakeControlPlane returns InstallTokenInfo.
   B2. register_main with a fake URL + fake JWT prints the install token.
   B3. register_main with missing URL raises / exits non-zero.

C. Company shadow sync
   C1. sync_company_shadow upserts a Company row from Entitlements.
   C2. sync_company_shadow called again is idempotent (no error on second call).
   C3. In runtime mode, a job for a company with NO local Company row
       works end-to-end: shadow is created from entitlements so the job
       doesn't fail "Company not found".

D. except-TypeError removal
   D1. FakeControlPlane.check_balance accepts **kw — existing tests still pass.
   D2. check_can_start_job calls cp.check_balance(company.id, db=db) without
       the fallback TypeError path (balance.py no longer has the except TypeError block).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

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
from omilo.control.factory import NotConfiguredError
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
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
# FakeControlPlane (same as in test_runtime_mode.py — local copy for isolation)
# ---------------------------------------------------------------------------


class FakeControlPlane:
    """Test double for ControlPlane — accepts **kw on all methods."""

    def __init__(
        self,
        *,
        unreachable: bool = False,
        balance: int = 1000,
        overage_policy: str = "soft",
        company_id: str = "cmp_test",
    ) -> None:
        self.unreachable = unreachable
        self._balance = balance
        self._overage_policy = overage_policy
        self._company_id = company_id
        self.report_usage_calls: list[UsageEvent] = []

    def verify_token(self, jwt: str) -> Identity:
        return Identity(user_id="usr_test", company_id=self._company_id, role="owner")

    def get_entitlements(self, company_id: str, **kw) -> Entitlements:
        if self.unreachable:
            raise ControlPlaneUnreachable("FakeControlPlane is unreachable")
        return Entitlements(
            edition="runtime",
            plan_id="plan_test",
            included_credits=500,
            overage_policy=self._overage_policy,
            features={"feature_x": True},
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
        return InstallTokenInfo(install_token="fake_install_tok_abc123", company_id=self._company_id)

    def heartbeat(self, install_token: str, **kw) -> bool:
        return True


# ---------------------------------------------------------------------------
# Session helpers
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


def _make_helper(db, *, company_id: str, engine_type: str = "fake"):
    from omilo.models.agents import Helper

    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="ShadowHelper",
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
# A. Mode selection tests
# ---------------------------------------------------------------------------


class TestModeSelection:
    """Mode config: cloud ↔ runtime selection via OMILO_MODE."""

    def test_a1_default_mode_is_local_control_plane(self):
        """Default (OMILO_MODE=cloud or unset) → get_control_plane() is LocalControlPlane."""
        from omilo.config import Settings, get_settings
        from omilo.control.factory import get_control_plane
        from omilo.control.local import LocalControlPlane

        settings = Settings(omilo_mode="cloud")
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, LocalControlPlane), (
            f"Cloud mode must return LocalControlPlane, got {type(cp).__name__}"
        )

    def test_a2_cloud_mode_mounts_control_router(self):
        """/control/* endpoints are exposed in cloud mode."""
        from omilo.config import Settings
        from starlette.testclient import TestClient

        settings = Settings(omilo_mode="cloud")
        with patch("omilo.config.get_settings", return_value=settings):
            import omilo.main as _main_mod
            app = _main_mod.create_app()

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/openapi.json")
        paths = list(resp.json().get("paths", {}).keys())
        control_routes = [p for p in paths if p.startswith("/control")]
        assert len(control_routes) > 0, (
            f"Cloud mode must mount /control/* routes. Got paths: {paths}"
        )

    def test_a3_runtime_mode_returns_remote_control_plane(self):
        """OMILO_MODE=runtime + URL → get_control_plane() is RemoteControlPlane."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane
        from omilo.control.remote import RemoteControlPlane

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url="https://fake.cp.example.com",
            omilo_install_token="tok_test_abc",
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, RemoteControlPlane), (
            f"Runtime mode must return RemoteControlPlane, got {type(cp).__name__}"
        )

    def test_a4_runtime_mode_does_not_mount_control_router(self):
        """/control/* endpoints are NOT mounted in runtime mode."""
        from omilo.config import Settings
        from starlette.testclient import TestClient

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url="https://fake.cp.example.com",
            omilo_install_token="tok_test_abc",
        )
        with patch("omilo.config.get_settings", return_value=settings):
            import omilo.main as _main_mod
            app = _main_mod.create_app()

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/openapi.json")
        paths = list(resp.json().get("paths", {}).keys())
        control_routes = [p for p in paths if p.startswith("/control")]
        assert len(control_routes) == 0, (
            f"Runtime mode must NOT mount /control/* routes. Got: {control_routes}"
        )

    def test_a5_runtime_mode_requires_control_plane_url(self):
        """OMILO_MODE=runtime without OMILO_CONTROL_PLANE_URL → NotConfiguredError."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url=None,  # missing
            omilo_install_token="tok_test_abc",
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            with pytest.raises(NotConfiguredError, match="OMILO_CONTROL_PLANE_URL"):
                get_control_plane()


# ---------------------------------------------------------------------------
# B. omilo-register / register.py
# ---------------------------------------------------------------------------


class TestRegister:
    """register.py: exchange user JWT for install token."""

    def test_b1_register_install_returns_install_token_info(self):
        """register_install against FakeControlPlane returns InstallTokenInfo."""
        from omilo.control.register import register_install

        fake_cp = FakeControlPlane(company_id="cmp_xyz")
        result = register_install(user_jwt="some.jwt.token", control_plane=fake_cp)

        assert result.install_token == "fake_install_tok_abc123"
        assert result.company_id == "cmp_xyz"

    def test_b2_register_main_prints_token(self, capsys):
        """register_main with a fake CP prints install token."""
        from omilo.control.register import register_main

        fake_cp = FakeControlPlane(company_id="cmp_print_test")
        # Call register_main directly (bypasses CLI arg parsing)
        register_main(
            user_jwt="jwt.for.company",
            control_plane=fake_cp,
        )
        captured = capsys.readouterr()
        assert "fake_install_tok_abc123" in captured.out, (
            f"register_main must print the install token. Got: {captured.out!r}"
        )
        assert "OMILO_INSTALL_TOKEN" in captured.out, (
            "register_main must tell the user where to put the token"
        )

    def test_b3_register_requires_control_plane_url(self):
        """register_main without OMILO_CONTROL_PLANE_URL raises / exits non-zero."""
        from omilo.config import Settings
        from omilo.control.register import main as register_entry_point

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url=None,
        )
        with patch("omilo.control.register.get_settings", return_value=settings):
            with pytest.raises(SystemExit) as exc_info:
                register_entry_point()
        assert exc_info.value.code != 0, "register must exit non-zero when URL missing"


# ---------------------------------------------------------------------------
# C. Company shadow sync
# ---------------------------------------------------------------------------


class TestCompanyShadow:
    """sync_company_shadow: upsert local Company row from Entitlements."""

    def test_c1_sync_creates_company_row_from_entitlements(self):
        """sync_company_shadow creates a Company row when none exists."""
        from omilo.control.shadow import sync_company_shadow

        fake_cp = FakeControlPlane(company_id="cmp_shadow_new", overage_policy="soft")
        target_cid = prefixed_id("cmp")

        # Verify the company doesn't exist yet
        with _superuser_session() as db:
            existing = db.get(Company, target_cid)
            assert existing is None, "Pre-condition: no Company row should exist"

        # sync should create it
        with _superuser_session() as db:
            company = sync_company_shadow(db, target_cid, fake_cp)

        assert company is not None
        assert company.id == target_cid

        # Verify it's in the DB
        with _superuser_session() as db:
            found = db.get(Company, target_cid)
        assert found is not None, "sync_company_shadow must persist the Company row"
        assert found.edition == "runtime"
        assert found.overage_policy == "soft"

    def test_c2_sync_is_idempotent(self):
        """Calling sync_company_shadow twice does not raise."""
        from omilo.control.shadow import sync_company_shadow

        fake_cp = FakeControlPlane(overage_policy="hard")
        target_cid = prefixed_id("cmp")

        # First call: create
        with _superuser_session() as db:
            sync_company_shadow(db, target_cid, fake_cp)

        # Second call: should not raise (upsert)
        with _superuser_session() as db:
            company = sync_company_shadow(db, target_cid, fake_cp)

        assert company is not None, "Second sync_company_shadow call must succeed"

    def test_c3_runtime_job_without_preseeded_company_works(self):
        """In runtime mode, a job for a company with NO local row works via shadow.

        The shadow is created from entitlements so 'Company not found' never occurs.
        """
        # Create a company ID that has NO local Company row
        new_cid = prefixed_id("cmp")
        fake_cp = FakeControlPlane(
            balance=1000,
            overage_policy="soft",
            company_id=new_cid,
        )

        # Verify no Company row exists
        with _superuser_session() as db:
            assert db.get(Company, new_cid) is None, "Pre-condition: no Company row"

        # sync_company_shadow creates it
        from omilo.control.shadow import sync_company_shadow
        with _superuser_session() as db:
            shadow = sync_company_shadow(db, new_cid, fake_cp)

        assert shadow.id == new_cid, "Shadow company must have correct id"

        # Now a helper and job can be created for this company
        with _tenant_session(new_cid) as db:
            helper = _make_helper(db, company_id=new_cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             patch("omilo.billing.meter.get_control_plane", return_value=fake_cp):
            with _tenant_session(new_cid) as db:
                job = start_job(
                    db,
                    company_id=new_cid,
                    helper_id=hid,
                    origin="chat",
                    brief="Shadow company job test",
                )

        assert job.status == "done", (
            f"Job must succeed after shadow Company created, got {job.status!r} error={job.error!r}"
        )


# ---------------------------------------------------------------------------
# D. except-TypeError removal
# ---------------------------------------------------------------------------


class TestNoTypeErrorFallback:
    """The except TypeError smell is removed; FakeControlPlane accepts **kw."""

    def test_d1_fake_control_plane_accepts_db_kwarg(self):
        """FakeControlPlane.check_balance(**kw) accepts db without TypeError."""
        fake_cp = FakeControlPlane(balance=500)
        # Must not raise TypeError even with db=<something>
        result = fake_cp.check_balance("cmp_any", db=object())
        assert result.balance == 500

    def test_d2_balance_py_has_no_except_typeerror(self):
        """balance.py must not contain the except TypeError fallback block."""
        balance_py = _API_DIR / "omilo" / "billing" / "balance.py"
        source = balance_py.read_text()
        assert "except TypeError" not in source, (
            "balance.py must not contain 'except TypeError' — the smell has been removed"
        )

    def test_d3_check_can_start_job_works_with_fake_cp_accepting_kw(self):
        """check_can_start_job works when FakeControlPlane accepts **kw (no TypeError)."""
        fake_cp = FakeControlPlane(balance=1000, overage_policy="soft")

        with _superuser_session() as sdb:
            company = Company(
                id=prefixed_id("cmp"),
                name="TypeErrorTestCo",
                color="#aabbcc",
                autonomy_default="ask",
                credit_balance=100,
                overage_policy="soft",
                edition="cloud",
            )
            sdb.add(company)
            sdb.flush()
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.billing.balance import check_can_start_job

        with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
             _tenant_session(cid) as db:
            company_obj = db.get(Company, cid)
            helper_obj = db.get(type(helper), hid)
            allowed, reason = check_can_start_job(db, company_obj, helper_obj, "fake")

        assert allowed is True, f"BYO engine should be allowed, got {reason!r}"
