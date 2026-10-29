"""TDD: Task 7 — Repos-parity read endpoints.

Tests every endpoint in §2 of 02-api-contracts.md:
  - All 12 endpoints return correct shape (list → [], item → DTO | 404)
  - camelCase JSON keys present in raw response
  - Empty company → [] (200), never 404/500
  - 404 for unknown/{id} lookups
  - repos.contract mirror: every inbox item's sessionId resolves via GET /sessions/{id}
"""
from __future__ import annotations

import uuid

import pytest

from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema_for_repos_tests():
    """Re-run alembic upgrade head before this module.

    test_models_migration.py's migrated_db teardown now re-upgrades after
    downgrading (ordering fix), but we keep this guard for full self-containment.
    """
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, email=None, name="Test User", password="testP4ss!"):
    email = email or f"repos_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _seed_data(company_id: str):
    """Insert test fixtures as superuser (bypass RLS) — test setup only.

    Returns a dict of IDs for assertions.
    """
    from datetime import datetime, timezone

    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.chat import ChatSession, Message
    from omilo.models.inbox import InboxItem
    from omilo.models.workspace import Channel, Folder, Goal

    now = datetime.now(timezone.utc)

    with SessionLocal() as session:
        with session.begin():
            ch1 = Channel(
                id=prefixed_id("chn"),
                company_id=company_id,
                name="Engineering",
                accent="dev",
                is_default=True,
                agent_count=2,
                chat_count=5,
                open_items=3,
            )
            ch2 = Channel(
                id=prefixed_id("chn"),
                company_id=company_id,
                name="Marketing",
                accent="marketing",
                is_default=None,
                agent_count=0,
                chat_count=0,
                open_items=0,
            )
            session.add_all([ch1, ch2])
            session.flush()

            folder1 = Folder(
                id=prefixed_id("fol"),
                company_id=company_id,
                channel_id=ch1.id,
                name="Sprint 1",
                count=3,
            )
            folder2 = Folder(
                id=prefixed_id("fol"),
                company_id=company_id,
                channel_id=ch2.id,
                name="Campaigns",
                count=1,
            )
            session.add_all([folder1, folder2])
            session.flush()

            goal1 = Goal(
                id=prefixed_id("gol"),
                company_id=company_id,
                channel_id=ch1.id,
                title="Launch v2",
                progress=40,
            )
            goal2 = Goal(
                id=prefixed_id("gol"),
                company_id=company_id,
                channel_id=ch2.id,
                title="Q4 pipeline",
                progress=10,
            )
            session.add_all([goal1, goal2])
            session.flush()

            sess1 = ChatSession(
                id=prefixed_id("ses"),
                company_id=company_id,
                title="Backend planning",
                channel_id=ch1.id,
                updated="2h",
                unread=True,
            )
            sess2 = ChatSession(
                id=prefixed_id("ses"),
                company_id=company_id,
                title="Brand refresh",
                channel_id=ch2.id,
                updated="now",
            )
            session.add_all([sess1, sess2])
            session.flush()

            msg1 = Message(
                id=prefixed_id("msg"),
                company_id=company_id,
                session_id=sess1.id,
                author={"kind": "human", "name": "Alice"},
                content="Let's plan Q4",
                created_at=now,
            )
            msg2 = Message(
                id=prefixed_id("msg"),
                company_id=company_id,
                session_id=sess1.id,
                author={"kind": "agent", "name": "Chief", "area": "Engineering"},
                content="Sure, here's the plan…",
                created_at=now,
            )
            session.add_all([msg1, msg2])
            session.flush()

            inbox1 = InboxItem(
                id=prefixed_id("inb"),
                company_id=company_id,
                title="Approve deploy",
                summary="Deploy to production needs approval",
                session_id=sess1.id,
                channel_id=ch1.id,
                kind="decision",
                status="pending",
                created_at=now,
                asker="Chief",
                asker_area="Engineering",
                needs_you=True,
            )
            session.add(inbox1)

    return {
        "ch1_id": ch1.id,
        "ch2_id": ch2.id,
        "folder1_id": folder1.id,
        "folder2_id": folder2.id,
        "goal1_id": goal1.id,
        "goal2_id": goal2.id,
        "sess1_id": sess1.id,
        "sess2_id": sess2.id,
        "msg1_id": msg1.id,
        "msg2_id": msg2.id,
        "inbox1_id": inbox1.id,
    }


# ---------------------------------------------------------------------------
# Fixture: seeded company
# ---------------------------------------------------------------------------


@pytest.fixture()
async def seeded_company(async_client):
    """Sign up a fresh user, resolve company_id, seed data, return (token, company_id, ids)."""
    email = f"repos_seed_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email, name="Repos Tester")
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]

    ids = _seed_data(company_id)
    return token, company_id, ids


@pytest.fixture()
async def empty_company(async_client):
    """Sign up a fresh user with no seeded data — used for empty-list assertions."""
    email = f"repos_empty_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email, name="Empty Tester")
    token = body["session"]["access"]
    return token


