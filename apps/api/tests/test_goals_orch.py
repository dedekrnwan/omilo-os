"""TDD — Task 2: Goals orchestration (create → Chief plan → delegated Jobs).

Tests:
1. POST /v1/goals {channel_id, title, target} creates a Goal with status=active,
   owner_helper_id=Chief, plus a plan Job (origin=goal) and ≥1 delegated child
   Jobs (origin=delegation, goal_id set, parent_job_id=plan job).
2. GET /v1/goals/{id} returns {goal, jobs[], proposals[]} with correct shape.
   progress reflects completed delegated jobs (fake engine completes immediately → 100).
3. POST /v1/goals/{id}/replan creates additional jobs (new plan + delegation).
4. Tenancy: company B cannot GET company A's goal → 404.

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
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, email=None, name="Goals Tester", password="testP4ss!"):
    email = email or f"goals_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helpers(company_id: str) -> tuple[str, str]:
    """Insert a Chief + one non-chief Helper for *company_id*.

    Bypasses RLS (superuser session) — test setup only.
    Returns (chief_id, worker_id).
    """
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            chief = Helper(
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
            worker = Helper(
                id=prefixed_id("hlp"),
                company_id=company_id,
                name="Builder",
                area="dev",
                is_chief=False,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            session.add(chief)
            session.add(worker)
            session.flush()
            return chief.id, worker.id


def _seed_channel(company_id: str) -> str:
    """Insert a Channel for *company_id*. Returns channel.id."""
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.workspace import Channel

    with SessionLocal() as session:
        with session.begin():
            channel = Channel(
                id=prefixed_id("chn"),
                company_id=company_id,
                name="Engineering",
                accent="dev",
                is_default=True,
                agent_count=2,
                chat_count=0,
                open_items=0,
            )
            session.add(channel)
            session.flush()
            return channel.id


# ---------------------------------------------------------------------------
# Fixture: company with Chief + worker helper + channel
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_with_team(async_client):
    """Sign up a fresh user, seed Chief+Worker+Channel. Return (token, company_id, channel_id)."""
    body = await _sign_up(async_client)
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]

    _seed_helpers(company_id)
    channel_id = _seed_channel(company_id)

    return token, company_id, channel_id


# ---------------------------------------------------------------------------
# Test 1 — POST /v1/goals creates Goal + plan Job + delegated Jobs
# ---------------------------------------------------------------------------


class TestCreateGoal:
    @pytest.mark.asyncio
    async def test_create_goal_returns_200_with_goal(
        self, async_client, company_with_team
    ):
        token, company_id, channel_id = company_with_team
        resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Ship X", "target": "Ship X to prod"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "goal" in data, f"Missing 'goal' key: {data}"
        goal = data["goal"]
        assert goal["id"].startswith("goal_"), f"Bad id: {goal['id']}"
        assert goal["title"] == "Ship X"
        assert goal["status"] == "active"

    @pytest.mark.asyncio
    async def test_create_goal_owner_is_chief(
        self, async_client, company_with_team
    ):
        """The created goal's owner_helper_id must be the Chief."""
        from omilo.db import SessionLocal
        from omilo.models.agents import Helper
        from omilo.models.workspace import Goal

        token, company_id, channel_id = company_with_team
        resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Chief Owner Goal", "target": "x"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        goal_id = resp.json()["goal"]["id"]

        with SessionLocal() as session:
            goal = session.query(Goal).filter(Goal.id == goal_id).first()
            assert goal is not None
            assert goal.owner_helper_id is not None
            chief = session.query(Helper).filter(
                Helper.id == goal.owner_helper_id
            ).first()
            assert chief is not None and chief.is_chief is True

    @pytest.mark.asyncio
    async def test_create_goal_spawns_plan_job(
        self, async_client, company_with_team
    ):
        """Creating a goal must produce exactly one plan Job (origin=goal) for the goal."""
        from omilo.db import SessionLocal
        from omilo.models.execution import Job

        token, company_id, channel_id = company_with_team
        resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Plan Job Goal", "target": "plan me"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        goal_id = resp.json()["goal"]["id"]

        with SessionLocal() as session:
            plan_jobs = (
                session.query(Job)
                .filter(Job.goal_id == goal_id, Job.origin == "goal")
                .all()
            )
        assert len(plan_jobs) == 1, f"Expected 1 plan job, got {len(plan_jobs)}"

    @pytest.mark.asyncio
    async def test_create_goal_spawns_delegated_jobs(
        self, async_client, company_with_team
    ):
        """Creating a goal must produce ≥1 delegated Jobs (origin=delegation) linked to the goal,
        with parent_job_id pointing to the plan job."""
        from omilo.db import SessionLocal
        from omilo.models.execution import Job

        token, company_id, channel_id = company_with_team
        resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Delegation Goal", "target": "delegate this"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        goal_id = resp.json()["goal"]["id"]

        with SessionLocal() as session:
            plan_job = (
                session.query(Job)
                .filter(Job.goal_id == goal_id, Job.origin == "goal")
                .first()
            )
            assert plan_job is not None, "Plan job must exist"

            delegated_jobs = (
                session.query(Job)
                .filter(
                    Job.goal_id == goal_id,
                    Job.origin == "delegation",
                )
                .all()
            )
        assert len(delegated_jobs) >= 1, (
            f"Expected ≥1 delegated jobs, got {len(delegated_jobs)}"
        )
        for dj in delegated_jobs:
            assert dj.parent_job_id == plan_job.id, (
                f"Delegated job {dj.id} parent_job_id={dj.parent_job_id!r}, "
                f"expected {plan_job.id!r}"
            )
            assert dj.goal_id == goal_id

    @pytest.mark.asyncio
    async def test_create_goal_response_includes_job_count(
        self, async_client, company_with_team
    ):
        """The POST response must include a job_count field."""
        token, company_id, channel_id = company_with_team
        resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Count Jobs", "target": "count"},
            headers=_auth(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "job_count" in data, f"Missing 'job_count': {data}"
        assert data["job_count"] >= 2, f"Expected ≥2 jobs, got {data['job_count']}"


# ---------------------------------------------------------------------------
# Test 2 — GET /v1/goals/{id} returns detail with jobs + proposals + progress
# ---------------------------------------------------------------------------


class TestGetGoalDetail:
    @pytest.mark.asyncio
    async def test_get_goal_detail_shape(
        self, async_client, company_with_team
    ):
        """GET /v1/goals/{id} returns {goal, jobs, proposals}."""
        token, company_id, channel_id = company_with_team
        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Detail Shape", "target": "check shape"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "goal" in data, f"Missing 'goal': {data}"
        assert "jobs" in data, f"Missing 'jobs': {data}"
        assert "proposals" in data, f"Missing 'proposals': {data}"

    @pytest.mark.asyncio
    async def test_get_goal_detail_includes_delegated_jobs(
        self, async_client, company_with_team
    ):
        """GET /v1/goals/{id} jobs[] must include the delegated jobs."""
        token, company_id, channel_id = company_with_team
        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Detail Jobs", "target": "delegation check"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()

        jobs = data["jobs"]
        assert len(jobs) >= 2, f"Expected ≥2 jobs (plan + ≥1 delegation), got {len(jobs)}: {jobs}"
        origins = {j["origin"] for j in jobs}
        assert "delegation" in origins, f"No delegation jobs in {origins}"

    @pytest.mark.asyncio
    async def test_get_goal_detail_progress_reflects_done_delegated_jobs(
        self, async_client, company_with_team
    ):
        """Since the fake engine completes immediately, all delegated jobs are done
        → progress should be 100."""
        token, company_id, channel_id = company_with_team
        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Progress Goal", "target": "measure progress"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        # Fake engine completes all jobs immediately — all delegated done → 100%
        assert data["goal"]["progress"] == 100, (
            f"Expected progress=100, got {data['goal']['progress']}"
        )

    @pytest.mark.asyncio
    async def test_get_goal_detail_proposals_is_list(
        self, async_client, company_with_team
    ):
        """proposals in detail response is always a list."""
        token, company_id, channel_id = company_with_team
        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Proposals Goal", "target": "check proposals"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token))
        assert resp.status_code == 200, resp.text
        assert isinstance(resp.json()["proposals"], list)


# ---------------------------------------------------------------------------
# Test 3 — POST /v1/goals/{id}/replan creates more jobs
# ---------------------------------------------------------------------------


class TestReplanGoal:
    @pytest.mark.asyncio
    async def test_replan_creates_additional_jobs(
        self, async_client, company_with_team
    ):
        """POST /v1/goals/{id}/replan must create a new plan Job + ≥1 more delegation Jobs."""
        from omilo.db import SessionLocal
        from omilo.models.execution import Job

        token, company_id, channel_id = company_with_team
        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id, "title": "Replan Goal", "target": "replan me"},
            headers=_auth(token),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        # Count jobs before replan
        with SessionLocal() as session:
            before_count = session.query(Job).filter(Job.goal_id == goal_id).count()

        replan_resp = await async_client.post(
            f"/v1/goals/{goal_id}/replan",
            headers=_auth(token),
        )
        assert replan_resp.status_code == 200, replan_resp.text
        data = replan_resp.json()
        assert "job_id" in data, f"Missing job_id in replan response: {data}"

        # Count after replan — must have grown
        with SessionLocal() as session:
            after_count = session.query(Job).filter(Job.goal_id == goal_id).count()

        assert after_count > before_count, (
            f"Job count should grow after replan: before={before_count}, after={after_count}"
        )

    @pytest.mark.asyncio
    async def test_replan_404_on_unknown_goal(
        self, async_client, company_with_team
    ):
        """POST /v1/goals/bad_id/replan on a non-existent goal → 404."""
        token, _, _ = company_with_team
        resp = await async_client.post(
            "/v1/goals/goal_doesnotexist/replan",
            headers=_auth(token),
        )
        assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Test 4 — Tenancy: company B cannot access company A's goal
