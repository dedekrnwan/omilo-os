"""TDD — P5b Task 1: McpAccessToken model + ToolCall.actor column.

Tests (company-scoped tenant sessions, real DB):

1. Create McpAccessToken in company A's tenant session; read back + assert all fields
   including scopes list.
2. is_active(now) logic: True; set revoked_at → False; reset, set expires_at past → False;
   expires_at future → True.
3. Company B's tenant session sees NO company-A tokens (RLS isolation).
4. token_hash UNIQUE: two rows with same token_hash in company A → IntegrityError.
5. ToolCall created WITHOUT actor → defaults to "agent".

RED → implement → GREEN.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.mcp_token import McpAccessToken
from omilo.models.tenancy import Company
from omilo.models.toolcall import ToolCall


# ---------------------------------------------------------------------------
# Session helpers (copied from test_commerce_models.py pattern)
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
# Fixtures: two companies + a helper seeded via superuser
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def company_a():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="MCP Token Test Co A",
        color="#0f3460",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


@pytest.fixture(scope="module")
def company_b():
    cmp = Company(
        id=prefixed_id("cmp"),
        name="MCP Token Test Co B",
        color="#533483",
        timezone="Asia/Jakarta",
    )
    with _superuser_session() as sess:
        sess.add(cmp)
    return cmp.id


@pytest.fixture(scope="module")
def helper_a(company_a):
    """Seed a Helper in company A (superuser bypass); return its id."""
    hlp = Helper(
        id=prefixed_id("hlp"),
        company_id=company_a,
        name="MCP Test Helper",
        area="ops",
        role="",
        job_description="",
        engine={},
        permissions=[],
        channel_ids=[],
    )
    with _superuser_session() as sess:
        sess.add(hlp)
    return hlp.id


# ---------------------------------------------------------------------------
# Test 1: Persistence — McpAccessToken round-trip
# ---------------------------------------------------------------------------


def test_mcp_access_token_persists(company_a, helper_a):
    """Create McpAccessToken in company A's tenant session; assert all fields read back."""
    tok_id = prefixed_id("mct")
    # Include tok_id in hash to ensure uniqueness across test runs
    unique_hash = f"deadbeef_{tok_id}"
    with _tenant_session(company_a) as sess:
        tok = McpAccessToken(
            id=tok_id,
            company_id=company_a,
            label="Claude Desktop",
            token_hash=unique_hash,
            helper_id=helper_a,
            scopes=["goals", "docs"],
        )
        sess.add(tok)
        sess.flush()

    # Read back in a fresh tenant session
    with _tenant_session(company_a) as sess:
        result = sess.get(McpAccessToken, tok_id)
        assert result is not None, "McpAccessToken not found after commit"
        assert result.company_id == company_a
        assert result.label == "Claude Desktop"
        assert result.token_hash == unique_hash
        assert result.helper_id == helper_a
        assert result.scopes == ["goals", "docs"]
        assert result.expires_at is None
        assert result.last_used_at is None
        assert result.revoked_at is None
        assert result.created_at is not None
        assert result.updated_at is not None


# ---------------------------------------------------------------------------
# Test 2: is_active logic
# ---------------------------------------------------------------------------


def test_is_active_true(company_a, helper_a):
    """is_active returns True when not revoked and no expiry."""
    now = datetime.now(tz=timezone.utc)
    tok = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="active-token",
        token_hash=f"hash_active_{now.timestamp()}",
        helper_id=helper_a,
        scopes=[],
    )
    with _tenant_session(company_a) as sess:
        sess.add(tok)
        sess.flush()
        assert tok.is_active(now) is True


def test_is_active_false_when_revoked(company_a, helper_a):
    """is_active returns False when revoked_at is set."""
    now = datetime.now(tz=timezone.utc)
    tok = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="revoked-token",
        token_hash=f"hash_revoked_{now.timestamp()}",
        helper_id=helper_a,
        scopes=[],
        revoked_at=now,
    )
    with _tenant_session(company_a) as sess:
        sess.add(tok)
        sess.flush()
        assert tok.is_active(now) is False


def test_is_active_false_when_expired(company_a, helper_a):
    """is_active returns False when expires_at is in the past."""
    now = datetime.now(tz=timezone.utc)
    past = now - timedelta(hours=1)
    tok = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="expired-token",
        token_hash=f"hash_expired_{now.timestamp()}",
        helper_id=helper_a,
        scopes=[],
        expires_at=past,
    )
    with _tenant_session(company_a) as sess:
        sess.add(tok)
        sess.flush()
        assert tok.is_active(now) is False


def test_is_active_true_when_not_yet_expired(company_a, helper_a):
    """is_active returns True when expires_at is in the future."""
    now = datetime.now(tz=timezone.utc)
    future = now + timedelta(hours=1)
    tok = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="not-yet-expired-token",
        token_hash=f"hash_future_{now.timestamp()}",
        helper_id=helper_a,
        scopes=[],
        expires_at=future,
    )
    with _tenant_session(company_a) as sess:
        sess.add(tok)
        sess.flush()
        assert tok.is_active(now) is True


# ---------------------------------------------------------------------------
# Test 3: RLS isolation — company B sees nothing
# ---------------------------------------------------------------------------


def test_rls_isolation_company_b_sees_no_mcp_tokens(company_a, company_b, helper_a):
    """Company B's tenant session must not see company A's McpAccessToken rows."""
    # Ensure at least one token exists in company A
    now = datetime.now(tz=timezone.utc)
    with _tenant_session(company_a) as sess:
        tok = McpAccessToken(
            id=prefixed_id("mct"),
            company_id=company_a,
            label="rls-test-token",
            token_hash=f"hash_rls_{now.timestamp()}",
            helper_id=helper_a,
            scopes=[],
        )
        sess.add(tok)
        sess.flush()

    # Company B session must see zero rows
    with _tenant_session(company_b) as sess:
        rows = sess.execute(select(McpAccessToken)).scalars().all()
    assert rows == [], (
        f"Company B should see zero McpAccessToken rows, got: {rows}"
    )


# ---------------------------------------------------------------------------
# Test 4: token_hash UNIQUE constraint
# ---------------------------------------------------------------------------


def test_token_hash_unique_raises_integrity_error(company_a, helper_a):
    """Two McpAccessToken rows with the same token_hash → IntegrityError."""
    duplicate_hash = "duplicate_hash_value_xyz"

    t1 = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="dup-token-1",
        token_hash=duplicate_hash,
        helper_id=helper_a,
        scopes=[],
    )
    t2 = McpAccessToken(
        id=prefixed_id("mct"),
        company_id=company_a,
        label="dup-token-2",
        token_hash=duplicate_hash,
        helper_id=helper_a,
        scopes=[],
    )

    with pytest.raises(IntegrityError):
        with _tenant_session(company_a) as sess:
            sess.add(t1)
            sess.add(t2)
            sess.flush()


# ---------------------------------------------------------------------------
# Test 5: ToolCall.actor defaults to "agent"
# ---------------------------------------------------------------------------


def test_toolcall_actor_defaults_to_agent(company_a, helper_a):
    """ToolCall created WITHOUT actor explicitly set → .actor == 'agent'."""
    tc_id = prefixed_id("tc")
    with _tenant_session(company_a) as sess:
        tc = ToolCall(
            id=tc_id,
            company_id=company_a,
            helper_id=helper_a,
            tool="goals/list",
            decision="allowed",
            detail={},
        )
        sess.add(tc)
        sess.flush()
        # Expire to force reload from DB (triggers server_default)
        sess.expire(tc)
        assert tc.actor == "agent"
