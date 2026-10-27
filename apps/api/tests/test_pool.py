"""TDD — Task 5 P4: Engine factory + account pool.

Tests:
1. select_account picks the ready account with headroom (pct_window < 85) and oldest
   last_used_at (LRU) among several ready accounts.
2. A near_limit account (pct_window >= 85) is skipped; if it is the only one → None.
3. All accounts cooling/error → None.
4. mark_limited(account) → status becomes "cooling", cooldown_until set in the future.
5. get_engine({"type":"litellm"}) with no key configured → raises EngineNotConfigured.
   Same for anthropic. fake still works (P1 green).
6. Company-scoped: company B's pool is invisible to company A.

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from omilo.db import SessionLocal
from omilo.engine import EngineNotConfigured, get_engine
from omilo.models.accounts import HarnessAccount
from omilo.models.base import prefixed_id

from tests.utils import run_alembic


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_account(
    company_id: str,
    *,
    harness: str = "claude_code",
    label: str = "Test Account",
    status: str = "ready",
    pct_window: int = 0,
    last_used_at: datetime | None = None,
    token_enc: str = "enc_test",
    token_hint: str = "...test",
) -> HarnessAccount:
    """Create and persist a HarnessAccount row for a company (bypasses RLS)."""
    acc = HarnessAccount(
        id=prefixed_id("acc"),
        company_id=company_id,
        harness=harness,
        label=label,
        token_enc=token_enc,
        token_hint=token_hint,
        status=status,
        pct_window=pct_window,
        last_used_at=last_used_at,
        tokens="",
        runs=0,
        cost_credits=0,
    )
    with SessionLocal() as session:
        with session.begin():
            session.add(acc)
    return acc


def _fresh_company_id() -> str:
    """Return a unique company_id (no real Company row needed for pool tests)."""
    return f"cmp_{uuid.uuid4().hex[:16]}"


# ---------------------------------------------------------------------------
# 1. select_account picks LRU ready account with headroom
# ---------------------------------------------------------------------------


def test_select_account_picks_lru_ready_with_headroom():
    """Among two ready accounts with headroom, the one with oldest last_used_at wins."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()
    now = datetime.now(timezone.utc)

    older = _make_account(
        cid,
        label="Older",
        status="ready",
        pct_window=10,
        last_used_at=now - timedelta(hours=2),
    )
    newer = _make_account(
        cid,
        label="Newer",
        status="ready",
        pct_window=20,
        last_used_at=now - timedelta(minutes=5),
    )

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is not None
    assert result.id == older.id, (
        f"Expected older account (LRU) to be selected; got {result.id!r}"
    )


def test_select_account_picks_never_used_first():
    """An account with last_used_at=None is most-eligible (never used = most LRU)."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()
    now = datetime.now(timezone.utc)

    used = _make_account(
        cid,
        label="Used",
        status="ready",
        pct_window=10,
        last_used_at=now - timedelta(hours=1),
    )
    never_used = _make_account(
        cid,
        label="NeverUsed",
        status="ready",
        pct_window=10,
        last_used_at=None,
    )

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is not None
    assert result.id == never_used.id, (
        f"Expected never-used account to be selected; got {result.id!r}"
    )


# ---------------------------------------------------------------------------
# 2. near_limit account is skipped; if only one → None
# ---------------------------------------------------------------------------


def test_select_account_skips_near_limit():
    """A pct_window >= 85 account is skipped; the ready account with headroom wins."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()

    near = _make_account(
        cid,
        label="NearLimit",
        status="ready",
        pct_window=90,
    )
    good = _make_account(
        cid,
        label="GoodHeadroom",
        status="ready",
        pct_window=50,
    )

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is not None
    assert result.id == good.id, (
        f"Expected good-headroom account to be selected; got {result.id!r}"
    )


def test_select_account_returns_none_when_only_near_limit():
    """If only near_limit accounts exist (pct >= 85), return None (defer)."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()

    _make_account(
        cid,
        label="NearOnly",
        status="ready",
        pct_window=85,
    )

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is None, "Expected None when only near_limit accounts exist"


# ---------------------------------------------------------------------------
# 3. All accounts cooling / error → None
# ---------------------------------------------------------------------------


def test_select_account_returns_none_when_all_cooling():
    """If all accounts are cooling, return None."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()
    _make_account(cid, label="Cooling1", status="cooling")
    _make_account(cid, label="Cooling2", status="cooling")

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is None, "Expected None when all accounts are cooling"


