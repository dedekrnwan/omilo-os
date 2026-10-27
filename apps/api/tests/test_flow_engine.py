"""TDD — Task 5: Flow run engine (walk nodes).

The fake engine returns: "[fake] handled: {first_line_of_brief}"
So a brief of "Analyse" → result_text = "[fake] handled: Analyse"
  - keyword "fake" → matches → Yes branch
  - keyword "__nomatch__" → no match → No branch

Tests:
1. run_flow creates FlowRun; ai_step spawns a Job (job_ids non-empty).
2. condition takes No branch (keyword "__nomatch__") → connector → done.
3. condition takes Yes branch (keyword "fake") → approval → needs_you + InboxItem.
4. test=True with approval node → status "done" (not "needs_you"), walk continues.
5. test=True connector node → no exception, status "done" (no real side effect).
6. Walk terminates even with a cycle (back-edge from connector → trigger).
7. Tenancy: company B cannot see company A's flow (RLS).
8. POST /v1/flows/{id}/run → 200, FlowRun dict with job_ids non-empty.
9. POST /v1/flows/{id}/test-run → 200, FlowRun dict.
10. POST /v1/flows/{id}/run with wrong tenant → 404.

RED → implement → GREEN.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

_API_DIR = Path(__file__).parent.parent


# ---------------------------------------------------------------------------
# Schema guard
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
# DB session helpers
# ---------------------------------------------------------------------------


from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow, FlowRun
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company, Member, User


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
        name=f"EngCo-{uuid.uuid4().hex[:6]}",
        color="#abcdef",
        autonomy_default="ask",
    )
    db.add(cmp)
    db.flush()
    return cmp


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


def _make_flow(db, company_id: str, *, condition_keyword: str = "__nomatch__") -> Flow:
    """Build the canonical 5-node test graph.

    trigger → ai_step → condition → (Yes: approval) / (No: connector)

    condition_keyword controls which branch is taken:
    - "fake"        → matches fake engine output → Yes → approval
    - "__nomatch__" → no match                   → No  → connector
    """
    nodes = [
        {"id": "n_trigger", "kind": "trigger", "label": "Start"},
        {"id": "n_ai", "kind": "ai_step", "label": "Analyse", "config": {}},
        {
            "id": "n_cond",
            "kind": "condition",
            "label": "If match",
            "config": {"keyword": condition_keyword},
        },
        {"id": "n_approval", "kind": "approval", "label": "Approve"},
        {
            "id": "n_connector",
            "kind": "connector",
            "label": "Notify",
            "config": {"name": "slack"},
        },
    ]
    edges = [
        {"from": "n_trigger", "to": "n_ai"},
        {"from": "n_ai", "to": "n_cond"},
        {"from": "n_cond", "to": "n_approval", "label": "Yes"},
        {"from": "n_cond", "to": "n_connector", "label": "No"},
    ]
    flow = Flow(
        id=prefixed_id("flw"),
        company_id=company_id,
        title="Test Engine Flow",
        enabled=False,
        channel_ids=[],
        areas=[],
        trigger={"kind": "manual", "spec": {}},
        nodes=nodes,
        edges=edges,
        version=1,
        status="draft",
        created_by="operator",
        proposed_from_pattern=False,
    )
    db.add(flow)
    db.flush()
    return flow


# ---------------------------------------------------------------------------
# Fixtures
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


@pytest_asyncio.fixture
async def async_client():
    from omilo.main import create_app
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        yield client


async def _get_token_for_company(client, company_id: str) -> str:
    """Sign up a fresh user, insert a Member for company_id, return token."""
    email = f"eng_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Engine User", "password": "testP4ss!"},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]

    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    user_id = me_resp.json()["user"]["id"]

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
# Direct engine tests (no HTTP)
# ---------------------------------------------------------------------------


class TestRunFlowEngine:
    def test_run_flow_creates_flow_run_with_prefixed_id(self, tenant_a):
        """run_flow returns a FlowRun with id starting 'frn_' and status set."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            run = run_flow(db, flow, trigger_summary="manual", started_by="operator")

        assert run.id.startswith("frn_")
        assert run.flow_id == flow.id
        assert run.started_by == "operator"
        assert run.trigger_summary == "manual"

    def test_run_flow_ai_step_populates_job_ids(self, tenant_a):
        """ai_step node spawns a Job; job_ids is non-empty after run."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            run = run_flow(db, flow, trigger_summary="manual", started_by="operator")

        assert isinstance(run.job_ids, list)
        assert len(run.job_ids) >= 1
        assert all(j.startswith("job_") for j in run.job_ids)

    def test_run_flow_no_branch_condition_reaches_connector_done(self, tenant_a):
        """No-match keyword → condition takes No → connector → FlowRun done."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            run = run_flow(db, flow, trigger_summary="manual", started_by="operator")

        assert run.status == "done"
        assert run.ended_at is not None

    def test_run_flow_yes_branch_condition_reaches_approval_needs_you(self, tenant_a):
        """'fake' keyword matches fake engine output → Yes → approval → needs_you + InboxItem."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="fake")
            run = run_flow(db, flow, trigger_summary="manual", started_by="operator")
            # Filter the InboxItem specifically to THIS run via meta so the
            # assertion cannot pass spuriously from a prior run's inbox item.
            run_meta = f"flow_run:{run.id}"
            items = (
                db.query(InboxItem)
                .filter(
                    InboxItem.company_id == company_id,
                    InboxItem.kind == "decision",
                    InboxItem.meta == run_meta,
                )
                .all()
            )

        assert run.status == "needs_you"
        assert run.waiting_for is not None
        assert run.ended_at is None  # not ended — parked
        assert len(items) == 1, f"expected exactly 1 InboxItem for {run_meta}, got {len(items)}"
        assert items[0].needs_you is True

    def test_approval_in_test_mode_does_not_pause(self, tenant_a):
        """test=True: approval node logs a note but does NOT pause; run ends done."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="fake")
            run = run_flow(
                db, flow, trigger_summary="test-run", started_by="operator", test=True
            )

        # In test mode, approval should not park the run → done
        assert run.status == "done"
        assert run.ended_at is not None

    def test_connector_in_test_mode_no_real_side_effect(self, tenant_a):
        """test=True with connector node: no exception, run ends done."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            # __nomatch__ → No → connector (test=True)
            run = run_flow(
                db, flow, trigger_summary="test-run", started_by="operator", test=True
            )

        assert run.status == "done"

    def test_walk_terminates_with_cycle(self, tenant_a):
        """A back-edge (connector→trigger) does not cause an infinite loop."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            # Add a back-edge to create a cycle
            flow.edges = list(flow.edges) + [
                {"from": "n_connector", "to": "n_trigger"}
            ]
            run = run_flow(db, flow, trigger_summary="cycle-test", started_by="operator")

        assert run.status in ("done", "needs_you", "failed")

    def test_flow_with_no_trigger_node_marks_failed(self, tenant_a):
        """A flow with no trigger node returns a FlowRun with status=failed."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            # Build a flow with no trigger node
            flow = Flow(
                id=prefixed_id("flw"),
                company_id=company_id,
                title="No Trigger Flow",
                enabled=False,
                channel_ids=[],
                areas=[],
                trigger={"kind": "manual", "spec": {}},
                nodes=[{"id": "n_ai", "kind": "ai_step", "label": "Do something"}],
                edges=[],
                version=1,
                status="draft",
                created_by="operator",
                proposed_from_pattern=False,
            )
            db.add(flow)
            db.flush()
            run = run_flow(db, flow, trigger_summary="test", started_by="operator")

        assert run.status == "failed"

    def test_condition_with_no_matching_edge_terminates_gracefully(self, tenant_a):
        """Condition with no outgoing edges terminates as done (no exception)."""
        from omilo.flows.engine import run_flow

        company_id, _ = tenant_a
        with _tenant_session(company_id) as db:
            # Flow: trigger → ai_step → condition (no outgoing edges)
            flow = Flow(
                id=prefixed_id("flw"),
                company_id=company_id,
                title="Dead-end condition",
                enabled=False,
                channel_ids=[],
                areas=[],
                trigger={"kind": "manual", "spec": {}},
                nodes=[
                    {"id": "n_trigger", "kind": "trigger", "label": "Start"},
                    {"id": "n_ai", "kind": "ai_step", "label": "Analyse"},
                    {"id": "n_cond", "kind": "condition", "label": "Branch", "config": {"keyword": "x"}},
                ],
                edges=[
                    {"from": "n_trigger", "to": "n_ai"},
                    {"from": "n_ai", "to": "n_cond"},
                    # no outgoing edges from condition
                ],
                version=1,
                status="draft",
                created_by="operator",
                proposed_from_pattern=False,
            )
            db.add(flow)
            db.flush()
            run = run_flow(db, flow, trigger_summary="test", started_by="operator")

        assert run.status == "done"

    def test_tenancy_company_b_cannot_see_company_a_flow(self, tenant_a, tenant_b):
        """RLS: company B's session returns None for company A's flow id."""
        company_id_a, _ = tenant_a
        company_id_b, _ = tenant_b

        with _tenant_session(company_id_a) as db:
            flow = _make_flow(db, company_id_a)
            flow_id = flow.id

        with _tenant_session(company_id_b) as db:
            result = db.query(Flow).filter(Flow.id == flow_id).first()

        assert result is None

    def test_run_flow_ai_step_with_no_helper_marks_failed(self):
        """ai_step in a company with no helper → run.status == 'failed' (NOT 'done').

        Uses a dedicated company with no Helper so it doesn't disturb the
        module-scoped tenant_a / tenant_b fixtures.
        """
        from omilo.flows.engine import run_flow

        # Create a fresh company with NO helper (superuser session)
        with _superuser_session() as su:
            cmp = _make_company(su)
            no_helper_company_id = cmp.id

        # Build a minimal flow: trigger → ai_step (no helper → should fail)
        with _tenant_session(no_helper_company_id) as db:
            flow = Flow(
                id=prefixed_id("flw"),
                company_id=no_helper_company_id,
                title="No-Helper Flow",
                enabled=False,
                channel_ids=[],
                areas=[],
                trigger={"kind": "manual", "spec": {}},
                nodes=[
                    {"id": "n_trigger", "kind": "trigger", "label": "Start"},
                    {"id": "n_ai", "kind": "ai_step", "label": "Do something", "config": {}},
                ],
                edges=[{"from": "n_trigger", "to": "n_ai"}],
                version=1,
                status="draft",
                created_by="operator",
                proposed_from_pattern=False,
            )
            db.add(flow)
            db.flush()
            run = run_flow(db, flow, trigger_summary="no-helper-test", started_by="operator")

        assert run.status == "failed", (
            f"expected 'failed' when no helper exists, got '{run.status}'"
        )
        assert run.ended_at is not None
        assert run.waiting_for == "no helper for ai_step"


# ---------------------------------------------------------------------------
# HTTP endpoint tests
# ---------------------------------------------------------------------------


class TestRunFlowEndpoints:
    @pytest.mark.asyncio
    async def test_post_run_creates_flow_run(self, async_client, tenant_a):
        """POST /v1/flows/{id}/run → 200, FlowRun dict with job_ids."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        # Create a flow via DB
        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            flow_id = flow.id

        resp = await async_client.post(
            f"/v1/flows/{flow_id}/run",
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"].startswith("frn_")
        assert body["flow_id"] == flow_id
        assert body["status"] == "done"
        assert isinstance(body["job_ids"], list)
        assert len(body["job_ids"]) >= 1

    @pytest.mark.asyncio
    async def test_post_test_run_returns_flow_run(self, async_client, tenant_a):
        """POST /v1/flows/{id}/test-run → 200, FlowRun dict."""
        company_id, _ = tenant_a
        token = await _get_token_for_company(async_client, company_id)

        with _tenant_session(company_id) as db:
            flow = _make_flow(db, company_id, condition_keyword="__nomatch__")
            flow_id = flow.id

        resp = await async_client.post(
            f"/v1/flows/{flow_id}/test-run",
            json={"sample": {}},
            headers={"Authorization": f"Bearer {token}", "X-Company-Id": company_id},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"].startswith("frn_")
        assert body["status"] == "done"

    @pytest.mark.asyncio
    async def test_post_run_wrong_tenant_returns_404(
        self, async_client, tenant_a, tenant_b
    ):
        """POST /v1/flows/{id}/run by company B on company A's flow → 404."""
        company_id_a, _ = tenant_a
        company_id_b, _ = tenant_b

        with _tenant_session(company_id_a) as db:
            flow = _make_flow(db, company_id_a)
            flow_id = flow.id

        token_b = await _get_token_for_company(async_client, company_id_b)

        resp = await async_client.post(
            f"/v1/flows/{flow_id}/run",
            headers={
                "Authorization": f"Bearer {token_b}",
                "X-Company-Id": company_id_b,
            },
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_post_test_run_wrong_tenant_returns_404(
        self, async_client, tenant_a, tenant_b
    ):
        """POST /v1/flows/{id}/test-run by company B on company A's flow → 404."""
        company_id_a, _ = tenant_a
        company_id_b, _ = tenant_b

        with _tenant_session(company_id_a) as db:
            flow = _make_flow(db, company_id_a)
            flow_id = flow.id

        token_b = await _get_token_for_company(async_client, company_id_b)

        resp = await async_client.post(
            f"/v1/flows/{flow_id}/test-run",
            json={"sample": {}},
            headers={
                "Authorization": f"Bearer {token_b}",
                "X-Company-Id": company_id_b,
            },
        )
        assert resp.status_code == 404, resp.text
