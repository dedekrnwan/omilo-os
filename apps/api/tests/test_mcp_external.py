"""TDD — P5b Task 3: External MCP endpoint (Role-3, /v1/x/mcp).

Tests mint tokens via the T2 POST endpoint then call /v1/x/mcp with Bearer.

1. whoami with ["goals"] token → returns helper identity (whoami always allowed).
2. ["goals"] token: goals_list → company's goals returned; tools/list includes
   goals_list + whoami but NOT flows_list/propose/skills.
3. SCOPE ESCALATION: ["goals"] token calls flows_list → JSON-RPC error (not
   data) + a ToolCall(decision="refused", actor="external:<label>") logged.
4. AUTONOMY CAP: ["propose"] token for helper with autonomy_cap="ask"; propose
   with medium risk → status:"proposed" (not auto-executed).
5. REVOKED: DELETE the token → call → 401; no success ToolCall.
6. EXPIRED: expires_at in the past → call → 401.
7. bad / absent bearer → 401.
8. last_used_at updated after a successful call.
9. AUDIT: a successful call logs ToolCall.actor == "external:<label>".
10. CROSS-TENANT: company A's token cannot see company B's goals.
11. Role-2 /v1/mcp tests still pass (run existing tests).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.toolcall import ToolCall
from omilo.models.workspace import Channel, Goal
from sqlalchemy import text
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
# Session helpers
# ---------------------------------------------------------------------------


def _superuser_session():
    class _S:
        def __enter__(self):
            self._sess = SessionLocal()
            self._txn = self._sess.begin()
            return self._sess

        def __exit__(self, exc_type, exc, tb):
            if exc_type:
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
            if exc_type:
                self._txn.rollback()
            else:
                self._txn.commit()
            self._sess.close()

    return _T()


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------


def _make_helper_db(company_id: str, autonomy_cap: str | None = None) -> str:
    with _superuser_session() as db:
        helper = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name="ExternalTestHelper",
            area="ops",
            is_chief=False,
            engine={"type": "fake"},
            autonomy_cap=autonomy_cap,
            permissions=[],
            status="active",
            channel_ids=[],
        )
        db.add(helper)
        db.flush()
        return helper.id


def _make_channel(company_id: str) -> str:
    with _superuser_session() as db:
        ch = Channel(
            id=prefixed_id("ch"),
            company_id=company_id,
            name="General",
            accent="general",
        )
        db.add(ch)
        db.flush()
        return ch.id


def _make_goal(company_id: str, channel_id: str, title: str = "Test Goal") -> str:
    with _superuser_session() as db:
        g = Goal(
            id=prefixed_id("gol"),
            company_id=company_id,
            channel_id=channel_id,
            title=title,
            progress=0,
        )
        db.add(g)
        db.flush()
        return g.id


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up_in(client) -> tuple[str, str]:
    """Sign up + /me; return (access_token, company_id)."""
    email = f"ext_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "External MCP User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    company_id = me.json()["company"]["id"]
    return token, company_id


async def _mint_access_token(
    client,
    *,
    auth_token: str,
    helper_id: str,
    scopes: list[str],
    label: str = "Claude Desktop",
    expires_at: datetime | None = None,
) -> dict:
    """Mint a McpAccessToken via the T2 endpoint; return the full response body."""
    body: dict = {
        "label": label,
        "helper_id": helper_id,
        "scopes": scopes,
    }
    if expires_at is not None:
        body["expires_at"] = expires_at.isoformat()

    resp = await client.post(
        "/v1/mcp-access-tokens",
        json=body,
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 200, f"mint failed: {resp.text}"
    return resp.json()


async def _revoke_access_token(client, *, auth_token: str, token_id: str) -> None:
    resp = await client.delete(
        f"/v1/mcp-access-tokens/{token_id}",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code in (200, 204), f"revoke failed: {resp.text}"


def _rpc_call(method: str, params: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": method, "arguments": params},
    }


def _rpc_list() -> dict:
    return {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}


def _bearer(raw: str) -> dict:
    return {"Authorization": f"Bearer {raw}"}


# ---------------------------------------------------------------------------
# Fixtures: two companies with goals + helpers
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def company_a(async_client):
    """Company A: owner + helper + goal."""
    auth_token, company_id = await _sign_up_in(async_client)
    helper_id = _make_helper_db(company_id)
    ch_id = _make_channel(company_id)
    goal_id = _make_goal(company_id, ch_id, title="Goal Alpha Ext")
    return {
        "auth_token": auth_token,
        "company_id": company_id,
        "helper_id": helper_id,
        "goal_id": goal_id,
    }


@pytest_asyncio.fixture
async def company_b(async_client):
    """Company B: owner + helper + goal."""
    auth_token, company_id = await _sign_up_in(async_client)
    helper_id = _make_helper_db(company_id)
    ch_id = _make_channel(company_id)
    goal_id = _make_goal(company_id, ch_id, title="Goal Beta Ext")
    return {
        "auth_token": auth_token,
        "company_id": company_id,
        "helper_id": helper_id,
        "goal_id": goal_id,
    }


# ---------------------------------------------------------------------------
# Test 1: whoami with ["goals"] token — whoami always allowed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_whoami_with_goals_token(async_client, company_a):
    """whoami is always allowed regardless of scopes."""
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="WhoamiTest",
    )
    raw_token = mint["token"]

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body, f"Expected result, got: {body}"
    result = body["result"]
    assert result["helper_id"] == company_a["helper_id"]
    assert result["company_id"] == company_a["company_id"]
    assert "name" in result


# ---------------------------------------------------------------------------
# Test 2: ["goals"] token: goals_list + tools/list filtered
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_goals_list_and_tools_list_filtered(async_client, company_a):
    """goals_list returns goals; tools/list shows only goals_list + whoami."""
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="GoalsOnlyTest",
    )
    raw_token = mint["token"]

    # goals_list should work
    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("goals_list", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body
    goals = body["result"]
    assert isinstance(goals, list)
    goal_ids = [g["id"] for g in goals]
    assert company_a["goal_id"] in goal_ids

    # tools/list must include goals_list + whoami but NOT flows_list/propose/skills
    resp2 = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_list(),
        headers=_bearer(raw_token),
    )
    assert resp2.status_code == 200, resp2.text
    tools_body = resp2.json()
    assert "result" in tools_body
    tool_names = {t["name"] for t in tools_body["result"]["tools"]}
    assert "whoami" in tool_names
    assert "goals_list" in tool_names
    assert "flows_list" not in tool_names
    assert "propose" not in tool_names
    assert "skills_list" not in tool_names
    assert "skill_read" not in tool_names
    assert "routines_list" not in tool_names


# ---------------------------------------------------------------------------
# Test 3: SCOPE ESCALATION — ["goals"] token calls flows_list → JSON-RPC error
#         + ToolCall(decision="refused", actor="external:<label>") logged
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_scope_escalation_refused(async_client, company_a):
    """Out-of-scope tool call returns JSON-RPC error and logs refused ToolCall."""
    label = "EscalationTest"
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label=label,
    )
    raw_token = mint["token"]
    company_id = company_a["company_id"]
    helper_id = company_a["helper_id"]

    # Count refused ToolCalls before
    with _tenant_session(company_id) as db:
        before = (
            db.query(ToolCall)
            .filter_by(
                company_id=company_id,
                helper_id=helper_id,
                tool="flows_list",
                decision="refused",
            )
            .count()
        )

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("flows_list", {}),
        headers=_bearer(raw_token),
    )
    # HTTP 200 but body contains "error" not "result"
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "error" in body, f"Expected JSON-RPC error, got: {body}"
    assert "result" not in body

    # ToolCall with decision="refused" and actor="external:<label>" must be logged
    with _tenant_session(company_id) as db:
        after = (
            db.query(ToolCall)
            .filter_by(
                company_id=company_id,
                helper_id=helper_id,
                tool="flows_list",
                decision="refused",
            )
            .count()
        )
    assert after == before + 1

    # Verify actor is set correctly
    with _tenant_session(company_id) as db:
        tc = (
            db.query(ToolCall)
            .filter_by(
                company_id=company_id,
                helper_id=helper_id,
                tool="flows_list",
                decision="refused",
            )
            .order_by(ToolCall.at.desc())
            .first()
        )
        assert tc is not None
        assert tc.actor == f"external:{label}"


# ---------------------------------------------------------------------------
# Test 4: AUTONOMY CAP — ["propose"] token for helper with autonomy_cap="ask"
#         → propose returns "proposed", not auto-executed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_autonomy_cap(async_client):
    """Helper with autonomy_cap='ask' + propose scope → propose returns 'proposed'."""
    # Sign up a new company for isolation
    auth_token, company_id = await _sign_up_in(async_client)
    # Helper with autonomy_cap="ask" (will force needs_owner verdict)
    helper_id = _make_helper_db(company_id, autonomy_cap="ask")

    mint = await _mint_access_token(
        async_client,
        auth_token=auth_token,
        helper_id=helper_id,
        scopes=["propose"],
        label="AutonomyCapTest",
    )
    raw_token = mint["token"]

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("propose", {
            "type": "message",
            "risk": "medium",
            "title": "External propose test",
            "body": "Should create proposal, not execute",
        }),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body, f"Expected result, got: {body}"
    result = body["result"]
    assert result["status"] == "proposed", f"Expected 'proposed', got: {result}"
    assert "proposal_id" in result

    # ToolCall actor should be external:<label>
    with _tenant_session(company_id) as db:
        tc = (
            db.query(ToolCall)
            .filter_by(company_id=company_id, helper_id=helper_id, tool="propose")
            .order_by(ToolCall.at.desc())
            .first()
        )
        assert tc is not None
        assert tc.actor == "external:AutonomyCapTest"


# ---------------------------------------------------------------------------
# Test 5: REVOKED — DELETE the token → call → 401; no success ToolCall
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_revoked_token_401(async_client, company_a):
    """After revocation, calling /v1/x/mcp returns 401 and no new ToolCall."""
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="RevokedTest",
    )
    raw_token = mint["token"]
    token_id = mint["id"]
    company_id = company_a["company_id"]
    helper_id = company_a["helper_id"]

    # Verify it works before revocation
    resp_before = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers=_bearer(raw_token),
    )
    assert resp_before.status_code == 200, resp_before.text

    # Revoke
    await _revoke_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        token_id=token_id,
    )

    # Count ToolCalls before attempting with revoked token
    with _tenant_session(company_id) as db:
        tc_before = db.query(ToolCall).filter_by(
            company_id=company_id, helper_id=helper_id,
        ).count()

    # Call after revocation → 401
    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 401, resp.text

    # No new ToolCall logged (revoked tokens don't execute any tool)
    with _tenant_session(company_id) as db:
        tc_after = db.query(ToolCall).filter_by(
            company_id=company_id, helper_id=helper_id,
        ).count()
    assert tc_after == tc_before, "No ToolCall should be logged for a revoked token"


# ---------------------------------------------------------------------------
# Test 6: EXPIRED — expires_at in the past → call → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_expired_token_401(async_client, company_a):
    """Token with expires_at in the past → 401."""
    past = datetime.now(timezone.utc) - timedelta(hours=1)
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="ExpiredTest",
        expires_at=past,
    )
    raw_token = mint["token"]

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 401, resp.text


# ---------------------------------------------------------------------------
# Test 7: bad / absent bearer → 401
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_bad_bearer_401(async_client):
    """Absent or garbage bearer → 401."""
    # No auth header
    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
    )
    assert resp.status_code == 401, resp.text

    # Garbage token
    resp2 = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers={"Authorization": "Bearer this-is-garbage"},
    )
    assert resp2.status_code == 401, resp2.text

    # "Bearer" prefix missing
    resp3 = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers={"Authorization": "Token sometoken"},
    )
    assert resp3.status_code == 401, resp3.text


# ---------------------------------------------------------------------------
# Test 8: last_used_at updated after a successful call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_last_used_at_updated(async_client, company_a):
    """last_used_at is set after a successful call."""
    from omilo.models.mcp_token import McpAccessToken

    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="LastUsedTest",
    )
    raw_token = mint["token"]
    token_id = mint["id"]
    company_id = company_a["company_id"]

    # Before: last_used_at should be None (just minted)
    with _tenant_session(company_id) as db:
        row = db.get(McpAccessToken, token_id)
        assert row is not None
        assert row.last_used_at is None

    # Make a call
    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("whoami", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 200, resp.text

    # After: last_used_at should be set
    with _tenant_session(company_id) as db:
        row = db.get(McpAccessToken, token_id)
        assert row is not None
        assert row.last_used_at is not None


# ---------------------------------------------------------------------------
# Test 9: AUDIT — successful call logs ToolCall.actor == "external:<label>"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_audit_actor(async_client, company_a):
    """ToolCall.actor is set to 'external:<label>' for external calls."""
    label = "AuditActorLabel"
    mint = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label=label,
    )
    raw_token = mint["token"]
    company_id = company_a["company_id"]
    helper_id = company_a["helper_id"]

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("goals_list", {}),
        headers=_bearer(raw_token),
    )
    assert resp.status_code == 200, resp.text

    with _tenant_session(company_id) as db:
        tc = (
            db.query(ToolCall)
            .filter_by(company_id=company_id, helper_id=helper_id, tool="goals_list")
            .order_by(ToolCall.at.desc())
            .first()
        )
        assert tc is not None
        assert tc.actor == f"external:{label}"


# ---------------------------------------------------------------------------
# Test 10: CROSS-TENANT — company A's token cannot see company B's goals
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_external_cross_tenant_isolation(async_client, company_a, company_b):
    """Company A's external token only sees A's goals, not B's."""
    mint_a = await _mint_access_token(
        async_client,
        auth_token=company_a["auth_token"],
        helper_id=company_a["helper_id"],
        scopes=["goals"],
        label="CrossTenantA",
    )
    raw_a = mint_a["token"]

    resp = await async_client.post(
        "/v1/x/mcp",
        json=_rpc_call("goals_list", {}),
        headers=_bearer(raw_a),
    )
    assert resp.status_code == 200, resp.text
    goals = resp.json()["result"]
    goal_ids = {g["id"] for g in goals}

    assert company_a["goal_id"] in goal_ids
    assert company_b["goal_id"] not in goal_ids
