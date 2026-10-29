"""TDD: Task 5 — Chat write + Helper turn endpoints.

Tests:
1. POST /v1/sessions creates a SessionDTO; GET it back.
2. POST /v1/sessions/{id}/messages with plain content:
   - returns {message, job_id}
   - operator Message is persisted
   - GET /v1/sessions/{id}/messages returns BOTH operator + assistant messages
3. Message with side-effect sentinel ('Reply\\nSEND: hi') → Proposal + decision
   InboxItem exist; endpoint still returns {message, job_id}.
4. Tenancy: user of company B cannot POST to company A's session (404).
5. No helper in company → 409.

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
# Low-level helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, email=None, name="Chat Tester", password="testP4ss!"):
    email = email or f"chat_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_chief_helper(company_id: str) -> str:
    """Insert a Chief Helper (is_chief=True, engine=fake) for *company_id*.

    Bypasses RLS (superuser session) — test setup only.
    Returns the helper.id.
    """
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            helper = Helper(
                id=prefixed_id("hlp"),
                company_id=company_id,
                name="Chief",
                area="ops",
                is_chief=True,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            session.add(helper)
            session.flush()
            return helper.id


# ---------------------------------------------------------------------------
# Fixture: authenticated user + Chief helper for their company
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_with_chief(async_client):
    """Sign up a fresh user, seed a Chief Helper, return (token, company_id)."""
    body = await _sign_up(async_client)
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]

    _seed_chief_helper(company_id)

    return token, company_id


# ---------------------------------------------------------------------------
# Test 1 — Create a session
# ---------------------------------------------------------------------------


class TestCreateSession:
    @pytest.mark.asyncio
    async def test_create_session_201(self, async_client, company_with_chief):
        token, company_id = company_with_chief
        resp = await async_client.post(
            "/v1/sessions",
            json={"title": "My chat", "scope": "chat"},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert "id" in data
        assert data["title"] == "My chat"

    @pytest.mark.asyncio
    async def test_create_session_default_title(self, async_client, company_with_chief):
        token, _ = company_with_chief
        resp = await async_client.post(
            "/v1/sessions",
            json={},
            headers=_auth(token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["title"] == "New chat"

    @pytest.mark.asyncio
    async def test_get_session_after_create(self, async_client, company_with_chief):
        token, _ = company_with_chief
        create_resp = await async_client.post(
            "/v1/sessions",
            json={"title": "Fetch me"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 201
        session_id = create_resp.json()["id"]

        get_resp = await async_client.get(
            f"/v1/sessions/{session_id}",
            headers=_auth(token),
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["id"] == session_id


# ---------------------------------------------------------------------------
# Test 2 — Post a message → operator + assistant messages present
# ---------------------------------------------------------------------------


class TestPostMessage:
    @pytest.mark.asyncio
    async def test_post_message_returns_message_and_job_id(
        self, async_client, company_with_chief
    ):
        token, _ = company_with_chief
        # Create session
        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Hello"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "message" in data
        assert "job_id" in data
        assert data["job_id"].startswith("job_")

    @pytest.mark.asyncio
    async def test_operator_message_persisted(self, async_client, company_with_chief):
        token, _ = company_with_chief
        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Operator message"},
            headers=_auth(token),
        )

        msgs_resp = await async_client.get(
            f"/v1/sessions/{session_id}/messages",
            headers=_auth(token),
        )
        assert msgs_resp.status_code == 200
        msgs = msgs_resp.json()
        contents = [m["content"] for m in msgs]
        assert "Operator message" in contents

    @pytest.mark.asyncio
    async def test_both_operator_and_assistant_messages_present(
        self, async_client, company_with_chief
    ):
        """After posting a message both the operator msg and the Helper reply
        must appear in GET /v1/sessions/{id}/messages."""
        token, _ = company_with_chief
        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        post_resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Hello"},
            headers=_auth(token),
        )
        assert post_resp.status_code == 200

        msgs_resp = await async_client.get(
            f"/v1/sessions/{session_id}/messages",
            headers=_auth(token),
        )
        assert msgs_resp.status_code == 200
        msgs = msgs_resp.json()

        # At least two messages: one from operator ("you"), one from helper
        assert len(msgs) >= 2, f"Expected ≥2 messages, got {len(msgs)}: {msgs}"

        kinds = {m["author"]["kind"] for m in msgs}
        assert "you" in kinds, f"No 'you' message found: {msgs}"
        assert "helper" in kinds, f"No 'helper' message found: {msgs}"

    @pytest.mark.asyncio
    async def test_operator_message_dto_shape(self, async_client, company_with_chief):
        token, _ = company_with_chief
        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Shape check"},
            headers=_auth(token),
        )
        msg = resp.json()["message"]
        # Must match TS Message shape: id, sessionId, author, content, createdAt
        for field in ("id", "sessionId", "author", "content", "createdAt"):
            assert field in msg, f"Missing field {field!r} in message DTO: {msg}"
        assert msg["author"]["kind"] == "you"
        assert msg["content"] == "Shape check"


# ---------------------------------------------------------------------------
# Test 3 — Side-effect sentinel → Proposal + InboxItem (waiting job)
# ---------------------------------------------------------------------------


class TestSideEffectSentinel:
    @pytest.mark.asyncio
    async def test_sentinel_creates_proposal_and_inbox_item(
        self, async_client, company_with_chief
    ):
        """A SEND: sentinel triggers needs_owner → Proposal + decision InboxItem."""
        from omilo.db import SessionLocal
        from omilo.models.approvals import Proposal
        from omilo.models.inbox import InboxItem

        token, company_id = company_with_chief

        # Use 'ask' autonomy (default) + SEND: sentinel → needs_owner verdict
        # First update company autonomy_default to 'ask' (it already is by default)

        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Reply\nSEND: hi"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "job_id" in data
        job_id = data["job_id"]

        # Verify Proposal and decision InboxItem exist (superuser read)
        with SessionLocal() as session:
            with session.begin():
                proposal = (
                    session.query(Proposal)
                    .filter(Proposal.job_id == job_id)
                    .first()
                )
                assert proposal is not None, "Proposal not created for waiting job"
                assert proposal.status == "pending"

                inbox_item = (
                    session.query(InboxItem)
                    .filter(
                        InboxItem.company_id == company_id,
                        InboxItem.kind == "decision",
                    )
                    .first()
                )
                assert inbox_item is not None, "Decision InboxItem not created"

    @pytest.mark.asyncio
    async def test_sentinel_endpoint_still_returns_200(
        self, async_client, company_with_chief
    ):
        """Even for a waiting job the endpoint must return 200 with {message, job_id}."""
        token, _ = company_with_chief
        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        session_id = sess_resp.json()["id"]

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Reply\nSEND: hi"},
            headers=_auth(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "message" in data
        assert "job_id" in data


# ---------------------------------------------------------------------------
# Test 4 — Tenancy: company B cannot access company A's session
# ---------------------------------------------------------------------------


class TestTenancyIsolation:
    @pytest.mark.asyncio
    async def test_other_company_gets_404(self, async_client):
        """A user from company B cannot post to company A's session."""
        # Company A: sign up + create session
        body_a = await _sign_up(async_client, name="User A")
        token_a = body_a["session"]["access"]

        me_a = await async_client.get("/v1/me", headers=_auth(token_a))
        company_a_id = me_a.json()["company"]["id"]
        _seed_chief_helper(company_a_id)

        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token_a)
        )
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

        # Company B: sign up, try to POST to A's session
        body_b = await _sign_up(async_client, name="User B")
        token_b = body_b["session"]["access"]

        me_b = await async_client.get("/v1/me", headers=_auth(token_b))
        company_b_id = me_b.json()["company"]["id"]
        _seed_chief_helper(company_b_id)

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "I should not see this"},
            headers=_auth(token_b),
        )
        # RLS returns no rows → session lookup is None → 404
        assert resp.status_code in (404, 403), (
            f"Expected 404/403, got {resp.status_code}: {resp.text}"
        )


