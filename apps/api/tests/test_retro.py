"""TDD — Task 7 P3: Retro / scorecard + Improvement.

Tests:
1. GET /v1/retro/scorecard → per-helper row with EXACT runs/success_rate/cost_credits.
2. POST /v1/retro/run → creates an Improvement row (status=active, by=chief,
   baseline non-empty, ref/helper_id point at weak subject).
3. Tenancy: company B's scorecard/retro excludes company A's data.

RED → implement → GREEN.
"""
from __future__ import annotations

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
# Seed helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="Retro Tester", password="testP4ss!"):
    import uuid
    email = f"retro_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helper(company_id: str, *, name: str = "RetroHelper") -> str:
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            helper = Helper(
                id=prefixed_id("hlp"),
                company_id=company_id,
                name=name,
                area="ops",
                role="Ops Worker",
                job_description="",
                is_chief=False,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            session.add(helper)
            return helper.id


def _seed_proposals(
    company_id: str,
    helper_id: str,
    *,
    statuses: list[str],
    created_at_override=None,
) -> None:
    """Insert Proposal rows directly, optionally with an explicit created_at."""
    from datetime import timezone

    from omilo.db import SessionLocal
    from omilo.models.approvals import Proposal
    from omilo.models.base import prefixed_id

    with SessionLocal() as session:
        with session.begin():
            for status in statuses:
                p = Proposal(
                    id=prefixed_id("prp"),
                    company_id=company_id,
                    job_id=prefixed_id("job"),  # dummy FK — no FK constraint enforced
                    helper_id=helper_id,
                    type="action",
                    risk="low",
                    title="Test proposal",
                    body_md="",
                    status=status,
                )
                if created_at_override is not None:
                    p.created_at = created_at_override
                session.add(p)


def _seed_jobs(
    company_id: str,
    helper_id: str,
    *,
    done: int,
    failed: int,
    cost_credits: int = 5,
) -> None:
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.execution import Job

    with SessionLocal() as session:
        with session.begin():
            for i in range(done):
                session.add(Job(
                    id=prefixed_id("job"),
                    company_id=company_id,
                    helper_id=helper_id,
                    origin="chat",
                    brief=f"Done {i}",
                    status="done",
                    cost_credits=cost_credits,
                ))
            for i in range(failed):
                session.add(Job(
                    id=prefixed_id("job"),
                    company_id=company_id,
                    helper_id=helper_id,
                    origin="chat",
                    brief=f"Failed {i}",
                    status="failed",
                    cost_credits=cost_credits,
                ))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_a(async_client):
    """Company A: 2 done + 3 failed jobs → success_rate = 2/5 = 0.4."""
    body = await _sign_up(async_client, name="Retro Company A")
    token = body["session"]["access"]

    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]

    helper_id = _seed_helper(company_id, name="Weak Helper")
    _seed_jobs(company_id, helper_id, done=2, failed=3, cost_credits=7)

    return {
        "token": token,
        "company_id": company_id,
        "helper_id": helper_id,
        "done": 2,
        "failed": 3,
        "total": 5,
        "cost_credits_per_job": 7,
    }


@pytest.fixture()
async def company_b(async_client):
    """Company B: healthy helper — 5 done + 0 failed."""
    body = await _sign_up(async_client, name="Retro Company B")
    token = body["session"]["access"]

    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]

    helper_id = _seed_helper(company_id, name="Healthy Helper B")
    _seed_jobs(company_id, helper_id, done=5, failed=0, cost_credits=3)

    return {"token": token, "company_id": company_id, "helper_id": helper_id}


# ---------------------------------------------------------------------------
# Tests: GET /v1/retro/scorecard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scorecard_exact_metrics(async_client, company_a):
    """Scorecard returns exact DB-computed runs, success_rate, cost_credits."""
    resp = await async_client.get(
        "/v1/retro/scorecard",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list), f"Expected list, got {type(data)}"

    # Find our helper row
    row = next((r for r in data if r.get("helper_id") == company_a["helper_id"]), None)
    assert row is not None, f"Helper {company_a['helper_id']} not in scorecard: {data}"

    total = company_a["total"]
    done = company_a["done"]
    expected_success_rate = done / total  # exact float: 0.4
    expected_cost = total * company_a["cost_credits_per_job"]  # 5 * 7 = 35

    assert row["runs"] == total, f"runs: expected {total}, got {row['runs']}"
    assert abs(row["success_rate"] - expected_success_rate) < 1e-6, (
        f"success_rate: expected {expected_success_rate}, got {row['success_rate']}"
    )
    assert row["cost_credits"] == expected_cost, (
        f"cost_credits: expected {expected_cost}, got {row['cost_credits']}"
    )


