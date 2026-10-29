"""TDD — Task 4: Flow CRUD + publish.

Tests:
1. POST /v1/flows {trigger:{kind:"schedule",...},nodes,edges} → 200, status=draft.
2. POST /v1/flows {trigger:{kind:"webhook",...}} → 422 (webhook rejected).
3. POST /v1/flows {trigger:{kind:"connector_webhook",...}} → 422.
4. GET /v1/flows → lists the created flow (FlowCard shape).
5. GET /v1/flows/{id} → full Flow (nodes/edges/trigger).
6. PATCH /v1/flows/{id} {title:"renamed"} → updated flow returned.
7. POST /v1/flows/{id}/publish → Proposal (type=flow_publish, pending) +
   decision InboxItem; returns the proposal.
8. GET /v1/flows/{id}/runs → [] (no runs yet).
9. Tenancy: company B cannot GET / PATCH / publish company A's flow → 404.

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import timezone

import pytest

from omilo.db import SessionLocal
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company, Member, User


# ---------------------------------------------------------------------------
# Schema guard
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    from tests.utils import run_alembic

    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Session helpers (mirrors test_approvals.py)
# ---------------------------------------------------------------------------


class _SuperuserSession:
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


def _superuser_session():
    return _SuperuserSession()


class _TenantSession:
    def __init__(self, company_id: str):
        self._company_id = company_id

    def __enter__(self):
        from sqlalchemy import text
        from omilo.db import set_company

        self._sess = SessionLocal()
        self._txn = self._sess.begin()
        self._sess.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(self._sess, self._company_id)
        return self._sess

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self._txn.rollback()
        else:
            self._txn.commit()
        self._sess.close()


def _tenant_session(company_id: str):
    return _TenantSession(company_id)


# ---------------------------------------------------------------------------
# Data factories
# ---------------------------------------------------------------------------


def _make_company(db) -> Company:
    cmp = Company(
        id=prefixed_id("cmp"),
        name=f"FlowsCo-{uuid.uuid4().hex[:6]}",
        color="#123456",
        autonomy_default="ask",
    )
    db.add(cmp)
    db.flush()
    return cmp


def _make_user_member(db, *, company_id: str) -> tuple[User, Member]:
    user = User(
        id=prefixed_id("usr"),
        email=f"flw_{uuid.uuid4().hex[:8]}@test.example",
        name="Flow User",
        hashed_password="x",
    )
    db.add(user)
    db.flush()
    member = Member(
        id=prefixed_id("mem"),
        company_id=company_id,
        user_id=user.id,
        role="owner",
    )
    db.add(member)
    db.flush()
    return user, member


def _make_helper(db, *, company_id: str, is_chief: bool = True) -> Helper:
    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name="Chief",
        area="ops",
        is_chief=is_chief,
        engine={"type": "fake"},
        autonomy_cap=None,
        permissions=[],
        status="active",
        channel_ids=[],
    )
    db.add(helper)
    db.flush()
    return helper


# ---------------------------------------------------------------------------
# Fixtures: two isolated tenants
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def tenant_a():
    """Company A + a Chief helper."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id, is_chief=True)
        helper_id = helper.id

    return company_id, helper_id


@pytest.fixture(scope="module")
def tenant_b():
    """Company B (for isolation tests)."""
    with _superuser_session() as su:
        cmp = _make_company(su)
        company_id = cmp.id

    with _tenant_session(company_id) as db:
        helper = _make_helper(db, company_id=company_id, is_chief=True)
        helper_id = helper.id

    return company_id, helper_id


async def _get_token_for_company(client, company_id: str) -> str:
    """Sign up a fresh user, insert a Member for company_id, return token.

    All requests using the returned token should include
    ``X-Company-Id: company_id`` so RLS scopes to the right tenant.
    """
    email = f"flw_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Flow User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]

    # Get the new user's id from /me
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    user_id = me_resp.json()["user"]["id"]

    # Insert a Member row for the target company (superuser; cross-company insert)
    with _superuser_session() as su:
        member = Member(
            id=prefixed_id("mem"),
            company_id=company_id,
            user_id=user_id,
            role="owner",
        )
        su.add(member)

    return token


# ---------------------------------------------------------------------------
# Payload fixtures
# ---------------------------------------------------------------------------

