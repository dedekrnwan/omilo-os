"""TDD — Task 4 P4: PaymentProvider port + ManualProvider + billing/usage endpoints.

Tests:
1. GET /v1/usage reflects a seeded ledger EXACTLY:
   seed 3 CreditLedger job rows (two helpers, two days) → assert balance,
   by_helper sums, by_day sums, used_this_period match seeded numbers precisely.
2. POST /v1/billing/change-plan → subscription becomes active with that plan,
   company.plan_id updated, balance increased by plan.included_credits
   (subscription_grant ledger row).
3. POST /v1/billing/topup {pack:"medium"} → balance += 5000, a topup ledger row
   + an offline Invoice exist. Works with ManualProvider, no Stripe.
4. GET /v1/billing/subscription reflects the active subscription after change-plan.
5. Company-scoped: company B cannot see company A's usage/ledger (RLS).

RED → implement → GREEN.
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


async def _sign_up(client, *, email=None, name="Billing Tester", password="testP4ss!"):
    email = email or f"billing_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _get_company_id(async_client_resp_json: dict) -> str:
    """Extract company_id from sign-up response."""
    return async_client_resp_json["company"]["id"]


def _seed_ledger_rows(
    company_id: str,
    *,
    balance_start: int = 1000,
    rows: list[dict],
) -> int:
    """Seed CreditLedger rows for a company. Sets Company.credit_balance.

    rows: list of dicts with keys: delta, reason, credits_charged, helper_id, day_offset
      day_offset: int — days before today (0=today, 1=yesterday, etc.)

    Returns the final credit_balance after seeding.
    """
    from datetime import timedelta

    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.billing import CreditLedger
    from omilo.models.tenancy import Company

    now_utc = datetime.now(timezone.utc)
    balance = balance_start

    with SessionLocal() as session:
        with session.begin():
            # Set starting credit_balance on Company
            company = session.get(Company, company_id)
            company.credit_balance = balance_start
            session.flush()

            running_balance = balance_start
            for row in rows:
                running_balance += row["delta"]
                day_offset = row.get("day_offset", 0)
                entry_time = now_utc - timedelta(days=day_offset)
                # Replace hour/min/sec to avoid midnight boundary issues
                entry_time = entry_time.replace(hour=12, minute=0, second=0, microsecond=0)

                entry = CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=company_id,
                    delta=row["delta"],
                    balance_after=running_balance,
                    reason=row.get("reason", "job"),
                    job_id=row.get("job_id", None),
                    helper_id=row.get("helper_id", None),
                    provider_cost_usd=0,
                    credits_charged=row.get("credits_charged", 0),
                    meta={},
                    at=entry_time,
                )
                session.add(entry)

            # Update Company.credit_balance to match ledger
            company.credit_balance = running_balance
            session.flush()

    return running_balance


def _seed_plan(tier: str = "growth") -> str:
    """Return the id of a seeded Plan with the given tier. Uses existing if present."""
    from omilo.db import SessionLocal

    with SessionLocal() as session:
        with session.begin():
            row = session.execute(
                __import__("sqlalchemy").text("SELECT id FROM plan WHERE tier = :t LIMIT 1"),
                {"t": tier},
            ).fetchone()
    if row:
        return row.id

    # Seed it directly
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.billing import Plan
    from decimal import Decimal

    pid = prefixed_id("pln")
    with SessionLocal() as session:
        with session.begin():
            plan = Plan(
                id=pid,
                tier=tier,
                name=tier.capitalize(),
                monthly_price_usd=Decimal("49.00"),
                included_credits=500,
                credit_overage_usd=Decimal("0.01"),
                seats=5,
                features={},
            )
            session.add(plan)
    return pid


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_a(async_client):
    """Sign up company A, return (token, company_id)."""
    body = await _sign_up(async_client, name="Billing A")
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]
    return token, company_id


@pytest.fixture()
async def company_b(async_client):
    """Sign up company B, return (token, company_id)."""
    body = await _sign_up(async_client, name="Billing B")
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]
    return token, company_id


# ---------------------------------------------------------------------------
# Test 1: GET /v1/usage reflects seeded ledger exactly
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_reflects_seeded_ledger(async_client, company_a):
    """Seeded CreditLedger job rows → GET /v1/usage returns exact sums."""
    token, company_id = company_a

    helper_a = "hlp_aaa"
    helper_b = "hlp_bbb"

    # Seed:
    #   - helper_a: 2 job rows on day_offset=0 (today), credits_charged=100 each → 200
    #   - helper_b: 1 job row on day_offset=1 (yesterday), credits_charged=50 → 50
    # Total used_this_period = 200 + 50 = 250, balance = 1000 - 100 - 100 - 50 = 750
    rows = [
        {"delta": -100, "reason": "job", "credits_charged": 100, "helper_id": helper_a, "day_offset": 0},
        {"delta": -100, "reason": "job", "credits_charged": 100, "helper_id": helper_a, "day_offset": 0},
        {"delta": -50,  "reason": "job", "credits_charged": 50,  "helper_id": helper_b, "day_offset": 1},
    ]
    final_balance = _seed_ledger_rows(company_id, balance_start=1000, rows=rows)
    # final_balance = 1000 + (-100) + (-100) + (-50) = 750
    assert final_balance == 750

    resp = await async_client.get("/v1/usage", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["balance"] == 750
    assert data["used_this_period"] == 250

    # by_helper
    by_helper = {h["helper_id"]: h["credits"] for h in data["by_helper"]}
    assert by_helper[helper_a] == 200
    assert by_helper[helper_b] == 50

    # by_day
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    from datetime import timedelta
    yesterday_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    by_day = {d["day"]: d["credits"] for d in data["by_day"]}
    assert by_day.get(today_str, 0) == 200
    assert by_day.get(yesterday_str, 0) == 50


# ---------------------------------------------------------------------------
# Test 2: POST /v1/billing/change-plan
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_plan(async_client, company_a):
    """change-plan: subscription active, plan_id updated, balance increased by included_credits."""
    token, company_id = company_a
    plan_id = _seed_plan("growth")

    # Read plan's included_credits
    from omilo.db import SessionLocal
    from omilo.models.billing import Plan as PlanModel
    with SessionLocal() as session:
        with session.begin():
            plan = session.get(PlanModel, plan_id)
            included = plan.included_credits

    # Get balance before
    from omilo.models.tenancy import Company
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, company_id)
            balance_before = int(company.credit_balance or 0)

    resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": plan_id},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["subscription"]["plan_id"] == plan_id
    assert data["subscription"]["status"] == "active"
    assert data["balance"] == balance_before + included

    # Verify DB: Company.plan_id updated
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, company_id)
            assert company.plan_id == plan_id

    # Verify: a subscription_grant ledger row exists
    from omilo.models.billing import CreditLedger
    with SessionLocal() as session:
        with session.begin():
            grant_row = session.execute(
                __import__("sqlalchemy").text(
                    "SELECT id FROM credit_ledger WHERE company_id=:cid AND reason='subscription_grant' LIMIT 1"
                ),
                {"cid": company_id},
            ).fetchone()
    assert grant_row is not None, "subscription_grant ledger row not found"


# ---------------------------------------------------------------------------
# Test 3: POST /v1/billing/topup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_topup_medium(async_client, company_a):
    """topup medium pack: balance += 5000, topup ledger row, offline Invoice exist."""
    token, company_id = company_a

    # Get balance before
    from omilo.db import SessionLocal
    from omilo.models.tenancy import Company
    with SessionLocal() as session:
        with session.begin():
            company = session.get(Company, company_id)
            balance_before = int(company.credit_balance or 0)

    resp = await async_client.post(
        "/v1/billing/topup",
        json={"pack": "medium"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["balance"] == balance_before + 5000

    invoice = data["invoice"]
    assert invoice["status"] in ("offline", "paid")
    assert invoice["provider"] == "manual"
    assert invoice["company_id"] == company_id

    # Verify: topup ledger row in DB
    from omilo.models.billing import CreditLedger
    with SessionLocal() as session:
        with session.begin():
            topup_row = session.execute(
                __import__("sqlalchemy").text(
                    "SELECT id FROM credit_ledger WHERE company_id=:cid AND reason='topup' LIMIT 1"
                ),
                {"cid": company_id},
            ).fetchone()
    assert topup_row is not None, "topup ledger row not found"

    # Verify: Invoice in DB
    with SessionLocal() as session:
        with session.begin():
            inv_row = session.execute(
                __import__("sqlalchemy").text(
                    "SELECT id, status FROM invoice WHERE company_id=:cid LIMIT 1"
                ),
                {"cid": company_id},
            ).fetchone()
    assert inv_row is not None, "Invoice row not found"
    assert inv_row.status in ("offline", "paid")


# ---------------------------------------------------------------------------
# Test 4: GET /v1/billing/subscription reflects active subscription
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_subscription_reflects_change_plan(async_client, company_a):
    """GET /v1/billing/subscription returns active subscription after change-plan."""
    token, company_id = company_a
    plan_id = _seed_plan("growth")

    # change plan first
    cp_resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": plan_id},
        headers=_auth(token),
    )
    assert cp_resp.status_code == 200, cp_resp.text

    # Now GET subscription
    resp = await async_client.get("/v1/billing/subscription", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["subscription"] is not None
    assert data["subscription"]["plan_id"] == plan_id
    assert data["subscription"]["status"] == "active"
    assert data["plan"] is not None
    assert data["plan"]["id"] == plan_id


# ---------------------------------------------------------------------------
# Test 5: Company-scoped — company B cannot see company A's data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_company_scoped(async_client, company_a, company_b):
    """Company B cannot see company A's usage/ledger (RLS enforced)."""
    token_a, company_a_id = company_a
    token_b, company_b_id = company_b

    # Seed ledger for company A with specific balance
    _seed_ledger_rows(
        company_a_id,
        balance_start=9999,
        rows=[
            {"delta": -999, "reason": "job", "credits_charged": 999,
             "helper_id": "hlp_scope_test", "day_offset": 0},
        ],
    )

    # Company B should see its OWN balance (not A's 9000)
    resp_b = await async_client.get("/v1/usage", headers=_auth(token_b))
    assert resp_b.status_code == 200, resp_b.text
    data_b = resp_b.json()
    assert data_b["balance"] != 9000, (
        f"Company B should NOT see company A's balance=9000 but got {data_b['balance']}"
    )

    # Company B's ledger should not contain A's rows
    ledger_b = await async_client.get("/v1/billing/ledger", headers=_auth(token_b))
    assert ledger_b.status_code == 200
    rows_b = ledger_b.json()
    row_ids_b = [r["id"] for r in rows_b]

    # Company A's ledger should contain its own rows
    ledger_a = await async_client.get("/v1/billing/ledger", headers=_auth(token_a))
    assert ledger_a.status_code == 200
    rows_a = ledger_a.json()
    row_ids_a = [r["id"] for r in rows_a]

    # None of A's row IDs should appear in B's ledger
    overlap = set(row_ids_a) & set(row_ids_b)
    assert not overlap, f"Company B can see company A's ledger rows: {overlap}"


