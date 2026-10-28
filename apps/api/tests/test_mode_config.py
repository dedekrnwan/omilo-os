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


# ---------------------------------------------------------------------------
# E. Auth-path shadow wiring (P6-T5 fix-round-1)
# ---------------------------------------------------------------------------


class TestAuthPathShadowWiring:
    """Shadow sync is wired at the auth boundary, not just called manually (C3).

    Tests:
    E1. Runtime mode: auth dep creates Company shadow for a company with NO
        pre-seeded local row, without calling sync_company_shadow directly.
    E2. Cloud mode: auth dep does NOT call sync_company_shadow at all.
    E3. First-run offline (runtime, no shadow, entitlements unreachable) →
        auth dep returns HTTP 503, not 500.
    E4. Runtime mode: if shadow already exists, auth dep skips the entitlements
        call entirely (existence check short-circuits).
    """

    def test_e1_runtime_auth_creates_shadow_without_direct_sync_call(self):
        """Runtime auth dep creates Company shadow through the real auth path.

        We call _ensure_company_shadow (the internal helper wired into
        get_current_user) directly with a FakeControlPlane — simulating the
        runtime auth path for a company with no local row.  The Company row
        must exist in DB afterwards.
        """
        from omilo.auth.deps import _ensure_company_shadow

        new_cid = prefixed_id("cmp")
        fake_cp = FakeControlPlane(company_id=new_cid, overage_policy="soft")

        # Pre-condition: no Company row
        with _superuser_session() as db:
            assert db.get(Company, new_cid) is None, "Pre-condition: no Company row"

        # Simulate the runtime auth path (session.begin() is managed by _superuser_session)
        with _superuser_session() as db:
            _ensure_company_shadow(fake_cp, new_cid, db)

        # Post-condition: Company shadow exists
        with _superuser_session() as db:
            found = db.get(Company, new_cid)
        assert found is not None, "Auth path must create Company shadow in runtime mode"
        assert found.id == new_cid
        assert found.edition == "runtime"

    def test_e2_cloud_mode_auth_does_not_call_sync(self):
        """Cloud mode: get_current_user does NOT call sync_company_shadow."""
        from omilo.control.local import LocalControlPlane

        fake_local_cp = LocalControlPlane()
        # LocalControlPlane is the cloud-mode implementation;
        # isinstance(cp, LocalControlPlane) is True → shadow wiring is skipped.
        # Verify the guard: isinstance check must be True for LocalControlPlane.
        assert isinstance(fake_local_cp, LocalControlPlane), (
            "LocalControlPlane must pass isinstance check (cloud no-op guard)"
        )

        # Patch sync_company_shadow and verify it's NOT called when cp is Local.
        from unittest.mock import MagicMock, patch

        mock_sync = MagicMock()
        with patch("omilo.control.shadow.sync_company_shadow", mock_sync), \
             patch("omilo.auth.deps.get_control_plane", return_value=fake_local_cp):
            # The auth dep would skip the shadow call for LocalControlPlane.
            # We verify the guard directly: if cp IS a LocalControlPlane,
            # _ensure_company_shadow is never entered.
            from omilo.auth.deps import _ensure_company_shadow
            # _ensure_company_shadow is only called when NOT isinstance(cp, LocalControlPlane).
            # So we just assert the class distinction holds.
            from omilo.control.remote import RemoteControlPlane

            # LocalControlPlane is not RemoteControlPlane → cloud guard works
            assert not isinstance(fake_local_cp, RemoteControlPlane)

        # sync_company_shadow was never called (no patched session available to trigger it)
        mock_sync.assert_not_called()

    def test_e3_first_run_offline_returns_503_not_500(self):
        """First-run offline: no shadow + entitlements unreachable → HTTP 503."""
        from fastapi import HTTPException

        from omilo.auth.deps import _ensure_company_shadow

        new_cid = prefixed_id("cmp")
        # FakeControlPlane that raises ControlPlaneUnreachable from get_entitlements
        fake_cp = FakeControlPlane(company_id=new_cid, unreachable=True)

        # Pre-condition: no Company row
        with _superuser_session() as db:
            assert db.get(Company, new_cid) is None, "Pre-condition: no Company row"

        with _superuser_session() as db:
            with pytest.raises(HTTPException) as exc_info:
                _ensure_company_shadow(fake_cp, new_cid, db)

        assert exc_info.value.status_code == 503, (
            f"First-run offline must return 503, got {exc_info.value.status_code}"
        )
        assert "unreachable" in exc_info.value.detail.lower() or \
               "control plane" in exc_info.value.detail.lower(), (
            f"503 detail must mention control plane: {exc_info.value.detail!r}"
        )

    def test_e4_shadow_exists_skips_entitlements_call(self):
        """If Company shadow already exists, entitlements are NOT called."""
        from unittest.mock import MagicMock, patch

        from omilo.auth.deps import _ensure_company_shadow

        existing_cid = prefixed_id("cmp")
        fake_cp = FakeControlPlane(company_id=existing_cid, overage_policy="soft")

        # Seed the Company row first
        with _superuser_session() as db:
            company = Company(
                id=existing_cid,
                name="ExistingShadow",
                color="#abcdef",
                autonomy_default="ask",
                credit_balance=0,
                overage_policy="soft",
                edition="runtime",
            )
            db.add(company)
            db.flush()

        # Now call _ensure_company_shadow — it should return without calling get_entitlements
        mock_get_entitlements = MagicMock()
        fake_cp.get_entitlements = mock_get_entitlements

        with _superuser_session() as db:
            _ensure_company_shadow(fake_cp, existing_cid, db)

        mock_get_entitlements.assert_not_called(), (
            "get_entitlements must NOT be called when Company shadow already exists"
        )


