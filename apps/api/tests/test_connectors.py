"""TDD — Task 7 P4: Connectors CRUD + compile tools + MCP gate integration.

Tests:
1. Install gmail piece → POST credentials → GET /v1/connectors shows it status=connected;
   credentials never returned in plaintext.
2. PATCH /v1/connectors/{id} disables it → enabled=False.
3. DELETE /v1/connectors/{id} → removed (GET shows empty).
4. compile_tools(connector, gmail_piece) → correct tool specs:
   - send-email (approval=ask) → side_effecting=True
   - list-messages (approval=auto) → side_effecting=False
   - names namespaced "gmail.send-email", "gmail.list-messages"
   - input_schema from inputs (to/subject/raw_message; q)
5. Compiled WRITE connector tool via MCP → creates Proposal (gated) + ToolCall; NO real HTTP.
6. HelperAccess: helper WITHOUT grant does NOT get connector tools; WITH grant does.
7. Company-scoped (RLS): company B cannot see/patch company A's connector.

RED → implement → GREEN. Full suite >= 494.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
import pytest_asyncio

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.connectors import Connector
from omilo.models.helper_access import HelperAccess
from omilo.models.pieces import Piece
from omilo.models.tenancy import Company, Member, User
from omilo.models.toolcall import ToolCall
from omilo.connectors.compile import compile_tools
from omilo.marketplace.index import index_pieces
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
    # Ensure pieces are indexed (needed for install)
    with SessionLocal() as db:
        with db.begin():
            index_pieces(db)
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


async def _sign_up(client, *, name="Connector Tester"):
    email = f"conn_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    company_id = me.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helper(company_id: str, *, name: str = "TestHelper") -> str:
    with _superuser_session() as db:
        helper = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name=name,
            area="ops",
            role="Worker",
            job_description="",
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


def _seed_helper_access(company_id: str, helper_id: str, connector_id: str) -> str:
    with _superuser_session() as db:
        ha = HelperAccess(
            id=prefixed_id("hac"),
            company_id=company_id,
            helper_id=helper_id,
            kind="connector",
            ref_id=connector_id,
            access="write",
            default_on=False,
        )
        db.add(ha)
        db.flush()
        return ha.id


def _mint_mcp_token(client_token: str, helper_id: str, client) -> str:
    """Mint MCP token via API (sync fixture helper using asyncio)."""
    import asyncio

    async def _do():
        resp = await client.post(
            f"/v1/helpers/{helper_id}/mcp-token",
            headers={"Authorization": f"Bearer {client_token}"},
        )
        assert resp.status_code == 200, resp.text
        return resp.json()["token"]

    return asyncio.get_event_loop().run_until_complete(_do())


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def setup_a(async_client):
    """Company A: user + installed gmail connector."""
    token, company_id = await _sign_up(async_client, name="Company A User")
    # Install gmail piece
    resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), resp.text
    connector_id = resp.json()["id"]
    return {
        "token": token,
        "company_id": company_id,
        "connector_id": connector_id,
    }


@pytest_asyncio.fixture
async def setup_b(async_client):
    """Company B: user + installed gmail connector."""
    token, company_id = await _sign_up(async_client, name="Company B User")
    # Install gmail piece
    resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert resp.status_code in (200, 201), resp.text
    connector_id = resp.json()["id"]
    return {
        "token": token,
        "company_id": company_id,
        "connector_id": connector_id,
    }


# ---------------------------------------------------------------------------
# Test 1: Install + POST credentials → GET shows connected; no plaintext
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_install_and_credentials(async_client, setup_a):
    """Install gmail, store credentials → connector is status=connected in GET."""
    token = setup_a["token"]
    connector_id = setup_a["connector_id"]

    # POST credentials
    resp = await async_client.post(
        f"/v1/connectors/{connector_id}/credentials",
        json={"fields": {"access_token": "ya29.secret_token", "refresh_token": "1//refresh"}},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Status must be "connected"
    assert body["status"] == "connected"
    # Secrets must NEVER appear in plaintext
    assert "access_token" not in str(body.get("secrets_enc", ""))
    assert "ya29.secret_token" not in str(body)
    assert "1//refresh" not in str(body)
    # Hint should show field names
    assert "access_token" in body.get("secrets_hint", [])
    assert "refresh_token" in body.get("secrets_hint", [])

    # GET /v1/connectors shows it
    list_resp = await async_client.get("/v1/connectors", headers=_auth(token))
    assert list_resp.status_code == 200
    connectors = list_resp.json()
    assert any(c["id"] == connector_id for c in connectors)
    conn = next(c for c in connectors if c["id"] == connector_id)
    assert conn["status"] == "connected"
    # No plaintext in list response
    assert "ya29.secret_token" not in str(connectors)


# ---------------------------------------------------------------------------
# Test 2: PATCH disables connector
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_disable_connector(async_client, setup_a):
    token = setup_a["token"]
    connector_id = setup_a["connector_id"]

    resp = await async_client.patch(
        f"/v1/connectors/{connector_id}",
        json={"enabled": False},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["enabled"] is False

    # Re-enable
    resp2 = await async_client.patch(
        f"/v1/connectors/{connector_id}",
        json={"enabled": True},
        headers=_auth(token),
    )
    assert resp2.status_code == 200
    assert resp2.json()["enabled"] is True


# ---------------------------------------------------------------------------
# Test 3: DELETE removes connector
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_connector(async_client):
    """Install a connector, then DELETE it; GET shows it's gone."""
    token, company_id = await _sign_up(async_client, name="Delete Tester")

    # Install
    install_resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert install_resp.status_code in (200, 201)
    connector_id = install_resp.json()["id"]

    # DELETE
    del_resp = await async_client.delete(
        f"/v1/connectors/{connector_id}",
        headers=_auth(token),
    )
    assert del_resp.status_code == 204

    # GET /v1/connectors → should not contain deleted connector
    list_resp = await async_client.get("/v1/connectors", headers=_auth(token))
    assert list_resp.status_code == 200
    ids = [c["id"] for c in list_resp.json()]
    assert connector_id not in ids


