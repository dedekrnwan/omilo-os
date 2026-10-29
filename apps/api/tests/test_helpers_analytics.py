"""TDD — Task 8: Helpers + Analytics read endpoints.

Tests:
1. GET /v1/helpers → helper appears with correct job count and success pct.
2. POST /v1/helpers {name,area,role} → creates; appears in list.
3. PATCH /v1/helpers/{id} {status:"paused"} → status updated.
4. GET /v1/analytics/overview → stats reflect seeded jobs (exact counts/sums).
5. Tenancy: company B's helpers/analytics don't include company A's data.
6. POST /v1/helpers with is_chief=true when chief exists → 409.

RED → implement → GREEN.

T7 P4 update: spend is now sourced from CreditLedger (reason='job') not Job.cost_credits.
The _seed_jobs helper now also seeds matching CreditLedger rows so the
test_analytics_overview_exact_counts assertion passes with the new spec.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

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


async def _sign_up(client, *, email=None, name="Helper Tester", password="testP4ss!"):
    email = email or f"helper_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_helper(company_id: str, *, is_chief: bool = True, name: str = "Chief") -> str:
    """Insert a Helper for *company_id*. Returns helper.id."""
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
                role="Chief Operator" if is_chief else "Worker",
                job_description="",
                is_chief=is_chief,
                engine={"type": "fake"},
                autonomy_cap=None,
                permissions=[],
                status="active",
                channel_ids=[],
            )
            session.add(helper)
            session.flush()
            return helper.id


def _seed_jobs(
    company_id: str,
    helper_id: str,
    *,
    done: int = 3,
    failed: int = 2,
    tokens_in: int = 100,
    tokens_out: int = 50,
    cost_credits: int = 10,
) -> list[str]:
    """Seed done + failed Jobs (and matching CreditLedger rows) for a helper.

    T7 P4: spend is now sourced from CreditLedger (reason='job'), not Job.cost_credits.
    We seed one CreditLedger row per job so analytics_overview.spend == total * cost_credits.
    Returns list of job ids.
    """
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.billing import CreditLedger
    from omilo.models.execution import Job

    job_ids = []
    with SessionLocal() as session:
        with session.begin():
            balance = 10000  # arbitrary starting balance
            for i in range(done):
                job = Job(
                    id=prefixed_id("job"),
                    company_id=company_id,
                    helper_id=helper_id,
                    origin="chat",
                    brief=f"Done job {i}",
                    status="done",
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_credits=cost_credits,
                )
                session.add(job)
                job_ids.append(job.id)
                # Matching CreditLedger row (T7 P4: spend from ledger)
                balance -= cost_credits
                ledger = CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=company_id,
                    delta=-cost_credits,
                    balance_after=balance,
                    reason="job",
                    helper_id=helper_id,
                    credits_charged=cost_credits,
                    at=datetime.now(timezone.utc),
                )
                session.add(ledger)
            for i in range(failed):
                job = Job(
                    id=prefixed_id("job"),
                    company_id=company_id,
                    helper_id=helper_id,
                    origin="chat",
                    brief=f"Failed job {i}",
                    status="failed",
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                    cost_credits=cost_credits,
                )
                session.add(job)
                job_ids.append(job.id)
                # Matching CreditLedger row (T7 P4: spend from ledger)
                balance -= cost_credits
                ledger = CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=company_id,
                    delta=-cost_credits,
                    balance_after=balance,
                    reason="job",
                    helper_id=helper_id,
                    credits_charged=cost_credits,
                    at=datetime.now(timezone.utc),
                )
                session.add(ledger)
    return job_ids


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_a(async_client):
    """Company A: signed-up user + seeded Chief + jobs."""
    body = await _sign_up(async_client, name="Company A User")
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200
    company_id = me_resp.json()["company"]["id"]

    helper_id = _seed_helper(company_id, is_chief=True, name="Chief A")
    # 3 done, 2 failed; 100 tokens_in, 50 tokens_out, 10 credits each
    job_ids = _seed_jobs(company_id, helper_id, done=3, failed=2)

    return {
        "token": token,
        "company_id": company_id,
        "helper_id": helper_id,
        "job_ids": job_ids,
        "done": 3,
        "failed": 2,
        "tokens_in_per_job": 100,
        "tokens_out_per_job": 50,
        "cost_credits_per_job": 10,
    }


@pytest.fixture()
async def company_b(async_client):
    """Company B: independent user for tenancy isolation tests."""
    body = await _sign_up(async_client, name="Company B User")
    token = body["session"]["access"]

    me_resp = await async_client.get("/v1/me", headers=_auth(token))
    assert me_resp.status_code == 200
    company_id = me_resp.json()["company"]["id"]

    helper_id = _seed_helper(company_id, is_chief=True, name="Chief B")
    _seed_jobs(company_id, helper_id, done=1, failed=0)

    return {"token": token, "company_id": company_id, "helper_id": helper_id}


# ---------------------------------------------------------------------------
# Tests: GET /v1/helpers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_helpers_list_shows_helper_with_job_count(async_client, company_a):
    """GET /v1/helpers returns the seeded helper with correct job count."""
    resp = await async_client.get(
        "/v1/helpers",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert isinstance(data, list)

    # Find our helper
    helper = next((h for h in data if h["id"] == company_a["helper_id"]), None)
    assert helper is not None, f"Helper not found in {data}"

    total = company_a["done"] + company_a["failed"]
    assert helper["jobs"] == total, f"Expected jobs={total}, got {helper['jobs']}"

    # success = done / total * 100 rounded
    expected_success = round(100 * company_a["done"] / total)
    assert helper["success"] == expected_success, (
        f"Expected success={expected_success}, got {helper['success']}"
    )

    # camelCase fields
    assert "name" in helper
    assert "area" in helper
    assert "role" in helper
    assert "status" in helper


# ---------------------------------------------------------------------------
# Tests: POST /v1/helpers
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_helper_appears_in_list(async_client, company_a):
    """POST /v1/helpers creates a helper; it then appears in GET /v1/helpers."""
    create_resp = await async_client.post(
        "/v1/helpers",
        json={"name": "New Worker", "area": "marketing", "role": "Marketing Bot"},
        headers=_auth(company_a["token"]),
    )
    assert create_resp.status_code in (200, 201), create_resp.text
    created = create_resp.json()
    new_id = created.get("id") or (created.get("helper") or {}).get("id")
    assert new_id, f"No id in response: {created}"

    list_resp = await async_client.get(
        "/v1/helpers",
        headers=_auth(company_a["token"]),
    )
    assert list_resp.status_code == 200
    ids = [h["id"] for h in list_resp.json()]
    assert new_id in ids, f"New helper {new_id} not in list: {ids}"


# ---------------------------------------------------------------------------
# Tests: POST /v1/helpers — chief guard
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_second_chief_returns_409(async_client, company_a):
    """POST /v1/helpers with is_chief=true when a chief already exists → 409."""
    resp = await async_client.post(
        "/v1/helpers",
        json={"name": "Second Chief", "area": "ops", "role": "Ops Lead", "is_chief": True},
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 409, f"Expected 409, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Tests: PATCH /v1/helpers/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_helper_status_paused(async_client, company_a):
    """PATCH /v1/helpers/{id} {status:'paused'} updates the status."""
    helper_id = company_a["helper_id"]
    resp = await async_client.patch(
        f"/v1/helpers/{helper_id}",
        json={"status": "paused"},
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text

    # Confirm via GET detail or list
    detail_resp = await async_client.get(
        f"/v1/helpers/{helper_id}",
        headers=_auth(company_a["token"]),
    )
    assert detail_resp.status_code == 200, detail_resp.text
    detail = detail_resp.json()
    helper_data = detail.get("helper") or detail
    assert helper_data["status"] == "paused", f"Expected paused, got {helper_data}"


# ---------------------------------------------------------------------------
# Tests: GET /v1/helpers/{id}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_helper_detail(async_client, company_a):
    """GET /v1/helpers/{id} returns {helper, jobs, skills}."""
    helper_id = company_a["helper_id"]
    resp = await async_client.get(
        f"/v1/helpers/{helper_id}",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "helper" in data
    assert "jobs" in data
    assert "skills" in data
    assert isinstance(data["jobs"], list)
    assert isinstance(data["skills"], list)


@pytest.mark.asyncio
async def test_get_helper_detail_other_tenant_404(async_client, company_a, company_b):
    """GET /v1/helpers/{id} for another company's helper → 404."""
    resp = await async_client.get(
        f"/v1/helpers/{company_a['helper_id']}",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Tests: GET /v1/analytics/overview
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_analytics_overview_exact_counts(async_client, company_a):
    """GET /v1/analytics/overview stats reflect seeded jobs exactly."""
    resp = await async_client.get(
        "/v1/analytics/overview",
        params={"range": "week"},
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert "stats" in data
    assert "series" in data

    stats = {s["label"]: s["value"] for s in data["stats"]}

    # Jobs done = 3 (exact)
    assert stats.get("Jobs done") == company_a["done"], (
        f"Expected Jobs done={company_a['done']}, got {stats}"
    )

    # Total jobs = done + failed = 5
    total = company_a["done"] + company_a["failed"]
    # Success rate = done / total * 100 rounded
    expected_success = round(100 * company_a["done"] / total)
    assert stats.get("Success rate") == expected_success, (
        f"Expected Success rate={expected_success}, got {stats}"
    )

    # Tokens = sum (tokens_in + tokens_out) across all jobs
    expected_tokens = total * (
        company_a["tokens_in_per_job"] + company_a["tokens_out_per_job"]
    )
    assert stats.get("Tokens") == expected_tokens, (
        f"Expected Tokens={expected_tokens}, got {stats}"
    )

    # Spend = sum cost_credits across all jobs
    expected_spend = total * company_a["cost_credits_per_job"]
    assert stats.get("Spend") == expected_spend, (
        f"Expected Spend={expected_spend}, got {stats}"
    )

    # series must have at least one entry
    assert len(data["series"]) >= 1


# ---------------------------------------------------------------------------
# Tests: Tenancy isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_helpers_tenancy_isolation(async_client, company_a, company_b):
    """Company B cannot see Company A's helpers."""
    resp = await async_client.get(
        "/v1/helpers",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 200
    ids = [h["id"] for h in resp.json()]
    assert company_a["helper_id"] not in ids, (
        "Company A's helper should not appear in Company B's list"
    )


@pytest.mark.asyncio
async def test_analytics_tenancy_isolation(async_client, company_a, company_b):
    """Company B's analytics don't include Company A's job data."""
    # Company A has 5 jobs (done=3, failed=2)
    # Company B has 1 done job seeded in fixture
    resp_a = await async_client.get(
        "/v1/analytics/overview",
        params={"range": "week"},
        headers=_auth(company_a["token"]),
    )
    resp_b = await async_client.get(
        "/v1/analytics/overview",
        params={"range": "week"},
        headers=_auth(company_b["token"]),
    )
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200

    stats_a = {s["label"]: s["value"] for s in resp_a.json()["stats"]}
    stats_b = {s["label"]: s["value"] for s in resp_b.json()["stats"]}

    # Company B's "Jobs done" should not equal Company A's total jobs done
    # (Company B only has 1 done, Company A has 3 done)
    # The exact counts must differ (they're scoped independently)
    assert stats_a.get("Jobs done") != stats_b.get("Jobs done") or (
        # Edge case: if both happen to equal, tokens/spend must differ
        stats_a.get("Tokens") != stats_b.get("Tokens")
    ), "Analytics data appears to bleed across companies"


# ---------------------------------------------------------------------------
# Task 1.7: Helper model/engine field (PATCH model persists + round-trips)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_helper_model_persists_and_round_trips(async_client, company_a):
    """PATCH /v1/helpers/{id} {model} persists into engine.model; GET returns it."""
    token = company_a["token"]
    helper_id = company_a["helper_id"]

    resp = await async_client.patch(
        f"/v1/helpers/{helper_id}",
        json={"model": "claude-sonnet-4"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["model"] == "claude-sonnet-4"

    # GET helper detail round-trips the model.
    get_resp = await async_client.get(
        f"/v1/helpers/{helper_id}", headers=_auth(token)
    )
    assert get_resp.status_code == 200, get_resp.text
    assert get_resp.json()["helper"]["model"] == "claude-sonnet-4"