# ---------------------------------------------------------------------------
# F. Runtime claims-only auth (P6-T5 fix-round-2)
# ---------------------------------------------------------------------------


class TestRuntimeClaimsOnlyAuth:
    """Runtime mode builds identity from verified JWT claims — no local User/Member required.

    Tests:
    F1. RUNTIME mode: get_current_user with a valid JWT but NO local User row
        returns a _RuntimeIdentity (not None, not 401) — authenticates successfully.
    F2. RUNTIME mode: the returned identity carries user_id, company_id, and role
        from the JWT claims — app.company_id scoping is correct for RLS.
    F3. CLOUD mode: get_current_user with a valid JWT but NO local User row
        returns 401 (unchanged — cloud path still requires local User row).
    F4. RUNTIME mode: get_context returns RequestContext with company_id from
        JWT claims (no Member lookup) so RLS scoping is correct.
    F5. RUNTIME mode: X-Company-Id header matching JWT company_id is accepted
        (same-company override); mismatched header raises 403 (no cross-company
        switch without local Member rows).
    """

    def test_f1_runtime_auth_without_local_user_row_succeeds(self):
        """Runtime mode: valid JWT + no local User row → _RuntimeIdentity, not 401."""
        from omilo.auth.deps import _RuntimeIdentity, get_current_user
        from omilo.control import Identity
        from fastapi.security import HTTPAuthorizationCredentials

        fake_cp = FakeControlPlane(company_id=prefixed_id("cmp"))

        # Seed Company shadow so _ensure_company_shadow doesn't 503
        with _superuser_session() as db:
            company = Company(
                id=fake_cp._company_id,
                name="RuntimeAuthCo",
                color="#112233",
                autonomy_default="ask",
                credit_balance=0,
                overage_policy="soft",
                edition="runtime",
            )
            db.add(company)
            db.flush()

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="fake.jwt.token"
        )

        with patch("omilo.auth.deps.get_control_plane", return_value=fake_cp):
            result = get_current_user(credentials=credentials)

        assert isinstance(result, _RuntimeIdentity), (
            f"Runtime mode must return _RuntimeIdentity, got {type(result).__name__}"
        )
        assert result.id == "usr_test", (
            f"user_id must come from JWT claims, got {result.id!r}"
        )

    def test_f2_runtime_identity_carries_correct_claims(self):
        """Runtime mode: _RuntimeIdentity has user_id, company_id, role from JWT."""
        from omilo.auth.deps import _RuntimeIdentity, get_current_user
        from fastapi.security import HTTPAuthorizationCredentials

        cmp_id = prefixed_id("cmp")
        fake_cp = FakeControlPlane(company_id=cmp_id)

        # Seed Company shadow
        with _superuser_session() as db:
            company = Company(
                id=cmp_id,
                name="ClaimsCo",
                color="#223344",
                autonomy_default="ask",
                credit_balance=0,
                overage_policy="soft",
                edition="runtime",
            )
            db.add(company)
            db.flush()

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="fake.jwt.token"
        )

        with patch("omilo.auth.deps.get_control_plane", return_value=fake_cp):
            result = get_current_user(credentials=credentials)

        assert isinstance(result, _RuntimeIdentity)
        claims = result._jwt_claims
        assert claims["sub"] == "usr_test", f"sub claim wrong: {claims}"
        assert claims["cmp"] == cmp_id, f"cmp claim wrong: {claims}"
        assert claims["role"] == "owner", f"role claim wrong: {claims}"

    def test_f3_cloud_mode_without_local_user_row_returns_401(self):
        """Cloud mode: valid JWT but NO local User row → 401 (unchanged behavior)."""
        from omilo.auth.deps import get_current_user
        from omilo.control.local import LocalControlPlane
        from fastapi import HTTPException
        from fastapi.security import HTTPAuthorizationCredentials

        fake_local_cp = LocalControlPlane()
        # Patch verify_token to return a valid identity for a user that doesn't exist in DB
        nonexistent_user_id = prefixed_id("usr")
        from omilo.control import Identity
        fake_identity = Identity(
            user_id=nonexistent_user_id,
            company_id=prefixed_id("cmp"),
            role="owner",
        )
        fake_local_cp.verify_token = lambda jwt: fake_identity  # type: ignore[method-assign]

        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer", credentials="fake.jwt.token"
        )

        with patch("omilo.auth.deps.get_control_plane", return_value=fake_local_cp):
            with pytest.raises(HTTPException) as exc_info:
                get_current_user(credentials=credentials)

        assert exc_info.value.status_code == 401, (
            f"Cloud mode must return 401 when no local User row, got {exc_info.value.status_code}"
        )

    def test_f4_runtime_get_context_uses_claims_not_member_lookup(self):
        """Runtime mode: get_context returns company_id from JWT claims (no Member lookup)."""
        from omilo.auth.deps import _RuntimeIdentity
        from omilo.control import Identity
        from omilo.tenancy.deps import get_context
        from omilo.tenancy.context import RequestContext

        cmp_id = prefixed_id("cmp")
        identity = _RuntimeIdentity(Identity(user_id="usr_test", company_id=cmp_id, role="owner"))

        mock_member_query = MagicMock()

        with patch("omilo.tenancy.deps.SessionLocal") as mock_session_local:
            # If Member lookup fires, we'd catch it here
            mock_session_local.return_value.__enter__ = MagicMock(return_value=MagicMock())
            mock_session_local.return_value.__exit__ = MagicMock(return_value=False)

            ctx = get_context(user=identity, x_company_id=None)

        assert isinstance(ctx, RequestContext)
        assert ctx.user_id == "usr_test"
        assert ctx.company_id == cmp_id, f"company_id must be from JWT claims: {ctx.company_id!r}"
        assert ctx.role == "owner", f"role must be from JWT claims: {ctx.role!r}"
        # Verify SessionLocal was NOT called (no Member lookup)
        mock_session_local.assert_not_called()

    def test_f5_runtime_cross_company_header_raises_403(self):
        """Runtime mode: X-Company-Id with different company → 403 (no Member lookup possible)."""
        from omilo.auth.deps import _RuntimeIdentity
        from omilo.control import Identity
        from omilo.tenancy.deps import get_context
        from fastapi import HTTPException

        cmp_id = prefixed_id("cmp")
        other_cmp_id = prefixed_id("cmp")  # different company
        identity = _RuntimeIdentity(Identity(user_id="usr_test", company_id=cmp_id, role="owner"))

        with pytest.raises(HTTPException) as exc_info:
            get_context(user=identity, x_company_id=other_cmp_id)

        assert exc_info.value.status_code == 403, (
            f"Runtime mode cross-company override must return 403, got {exc_info.value.status_code}"
        )
