"""TDD — P5d Task 2b: POST /v1/channels — Channel (Area) create endpoint.

Tests:
1. POST /v1/channels with all fields → 201; response has contextScope alias;
   GET /v1/channels now includes the new channel.
2. POST /v1/channels with minimal body {name} → defaults: context_scope="isolated",
   accent="general", icon/purpose null.
3. POST /v1/channels with empty name → 422.
4. Company-scoped (RLS): company B cannot see company A's created channel;
   created channel's company_id is A's (verified via superuser session).

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid

import pytest

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
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="Channel Tester", password="testP4ss!"):
    email = f"chn_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test 1 — Full create + list includes new channel
# ---------------------------------------------------------------------------


class TestCreateChannelFull:
    @pytest.mark.asyncio
    async def test_create_with_all_fields_returns_201(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Full A")
        resp = await async_client.post(
            "/v1/channels",
            json={
                "name": "Growth",
                "accent": "marketing",
                "icon": "rocket",
                "purpose": "Growth experiments",
                "context_scope": "isolated_general",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "Growth"
        assert data["accent"] == "marketing"
        assert data["icon"] == "rocket"
        assert data["purpose"] == "Growth experiments"
        # camelCase alias for context_scope
        assert data["contextScope"] == "isolated_general"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_list_includes_created_channel(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Full B")
        create_resp = await async_client.post(
            "/v1/channels",
            json={
                "name": "Growth Listed",
                "accent": "marketing",
                "icon": "rocket",
                "purpose": "Check list",
                "context_scope": "isolated_general",
            },
            headers=_auth(token),
        )
        assert create_resp.status_code == 201
        created_id = create_resp.json()["id"]

        list_resp = await async_client.get("/v1/channels", headers=_auth(token))
        assert list_resp.status_code == 200
        ids = [ch["id"] for ch in list_resp.json()]
        assert created_id in ids, f"Created channel {created_id} not in list: {ids}"

    @pytest.mark.asyncio
    async def test_get_single_channel_after_create(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Full C")
        create_resp = await async_client.post(
            "/v1/channels",
            json={"name": "Get Me", "icon": "star", "context_scope": "isolated_general"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 201
        channel_id = create_resp.json()["id"]

        get_resp = await async_client.get(f"/v1/channels/{channel_id}", headers=_auth(token))
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["id"] == channel_id
        assert data["icon"] == "star"
        assert data["contextScope"] == "isolated_general"


# ---------------------------------------------------------------------------
# Test 2 — Defaults: minimal body
# ---------------------------------------------------------------------------


class TestCreateChannelDefaults:
    @pytest.mark.asyncio
    async def test_minimal_body_defaults(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Minimal A")
        resp = await async_client.post(
            "/v1/channels",
            json={"name": "Minimal"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "Minimal"
        assert data["accent"] == "general"
        # icon and purpose omitted (None) — may be absent or null in response
        assert data.get("icon") is None
        assert data.get("purpose") is None
        assert data["contextScope"] == "isolated"

    @pytest.mark.asyncio
    async def test_defaults_agent_chat_open_items_zero(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Minimal B")
        resp = await async_client.post(
            "/v1/channels",
            json={"name": "Zeros"},
            headers=_auth(token),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["agentCount"] == 0
        assert data["chatCount"] == 0
        assert data["openItems"] == 0


# ---------------------------------------------------------------------------
# Test 3 — Validation: empty name → 422
# ---------------------------------------------------------------------------


class TestCreateChannelValidation:
    @pytest.mark.asyncio
    async def test_empty_name_rejected(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Validate A")
        resp = await async_client.post(
            "/v1/channels",
            json={"name": ""},
            headers=_auth(token),
        )
        assert resp.status_code in (400, 422), (
            f"Expected 400/422 for empty name, got {resp.status_code}: {resp.text}"
        )

    @pytest.mark.asyncio
    async def test_whitespace_only_name_rejected(self, async_client):
        token, _ = await _sign_up(async_client, name="CW Validate B")
        resp = await async_client.post(
            "/v1/channels",
            json={"name": "   "},
            headers=_auth(token),
        )
        assert resp.status_code in (400, 422), (
            f"Expected 400/422 for whitespace name, got {resp.status_code}: {resp.text}"
        )


# ---------------------------------------------------------------------------
# Test 4 — RLS / tenancy: company B cannot see company A's channel
# ---------------------------------------------------------------------------


class TestChannelTenancyIsolation:
    @pytest.mark.asyncio
    async def test_company_b_cannot_see_company_a_channel(self, async_client):
        """Channel created by company A must not appear in company B's list."""
        token_a, company_a_id = await _sign_up(async_client, name="CW Tenant A")
        token_b, company_b_id = await _sign_up(async_client, name="CW Tenant B")

        # Company A creates a channel
        create_resp = await async_client.post(
            "/v1/channels",
            json={"name": "A-Private", "context_scope": "isolated"},
            headers=_auth(token_a),
        )
        assert create_resp.status_code == 201
        channel_id = create_resp.json()["id"]

        # Company B lists channels — should not see A's channel
        list_resp = await async_client.get("/v1/channels", headers=_auth(token_b))
        assert list_resp.status_code == 200
        b_ids = [ch["id"] for ch in list_resp.json()]
        assert channel_id not in b_ids, (
            f"Company B should not see company A's channel {channel_id}, but got: {b_ids}"
        )

    @pytest.mark.asyncio
    async def test_created_channel_company_id_is_correct(self, async_client):
        """Verify via superuser session that company_id on the row = creator's company."""
        from omilo.db import SessionLocal
        from omilo.models.workspace import Channel

        token_a, company_a_id = await _sign_up(async_client, name="CW CompanyId A")

        create_resp = await async_client.post(
            "/v1/channels",
            json={"name": "CompanyId Check"},
            headers=_auth(token_a),
        )
        assert create_resp.status_code == 201
        channel_id = create_resp.json()["id"]

        # Use superuser (bypasses RLS) to confirm company_id
        with SessionLocal() as session:
            with session.begin():
                row = session.query(Channel).filter(Channel.id == channel_id).first()
                assert row is not None, "Channel row not found via superuser"
                assert row.company_id == company_a_id, (
                    f"Expected company_id={company_a_id}, got {row.company_id}"
                )
                assert row.context_scope == "isolated"