# ---------------------------------------------------------------------------
# Test 4: compile_tools produces correct spec from gmail piece
# ---------------------------------------------------------------------------


def test_compile_tools_gmail():
    """compile_tools(connector, gmail_piece) → correct tool specs."""
    # Load gmail piece from DB (was indexed in ensure_schema)
    with SessionLocal() as db:
        gmail = db.get(Piece, "gmail")
    assert gmail is not None, "gmail piece must be indexed"

    # Fake connector (no DB needed for compile_tools — pure function)
    connector = SimpleNamespace(id="con_test", piece_id="gmail")

    tools = compile_tools(connector, gmail)

    assert len(tools) >= 2, f"Expected >= 2 tools from gmail, got {len(tools)}"

    by_name = {t["name"]: t for t in tools}

    # --- send-email: approval=ask → side_effecting=True ---
    assert "gmail.send-email" in by_name, f"Missing gmail.send-email in {list(by_name)}"
    send = by_name["gmail.send-email"]
    assert send["side_effecting"] is True
    assert send["approval"] == "ask"
    assert send["piece_id"] == "gmail"
    assert send["connector_id"] == "con_test"
    assert send["action_name"] == "send-email"

    # Input schema from inputs
    schema = send["inputSchema"]
    assert "to" in schema["properties"]
    assert "raw_message" in schema["properties"]
    # required fields
    assert "to" in schema.get("required", [])
    assert "raw_message" in schema.get("required", [])

    # --- list-messages: approval=auto → side_effecting=False ---
    assert "gmail.list-messages" in by_name, f"Missing gmail.list-messages in {list(by_name)}"
    lst = by_name["gmail.list-messages"]
    assert lst["side_effecting"] is False
    assert lst["approval"] == "auto"

    # q is optional (no required: true) → should not be in required
    lst_schema = lst["inputSchema"]
    assert "q" in lst_schema["properties"]
    assert "q" not in lst_schema.get("required", [])