_VALID_TRIGGER = {"kind": "schedule", "spec": {"cron": "0 9 * * 1"}}
_NODES = [
    {"id": "n1", "kind": "trigger", "label": "Monday 9am", "x": 0, "y": 0},
    {"id": "n2", "kind": "ai_step", "label": "Compile digest", "x": 200, "y": 0},
]
_EDGES = [{"id": "e1", "from": "n1", "to": "n2"}]


# ---------------------------------------------------------------------------
# Test 1: POST /v1/flows → status=draft
# ---------------------------------------------------------------------------


class TestCreateFlow:
    @pytest.mark.asyncio
    async def test_create_flow_schedule_trigger_returns_draft(
        self, async_client, tenant_a
    ):
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Weekly digest",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        flow = resp.json()
        assert flow["id"].startswith("flw_"), flow["id"]
        assert flow["status"] == "draft"
        assert flow["enabled"] is False
        assert flow["version"] == 1
        assert flow["created_by"] == "operator"
        assert flow["trigger"]["kind"] == "schedule"

    @pytest.mark.asyncio
    async def test_create_flow_manual_trigger_ok(self, async_client, tenant_a):
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Manual flow",
                "trigger": {"kind": "manual", "spec": {}},
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["trigger"]["kind"] == "manual"

    @pytest.mark.asyncio
    async def test_create_flow_internal_event_trigger_ok(self, async_client, tenant_a):
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Chained flow",
                "trigger": {"kind": "internal_event", "spec": {"event": "flow.finished"}},
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_create_flow_connector_poll_trigger_ok(self, async_client, tenant_a):
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "CRM poller",
                "trigger": {"kind": "connector_poll", "spec": {"interval_minutes": 15}},
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text


# ---------------------------------------------------------------------------
# Test 2/3: Rejected trigger kinds
# ---------------------------------------------------------------------------


class TestRejectedTriggerKinds:
    @pytest.mark.asyncio
    async def test_webhook_trigger_returns_422(self, async_client, tenant_a):
        """POST /v1/flows with trigger.kind='webhook' must return 422."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Webhook flow",
                "trigger": {"kind": "webhook", "spec": {"url": "https://evil.example"}},
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 422, resp.text
        detail = str(resp.json().get("detail", ""))
        assert "webhook" in detail.lower() or "inbound" in detail.lower(), detail

    @pytest.mark.asyncio
    async def test_connector_webhook_trigger_returns_422(self, async_client, tenant_a):
        """POST /v1/flows with trigger.kind='connector_webhook' must return 422."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Connector webhook flow",
                "trigger": {"kind": "connector_webhook", "spec": {}},
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 422, resp.text


# ---------------------------------------------------------------------------
# Test 4/5: List + get
# ---------------------------------------------------------------------------