# ---------------------------------------------------------------------------
# Tests: POST /v1/retro/run
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retro_run_creates_improvement(async_client, company_a):
    """POST /v1/retro/run creates an Improvement with baseline + active status."""
    resp = await async_client.post(
        "/v1/retro/run",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "improvements" in body, f"No 'improvements' key: {body}"
    assert "scorecard" in body, f"No 'scorecard' key: {body}"

    improvements = body["improvements"]
    assert len(improvements) >= 1, "Expected at least one improvement for the weak helper"

    imp = improvements[0]
    assert imp["status"] == "active", f"Expected status=active, got {imp['status']}"
    assert imp["by"] == "chief", f"Expected by=chief, got {imp['by']}"
    assert imp["helper_id"] == company_a["helper_id"], (
        f"Expected helper_id={company_a['helper_id']}, got {imp['helper_id']}"
    )
    # baseline must be a non-empty dict (snapshot of current scores)
    assert isinstance(imp.get("baseline"), dict), f"baseline not a dict: {imp.get('baseline')}"
    assert imp["baseline"], f"baseline is empty: {imp['baseline']}"
    # reason must mention something about the weakness
    assert imp.get("reason"), "reason should be non-empty"


@pytest.mark.asyncio
async def test_retro_run_improvement_persisted_in_db(async_client, company_a):
    """POST /v1/retro/run persists Improvement to DB (query it directly)."""
    resp = await async_client.post(
        "/v1/retro/run",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    improvements = body["improvements"]
    assert improvements, "Expected improvements in response"

    imp_id = improvements[0]["id"]

    # Verify it's in the DB
    from omilo.db import SessionLocal
    from omilo.models.improvement import Improvement

    with SessionLocal() as session:
        db_imp = session.get(Improvement, imp_id)
    assert db_imp is not None, f"Improvement {imp_id} not found in DB"
    assert db_imp.status == "active"
    assert db_imp.by == "chief"
    assert db_imp.company_id == company_a["company_id"]
    assert db_imp.baseline  # non-empty


@pytest.mark.asyncio
async def test_healthy_company_produces_no_improvement(async_client, company_b):
    """POST /v1/retro/run for a company with all-healthy helpers → empty improvements."""
    resp = await async_client.post(
        "/v1/retro/run",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Healthy (5/5 done) → success_rate = 1.0, no weak spot → no improvements
    assert body["improvements"] == [], (
        f"Expected no improvements for healthy company, got: {body['improvements']}"
    )


# ---------------------------------------------------------------------------
# Tests: Tenancy isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scorecard_tenant_isolation(async_client, company_a, company_b):
    """Company B's scorecard does not include company A's helper."""
    resp = await async_client.get(
        "/v1/retro/scorecard",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    helper_ids = [r.get("helper_id") for r in data]
    assert company_a["helper_id"] not in helper_ids, (
        f"Company A's helper leaked into Company B's scorecard: {data}"
    )


@pytest.mark.asyncio
async def test_retro_run_tenant_isolation(async_client, company_a, company_b):
    """Company B's retro/run only evaluates its own data."""
    # Run retro for company B
    resp = await async_client.post(
        "/v1/retro/run",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Scorecard in response should not contain company A's helper
    scorecard = body["scorecard"]
    helper_ids = [r.get("helper_id") for r in scorecard]
    assert company_a["helper_id"] not in helper_ids, (
        f"Company A's helper leaked into Company B's retro scorecard: {scorecard}"
    )
    # Any improvements created should be for company B's helper only
    for imp in body.get("improvements", []):
        assert imp.get("helper_id") != company_a["helper_id"], (
            f"Company A's helper found in Company B's improvements: {imp}"
        )


# ---------------------------------------------------------------------------
# Tests: approval_rate is windowed (P3 review finding fix)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_scorecard_approval_rate_is_windowed(async_client):
    """approval_rate must only count proposals within the days= window.

    Seed:
      - 2 in-window proposals (1 approved, 1 pending)  → approval_rate = 0.5
      - 1 old (60 days ago) approved proposal           → must NOT count
    Expected: approval_rate == 0.5, not 2/3 ≈ 0.667.
    """
    from datetime import datetime, timedelta, timezone

    body = await _sign_up(async_client, name="Windowed Approval Tester")
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]

    helper_id = _seed_helper(company_id, name="Windowed Helper")
    # Seed jobs so the helper appears in the scorecard (window = last 7 days)
    _seed_jobs(company_id, helper_id, done=2, failed=0, cost_credits=1)

    now = datetime.now(tz=timezone.utc)
    old_ts = now - timedelta(days=60)

    # In-window: 1 approved + 1 pending
    _seed_proposals(company_id, helper_id, statuses=["approved", "pending"])
    # Out-of-window: 1 approved (must not count)
    _seed_proposals(company_id, helper_id, statuses=["approved"], created_at_override=old_ts)

    resp = await async_client.get(
        "/v1/retro/scorecard?days=7",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    row = next((r for r in data if r.get("helper_id") == helper_id), None)
    assert row is not None, f"Helper {helper_id} not in scorecard: {data}"

    # Only the 2 in-window proposals count → 1 approved / 2 total = 0.5
    assert abs(row["approval_rate"] - 0.5) < 1e-6, (
        f"approval_rate should be 0.5 (windowed), got {row['approval_rate']}. "
        "Old out-of-window proposal must not be included."
    )