# ---------------------------------------------------------------------------
# Test 5: Compiled WRITE connector tool via MCP → Proposal + ToolCall; NO real HTTP
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compiled_write_tool_creates_proposal(async_client):
    """A compiled write connector tool invoked via MCP creates a Proposal (gated) + ToolCall."""
    token, company_id = await _sign_up(async_client, name="MCP Connector Tester")
    helper_id = _seed_helper(company_id, name="ConnectorHelper")

    # Install gmail + store credentials → status=connected
    install_resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert install_resp.status_code in (200, 201)
    connector_id = install_resp.json()["id"]

    cred_resp = await async_client.post(
        f"/v1/connectors/{connector_id}/credentials",
        json={"fields": {"access_token": "tok"}},
        headers=_auth(token),
    )
    assert cred_resp.status_code == 200

    # Grant helper access to this connector
    _seed_helper_access(company_id, helper_id, connector_id)

    # Mint MCP token
    mcp_resp = await async_client.post(
        f"/v1/helpers/{helper_id}/mcp-token",
        headers=_auth(token),
    )
    assert mcp_resp.status_code == 200, mcp_resp.text
    mcp_token = mcp_resp.json()["token"]

    # Count proposals before
    with _tenant_session(company_id) as db:
        proposals_before = db.query(Proposal).count()

    # Call the write tool (gmail.send-email → approval=ask → side_effecting=True)
    rpc = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "gmail.send-email",
            "arguments": {
                "to": "test@example.com",
                "subject": "Hello",
                "raw_message": "dGVzdA==",
            },
        },
    }
    resp = await async_client.post(
        "/v1/mcp",
        json=rpc,
        headers={"Authorization": f"Bearer {mcp_token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "result" in body, f"Expected result, got: {body}"
    result = body["result"]

    # Must be proposed (gated) — NOT executed
    assert result.get("status") == "proposed", f"Expected 'proposed', got: {result}"
    assert "proposal_id" in result

    # Proposal row must exist
    with _tenant_session(company_id) as db:
        proposals_after = db.query(Proposal).count()
        assert proposals_after > proposals_before, "Expected a new Proposal to be created"

        proposal = db.get(Proposal, result["proposal_id"])
        assert proposal is not None
        assert proposal.status == "pending"

    # ToolCall row must exist
    with _tenant_session(company_id) as db:
        tc = (
            db.query(ToolCall)
            .filter(ToolCall.helper_id == helper_id)
            .order_by(ToolCall.at.desc())
            .first()
        )
        assert tc is not None
        assert tc.tool == "gmail.send-email"
        # Write connector tool with approval=ask MUST always be gated (never auto-allowed)
        assert tc.decision == "proposal"


# ---------------------------------------------------------------------------
# Test 6: HelperAccess — grant filter
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_helper_access_grant_filter(async_client):
    """Helper WITHOUT HelperAccess grant does NOT get connector tools; WITH grant does."""
    from omilo.mcp.tools import get_connector_tools_for_helper

    token, company_id = await _sign_up(async_client, name="Grant Test User")

    # Install gmail + credentials → connected
    install_resp = await async_client.post(
        "/v1/connectors/install",
        json={"piece_id": "gmail"},
        headers=_auth(token),
    )
    assert install_resp.status_code in (200, 201)
    connector_id = install_resp.json()["id"]

    await async_client.post(
        f"/v1/connectors/{connector_id}/credentials",
        json={"fields": {"access_token": "tok"}},
        headers=_auth(token),
    )

    # Helper A — no grant
    helper_a_id = _seed_helper(company_id, name="NoGrant Helper")
    # Helper B — with grant
    helper_b_id = _seed_helper(company_id, name="WithGrant Helper")
    _seed_helper_access(company_id, helper_b_id, connector_id)

    with _tenant_session(company_id) as db:
        helper_a = db.get(Helper, helper_a_id)
        helper_b = db.get(Helper, helper_b_id)

        tools_a = get_connector_tools_for_helper(db, helper_a)
        tools_b = get_connector_tools_for_helper(db, helper_b)

    # Helper A has NO grant → zero connector tools
    tool_names_a = [t["name"] for t in tools_a]
    assert "gmail.send-email" not in tool_names_a, (
        f"Helper A should not see gmail tools, got: {tool_names_a}"
    )

    # Helper B HAS grant → gmail tools visible
    tool_names_b = [t["name"] for t in tools_b]
    assert "gmail.send-email" in tool_names_b, (
        f"Helper B should see gmail tools, got: {tool_names_b}"
    )


# ---------------------------------------------------------------------------
# Test 7: Company-scoped — company B cannot see/patch company A's connector
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_company_scoped_rls(async_client, setup_a, setup_b):
    """Company B cannot see or patch company A's connector (RLS)."""
    token_a = setup_a["token"]
    token_b = setup_b["token"]
    connector_a_id = setup_a["connector_id"]

    # Company A's connector should appear in A's list
    list_a = await async_client.get("/v1/connectors", headers=_auth(token_a))
    ids_a = [c["id"] for c in list_a.json()]
    assert connector_a_id in ids_a

    # Company B's list should NOT contain company A's connector
    list_b = await async_client.get("/v1/connectors", headers=_auth(token_b))
    ids_b = [c["id"] for c in list_b.json()]
    assert connector_a_id not in ids_b, (
        f"Company B should not see Company A's connector {connector_a_id}"
    )

    # Company B PATCH on A's connector_id → 404 (RLS isolation)
    patch_resp = await async_client.patch(
        f"/v1/connectors/{connector_a_id}",
        json={"enabled": False},
        headers=_auth(token_b),
    )
    assert patch_resp.status_code == 404, (
        f"Expected 404 (RLS), got {patch_resp.status_code}: {patch_resp.text}"
    )