# ---------------------------------------------------------------------------
# Test 5 — No helper in company → 409
# ---------------------------------------------------------------------------


class TestNoHelper:
    @pytest.mark.asyncio
    async def test_no_helper_returns_409(self, async_client):
        """A company with no helpers should get a 409 on POST /sessions/{id}/messages."""
        body = await _sign_up(async_client, name="No-Helper User")
        token = body["session"]["access"]

        # Sign-up now seeds a default Chief + area. To exercise the genuine
        # "no helper" branch, remove every helper for this company first.
        me = await async_client.get("/v1/me", headers=_auth(token))
        company_id = me.json()["company"]["id"]
        from omilo.db import SessionLocal
        from omilo.models.agents import Helper

        with SessionLocal() as _sess:
            with _sess.begin():
                _sess.query(Helper).filter(
                    Helper.company_id == company_id
                ).delete(synchronize_session=False)

        sess_resp = await async_client.post(
            "/v1/sessions", json={}, headers=_auth(token)
        )
        assert sess_resp.status_code == 201
        session_id = sess_resp.json()["id"]

        resp = await async_client.post(
            f"/v1/sessions/{session_id}/messages",
            json={"content": "Anyone there?"},
            headers=_auth(token),
        )
        assert resp.status_code == 409, (
            f"Expected 409 when no helper exists, got {resp.status_code}: {resp.text}"
        )
