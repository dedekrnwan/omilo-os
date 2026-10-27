"""TDD — Task 7 P4: Analytics spend from CreditLedger.

Tests:
1. Seed CreditLedger job rows → GET /v1/analytics/overview `spend` == exact sum.
2. GET /v1/analytics/helpers per-helper spend == exact per-helper sums from ledger.
3. Company-scoped: company B's spend does not include company A's ledger rows.
4. Only reason="job" rows count toward spend (not "topup" or other reasons).

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from omilo.db import SessionLocal, set_company
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
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
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="Spend Tester"):
    email = f"spend_{uuid.uuid4().hex[:8]}@test.example"
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


def _seed_helper(company_id: str, *, name: str = "SpendHelper") -> str:
    from omilo.models.agents import Helper

    with SessionLocal() as session:
        with session.begin():
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
            session.add(helper)
            session.flush()
            return helper.id


def _seed_ledger_rows(
    company_id: str,
    helper_id: str,
    *,
    credits: list[int],
    reason: str = "job",
) -> list[str]:
    """Seed CreditLedger rows and return their ids."""
    ids = []
    with SessionLocal() as db:
        with db.begin():
            for amt in credits:
                row = CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=company_id,
                    delta=-amt,
                    balance_after=1000 - amt,
                    reason=reason,
                    helper_id=helper_id,
                    credits_charged=amt,
                    at=datetime.now(timezone.utc),
                )
                db.add(row)
                db.flush()
                ids.append(row.id)
    return ids


# ---------------------------------------------------------------------------
# Test 1: overview spend == exact sum of ledger credits_charged (reason=job)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_overview_spend_exact_sum(async_client):
    """GET /v1/analytics/overview spend == sum of CreditLedger credits_charged (reason=job)."""
    token, company_id = await _sign_up(async_client, name="Overview Spend Tester")
    helper_id = _seed_helper(company_id)

    # Seed job rows: 100 + 250 + 75 = 425
    credits = [100, 250, 75]
    _seed_ledger_rows(company_id, helper_id, credits=credits, reason="job")

    resp = await async_client.get(
        "/v1/analytics/overview?range=week",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    stats = {s["label"]: s["value"] for s in resp.json()["stats"]}

    assert "Spend" in stats, f"'Spend' not in stats: {stats}"
    assert stats["Spend"] == sum(credits), (
        f"Expected spend={sum(credits)}, got {stats['Spend']}"
    )


# ---------------------------------------------------------------------------
# Test 2: per-helper spend == exact per-helper sums
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_helpers_spend_exact_per_helper(async_client):
    """GET /v1/analytics/helpers per-helper spend == exact sums from ledger."""
    token, company_id = await _sign_up(async_client, name="Helpers Spend Tester")
    helper_a_id = _seed_helper(company_id, name="HelperA")
    helper_b_id = _seed_helper(company_id, name="HelperB")

    # Helper A: 200 + 300 = 500
    _seed_ledger_rows(company_id, helper_a_id, credits=[200, 300], reason="job")
    # Helper B: 150
    _seed_ledger_rows(company_id, helper_b_id, credits=[150], reason="job")

    resp = await async_client.get(
        "/v1/analytics/helpers?range=week",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()

    by_id = {r["helperId"]: r for r in rows}
    assert helper_a_id in by_id, f"Helper A not in response: {list(by_id)}"
    assert helper_b_id in by_id, f"Helper B not in response: {list(by_id)}"

    assert by_id[helper_a_id]["spend"] == 500, (
        f"Expected helper A spend=500, got {by_id[helper_a_id]['spend']}"
    )
    assert by_id[helper_b_id]["spend"] == 150, (
        f"Expected helper B spend=150, got {by_id[helper_b_id]['spend']}"
    )


# ---------------------------------------------------------------------------
# Test 3: Company-scoped — company B spend does not include company A's rows
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spend_company_scoped(async_client):
    """Company B's analytics overview spend does not include Company A's ledger rows."""
    token_a, company_a_id = await _sign_up(async_client, name="Spend Company A")
    token_b, company_b_id = await _sign_up(async_client, name="Spend Company B")

    helper_a_id = _seed_helper(company_a_id, name="HelperA_Isolated")
    helper_b_id = _seed_helper(company_b_id, name="HelperB_Isolated")

    # Company A: 1000 credits spent
    _seed_ledger_rows(company_a_id, helper_a_id, credits=[1000], reason="job")
    # Company B: 50 credits spent
    _seed_ledger_rows(company_b_id, helper_b_id, credits=[50], reason="job")

    # Company A overview
    resp_a = await async_client.get("/v1/analytics/overview?range=week", headers=_auth(token_a))
    stats_a = {s["label"]: s["value"] for s in resp_a.json()["stats"]}

    # Company B overview
    resp_b = await async_client.get("/v1/analytics/overview?range=week", headers=_auth(token_b))
    stats_b = {s["label"]: s["value"] for s in resp_b.json()["stats"]}

    # Company B should NOT see Company A's spend
    assert stats_b["Spend"] < stats_a["Spend"] or stats_a["Spend"] >= 1000, (
        "Company B's spend should not include Company A's 1000 credits"
    )
    assert stats_a["Spend"] >= 1000, f"Company A spend should be >= 1000, got {stats_a['Spend']}"
    assert stats_b["Spend"] <= 50, f"Company B spend should be <= 50, got {stats_b['Spend']}"


# ---------------------------------------------------------------------------
# Test 4: Only reason="job" rows count (not "topup" etc.)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_spend_only_job_reason(async_client):
    """Only CreditLedger rows with reason='job' contribute to spend."""
    token, company_id = await _sign_up(async_client, name="Job Reason Tester")
    helper_id = _seed_helper(company_id, name="ReasonHelper")

    # Seed job rows: 100 credits
    _seed_ledger_rows(company_id, helper_id, credits=[100], reason="job")
    # Seed topup rows: 5000 credits (should NOT count in spend)
    _seed_ledger_rows(company_id, helper_id, credits=[5000], reason="topup")

    resp = await async_client.get(
        "/v1/analytics/overview?range=week",
        headers=_auth(token),
    )
    assert resp.status_code == 200
    stats = {s["label"]: s["value"] for s in resp.json()["stats"]}

    # Spend must equal ONLY the job row (100), not 5100
    assert stats["Spend"] == 100, (
        f"Expected spend=100 (only job rows), got {stats['Spend']} "
        f"(topup rows must NOT count)"
    )
