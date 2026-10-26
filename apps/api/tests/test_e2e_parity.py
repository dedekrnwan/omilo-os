"""End-to-end parity smoke — Task 10.

Signs in as the demo owner (demo@omilo.app) against a seeded DB and asserts
the FULL Repos surface returns exactly what the UI fixture mocks did.

Fixture counts and spot-check values come from:
  src/adapters/mock/fixtures.ts (the TypeScript source of truth)

Run order safety: the module fixture calls seed_demo() which is idempotent,
so the test passes whether or not test_seed.py ran first.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from omilo.main import create_app
from omilo.seed.run import seed_demo

# ---------------------------------------------------------------------------
# Expected fixture values — match fixtures.ts EXACTLY
# ---------------------------------------------------------------------------

EXPECTED_CHANNEL_COUNT = 4
EXPECTED_CHANNEL_IDS = {"ch-general", "ch-engineering", "ch-marketing", "ch-business"}
EXPECTED_GOAL_COUNT = 10
EXPECTED_FOLDER_COUNT = 10
EXPECTED_SESSION_COUNT = 32
EXPECTED_INBOX_COUNT = 9
EXPECTED_INBOX_PASSKEY_PROPOSALS = 3

DEMO_EMAIL = "demo@omilo.app"
DEMO_PASSWORD = "demo-password-1234"
DEMO_COMPANY_ID = "cmp_demo"


# ---------------------------------------------------------------------------
# Module-scoped fixture: ensure DB is seeded before any test in this module
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def seeded_demo_db():
    """Idempotently seed the demo company before e2e tests."""
    seed_demo()
    yield


# ---------------------------------------------------------------------------
# Session-scoped async client + token for the demo owner
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
async def demo_token(seeded_demo_db) -> str:
    """Sign in as demo@omilo.app and return the access token.

    Asserts that the active company in the token is cmp_demo.
    """
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(
            "/v1/auth/sign-in",
            json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        )
    assert resp.status_code == 200, f"sign-in failed: {resp.status_code} {resp.text}"
    body = resp.json()
    token = body["session"]["access"]

    # Verify active company is cmp_demo by decoding the token claims via /me
    app2 = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app2),
        base_url="http://test",
    ) as client2:
        me_resp = await client2.get(
            "/v1/me",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert me_resp.status_code == 200, f"/me failed: {me_resp.status_code} {me_resp.text}"
    me = me_resp.json()
    assert me["company"]["id"] == DEMO_COMPANY_ID, (
        f"Active company must be {DEMO_COMPANY_ID!r}, got {me['company']['id']!r}"
    )
    return token


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# E2E Test 1: GET /v1/channels — 4 channels, correct ids, ch-general spot-check
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_channels_parity(demo_token):
    """GET /v1/channels returns all 4 fixture channels with correct ids + values."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/channels", headers=_auth(demo_token))

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == EXPECTED_CHANNEL_COUNT, (
        f"Expected {EXPECTED_CHANNEL_COUNT} channels, got {len(data)}"
    )

    ids_returned = {c["id"] for c in data}
    assert ids_returned == EXPECTED_CHANNEL_IDS, (
        f"Channel ids mismatch: got {ids_returned}"
    )

    # Spot-check ch-general
    general = next(c for c in data if c["id"] == "ch-general")
    assert general["name"] == "General"
    assert general["isDefault"] is True
    assert general["chatCount"] == 31

    # camelCase keys must be present, snake_case absent
    assert "agentCount" in general, "camelCase agentCount missing"
    assert "chatCount" in general, "camelCase chatCount missing"
    assert "openItems" in general, "camelCase openItems missing"
    assert "agent_count" not in general, "snake_case agent_count must be absent"
    assert "chat_count" not in general, "snake_case chat_count must be absent"
    assert "open_items" not in general, "snake_case open_items must be absent"


