"""TDD — Task 1 (P6b): OMILO_MODE=local — fully-local, cloud-free, BYO-only mode.

RED first: these tests are written BEFORE the implementation.
Implement in: config.py, control/factory.py, billing/balance.py, billing/meter.py,
              engine/__init__.py, main.py, auth/deps.py.

Coverage:
A. Mode enum + factory
   A1. OMILO_MODE=local  → get_control_plane() is LocalControlPlane
   A2. OMILO_MODE=local  → does NOT require OMILO_CONTROL_PLANE_URL / OMILO_INSTALL_TOKEN
   A3. OMILO_MODE=cloud  → get_control_plane() is LocalControlPlane (unchanged)
   A4. OMILO_MODE=hybrid → get_control_plane() is RemoteControlPlane
   A5. OMILO_MODE=runtime→ RemoteControlPlane (alias works, normalized to hybrid)
   A6. is_local_mode()   → True when mode=local, False otherwise

B. Local billing — BYO free
   B1. check_can_start_job in local mode → (True, None) for every engine type (fake, litellm, ...)
   B2. check_can_start_job local + balance=0 + hard-overage → STILL (True, None) — no balance check
   B3. meter_job in local mode → None (no-op, no CreditLedger row written)
   B4. BYO engine (fake) job runs to completion in local mode: status done, 0 credits, no CreditLedger

C. Pooled engine refused in local
   C1. get_engine({"type": "litellm"}) in local mode → raises PooledInferenceUnavailableLocal
   C2. litellm job in local mode → never runs / refused before engine build

D. Local auth is authoritative (not claims-only)
   D1. In local mode, get_current_user takes the LocalControlPlane branch (no _RuntimeIdentity)

E. /control not required in local
   E1. App created with OMILO_MODE=local does NOT raise NotConfiguredError
   E2. /control/balance route is still mounted in local mode (LocalControlPlane serves it)
       — only OMILO_MODE=runtime previously skipped mounting; local is NOT runtime

F. Alias + cloud/hybrid unchanged
   F1. OMILO_MODE=runtime alias → RemoteControlPlane (already tested in A5)
   F2. cloud mode check_can_start_job still works (P4 compat)
   F3. hybrid mode check_can_start_job with credit-consuming engine: balance OK → allowed
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
from omilo.control.local import LocalControlPlane
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
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
# Helpers: session context managers (mirrors test_runtime_mode.py pattern)
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


def _make_company(db, *, credit_balance: int = 0, overage_policy: str = "hard") -> Company:
    company = Company(
        id=prefixed_id("cmp"),
        name=f"LocalCo-{prefixed_id('x')}",
        color="#112233",
        autonomy_default="yolo",
        credit_balance=credit_balance,
        overage_policy=overage_policy,
        edition="local",
    )
    db.add(company)
    db.flush()
    return company


def _make_helper(db, *, company_id: str, engine_type: str = "fake"):
    from omilo.models.agents import Helper

    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="LocalHelper",
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
# FakeRemoteControlPlane — for hybrid/runtime alias tests
# ---------------------------------------------------------------------------


class FakeRemoteControlPlane:
    """Minimal fake that is NOT a LocalControlPlane — simulates RemoteControlPlane."""

    def verify_token(self, jwt: str) -> Identity:
        return Identity(user_id="usr_remote", company_id="cmp_remote", role="member")

    def get_entitlements(self, company_id: str, **kw) -> Entitlements:
        return Entitlements(
            edition="hybrid",
            plan_id="plan_remote",
            included_credits=500,
            overage_policy="soft",
            features={},
        )

    def check_balance(self, company_id: str, **kw) -> BalanceState:
        return BalanceState(balance=500, overage_policy="soft")

    def report_usage(self, ev: UsageEvent, **kw) -> UsageResult:
        return UsageResult(accepted=True, new_balance=490)

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
        return InstallTokenInfo(install_token="remote_tok", company_id="cmp_remote")

    def heartbeat(self, install_token: str, **kw) -> bool:
        return True


# ===========================================================================
# A. Mode enum + factory
# ===========================================================================


class TestModeFactory:
    """A-series: verify factory routing for all modes."""

    def test_A1_local_mode_returns_local_control_plane(self):
        """OMILO_MODE=local → get_control_plane() is LocalControlPlane."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(omilo_mode="local")
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, LocalControlPlane), (
            f"OMILO_MODE=local must return LocalControlPlane, got {type(cp).__name__}"
        )

    def test_A2_local_mode_no_url_required(self):
        """OMILO_MODE=local requires no OMILO_CONTROL_PLANE_URL or OMILO_INSTALL_TOKEN."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(
            omilo_mode="local",
            omilo_control_plane_url=None,
            omilo_install_token=None,
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            try:
                cp = get_control_plane()
            except NotConfiguredError as exc:
                pytest.fail(
                    f"OMILO_MODE=local must NOT require OMILO_CONTROL_PLANE_URL, "
                    f"but raised NotConfiguredError: {exc}"
                )

        assert isinstance(cp, LocalControlPlane)

    def test_A3_cloud_mode_returns_local_control_plane(self):
        """OMILO_MODE=cloud (default) → LocalControlPlane (unchanged)."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(omilo_mode="cloud")
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, LocalControlPlane)

    def test_A4_hybrid_mode_returns_remote_control_plane(self):
        """OMILO_MODE=hybrid → RemoteControlPlane."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane
        from omilo.control.remote import RemoteControlPlane

        settings = Settings(
            omilo_mode="hybrid",
            omilo_control_plane_url="https://api.omilo.app",
            omilo_install_token="tok_test",
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, RemoteControlPlane), (
            f"OMILO_MODE=hybrid must return RemoteControlPlane, got {type(cp).__name__}"
        )

    def test_A5_runtime_alias_returns_remote_control_plane(self):
        """OMILO_MODE=runtime (alias for hybrid) → RemoteControlPlane."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane
        from omilo.control.remote import RemoteControlPlane

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url="https://api.omilo.app",
            omilo_install_token="tok_test",
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, RemoteControlPlane), (
            f"OMILO_MODE=runtime (alias) must return RemoteControlPlane, got {type(cp).__name__}"
        )

    def test_A6_is_local_mode_helper(self):
        """is_local_mode() returns True when mode=local, False otherwise."""
        from omilo.config import Settings
        from omilo.control.factory import is_local_mode

        for mode, expected in [("local", True), ("cloud", False), ("hybrid", False), ("runtime", False)]:
            settings = Settings(omilo_mode=mode)
            with patch("omilo.control.factory.get_settings", return_value=settings):
                result = is_local_mode()
            assert result == expected, (
                f"is_local_mode() for OMILO_MODE={mode!r} expected {expected}, got {result}"
            )


