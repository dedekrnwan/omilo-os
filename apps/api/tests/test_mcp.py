"""TDD: Task 7 P2 — MCP server (Role-2: per-agent native platform tools).

Setup: company + Helper; mint a token via POST /v1/helpers/{id}/mcp-token.

Tests:
1. tools/call whoami with valid Bearer → returns helper identity.
2. Bad / absent token → 401.
3. tools/call propose {type:"message", risk:"medium"} under autonomy 'ask' →
   needs_owner → Proposal created (pending) + ToolCall with decision "proposal".
4. tools/call goals_list → returns the company's goals (seed one).
5. Tenancy: company-A helper token only sees company-A's goals.
6. propose never executes a real side effect (just records a Proposal/ToolCall).
7. tools/list → returns catalog of tool names.
"""
from __future__ import annotations

import uuid
import hashlib
import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User
from omilo.models.toolcall import ToolCall
from omilo.models.workspace import Channel, Goal
from omilo.main import create_app
from sqlalchemy import text

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Module-scoped schema guard
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
    class _S:
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

    return _S()


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------

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


def _make_helper_db(company_id: str) -> str:
    with _superuser_session() as db:
        helper = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
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
        return helper.id


# ---------------------------------------------------------------------------
# Async helpers
# ---------------------------------------------------------------------------

async def _sign_up_in(client) -> tuple[str, str]:
    """Sign up + /me; return (access_token, company_id)."""
    email = f"mcp_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "MCP User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    company_id = me.json()["company"]["id"]
    return token, company_id


async def _mint_token(client, helper_id: str, auth_token: str) -> str:
    resp = await client.post(
        f"/v1/helpers/{helper_id}/mcp-token",
        headers={"Authorization": f"Bearer {auth_token}"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["token"]


def _rpc_payload(method: str, params: dict) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": method, "arguments": params},
    }


# ---------------------------------------------------------------------------
# Fixtures: two companies, each with a helper + mcp token + a goal
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def setup_a(async_client):
    """Company A: user + helper + mcp_token + a goal."""
    auth_token, company_id = await _sign_up_in(async_client)
    helper_id = _make_helper_db(company_id)
    ch_id = _make_channel(company_id)
    goal_id = _make_goal(company_id, ch_id, title="Goal Alpha")
    raw_token = await _mint_token(async_client, helper_id, auth_token)
    return {
        "auth_token": auth_token,
        "company_id": company_id,
        "helper_id": helper_id,
        "mcp_token": raw_token,
        "goal_id": goal_id,
    }


@pytest_asyncio.fixture
async def setup_b(async_client):
    """Company B: user + helper + mcp_token + a different goal."""
    auth_token, company_id = await _sign_up_in(async_client)
    helper_id = _make_helper_db(company_id)
    ch_id = _make_channel(company_id)
    goal_id = _make_goal(company_id, ch_id, title="Goal Beta")
    raw_token = await _mint_token(async_client, helper_id, auth_token)
    return {
        "auth_token": auth_token,
        "company_id": company_id,
        "helper_id": helper_id,
        "mcp_token": raw_token,
        "goal_id": goal_id,
    }


# ---------------------------------------------------------------------------
# Test: mint token stores hash, returns raw once
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_mint_token_stores_hash(setup_a):
    """The minted token hash must be stored on the Helper."""
    raw = setup_a["mcp_token"]
    helper_id = setup_a["helper_id"]

    # Token format: "{helper_id}.{secret}"
    parts = raw.split(".", 1)
    assert len(parts) == 2
    assert parts[0] == helper_id

    secret = parts[1]
    expected_hash = hashlib.sha256(secret.encode()).hexdigest()

    with _superuser_session() as db:
        helper = db.get(Helper, helper_id)
        assert helper.mcp_token_hash == expected_hash


# ---------------------------------------------------------------------------
# Test: tools/call whoami
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_whoami(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("whoami", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body
    result = body["result"]
    assert result["helper_id"] == setup_a["helper_id"]
    assert result["company_id"] == setup_a["company_id"]
    assert "name" in result
    assert "is_chief" in result


# ---------------------------------------------------------------------------
# Test: bad / absent token → 401
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_bad_token_401(async_client):
    # Absent token
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("whoami", {}),
    )
    assert resp.status_code == 401

    # Malformed bearer
    resp2 = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("whoami", {}),
        headers={"Authorization": "Bearer notavalidtoken"},
    )
    assert resp2.status_code == 401

    # Valid format, wrong secret
    resp3 = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("whoami", {}),
        headers={"Authorization": "Bearer hlp_fake.wrongsecret"},
    )
    assert resp3.status_code == 401