# ---------------------------------------------------------------------------
# E2E Test 2: GET /v1/goals — 10 goals, g-passkeys progress=40
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_goals_parity(demo_token):
    """GET /v1/goals returns all 10 fixture goals; g-passkeys progress=40."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/goals", headers=_auth(demo_token))

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == EXPECTED_GOAL_COUNT, (
        f"Expected {EXPECTED_GOAL_COUNT} goals, got {len(data)}"
    )

    passkeys_goal = next((g for g in data if g["id"] == "g-passkeys"), None)
    assert passkeys_goal is not None, "Goal 'g-passkeys' not found in response"
    assert passkeys_goal["progress"] == 40, (
        f"g-passkeys progress should be 40, got {passkeys_goal['progress']}"
    )
    assert "channelId" in passkeys_goal, "camelCase channelId missing from goal"
    assert "channel_id" not in passkeys_goal, "snake_case channel_id must be absent"


# ---------------------------------------------------------------------------
# E2E Test 3: GET /v1/folders — 10 folders, f-q4 count=6
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_folders_parity(demo_token):
    """GET /v1/folders returns all 10 fixture folders; f-q4 count=6."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/folders", headers=_auth(demo_token))

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == EXPECTED_FOLDER_COUNT, (
        f"Expected {EXPECTED_FOLDER_COUNT} folders, got {len(data)}"
    )

    f_q4 = next((f for f in data if f["id"] == "f-q4"), None)
    assert f_q4 is not None, "Folder 'f-q4' not found in response"
    assert f_q4["count"] == 6, f"f-q4 count should be 6, got {f_q4['count']}"
    assert "channelId" in f_q4, "camelCase channelId missing from folder"
    assert "channel_id" not in f_q4, "snake_case channel_id must be absent"