# ===========================================================================
# B. Local billing — BYO free
# ===========================================================================


class TestLocalBillingBYOFree:
    """B-series: in local mode, every job is allowed at 0 credits; meter is a no-op."""

    def test_B1_check_can_start_job_always_allowed_in_local_mode(self):
        """check_can_start_job with OMILO_MODE=local → (True, None) for any engine."""
        from omilo.billing.balance import check_can_start_job
        from omilo.config import get_settings

        with _superuser_session() as db:
            company = _make_company(db, credit_balance=0, overage_policy="hard")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        for engine_type in ("fake", "litellm", "anthropic"):
            with _tenant_session(cid) as db:
                comp = db.get(Company, cid)
                hlp = db.get(type(helper), hid)

                get_settings.cache_clear()
                with patch.dict("os.environ", {"OMILO_MODE": "local"}, clear=False):
                    get_settings.cache_clear()
                    # Patch the factory inside billing.balance to return LocalControlPlane
                    # but with is_local_mode() returning True
                    from omilo.control.local import LocalControlPlane as LCP
                    local_cp = LCP()
                    with patch("omilo.billing.balance.get_control_plane", return_value=local_cp), \
                         patch("omilo.billing.balance.is_local_mode", return_value=True):
                        allowed, reason = check_can_start_job(db, comp, hlp, engine_type=engine_type)
                get_settings.cache_clear()

            assert allowed is True, (
                f"LOCAL mode: check_can_start_job for engine={engine_type!r} must be allowed, got reason={reason!r}"
            )
            assert reason is None, (
                f"LOCAL mode: reason must be None for engine={engine_type!r}, got {reason!r}"
            )

    def test_B2_local_mode_gate_ignores_balance_and_hard_overage(self):
        """check_can_start_job local + balance=0 + hard-overage → (True, None), no credit check."""
        from omilo.billing.balance import check_can_start_job

        with _superuser_session() as db:
            company = _make_company(db, credit_balance=0, overage_policy="hard")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        # Even with litellm (credit-consuming) + zero balance + hard overage,
        # local mode must allow the job.
        with _tenant_session(cid) as db:
            comp = db.get(Company, cid)
            hlp = db.get(type(helper), hid)

            from omilo.control.local import LocalControlPlane as LCP
            local_cp = LCP()
            with patch("omilo.billing.balance.get_control_plane", return_value=local_cp), \
                 patch("omilo.billing.balance.is_local_mode", return_value=True):
                allowed, reason = check_can_start_job(db, comp, hlp, engine_type="litellm")

        assert allowed is True, f"LOCAL mode must ignore balance=0 + hard, got reason={reason!r}"
        assert reason is None

    def test_B3_meter_job_is_noop_in_local_mode(self):
        """meter_job in local mode returns None and writes NO CreditLedger row."""
        from omilo.billing.meter import meter_job

        with _superuser_session() as db:
            company = _make_company(db, credit_balance=1000)
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        # Create a fake job object (no 'model' field on Job; no 'finished_at')
        from omilo.models.execution import Job
        from datetime import datetime, timezone

        job_id = prefixed_id("job")

        with _superuser_session() as db:
            comp = db.get(Company, cid)
            job = Job(
                id=job_id,
                company_id=cid,
                helper_id=hid,
                origin="chat",
                brief="local meter test",
                status="done",
                engine_type="fake",
                tokens_in=100,
                tokens_out=50,
                cost_credits=0,
            )
            db.add(job)

            from omilo.control.local import LocalControlPlane as LCP
            local_cp = LCP()
            with patch("omilo.billing.meter.get_control_plane", return_value=local_cp), \
                 patch("omilo.billing.meter.is_local_mode", return_value=True):
                result = meter_job(db, job)

        assert result is None, f"meter_job in local mode must return None, got {result!r}"

        # Verify no CreditLedger row was written
        with _superuser_session() as db:
            ledger_count = (
                db.query(CreditLedger)
                .filter_by(company_id=cid, job_id=job_id, reason="job")
                .count()
            )
        assert ledger_count == 0, (
            f"meter_job in local mode must NOT write CreditLedger; found {ledger_count} row(s)"
        )

    def test_B4_byo_job_runs_done_zero_credits_no_ledger_in_local_mode(self):
        """BYO engine job in local mode: status=done, cost_credits=0, no CreditLedger row."""
        from omilo.config import get_settings

        with _superuser_session() as sdb:
            company = _make_company(sdb, credit_balance=0, overage_policy="hard")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        from omilo.loop.runner import start_job
        from omilo.control.local import LocalControlPlane as LCP

        local_cp = LCP()

        get_settings.cache_clear()
        with patch.dict("os.environ", {"OMILO_MODE": "local"}, clear=False):
            get_settings.cache_clear()
            with patch("omilo.billing.balance.get_control_plane", return_value=local_cp), \
                 patch("omilo.billing.meter.get_control_plane", return_value=local_cp), \
                 patch("omilo.billing.balance.is_local_mode", return_value=True), \
                 patch("omilo.billing.meter.is_local_mode", return_value=True), \
                 _tenant_session(cid) as db:
                job = start_job(
                    db,
                    company_id=cid,
                    helper_id=hid,
                    origin="chat",
                    brief="local BYO job test",
                )
        get_settings.cache_clear()

        assert job.status == "done", (
            f"BYO job in local mode must complete, got {job.status!r} error={job.error!r}"
        )
        assert job.cost_credits == 0, f"local mode BYO job must charge 0 credits, got {job.cost_credits}"

        # No CreditLedger row
        with _superuser_session() as db:
            ledger_count = (
                db.query(CreditLedger)
                .filter_by(company_id=cid, job_id=job.id, reason="job")
                .count()
            )
        assert ledger_count == 0, (
            f"local mode must produce no CreditLedger rows; found {ledger_count}"
        )