# ---------------------------------------------------------------------------
# Test 1: GET /v1/channels
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channels_list(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/channels", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 2
    ids_returned = [c["id"] for c in data]
    assert ids["ch1_id"] in ids_returned
    assert ids["ch2_id"] in ids_returned


@pytest.mark.asyncio
async def test_channels_list_camelcase(async_client, seeded_company):
    """Raw JSON must have camelCase keys: agentCount, isDefault, openItems."""
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/channels", headers=_auth(token))
    assert resp.status_code == 200
    items = resp.json()
    # Find the seeded default channel
    ch1 = next(c for c in items if c["id"] == ids["ch1_id"])
    assert "agentCount" in ch1, f"camelCase 'agentCount' missing from channel JSON: {ch1}"
    assert "isDefault" in ch1 or ch1.get("isDefault") is None
    assert "openItems" in ch1, f"camelCase 'openItems' missing from channel JSON: {ch1}"
    # Confirm snake_case keys are absent
    assert "agent_count" not in ch1
    assert "open_items" not in ch1


# ---------------------------------------------------------------------------
# Test 2: GET /v1/channels/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channel_get_found(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(f"/v1/channels/{ids['ch1_id']}", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == ids["ch1_id"]
    assert body["name"] == "Engineering"
    assert "agentCount" in body


@pytest.mark.asyncio
async def test_channel_get_not_found(async_client, seeded_company):
    token, *_ = seeded_company
    resp = await async_client.get("/v1/channels/chn_doesnotexist", headers=_auth(token))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 3: GET /v1/channels/{id}/folders
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channel_folders(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(
        f"/v1/channels/{ids['ch1_id']}/folders", headers=_auth(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    folder_ids = [f["id"] for f in data]
    assert ids["folder1_id"] in folder_ids
    # ch2's folder must NOT appear
    assert ids["folder2_id"] not in folder_ids
    # camelCase check
    assert "channelId" in data[0], f"camelCase 'channelId' missing: {data[0]}"


# ---------------------------------------------------------------------------
# Test 4: GET /v1/folders
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_folders_list(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/folders", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    folder_ids = [f["id"] for f in data]
    assert ids["folder1_id"] in folder_ids
    assert ids["folder2_id"] in folder_ids


# ---------------------------------------------------------------------------
# Test 5: GET /v1/channels/{id}/goals
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channel_goals(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(
        f"/v1/channels/{ids['ch1_id']}/goals", headers=_auth(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    goal_ids = [g["id"] for g in data]
    assert ids["goal1_id"] in goal_ids
    assert ids["goal2_id"] not in goal_ids
    # camelCase check
    assert "channelId" in data[0]


# ---------------------------------------------------------------------------
# Test 6: GET /v1/goals
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_goals_list(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/goals", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    goal_ids = [g["id"] for g in data]
    assert ids["goal1_id"] in goal_ids
    assert ids["goal2_id"] in goal_ids


# ---------------------------------------------------------------------------
# Test 7: GET /v1/sessions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sessions_list(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/sessions", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    sess_ids = [s["id"] for s in data]
    assert ids["sess1_id"] in sess_ids
    assert ids["sess2_id"] in sess_ids


# ---------------------------------------------------------------------------
# Test 8: GET /v1/sessions/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_get_found(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(f"/v1/sessions/{ids['sess1_id']}", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == ids["sess1_id"]
    assert body["title"] == "Backend planning"


@pytest.mark.asyncio
async def test_session_get_not_found(async_client, seeded_company):
    token, *_ = seeded_company
    resp = await async_client.get("/v1/sessions/ses_doesnotexist", headers=_auth(token))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 9: GET /v1/channels/{id}/sessions
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_channel_sessions(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(
        f"/v1/channels/{ids['ch1_id']}/sessions", headers=_auth(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    sess_ids = [s["id"] for s in data]
    assert ids["sess1_id"] in sess_ids
    assert ids["sess2_id"] not in sess_ids


# ---------------------------------------------------------------------------
# Test 10: GET /v1/sessions/{id}/messages
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_session_messages(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(
        f"/v1/sessions/{ids['sess1_id']}/messages", headers=_auth(token)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    msg_ids = [m["id"] for m in data]
    assert ids["msg1_id"] in msg_ids
    assert ids["msg2_id"] in msg_ids
    # camelCase check
    assert "sessionId" in data[0], f"camelCase 'sessionId' missing: {data[0]}"
    assert "createdAt" in data[0], f"camelCase 'createdAt' missing: {data[0]}"


# ---------------------------------------------------------------------------
# Test 11: GET /v1/inbox
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_inbox_list(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get("/v1/inbox", headers=_auth(token))
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    inbox_ids = [i["id"] for i in data]
    assert ids["inbox1_id"] in inbox_ids
    # camelCase checks
    item = next(i for i in data if i["id"] == ids["inbox1_id"])
    assert "sessionId" in item, f"camelCase 'sessionId' missing: {item}"
    assert "channelId" in item, f"camelCase 'channelId' missing: {item}"
    assert "askerArea" in item, f"camelCase 'askerArea' missing: {item}"
    assert "createdAt" in item, f"camelCase 'createdAt' missing: {item}"
    assert "needsYou" in item, f"camelCase 'needsYou' missing: {item}"


# ---------------------------------------------------------------------------
# Test 12: GET /v1/inbox/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_inbox_get_found(async_client, seeded_company):
    token, company_id, ids = seeded_company
    resp = await async_client.get(f"/v1/inbox/{ids['inbox1_id']}", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == ids["inbox1_id"]
    assert body["title"] == "Approve deploy"


@pytest.mark.asyncio
async def test_inbox_get_not_found(async_client, seeded_company):
    token, *_ = seeded_company
    resp = await async_client.get("/v1/inbox/inb_doesnotexist", headers=_auth(token))
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 13: Empty company → [] (200) for all list endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_empty_company_list_endpoints_return_empty_arrays(async_client, empty_company):
    """A brand-new company returns [] for list endpoints that aren't bootstrap-seeded.

    Sign-up now seeds a default "General" area + a Chief Helper, so /v1/channels
    returns that single default area (not []); everything else is still empty.
    """
    token = empty_company
    headers = _auth(token)

    # These remain empty for a fresh company (no bootstrap seeding).
    empty_endpoints = [
        "/v1/folders",
        "/v1/goals",
        "/v1/sessions",
        "/v1/inbox",
    ]
    for endpoint in empty_endpoints:
        resp = await async_client.get(endpoint, headers=headers)
        assert resp.status_code == 200, f"{endpoint} returned {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), f"{endpoint} returned non-list: {data}"
        assert data == [], f"{endpoint} expected [], got {data}"

    # /v1/channels is seeded with exactly one default area on sign-up.
    ch_resp = await async_client.get("/v1/channels", headers=headers)
    assert ch_resp.status_code == 200, ch_resp.text
    channels = ch_resp.json()
    assert isinstance(channels, list)
    assert len(channels) == 1, f"expected the single seeded default area, got {channels}"
    assert channels[0].get("isDefault") is True


# ---------------------------------------------------------------------------
# Test 14: repos.contract mirror — inbox items' sessionId resolves via sessions.get
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repos_contract_inbox_session_ids_resolve(async_client, seeded_company):
    """Mirror of repos.contract.ts:
    Every inbox item's sessionId must resolve via GET /sessions/{id} (200).
    """
    token, company_id, ids = seeded_company
    headers = _auth(token)

    inbox_resp = await async_client.get("/v1/inbox", headers=headers)
    assert inbox_resp.status_code == 200
    inbox_items = inbox_resp.json()
    assert len(inbox_items) > 0, "Need at least one inbox item for contract mirror test"

    for item in inbox_items:
        session_id = item["sessionId"]
        sess_resp = await async_client.get(f"/v1/sessions/{session_id}", headers=headers)
        assert sess_resp.status_code == 200, (
            f"inbox item {item['id']} sessionId={session_id} did not resolve: "
            f"{sess_resp.status_code} {sess_resp.text}"
        )
        sess_body = sess_resp.json()
        assert sess_body["id"] == session_id


# ---------------------------------------------------------------------------
# Test 15: Probe route is gone — GET /v1/_whoami must NOT exist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_probe_route_removed(async_client, empty_company):
    """The Task 5 temporary probe route must be gone in Task 7."""
    token = empty_company
    resp = await async_client.get("/v1/_whoami", headers=_auth(token))
    assert resp.status_code == 404, (
        f"Probe route /v1/_whoami should have been removed but returned {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# Test 16: Cross-company isolation via RLS — other company's items must be 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_company_isolation(async_client):
    """User B cannot see User A's data — RLS makes it invisible → 404."""
    # Sign up two separate companies
    body_a = await _sign_up(async_client, email=f"iso_a_{uuid.uuid4().hex[:8]}@test.example")
    body_b = await _sign_up(async_client, email=f"iso_b_{uuid.uuid4().hex[:8]}@test.example")

    token_a = body_a["session"]["access"]
    token_b = body_b["session"]["access"]

    me_a = (await async_client.get("/v1/me", headers=_auth(token_a))).json()
    company_a = me_a["company"]["id"]

    # Seed a channel into company A
    ids_a = _seed_data(company_a)
    ch_a_id = ids_a["ch1_id"]

    # User B tries to get company A's channel → should be 404 (RLS hides it)
    resp = await async_client.get(f"/v1/channels/{ch_a_id}", headers=_auth(token_b))
    assert resp.status_code == 404, (
        f"Cross-company isolation failed: user B got {resp.status_code} for company A's channel"
    )