# ---------------------------------------------------------------------------
# E2E Test 4: GET /v1/sessions — 32 sessions
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_sessions_list_parity(demo_token):
    """GET /v1/sessions returns all 32 fixture sessions."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/sessions", headers=_auth(demo_token))

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == EXPECTED_SESSION_COUNT, (
        f"Expected {EXPECTED_SESSION_COUNT} sessions, got {len(data)}"
    )


# ---------------------------------------------------------------------------
# E2E Test 5: GET /v1/channels/ch-engineering/sessions includes sess-passkey
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_channel_sessions_parity(demo_token):
    """GET /v1/channels/ch-engineering/sessions includes sess-passkey."""
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/v1/channels/ch-engineering/sessions",
            headers=_auth(demo_token),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    ids = [s["id"] for s in data]
    assert "sess-passkey" in ids, (
        f"sess-passkey not found in ch-engineering sessions: {ids}"
    )
    # channelId camelCase present
    first = data[0]
    assert "channelId" in first, "camelCase channelId missing from session"
    assert "channel_id" not in first, "snake_case channel_id must be absent"


# ---------------------------------------------------------------------------
# E2E Test 6: GET /v1/sessions/sess-passkey/messages — passkey messages
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_session_messages_parity(demo_token):
    """GET /v1/sessions/sess-passkey/messages returns passkey messages.

    Asserts:
    - The first user message content matches fixtures.ts msg-pk-1
    - Both 'you' and 'helper' kind authors are present
    - camelCase keys sessionId, createdAt are present
    """
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get(
            "/v1/sessions/sess-passkey/messages",
            headers=_auth(demo_token),
        )

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1, "Expected at least 1 passkey message"

    # All messages should be for sess-passkey
    for msg in data:
        assert msg.get("sessionId") == "sess-passkey", (
            f"Message sessionId mismatch: {msg.get('sessionId')}"
        )

    # Find the first user message (msg-pk-1) by id
    msg_pk_1 = next((m for m in data if m["id"] == "msg-pk-1"), None)
    assert msg_pk_1 is not None, "msg-pk-1 not found in sess-passkey messages"
    assert "Can we ship passkeys" in msg_pk_1["content"], (
        f"msg-pk-1 content mismatch: {msg_pk_1['content']!r}"
    )
    assert msg_pk_1["author"]["kind"] == "you", (
        f"msg-pk-1 author kind should be 'you', got {msg_pk_1['author']['kind']!r}"
    )

    # Check that helper-kind authors are also present
    kinds = {m["author"]["kind"] for m in data}
    assert "helper" in kinds, f"Expected 'helper' kind messages; found kinds: {kinds}"
    assert "you" in kinds, f"Expected 'you' kind messages; found kinds: {kinds}"

    # camelCase keys
    first = data[0]
    assert "sessionId" in first, "camelCase sessionId missing from message"
    assert "createdAt" in first, "camelCase createdAt missing from message"
    assert "session_id" not in first, "snake_case session_id must be absent"
    assert "created_at" not in first, "snake_case created_at must be absent"


# ---------------------------------------------------------------------------
# E2E Test 7: GET /v1/inbox — 9 items, inbox-passkey-tasks has 3 proposals
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_inbox_parity(demo_token):
    """GET /v1/inbox returns 9 fixture inbox items.

    inbox-passkey-tasks has 3 proposals, each with who/area/text/due.
    """
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/v1/inbox", headers=_auth(demo_token))

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == EXPECTED_INBOX_COUNT, (
        f"Expected {EXPECTED_INBOX_COUNT} inbox items, got {len(data)}"
    )

    # Spot-check inbox-passkey-tasks
    passkey_item = next((i for i in data if i["id"] == "inbox-passkey-tasks"), None)
    assert passkey_item is not None, "inbox-passkey-tasks not found in /v1/inbox"

    proposals = passkey_item.get("proposals")
    assert proposals is not None, "inbox-passkey-tasks must have proposals field"
    assert isinstance(proposals, list), f"proposals must be a list, got {type(proposals)}"
    assert len(proposals) == EXPECTED_INBOX_PASSKEY_PROPOSALS, (
        f"Expected {EXPECTED_INBOX_PASSKEY_PROPOSALS} proposals, got {len(proposals)}"
    )

    # Each proposal must have who/area/text/due
    for proposal in proposals:
        assert "who" in proposal, f"proposal missing 'who': {proposal}"
        assert "area" in proposal, f"proposal missing 'area': {proposal}"
        assert "text" in proposal, f"proposal missing 'text': {proposal}"
        assert "due" in proposal, f"proposal missing 'due': {proposal}"

    # Verify proposal values match fixtures.ts exactly
    expected_proposals = [
        {"who": "Dev",    "area": "dev",       "text": "Ship passkeys on web + iOS",     "due": "Nov 14"},
        {"who": "Dev",    "area": "dev",       "text": "Android password fallback flow", "due": "Nov 21"},
        {"who": "Growth", "area": "marketing", "text": "Launch comms to all users",      "due": "Nov 24"},
    ]
    for exp, got in zip(expected_proposals, proposals):
        assert got["who"] == exp["who"], f"proposal who mismatch: {got['who']!r} != {exp['who']!r}"
        assert got["area"] == exp["area"], f"proposal area mismatch: {got['area']!r} != {exp['area']!r}"
        assert got["text"] == exp["text"], f"proposal text mismatch: {got['text']!r} != {exp['text']!r}"
        assert got["due"] == exp["due"], f"proposal due mismatch: {got['due']!r} != {exp['due']!r}"

    # camelCase keys in inbox item
    assert "sessionId" in passkey_item, "camelCase sessionId missing from inbox item"
    assert "channelId" in passkey_item, "camelCase channelId missing from inbox item"
    assert "askerArea" in passkey_item, "camelCase askerArea missing from inbox item"
    assert "createdAt" in passkey_item, "camelCase createdAt missing from inbox item"
    assert "needsYou" in passkey_item, "camelCase needsYou missing from inbox item"
    assert "session_id" not in passkey_item, "snake_case session_id must be absent"
    assert "channel_id" not in passkey_item, "snake_case channel_id must be absent"
    assert "asker_area" not in passkey_item, "snake_case asker_area must be absent"
    assert "created_at" not in passkey_item, "snake_case created_at must be absent"
    assert "needs_you" not in passkey_item, "snake_case needs_you must be absent"


# ---------------------------------------------------------------------------
# E2E Test 8: Idempotency — re-seeding must not change counts
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_e2e_reseed_idempotency(demo_token):
    """Calling seed_demo() again must not duplicate any data."""
    seed_demo()  # second run

    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        headers = _auth(demo_token)
        channels_resp = await client.get("/v1/channels", headers=headers)
        goals_resp = await client.get("/v1/goals", headers=headers)
        folders_resp = await client.get("/v1/folders", headers=headers)
        sessions_resp = await client.get("/v1/sessions", headers=headers)
        inbox_resp = await client.get("/v1/inbox", headers=headers)

    assert len(channels_resp.json()) == EXPECTED_CHANNEL_COUNT
    assert len(goals_resp.json()) == EXPECTED_GOAL_COUNT
    assert len(folders_resp.json()) == EXPECTED_FOLDER_COUNT
    assert len(sessions_resp.json()) == EXPECTED_SESSION_COUNT
    assert len(inbox_resp.json()) == EXPECTED_INBOX_COUNT