# ===========================================================================
# C. Pooled engine refused in local mode
# ===========================================================================


class TestPooledEngineRefusedInLocal:
    """C-series: litellm (pooled/credit-consuming) engine refused in local mode."""

    def test_C1_get_engine_litellm_raises_in_local_mode(self):
        """get_engine({'type': 'litellm'}) in local mode → PooledInferenceUnavailableLocal."""
        from omilo.config import get_settings
        from omilo.engine import get_engine, PooledInferenceUnavailableLocal

        get_settings.cache_clear()
        with patch.dict("os.environ", {"OMILO_MODE": "local"}, clear=False):
            get_settings.cache_clear()
            with patch("omilo.engine.is_local_mode", return_value=True):
                with pytest.raises(PooledInferenceUnavailableLocal) as exc_info:
                    get_engine({"type": "litellm"})
        get_settings.cache_clear()

        assert "pooled" in str(exc_info.value).lower() or "local" in str(exc_info.value).lower(), (
            f"Error message should mention 'pooled' or 'local', got: {exc_info.value}"
        )

    def test_C1b_pool_error_message_is_clear(self):
        """PooledInferenceUnavailableLocal error message mentions hybrid mode as alternative."""
        from omilo.engine import get_engine, PooledInferenceUnavailableLocal

        with patch("omilo.engine.is_local_mode", return_value=True):
            with pytest.raises(PooledInferenceUnavailableLocal) as exc_info:
                get_engine({"type": "litellm"})

        msg = str(exc_info.value)
        # Should mention hybrid mode as the path to use pooled inference
        assert "hybrid" in msg.lower() or "omilo cloud" in msg.lower() or "byo" in msg.lower(), (
            f"Error should guide user toward hybrid or BYO alternatives, got: {msg}"
        )

    def test_C2_byo_engines_still_work_in_local_mode(self):
        """BYO engines (fake, anthropic) build normally in local mode (no refusal)."""
        from omilo.engine import get_engine

        with patch("omilo.engine.is_local_mode", return_value=True):
            # fake always works
            engine = get_engine({"type": "fake"})
            assert engine is not None

        # anthropic + claude_code may raise EngineNotConfigured (no keys) but NOT
        # PooledInferenceUnavailableLocal — the refusal is only for pooled litellm
        from omilo.engine import EngineNotConfigured, PooledInferenceUnavailableLocal
        with patch("omilo.engine.is_local_mode", return_value=True):
            try:
                get_engine({"type": "anthropic"})
            except EngineNotConfigured:
                pass  # expected if no key configured
            except PooledInferenceUnavailableLocal:
                pytest.fail("anthropic engine must NOT be refused in local mode")