# ---------------------------------------------------------------------------


class TestGoalTenancy:
    @pytest.mark.asyncio
    async def test_company_b_cannot_get_company_a_goal(
        self, async_client
    ):
        """Company B's token must get 404 when accessing Company A's goal."""
        # Company A
        body_a = await _sign_up(async_client)
        token_a = body_a["session"]["access"]
        me_a = await async_client.get("/v1/me", headers=_auth(token_a))
        company_id_a = me_a.json()["company"]["id"]
        _seed_helpers(company_id_a)
        channel_id_a = _seed_channel(company_id_a)

        create_resp = await async_client.post(
            "/v1/goals",
            json={"channel_id": channel_id_a, "title": "A's Secret Goal", "target": "secret"},
            headers=_auth(token_a),
        )
        assert create_resp.status_code == 200, create_resp.text
        goal_id = create_resp.json()["goal"]["id"]

        # Company B — separate user + company
        body_b = await _sign_up(async_client)
        token_b = body_b["session"]["access"]

        resp = await async_client.get(f"/v1/goals/{goal_id}", headers=_auth(token_b))
        assert resp.status_code == 404, (
            f"Company B should not see Company A's goal; got {resp.status_code}: {resp.text}"
        )

    @pytest.mark.asyncio
    async def test_goal_not_found_returns_404(self, async_client, company_with_team):
        """GET /v1/goals/goal_unknown returns 404."""
        token, _, _ = company_with_team
        resp = await async_client.get(
            "/v1/goals/goal_doesnotexist",
            headers=_auth(token),
        )
        assert resp.status_code == 404, resp.text