# ---------------------------------------------------------------------------
# Test 6: GET /v1/usage — included credits from plan
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usage_included_credits_from_plan(async_client, company_a):
    """GET /v1/usage → included matches the plan's included_credits after change-plan."""
    token, company_id = company_a
    plan_id = _seed_plan("growth")

    # Get plan's included_credits
    from omilo.db import SessionLocal
    from omilo.models.billing import Plan as PlanModel
    with SessionLocal() as session:
        with session.begin():
            plan = session.get(PlanModel, plan_id)
            included = plan.included_credits

    # Assign plan
    cp_resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": plan_id},
        headers=_auth(token),
    )
    assert cp_resp.status_code == 200

    resp = await async_client.get("/v1/usage", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["included"] == included


# ---------------------------------------------------------------------------
# Test 7: topup with invalid pack → 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_topup_invalid_pack(async_client, company_a):
    """POST /v1/billing/topup with unknown pack → 400."""
    token, _ = company_a
    resp = await async_client.post(
        "/v1/billing/topup",
        json={"pack": "giga"},
        headers=_auth(token),
    )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# Test 8: change-plan with non-existent plan → 404
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_change_plan_not_found(async_client, company_a):
    """POST /v1/billing/change-plan with unknown plan_id → 404."""
    token, _ = company_a
    resp = await async_client.post(
        "/v1/billing/change-plan",
        json={"plan_id": "pln_doesnotexist"},
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# Test 9: GET /v1/billing/ledger returns rows newest first
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ledger_newest_first(async_client, company_a):
    """GET /v1/billing/ledger returns rows in descending time order."""
    token, company_id = company_a

    # Seed 2 rows with different day offsets (older first in list but should appear last)
    _seed_ledger_rows(
        company_id,
        balance_start=500,
        rows=[
            {"delta": -10, "reason": "job", "credits_charged": 10, "day_offset": 2},
            {"delta": -20, "reason": "job", "credits_charged": 20, "day_offset": 0},
        ],
    )

    resp = await async_client.get("/v1/billing/ledger", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    rows = resp.json()
    assert len(rows) >= 2
    # First row should have the most recent created_at
    assert rows[0]["created_at"] >= rows[1]["created_at"]