class TestListAndGetFlow:
    @pytest.mark.asyncio
    async def test_list_flows_includes_created_flow(self, async_client, tenant_a):
        """GET /v1/flows returns FlowCard list including just-created flow."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        # Create a flow
        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "List target",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        # List
        list_resp = await async_client.get(
            "/v1/flows",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert list_resp.status_code == 200, list_resp.text
        items = list_resp.json()
        assert isinstance(items, list)
        ids = [f["id"] for f in items]
        assert flow_id in ids, f"{flow_id} not in {ids}"

        # Check FlowCard shape
        card = next(f for f in items if f["id"] == flow_id)
        assert "title" in card
        assert "status" in card
        assert "enabled" in card
        assert "count" in card  # len(nodes)

    @pytest.mark.asyncio
    async def test_get_flow_returns_nodes_edges(self, async_client, tenant_a):
        """GET /v1/flows/{id} returns the full flow with nodes and edges."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Detail flow",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        get_resp = await async_client.get(
            f"/v1/flows/{flow_id}",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert get_resp.status_code == 200, get_resp.text
        flow = get_resp.json()
        assert flow["id"] == flow_id
        assert len(flow["nodes"]) == len(_NODES)
        assert len(flow["edges"]) == len(_EDGES)
        assert "trigger" in flow


# ---------------------------------------------------------------------------
# Test 6: PATCH
# ---------------------------------------------------------------------------


class TestPatchFlow:
    @pytest.mark.asyncio
    async def test_patch_flow_updates_title(self, async_client, tenant_a):
        """PATCH /v1/flows/{id} {title:'renamed'} returns the updated flow."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Old title",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        patch_resp = await async_client.patch(
            f"/v1/flows/{flow_id}",
            json={"title": "New title"},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert patch_resp.status_code == 200, patch_resp.text
        assert patch_resp.json()["title"] == "New title"

    @pytest.mark.asyncio
    async def test_patch_flow_rejects_webhook_trigger(self, async_client, tenant_a):
        """PATCH with a webhook trigger.kind must return 422."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Patch webhook test",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        flow_id = create_resp.json()["id"]

        patch_resp = await async_client.patch(
            f"/v1/flows/{flow_id}",
            json={"trigger": {"kind": "webhook", "spec": {}}},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert patch_resp.status_code == 422, patch_resp.text

    @pytest.mark.asyncio
    async def test_patch_flow_settings_deep_merge_and_roundtrip(
        self, async_client, tenant_a
    ):
        """PATCH settings deep-merges + persists, and GET round-trips it (Task C)."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)
        hdrs = {"Authorization": f"Bearer {token}", "X-Company-Id": company_id}

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Settings flow",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers=hdrs,
        )
        assert create_resp.status_code == 200, create_resp.text
        flow = create_resp.json()
        flow_id = flow["id"]
        # New flows default to empty settings.
        assert flow["settings"] == {}

        # First PATCH sets budget + a nested notifications block.
        p1 = await async_client.patch(
            f"/v1/flows/{flow_id}",
            json={
                "settings": {
                    "budget": {"monthly_credits": 500},
                    "notifications": {"email": True},
                }
            },
            headers=hdrs,
        )
        assert p1.status_code == 200, p1.text
        assert p1.json()["settings"]["budget"]["monthly_credits"] == 500

        # Second PATCH deep-merges a sibling key without clobbering existing ones.
        p2 = await async_client.patch(
            f"/v1/flows/{flow_id}",
            json={
                "settings": {
                    "quiet_hours": {"start": "22:00", "end": "08:00"},
                    "notifications": {"slack": True},
                }
            },
            headers=hdrs,
        )
        assert p2.status_code == 200, p2.text

        # GET round-trip: all keys coexist.
        get_resp = await async_client.get(f"/v1/flows/{flow_id}", headers=hdrs)
        assert get_resp.status_code == 200, get_resp.text
        settings = get_resp.json()["settings"]
        assert settings["budget"]["monthly_credits"] == 500
        assert settings["quiet_hours"] == {"start": "22:00", "end": "08:00"}
        # notifications deep-merged: both email (from p1) and slack (from p2) present.
        assert settings["notifications"] == {"email": True, "slack": True}


# ---------------------------------------------------------------------------
# Test 7: Publish → flow_publish Proposal + decision InboxItem
# ---------------------------------------------------------------------------


class TestPublishFlow:
    @pytest.mark.asyncio
    async def test_publish_creates_flow_publish_proposal(self, async_client, tenant_a):
        """POST /v1/flows/{id}/publish returns a pending flow_publish Proposal."""
        company_id, helper_id = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Publish me",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        pub_resp = await async_client.post(
            f"/v1/flows/{flow_id}/publish",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert pub_resp.status_code == 200, pub_resp.text
        proposal = pub_resp.json()

        assert proposal["type"] == "flow_publish"
        assert proposal["status"] == "pending"
        assert proposal["risk"] == "medium"
        assert "Publish flow" in proposal["title"]

        # Verify a decision InboxItem exists for this proposal
        with _tenant_session(company_id) as db:
            inbox = (
                db.query(InboxItem)
                .filter_by(company_id=company_id, kind="decision")
                .filter(
                    InboxItem.proposal_id == proposal["id"]
                )
                .first()
            )
            assert inbox is not None, "decision InboxItem must exist for flow_publish proposal"
            assert inbox.needs_you is True

    @pytest.mark.asyncio
    async def test_flow_status_stays_draft_after_publish_request(
        self, async_client, tenant_a
    ):
        """Publishing creates a Proposal; the Flow remains draft until approved."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Still draft",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        flow_id = create_resp.json()["id"]

        await async_client.post(
            f"/v1/flows/{flow_id}/publish",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )

        get_resp = await async_client.get(
            f"/v1/flows/{flow_id}",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert get_resp.json()["status"] == "draft"


# ---------------------------------------------------------------------------
# Test 8: GET /v1/flows/{id}/runs
# ---------------------------------------------------------------------------


class TestFlowRuns:
    @pytest.mark.asyncio
    async def test_get_runs_returns_empty_list(self, async_client, tenant_a):
        """GET /v1/flows/{id}/runs → [] for a new flow with no runs."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "Runs test",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        flow_id = create_resp.json()["id"]

        runs_resp = await async_client.get(
            f"/v1/flows/{flow_id}/runs",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert runs_resp.status_code == 200, runs_resp.text
        assert runs_resp.json() == []


# ---------------------------------------------------------------------------
# Test 9: Tenancy isolation
# ---------------------------------------------------------------------------


class TestTenancyIsolation:
    @pytest.mark.asyncio
    async def test_company_b_cannot_get_company_a_flow(
        self, async_client, tenant_a, tenant_b
    ):
        """Company B's token cannot GET company A's flow (404 via RLS)."""
        company_a_id, _ = tenant_a
        company_b_id, _ = tenant_b

        token_a = await _get_token_for_company(async_client, company_a_id)
        token_b = await _get_token_for_company(async_client, company_b_id)

        # Create a flow under company A
        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "A's flow",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a_id},
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        # Company B tries to GET it → 404
        get_resp = await async_client.get(
            f"/v1/flows/{flow_id}",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert get_resp.status_code == 404, get_resp.text

    @pytest.mark.asyncio
    async def test_company_b_cannot_patch_company_a_flow(
        self, async_client, tenant_a, tenant_b
    ):
        """Company B's token cannot PATCH company A's flow (404 via RLS)."""
        company_a_id, _ = tenant_a
        company_b_id, _ = tenant_b

        token_a = await _get_token_for_company(async_client, company_a_id)
        token_b = await _get_token_for_company(async_client, company_b_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "A's flow for patch",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a_id},
        )
        flow_id = create_resp.json()["id"]

        patch_resp = await async_client.patch(
            f"/v1/flows/{flow_id}",
            json={"title": "stolen"},
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert patch_resp.status_code == 404, patch_resp.text

    @pytest.mark.asyncio
    async def test_company_b_cannot_publish_company_a_flow(
        self, async_client, tenant_a, tenant_b
    ):
        """Company B's token cannot publish company A's flow (404 via RLS)."""
        company_a_id, _ = tenant_a
        company_b_id, _ = tenant_b

        token_a = await _get_token_for_company(async_client, company_a_id)
        token_b = await _get_token_for_company(async_client, company_b_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "A's flow for publish",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a_id},
        )
        flow_id = create_resp.json()["id"]

        pub_resp = await async_client.post(
            f"/v1/flows/{flow_id}/publish",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert pub_resp.status_code == 404, pub_resp.text


# ---------------------------------------------------------------------------
# Task 1.3: DELETE /v1/flows/{id}
# ---------------------------------------------------------------------------


class TestDeleteFlow:
    @pytest.mark.asyncio
    async def test_delete_flow_removes_it(self, async_client, tenant_a):
        """DELETE /v1/flows/{id} → 204; subsequent GET → 404."""
        company_a_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_a_id)
        headers = {"Authorization": f"Bearer {token}", "X-Company-Id": company_a_id}

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "To delete",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers=headers,
        )
        assert create_resp.status_code == 200, create_resp.text
        flow_id = create_resp.json()["id"]

        del_resp = await async_client.delete(f"/v1/flows/{flow_id}", headers=headers)
        assert del_resp.status_code == 204, del_resp.text

        get_resp = await async_client.get(f"/v1/flows/{flow_id}", headers=headers)
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_delete_flow_cross_tenant_404(self, async_client, tenant_a, tenant_b):
        """Company B cannot delete company A's flow (404 via RLS)."""
        company_a_id, _ = tenant_a
        company_b_id, _ = tenant_b
        token_a = await _get_token_for_company(async_client, company_a_id)
        token_b = await _get_token_for_company(async_client, company_b_id)

        create_resp = await async_client.post(
            "/v1/flows",
            json={
                "title": "A's flow",
                "trigger": _VALID_TRIGGER,
                "nodes": _NODES,
                "edges": _EDGES,
            },
            headers={"Authorization": f"Bearer {token_a}", "X-Company-Id": company_a_id},
        )
        flow_id = create_resp.json()["id"]

        del_resp = await async_client.delete(
            f"/v1/flows/{flow_id}",
            headers={"Authorization": f"Bearer {token_b}", "X-Company-Id": company_b_id},
        )
        assert del_resp.status_code == 404, del_resp.text