# ===========================================================================
# D. Local auth is authoritative
# ===========================================================================


class TestLocalAuthAuthoritative:
    """D-series: local mode uses LocalControlPlane → authoritative User/Member path."""

    def test_D1_local_mode_auth_takes_cloud_path(self):
        """In local mode, isinstance(cp, LocalControlPlane) is True → cloud/authoritative auth path."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(omilo_mode="local")
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        # In deps.py the branch is: if not isinstance(cp, LocalControlPlane): # runtime
        # local mode MUST take the else branch (cloud/authoritative)
        assert isinstance(cp, LocalControlPlane), (
            "local mode must use LocalControlPlane so auth takes the authoritative path"
        )

    def test_D2_local_mode_no_runtime_identity(self):
        """In local mode, get_current_user does NOT return _RuntimeIdentity.

        Verified by confirming get_control_plane() returns LocalControlPlane —
        deps.py guards on isinstance(cp, LocalControlPlane) to route to the
        authoritative User/Member DB path (not _RuntimeIdentity).
        """
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane

        settings = Settings(omilo_mode="local")
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, LocalControlPlane), "local must use LocalControlPlane"
        # Logical consequence: deps.py will NOT execute the _RuntimeIdentity branch.


# ===========================================================================
# E. /control not required in local
# ===========================================================================


class TestControlNotRequiredInLocal:
    """E-series: /control does not need to be mounted and local mode doesn't error."""

    def test_E1_app_creates_without_error_in_local_mode(self):
        """App can be created with OMILO_MODE=local without any NotConfiguredError."""
        from omilo.config import Settings

        settings = Settings(omilo_mode="local")
        with patch("omilo.config.get_settings", return_value=settings):
            try:
                import omilo.main as _main_mod
                app = _main_mod.create_app()
            except NotConfiguredError as exc:
                pytest.fail(f"create_app() with OMILO_MODE=local raised NotConfiguredError: {exc}")

        assert app is not None

    def test_E2_control_routes_present_in_local_mode(self):
        """In local mode (LocalControlPlane), /control/* is mounted (same as cloud)."""
        from omilo.config import Settings
        from starlette.testclient import TestClient

        settings = Settings(omilo_mode="local")
        with patch("omilo.config.get_settings", return_value=settings):
            import omilo.main as _main_mod
            app = _main_mod.create_app()

        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/openapi.json")
        paths = list(resp.json().get("paths", {}).keys())
        control_routes = [p for p in paths if p.startswith("/control")]
        assert len(control_routes) > 0, (
            f"Local mode must mount /control/* routes (same as cloud). Got paths: {paths}"
        )


