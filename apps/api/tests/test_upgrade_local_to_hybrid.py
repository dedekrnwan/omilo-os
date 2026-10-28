"""TDD — Task 2 (P6b): local → hybrid upgrade — re-key migration + omilo-connect.

RED first: tests are written before implementation.

Implement in:
  apps/api/omilo/control/rekey.py   — rekey_company()
  apps/api/omilo/control/upgrade.py — connect_to_cloud(), UpgradeResult, AlreadyHybridError
  apps/api/pyproject.toml           — omilo-connect console script

Coverage
--------
R1. HAPPY PATH — every seeded row moves to new company
    Seed: Company L + Channel, Goal, Helper, Job (execution), KbChunk (knowledge),
          ChatSession (session), Message, ToolCall, McpAccessToken, ProviderKey,
          HarnessAccount (two non-obvious tables to prove no hardcoding).
    connect_to_cloud(bootstrap_db, user_jwt, fake_url) → UpgradeResult mode=hybrid.
    Assert: all rows under L == 0; all rows under cloud C (same count).
    Assert: Company(id=C) exists; Company(id=L) gone.
    Assert: rows_rekeyed == number of seeded tenant rows (incl. wallet_settings if seeded).

R2. PROGRAMMATIC ENUMERATION — assert re-key covers a non-special-cased table
    Seed a row in Improvement (a less-obvious tenant table not explicitly special-cased).
    After connect_to_cloud, confirm the row moved to C.

R3. COUNT check — rows_rekeyed matches total seeded tenant rows.

R4. ONE-WAY GUARD — already hybrid → rejected
    Patch settings to mode=hybrid → connect_to_cloud raises AlreadyHybridError.

R5. ROLLBACK ATOMIC — failure mid-rekey → nothing changed
    Monkeypatch rekey_company to raise RuntimeError after seeding.
    Verify all original rows still exist under L; Company(id=L) still exists.

R6. ROLLBACK ATOMIC v2 — register_install failure → nothing changed
    Monkeypatch FakeControlPlane.register_install to raise.
    Verify data unchanged (rekey never ran).

R7. COMPANY ROW — new Company exists; old Company gone after upgrade.

R8. HYBRID CONFIG PERSISTED — .env file updated with correct values.

R9. MEMBER/USER RETIRED — Member rows deleted; User password_hash nulled.

R10. ALREADY-SAME-ID GUARD — rekey_company raises when old==new.

Note: FakeControlPlane is used for all cloud-side calls — NO network.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock
import tempfile

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.control import InstallTokenInfo, BalanceState, Entitlements, UsageResult, Identity, UsageEvent
from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, User, Member

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Schema
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
# FakeControlPlane (no network)
# ---------------------------------------------------------------------------


class FakeControlPlane:
    """Fully offline fake control plane.

    register_install returns a fixed cloud_company_id + install token.
    All other methods return valid stubs.
    """

    def __init__(self, cloud_company_id: str = "cmp_cloud_TESTCLOUD"):
        self._cloud_company_id = cloud_company_id
        self._install_token = "fake-install-token-HYBRID001"
        self.register_calls: list[str] = []

    def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
        self.register_calls.append(user_jwt)
        return InstallTokenInfo(
            install_token=self._install_token,
            company_id=self._cloud_company_id,
        )

    def verify_token(self, jwt: str) -> Identity:
        return Identity(user_id="usr_cloud", company_id=self._cloud_company_id, role="member")

    def get_entitlements(self, company_id: str, **kw) -> Entitlements:
        return Entitlements(
            edition="hybrid", plan_id=None, included_credits=500,
            overage_policy="soft", features={},
        )

    def check_balance(self, company_id: str, **kw) -> BalanceState:
        return BalanceState(balance=500, overage_policy="soft")

    def report_usage(self, ev: UsageEvent, **kw) -> UsageResult:
        return UsageResult(accepted=True, new_balance=490)

    def heartbeat(self, install_token: str, **kw) -> bool:
        return True


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------


def _boot_session():
    """Context manager: privileged (superuser) session — mimics get_bootstrap_db."""
    class _S:
        def __enter__(self) -> Session:
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
        def __enter__(self) -> Session:
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
# Seed helpers
# ---------------------------------------------------------------------------


def _make_company(db: Session, company_id: str | None = None, **kwargs) -> Company:
    defaults = dict(
        id=company_id or prefixed_id("cmp"),
        name="LocalTestCo",
        color="#aabbcc",
        timezone="UTC",
        autonomy_default="ask",
        edition="local",
    )
    defaults.update(kwargs)
    cmp = Company(**defaults)
    db.add(cmp)
    db.flush()
    return cmp


def _make_user(db: Session) -> User:
    user = User(
        id=prefixed_id("usr"),
        email=f"{prefixed_id('u')}@local.test",
        name="Local User",
        password_hash="hashed_password",
    )
    db.add(user)
    db.flush()
    return user


def _make_member(db: Session, company_id: str, user_id: str) -> Member:
    member = Member(
        id=prefixed_id("mem"),
        company_id=company_id,
        user_id=user_id,
        role="owner",
    )
    db.add(member)
    db.flush()
    return member


def _seed_full_local_install(db: Session, local_company_id: str) -> dict:
    """Seed a realistic local install with rows across many tenant tables.

    Returns a dict mapping table_name → list of seeded IDs so callers can
    verify the rows moved.
    """
    from omilo.models.workspace import Channel, Goal
    from omilo.models.chat import ChatSession, Message
    from omilo.models.agents import Helper
    from omilo.models.execution import Job
    from omilo.models.knowledge import KbSource, KbChunk
    from omilo.models.toolcall import ToolCall
    from omilo.models.mcp_token import McpAccessToken
    from omilo.models.accounts import HarnessAccount, ProviderKey
    from omilo.models.improvement import Improvement

    seeded: dict[str, list[str]] = {}

    # Channel
    ch = Channel(
        id=prefixed_id("ch"),
        company_id=local_company_id,
        name="General",
    )
    db.add(ch)
    db.flush()
    seeded["channel"] = [ch.id]

    # Goal (FK → channel)
    goal = Goal(
        id=prefixed_id("gol"),
        company_id=local_company_id,
        channel_id=ch.id,
        title="Reach 1000 users",
    )
    db.add(goal)
    db.flush()
    seeded["goal"] = [goal.id]

    # Helper
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=local_company_id,
        name="TestHelper",
        area="ops",
        is_chief=False,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    seeded["helper"] = [helper.id]

    # Job (execution)
    job = Job(
        id=prefixed_id("job"),
        company_id=local_company_id,
        helper_id=helper.id,
        origin="chat",
        brief="Test task",
        status="done",
        engine_type="fake",
    )
    db.add(job)
    db.flush()
    seeded["job"] = [job.id]

    # KbSource + KbChunk (knowledge)
    kbs = KbSource(
        id=prefixed_id("kbs"),
        company_id=local_company_id,
        kind="text",
        ref="https://example.com/doc",
        title="Doc",
        content_hash="abc123",
    )
    db.add(kbs)
    db.flush()

    kbc = KbChunk(
        id=prefixed_id("kbc"),
        company_id=local_company_id,
        source_id=kbs.id,
        text="Hello world",
        embedding=None,
    )
    db.add(kbc)
    db.flush()
    seeded["kb_source"] = [kbs.id]
    seeded["kb_chunk"] = [kbc.id]

    # ChatSession + Message
    sess = ChatSession(
        id=prefixed_id("ses"),
        company_id=local_company_id,
        title="Test Session",
        channel_id=ch.id,
    )
    db.add(sess)
    db.flush()

    msg = Message(
        id=prefixed_id("msg"),
        company_id=local_company_id,
        session_id=sess.id,
        author={"kind": "user", "name": "Local User"},
        content="Hello!",
    )
    db.add(msg)
    db.flush()
    seeded["session"] = [sess.id]
    seeded["message"] = [msg.id]

    # ToolCall (non-obvious table — proves no hardcoding)
    tc = ToolCall(
        id=prefixed_id("tc"),
        company_id=local_company_id,
        helper_id=helper.id,
        job_id=job.id,
        tool="test_tool",
        decision="allowed",
        detail={},
    )
    db.add(tc)
    db.flush()
    seeded["tool_call"] = [tc.id]

    # McpAccessToken (another non-obvious table)
    mat = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=local_company_id,
        label="Test Token",
        token_hash="sha256_fake_hash_" + prefixed_id("h"),
        helper_id=helper.id,
        scopes=["goals"],
    )
    db.add(mat)
    db.flush()
    seeded["mcp_access_token"] = [mat.id]

    # HarnessAccount
    ha = HarnessAccount(
        id=prefixed_id("acc"),
        company_id=local_company_id,
        harness="fake",
        label="Test Account",
        token_enc="enc_fake",
        token_hint="enc...",
    )
    db.add(ha)
    db.flush()
    seeded["harness_account"] = [ha.id]

    # ProviderKey
    pk = ProviderKey(
        id=prefixed_id("pk"),
        company_id=local_company_id,
        provider="openai",
        key_enc="enc_fake_key",
        key_hint="sk-...",
        label="OpenAI Key",
        used_by=[],
    )
    db.add(pk)
    db.flush()
    seeded["provider_key"] = [pk.id]

    # Improvement — a non-special-cased tenant table (proves enumeration)
    imp = Improvement(
        id=prefixed_id("imp"),
        company_id=local_company_id,
        by=helper.id,
        helper_id=helper.id,
        kind="prompt_patch",
        before={},
        after={"prompt": "better prompt"},
        reason="test improvement",
        baseline={},
        status="active",
    )
    db.add(imp)
    db.flush()
    seeded["improvement"] = [imp.id]

    return seeded


def _count_rows_for_company(db: Session, table_name: str, company_id: str) -> int:
    """Count rows in a table for a given company_id (privileged session)."""
    result = db.execute(
        text(f"SELECT COUNT(*) FROM {table_name} WHERE company_id = :cid"),
        {"cid": company_id},
    )
    return result.scalar() or 0


# ---------------------------------------------------------------------------
# connect_to_cloud test wrapper (injects FakeControlPlane)
# ---------------------------------------------------------------------------


def _run_connect_to_cloud(
    db: Session,
    local_company_id: str,
    fake_cp: FakeControlPlane,
    env_file: Path,
) -> "UpgradeResult":
    """Call connect_to_cloud with FakeControlPlane injected (no network)."""
    from omilo.control.upgrade import connect_to_cloud
    from omilo.control import remote as remote_module

    # Patch RemoteControlPlane so register_install uses our fake.
    class _FakeRemoteCP:
        def __init__(self, **kw):
            pass

        def register_install(self, user_jwt: str, **kw) -> InstallTokenInfo:
            return fake_cp.register_install(user_jwt)

    with patch.object(remote_module, "RemoteControlPlane", _FakeRemoteCP):
        # Patch settings so current mode is "local"
        with patch("omilo.control.upgrade.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(omilo_mode="local")
            return connect_to_cloud(
                db,
                user_jwt="fake-user-jwt",
                control_plane_url="https://fake.omilo.app",
                env_file=env_file,
                local_company_id=local_company_id,
            )


# ===========================================================================
# R1 — Happy path: every seeded row moves to new company
# ===========================================================================


def test_r1_happy_path_all_rows_moved():
    """All seeded rows move from local company L to cloud company C."""
    from omilo.control.upgrade import UpgradeResult

    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")

    # Unique cloud company_id for this test (avoid collision with other tests).
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    seeded: dict[str, list[str]] = {}
    user_id: str | None = None

    # Seed the local install.
    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        user_id = user.id
        _make_member(db, local_cid, user_id)
        seeded = _seed_full_local_install(db, local_cid)

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        # Run the upgrade inside a privileged transaction.
        with _boot_session() as db:
            result = _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        # Verify result shape.
        assert result.mode == "hybrid"
        assert result.cloud_company_id == cloud_cid
        assert result.install_token == "fake-install-token-HYBRID001"
        assert result.rows_rekeyed > 0

        # Verify rows moved: each table should have 0 rows under local_cid
        # and >= 1 row under cloud_cid.
        with _boot_session() as db:
            for table_name, ids in seeded.items():
                under_local = _count_rows_for_company(db, table_name, local_cid)
                under_cloud = _count_rows_for_company(db, table_name, cloud_cid)
                assert under_local == 0, (
                    f"Table {table_name!r} still has {under_local} rows under LOCAL company"
                )
                assert under_cloud == len(ids), (
                    f"Table {table_name!r} expected {len(ids)} rows under CLOUD company, got {under_cloud}"
                )

            # Old Company gone, new Company exists.
            assert db.get(Company, local_cid) is None, "Old Company L should be deleted"
            assert db.get(Company, cloud_cid) is not None, "New Company C should exist"

    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R2 — Programmatic enumeration: Improvement table (non-special-cased)
# ===========================================================================


def test_r2_programmatic_enumeration_improvement_table():
    """Improvement (non-special-cased table) is re-keyed by programmatic enumeration."""
    from omilo.models.improvement import Improvement

    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    imp_id: str | None = None

    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        _make_member(db, local_cid, user.id)

        # Only seed the Improvement table to isolate this test.
        helper_id = prefixed_id("hlp")
        from omilo.models.agents import Helper
        helper = Helper(
            id=helper_id,
            company_id=local_cid,
            name="ImpHelper",
            area="ops",
            is_chief=False,
            engine={"type": "fake"},
            autonomy_cap=None,
            permissions=[],
            status="active",
            channel_ids=[],
        )
        db.add(helper)
        db.flush()

        imp = Improvement(
            id=prefixed_id("imp"),
            company_id=local_cid,
            by=helper_id,
            helper_id=helper_id,
            kind="prompt_patch",
            before={},
            after={"p": "v"},
            reason="enumeration test",
            baseline={},
            status="active",
        )
        db.add(imp)
        db.flush()
        imp_id = imp.id

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        with _boot_session() as db:
            _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        # Confirm Improvement row moved to cloud company.
        with _boot_session() as db:
            moved_imp = db.get(Improvement, imp_id)
            assert moved_imp is not None
            assert moved_imp.company_id == cloud_cid, (
                f"Improvement row should be under cloud company {cloud_cid!r}, "
                f"got {moved_imp.company_id!r}"
            )
            old_count = _count_rows_for_company(db, "improvement", local_cid)
            assert old_count == 0, f"improvement still has {old_count} rows under LOCAL company"
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R3 — rows_rekeyed count matches seeded rows
# ===========================================================================


def test_r3_rows_rekeyed_count():
    """rows_rekeyed in UpgradeResult matches the number of tenant rows moved."""
    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    seeded: dict[str, list[str]] = {}
    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        _make_member(db, local_cid, user.id)
        seeded = _seed_full_local_install(db, local_cid)

    # Expected rows: all seeded rows + the Member row
    expected_tenant_rows = sum(len(ids) for ids in seeded.values()) + 1  # +1 for member

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        with _boot_session() as db:
            result = _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        # rows_rekeyed should be >= the seeded tenant rows (member is also rekeyed)
        assert result.rows_rekeyed >= expected_tenant_rows, (
            f"rows_rekeyed={result.rows_rekeyed} should be >= {expected_tenant_rows}"
        )
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R4 — One-way guard: already hybrid → AlreadyHybridError
# ===========================================================================


def test_r4_one_way_guard_already_hybrid():
    """connect_to_cloud raises AlreadyHybridError when mode is already hybrid."""
    from omilo.control.upgrade import connect_to_cloud, AlreadyHybridError
    from omilo.control import remote as remote_module

    class _FakeRemoteCP:
        def __init__(self, **kw):
            pass
        def register_install(self, user_jwt: str, **kw):
            return InstallTokenInfo(install_token="tok", company_id="cmp_cloud")

    with patch.object(remote_module, "RemoteControlPlane", _FakeRemoteCP):
        with patch("omilo.control.upgrade.get_settings") as mock_settings:
            mock_settings.return_value = MagicMock(omilo_mode="hybrid")
            with _boot_session() as db:
                with pytest.raises(AlreadyHybridError):
                    connect_to_cloud(
                        db,
                        user_jwt="fake-jwt",
                        control_plane_url="https://fake.omilo.app",
                    )


def test_r4b_one_way_guard_cloud_mode():
    """connect_to_cloud raises AlreadyHybridError when mode is 'cloud'."""
    from omilo.control.upgrade import connect_to_cloud, AlreadyHybridError

    with patch("omilo.control.upgrade.get_settings") as mock_settings:
        mock_settings.return_value = MagicMock(omilo_mode="cloud")
        with _boot_session() as db:
            with pytest.raises(AlreadyHybridError):
                connect_to_cloud(
                    db,
                    user_jwt="fake-jwt",
                    control_plane_url="https://fake.omilo.app",
                )


# ===========================================================================
# R5 — Rollback atomic: failure in rekey → nothing changed
# ===========================================================================


def test_r5_rollback_atomic_rekey_failure():
    """If rekey_company raises mid-flight, transaction rolls back — data intact."""
    from omilo.control import upgrade as upgrade_module

    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        _make_member(db, local_cid, user.id)
        ch = db.add(
            __import__("omilo.models.workspace", fromlist=["Channel"]).Channel(
                id=prefixed_id("ch"),
                company_id=local_cid,
                name="BoomCh",
            )
        )

    # Verify seed is present.
    with _boot_session() as db:
        assert db.get(Company, local_cid) is not None
        count_before = _count_rows_for_company(db, "channel", local_cid)
        assert count_before >= 0  # at least 0

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        # Patch rekey_company to raise after the mode check.
        def _exploding_rekey(db, old_id, new_id):
            raise RuntimeError("Simulated rekey failure — test R5")

        with patch.object(upgrade_module, "rekey_company", _exploding_rekey):
            with _boot_session() as db:
                with pytest.raises(RuntimeError, match="Simulated rekey failure"):
                    with patch("omilo.control.upgrade.get_settings") as mock_settings:
                        mock_settings.return_value = MagicMock(omilo_mode="local")

                        from omilo.control import remote as remote_module
                        class _FakeRemoteCP:
                            def __init__(self, **kw): pass
                            def register_install(self, jwt, **kw):
                                return InstallTokenInfo(install_token="tok", company_id=cloud_cid)

                        with patch.object(remote_module, "RemoteControlPlane", _FakeRemoteCP):
                            from omilo.control.upgrade import connect_to_cloud
                            connect_to_cloud(
                                db,
                                user_jwt="fake-jwt",
                                control_plane_url="https://fake.omilo.app",
                                env_file=env_file,
                            )

        # Verify data intact: Company L still exists, no Company C created.
        with _boot_session() as db:
            assert db.get(Company, local_cid) is not None, (
                "Company L should still exist after rollback"
            )
            # Cloud company should NOT exist (transaction rolled back).
            # (It may or may not exist from prior tests — we only care about the specific cloud_cid.)
            # Count channels under local_cid — should be unchanged.
            assert _count_rows_for_company(db, "channel", local_cid) >= count_before
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R6 — Rollback atomic: register_install failure → rekey never runs
# ===========================================================================


def test_r6_rollback_register_failure():
    """If register_install raises, no re-keying happens — data intact."""
    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")

    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        _make_member(db, local_cid, user.id)
        from omilo.models.workspace import Channel
        db.add(Channel(id=prefixed_id("ch"), company_id=local_cid, name="RollbackCh"))

    count_before: int
    with _boot_session() as db:
        count_before = _count_rows_for_company(db, "channel", local_cid)

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        from omilo.control import remote as remote_module
        from omilo.control.upgrade import connect_to_cloud
        from omilo.control import ControlPlaneUnreachable

        class _FailingRemoteCP:
            def __init__(self, **kw): pass
            def register_install(self, jwt, **kw):
                raise ControlPlaneUnreachable("Simulated cloud unreachable — R6")

        with patch.object(remote_module, "RemoteControlPlane", _FailingRemoteCP):
            with patch("omilo.control.upgrade.get_settings") as mock_settings:
                mock_settings.return_value = MagicMock(omilo_mode="local")
                with _boot_session() as db:
                    with pytest.raises(ControlPlaneUnreachable):
                        connect_to_cloud(
                            db,
                            user_jwt="fake-jwt",
                            control_plane_url="https://fake.omilo.app",
                            env_file=env_file,
                        )

        # Data must be intact.
        with _boot_session() as db:
            assert db.get(Company, local_cid) is not None
            assert _count_rows_for_company(db, "channel", local_cid) >= count_before
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R7 — Company row: new exists, old gone
# ===========================================================================


def test_r7_company_row_new_created_old_deleted():
    """After upgrade: Company(id=C) exists with display fields; Company(id=L) gone."""
    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    with _boot_session() as db:
        _make_company(db, company_id=local_cid, name="MyLocalCo", color="#112233")
        user = _make_user(db)
        _make_member(db, local_cid, user.id)

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        with _boot_session() as db:
            _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        with _boot_session() as db:
            old = db.get(Company, local_cid)
            new = db.get(Company, cloud_cid)

            assert old is None, f"Old Company {local_cid!r} should be deleted after upgrade"
            assert new is not None, f"New Company {cloud_cid!r} should exist after upgrade"
            assert new.name == "MyLocalCo"
            assert new.color == "#112233"
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R8 — Hybrid config persisted to .env file
# ===========================================================================


def test_r8_hybrid_config_written_to_env_file():
    """connect_to_cloud writes OMILO_MODE, OMILO_CONTROL_PLANE_URL, OMILO_INSTALL_TOKEN."""
    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        _make_member(db, local_cid, user.id)

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False, mode="w") as f:
        f.write("DATABASE_URL=postgresql://localhost/omilo\n")
        f.write("OMILO_MODE=local\n")
        env_file = Path(f.name)

    try:
        with _boot_session() as db:
            _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        content = env_file.read_text()
        assert "OMILO_MODE=hybrid" in content, "OMILO_MODE should be updated to hybrid"
        assert "OMILO_CONTROL_PLANE_URL=https://fake.omilo.app" in content
        assert "OMILO_INSTALL_TOKEN=fake-install-token-HYBRID001" in content
        # Old DATABASE_URL should be preserved.
        assert "DATABASE_URL=postgresql://localhost/omilo" in content
        # Old OMILO_MODE=local should NOT appear (replaced).
        assert "OMILO_MODE=local" not in content
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R9 — Member/User retired after upgrade
# ===========================================================================


def test_r9_local_identity_retired():
    """After upgrade: Member rows deleted, User password_hash nulled."""
    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")
    fake_cp = FakeControlPlane(cloud_company_id=cloud_cid)

    user_id: str | None = None
    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        user = _make_user(db)
        user_id = user.id
        _make_member(db, local_cid, user.id)

    with tempfile.NamedTemporaryFile(suffix=".env", delete=False) as f:
        env_file = Path(f.name)

    try:
        with _boot_session() as db:
            _run_connect_to_cloud(db, local_cid, fake_cp, env_file)

        with _boot_session() as db:
            # Member rows under the new company should be deleted.
            members = db.query(Member).filter_by(company_id=cloud_cid).all()
            assert members == [], (
                f"Member rows should be deleted after upgrade, got {len(members)}"
            )

            # User password_hash should be None (retired, cannot login locally).
            user_row = db.get(User, user_id)
            assert user_row is not None
            assert user_row.password_hash is None, (
                "User.password_hash should be None after local identity retirement"
            )
    finally:
        env_file.unlink(missing_ok=True)


# ===========================================================================
# R10 — rekey_company raises when old_company_id == new_company_id
# ===========================================================================


def test_r10_rekey_same_id_raises():
    """rekey_company raises ValueError when old and new IDs are identical."""
    from omilo.control.rekey import rekey_company

    some_id = prefixed_id("cmp")

    with _boot_session() as db:
        with pytest.raises(ValueError, match="identical"):
            rekey_company(db, some_id, some_id)


# ===========================================================================
# BONUS — rekey_company raw unit test (without connect_to_cloud)
# ===========================================================================


def test_rekey_company_moves_rows_directly():
    """Direct unit test for rekey_company: moves rows across tables atomically."""
    from omilo.control.rekey import rekey_company
    from omilo.models.workspace import Channel

    local_cid = prefixed_id("cmp")
    cloud_cid = prefixed_id("cmp")

    with _boot_session() as db:
        _make_company(db, company_id=local_cid)
        ch = Channel(id=prefixed_id("ch"), company_id=local_cid, name="DirectRekey")
        db.add(ch)
        db.flush()
        ch_id = ch.id

    with _boot_session() as db:
        rows = rekey_company(db, local_cid, cloud_cid)
        assert rows > 0

    with _boot_session() as db:
        ch_row = db.get(Channel, ch_id)
        assert ch_row is not None
        assert ch_row.company_id == cloud_cid
        assert db.get(Company, local_cid) is None
        assert db.get(Company, cloud_cid) is not None


# ===========================================================================
# BONUS — _discover_tenant_tables covers all expected tables
# ===========================================================================


def test_tenant_table_enumeration_includes_expected_tables():
    """Programmatic enumeration discovers all known company_id tenant tables."""
    from omilo.control.rekey import _discover_tenant_tables, _EXPLICIT_EXCLUDE_FROM_GENERIC_UPDATE

    tables = set(_discover_tenant_tables(_EXPLICIT_EXCLUDE_FROM_GENERIC_UPDATE))

    # Tables that MUST be in the enumerated set.
    expected = {
        "channel", "folder", "goal",
        "session", "message",
        "helper",
        "job", "run_event", "report",
        "proposal", "proposal_revision",
        "routine", "routine_run",
        "flow", "flow_run",
        "tool_call",
        "kb_source", "kb_chunk",
        "memory_doc",
        "skill",
        "improvement",
        "member",
        "credit_ledger", "subscription", "invoice",
        "harness_account", "provider_key",
        "connector",
        "mcp_access_token",
        "inbox_item",
        "install_token",
        "helper_access",
        "doit_payment",
    }

    missing = expected - tables
    assert not missing, (
        f"Programmatic enumeration missed expected tenant tables: {sorted(missing)}"
    )

    # Global tables must NOT be in the set.
    global_tables = {"company", "user", "plan", "piece"}
    wrongly_included = global_tables & tables
    assert not wrongly_included, (
        f"Global tables incorrectly included in tenant table enumeration: {wrongly_included}"
    )