def test_select_account_returns_none_when_all_error():
    """If all accounts are error, return None."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()
    _make_account(cid, label="Err1", status="error")

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is None, "Expected None when all accounts are error"


def test_select_account_returns_none_when_no_accounts():
    """If no accounts exist for harness, return None."""
    from omilo.engine.pool import select_account

    cid = _fresh_company_id()

    with SessionLocal() as session:
        with session.begin():
            result = select_account(session, company_id=cid, harness="claude_code")

    assert result is None, "Expected None when no accounts exist"


# ---------------------------------------------------------------------------
# 4. mark_limited → cooling + cooldown_until in the future
# ---------------------------------------------------------------------------


def test_mark_limited_sets_cooling_and_cooldown_until():
    """mark_limited sets status='cooling' and cooldown_until to a future UTC time."""
    from omilo.engine.pool import mark_limited

    cid = _fresh_company_id()
    acc = _make_account(cid, label="ToLimit", status="ready", pct_window=50)

    before = datetime.now(timezone.utc)

    with SessionLocal() as session:
        with session.begin():
            # Load the account inside this session so we can mutate it
            db_acc = session.get(HarnessAccount, acc.id)
            mark_limited(session, db_acc)

    # Reload to verify persisted state
    with SessionLocal() as session:
        with session.begin():
            refreshed = session.get(HarnessAccount, acc.id)
            assert refreshed is not None
            assert refreshed.status == "cooling", (
                f"Expected 'cooling', got {refreshed.status!r}"
            )
            assert refreshed.cooldown_until is not None, (
                "Expected cooldown_until to be set"
            )
            # cooldown_until must be in the future (past the moment we called mark_limited)
            cooldown_ts = refreshed.cooldown_until
            if cooldown_ts.tzinfo is None:
                cooldown_ts = cooldown_ts.replace(tzinfo=timezone.utc)
            assert cooldown_ts > before, (
                f"cooldown_until {cooldown_ts} must be after {before}"
            )


# ---------------------------------------------------------------------------
# 5. get_engine: litellm/anthropic without key → EngineNotConfigured; fake works
# ---------------------------------------------------------------------------


def test_get_engine_litellm_no_key_raises_not_configured(monkeypatch):
    """get_engine({'type':'litellm'}) with no API key → EngineNotConfigured."""
    # Ensure relevant env vars are absent
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_KEY", raising=False)

    with pytest.raises(EngineNotConfigured):
        get_engine({"type": "litellm"})


def test_get_engine_anthropic_no_key_raises_not_configured(monkeypatch):
    """get_engine({'type':'anthropic'}) with no API key → EngineNotConfigured."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_API_KEY", raising=False)

    with pytest.raises(EngineNotConfigured):
        get_engine({"type": "anthropic"})


def test_get_engine_fake_still_works():
    """get_engine({'type':'fake'}) still returns a FakeEngine (P1 contract)."""
    from omilo.engine.fake import FakeEngine

    engine = get_engine({"type": "fake"})
    assert isinstance(engine, FakeEngine)


def test_get_engine_unknown_type_raises_value_error():
    """get_engine({'type':'unknown'}) → ValueError."""
    with pytest.raises(ValueError):
        get_engine({"type": "unknown_xyz"})


def test_get_engine_claude_code_no_accounts_raises_not_configured():
    """get_engine({'type':'claude_code'}) with no eligible pool accounts → EngineNotConfigured."""
    # Use a fresh company_id so there are no accounts in the pool
    with pytest.raises(EngineNotConfigured):
        get_engine({"type": "claude_code", "company_id": _fresh_company_id()})


# ---------------------------------------------------------------------------
# 6. Company-scoped: company B's pool invisible to A
# ---------------------------------------------------------------------------


def test_select_account_company_scoped():
    """Company A cannot see company B's HarnessAccount rows."""
    from omilo.engine.pool import select_account

    cid_a = _fresh_company_id()
    cid_b = _fresh_company_id()

    # Seed an account for B only
    _make_account(cid_b, label="CompanyBAccount", status="ready", pct_window=0)

    with SessionLocal() as session:
        with session.begin():
            result_a = select_account(session, company_id=cid_a, harness="claude_code")

    assert result_a is None, (
        "Company A should not see company B's accounts; expected None"
    )