# ===========================================================================
# F. Aliases + cloud/hybrid behavior unchanged
# ===========================================================================


class TestAliasesAndUnchangedModes:
    """F-series: runtime alias + cloud and hybrid modes unchanged."""

    def test_F1_runtime_alias_normalized(self):
        """OMILO_MODE=runtime → RemoteControlPlane (alias for hybrid)."""
        from omilo.config import Settings
        from omilo.control.factory import get_control_plane
        from omilo.control.remote import RemoteControlPlane

        settings = Settings(
            omilo_mode="runtime",
            omilo_control_plane_url="https://api.omilo.app",
            omilo_install_token="tok_alias",
        )
        with patch("omilo.control.factory.get_settings", return_value=settings):
            cp = get_control_plane()

        assert isinstance(cp, RemoteControlPlane), (
            f"OMILO_MODE=runtime alias must return RemoteControlPlane, got {type(cp).__name__}"
        )

    def test_F2_cloud_mode_check_can_start_unchanged(self):
        """Cloud mode check_can_start_job still works as before (P4 compat)."""
        from omilo.billing.balance import check_can_start_job
        from omilo.control.local import LocalControlPlane as LCP

        with _superuser_session() as db:
            company = _make_company(db, credit_balance=1000, overage_policy="soft")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="fake")
            hid = helper.id

        with _tenant_session(cid) as db:
            comp = db.get(Company, cid)
            hlp = db.get(type(helper), hid)

            local_cp = LCP()
            with patch("omilo.billing.balance.get_control_plane", return_value=local_cp), \
                 patch("omilo.billing.balance.is_local_mode", return_value=False):
                allowed, reason = check_can_start_job(db, comp, hlp, engine_type="fake")

        assert allowed is True, f"cloud mode BYO job must be allowed, got reason={reason!r}"

    def test_F3_hybrid_credit_consuming_job_allowed_when_balance_ok(self):
        """Hybrid mode + credit-consuming engine + balance OK → allowed."""
        from omilo.billing.balance import check_can_start_job

        with _superuser_session() as db:
            company = _make_company(db, credit_balance=500, overage_policy="soft")
            cid = company.id

        with _tenant_session(cid) as db:
            helper = _make_helper(db, company_id=cid, engine_type="litellm")
            hid = helper.id

        fake_cp = FakeRemoteControlPlane()

        with _tenant_session(cid) as db:
            comp = db.get(Company, cid)
            hlp = db.get(type(helper), hid)

            with patch("omilo.billing.balance.get_control_plane", return_value=fake_cp), \
                 patch("omilo.billing.balance.is_local_mode", return_value=False):
                allowed, reason = check_can_start_job(db, comp, hlp, engine_type="litellm")

        assert allowed is True, f"hybrid mode with balance OK must allow litellm job, got {reason!r}"