# ---------------------------------------------------------------------------
# Test: tools/call propose under 'ask' → needs_owner → Proposal created
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_creates_proposal(async_client, setup_a):
    company_id = setup_a["company_id"]
    helper_id = setup_a["helper_id"]

    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("propose", {
            "type": "message",
            "risk": "medium",
            "title": "Send a test message",
            "body": "This is the body of the proposal",
        }),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body
    result = body["result"]
    # Under 'ask' + medium risk → needs_owner
    assert result["status"] == "proposed"
    assert "proposal_id" in result
    proposal_id = result["proposal_id"]

    # Verify Proposal was actually created in DB (pending)
    with _tenant_session(company_id) as db:
        proposal = db.query(Proposal).filter_by(id=proposal_id).first()
        assert proposal is not None
        assert proposal.status == "pending"
        assert proposal.company_id == company_id
        assert proposal.helper_id == helper_id

    # Verify ToolCall was logged with decision="proposal"
    with _tenant_session(company_id) as db:
        tc = (
            db.query(ToolCall)
            .filter_by(company_id=company_id, helper_id=helper_id, tool="propose")
            .order_by(ToolCall.at.desc())
            .first()
        )
        assert tc is not None
        assert tc.decision == "proposal"


# ---------------------------------------------------------------------------
# Test: propose never executes a real side effect
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_propose_no_real_side_effect(async_client, setup_a):
    """propose → only Proposal created, no real execution Job spawned."""
    from omilo.models.execution import Job

    company_id = setup_a["company_id"]

    # Count execution Jobs before
    with _tenant_session(company_id) as db:
        jobs_before = (
            db.query(Job)
            .filter_by(company_id=company_id, origin="execution")
            .count()
        )

    await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("propose", {
            "type": "message", "risk": "medium",
            "title": "T", "body": "B",
        }),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )

    with _tenant_session(company_id) as db:
        jobs_after = (
            db.query(Job)
            .filter_by(company_id=company_id, origin="execution")
            .count()
        )

    assert jobs_after == jobs_before


# ---------------------------------------------------------------------------
# Test: goals_list returns company goals
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_goals_list(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("goals_list", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body
    goals = body["result"]
    assert isinstance(goals, list)
    goal_ids = [g["id"] for g in goals]
    assert setup_a["goal_id"] in goal_ids


# ---------------------------------------------------------------------------
# Test: tenancy — company-A token only sees company-A's goals
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_goals_tenancy(async_client, setup_a, setup_b):
    """Company A's token must NOT see Company B's goals."""
    resp_a = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("goals_list", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    resp_b = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("goals_list", {}),
        headers={"Authorization": f"Bearer {setup_b['mcp_token']}"},
    )

    goals_a = resp_a.json()["result"]
    goals_b = resp_b.json()["result"]

    ids_a = {g["id"] for g in goals_a}
    ids_b = {g["id"] for g in goals_b}

    # Each only sees their own goal
    assert setup_a["goal_id"] in ids_a
    assert setup_b["goal_id"] in ids_b

    # Cross-tenant: A's goal not in B, B's goal not in A
    assert setup_b["goal_id"] not in ids_a
    assert setup_a["goal_id"] not in ids_b


# ---------------------------------------------------------------------------
# Test: tools/list returns catalog
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tools_list(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body
    tools = body["result"]["tools"]
    tool_names = [t["name"] for t in tools]
    for expected in ["whoami", "goals_list", "routines_list", "flows_list", "recall", "propose"]:
        assert expected in tool_names, f"Expected {expected!r} in tool catalog"


# ---------------------------------------------------------------------------
# Test: ToolCall logged on every call
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tool_call_logged_whoami(async_client, setup_a):
    company_id = setup_a["company_id"]
    helper_id = setup_a["helper_id"]

    with _tenant_session(company_id) as db:
        before = db.query(ToolCall).filter_by(
            company_id=company_id, helper_id=helper_id, tool="whoami"
        ).count()

    await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("whoami", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )

    with _tenant_session(company_id) as db:
        after = db.query(ToolCall).filter_by(
            company_id=company_id, helper_id=helper_id, tool="whoami"
        ).count()

    assert after == before + 1


# ---------------------------------------------------------------------------
# Test: recall stub returns empty list
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_recall_stub(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("recall", {"query": "anything"}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["result"] == []


# ---------------------------------------------------------------------------
# Test: routines_list and flows_list return lists
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_routines_list(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("routines_list", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json()["result"], list)


@pytest.mark.asyncio
async def test_flows_list(async_client, setup_a):
    resp = await async_client.post(
        "/v1/mcp",
        json=_rpc_payload("flows_list", {}),
        headers={"Authorization": f"Bearer {setup_a['mcp_token']}"},
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json()["result"], list)
