"""TDD — Task 5 P4: /v1/ai-accounts CRUD + test + check endpoints.

Tests:
1. GET /v1/ai-accounts returns seeded rows with exact fields.
2. POST /v1/ai-accounts creates a new HarnessAccount.
3. PATCH /v1/ai-accounts/{id} updates name/tag/status.
4. POST /v1/ai-accounts/check reclassifies a pct_window>=85 row to near_limit.
5. Company-scoped: company B cannot see company A's accounts.
6. POST /v1/ai-accounts/{id}/test returns {ok:true, status:...} (offline stub).

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from omilo.db import SessionLocal
from omilo.models.accounts import HarnessAccount
from omilo.models.base import prefixed_id


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
# Helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="AI Accounts Tester", password="testP4ss!"):
    email = f"ai_accts_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed_harness_account(
    company_id: str,
    *,
    harness: str = "claude_code",
    label: str = "Test Account",
    tag: str = "",
    status: str = "ready",
    pct_window: int = 0,
    last_used_at: datetime | None = None,
) -> HarnessAccount:
    """Seed a HarnessAccount row bypassing RLS (uses SessionLocal as superuser)."""
    acc = HarnessAccount(
        id=prefixed_id("acc"),
        company_id=company_id,
        harness=harness,
        label=label,
        token_enc=f"enc_{uuid.uuid4().hex[:8]}",
        token_hint="...hint",
        status=status,
        pct_window=pct_window,
        last_used_at=last_used_at,
        tokens="",
        runs=0,
        cost_credits=0,
    )
    with SessionLocal() as session:
        with session.begin():
            session.add(acc)
    return acc


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
async def company_a(async_client):
    """Sign up company A, return (token, company_id)."""
    body = await _sign_up(async_client, name="AI-Accts Company A")
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]
    return token, company_id


@pytest.fixture()
async def company_b(async_client):
    """Sign up company B, return (token, company_id)."""
    body = await _sign_up(async_client, name="AI-Accts Company B")
    token = body["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    assert me.status_code == 200
    company_id = me.json()["company"]["id"]
    return token, company_id


# ---------------------------------------------------------------------------
# 1. GET /v1/ai-accounts returns seeded rows with exact fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_ai_accounts_returns_seeded_rows(async_client, company_a):
    """GET /v1/ai-accounts returns the seeded account with all required fields."""
    token, company_id = company_a

    acc = _seed_harness_account(
        company_id,
        harness="claude_code",
        label="Primary Account",
        status="ready",
        pct_window=42,
    )

    resp = await async_client.get(
        "/v1/ai-accounts",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    rows = resp.json()

    # Find our seeded account
    found = next((r for r in rows if r["id"] == acc.id), None)
    assert found is not None, f"Seeded account {acc.id!r} not found in response"

    # Check required fields
    assert found["harness"] == "claude_code"
    assert found["name"] == "Primary Account"
    assert found["status"] == "ready"
    assert found["pct"] == 42
    assert "tokens" in found
    assert "last_used" in found
    assert "id" in found


@pytest.mark.asyncio
async def test_get_ai_accounts_returns_empty_list_for_new_company(async_client):
    """A fresh company with no seeded accounts gets an empty list."""
    body = await _sign_up(async_client, name="FreshCompany")
    token = body["session"]["access"]

    resp = await async_client.get("/v1/ai-accounts", headers=_auth(token))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ---------------------------------------------------------------------------
# 2. POST /v1/ai-accounts creates a new HarnessAccount
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_post_ai_accounts_creates_account(async_client, company_a):
    """POST /v1/ai-accounts creates a new account and returns it."""
    token, company_id = company_a

    resp = await async_client.post(
        "/v1/ai-accounts",
        json={
            "harness": "claude_code",
            "name": "New Account",
            "tag": "work",
            "token_enc": "enc_newtoken123",
            "token_hint": "...123",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()

    assert data["harness"] == "claude_code"
    assert data["name"] == "New Account"
    assert data["status"] == "ready"
    assert "id" in data

    # Verify persisted
    get_resp = await async_client.get("/v1/ai-accounts", headers=_auth(token))
    ids = [r["id"] for r in get_resp.json()]
    assert data["id"] in ids


@pytest.mark.asyncio
async def test_post_ai_accounts_minimal_body(async_client, company_a):
    """POST /v1/ai-accounts with minimal required fields works."""
    token, company_id = company_a

    resp = await async_client.post(
        "/v1/ai-accounts",
        json={
            "harness": "anthropic",
            "name": "Direct Anthropic Key",
            "token_enc": "enc_xyz",
            "token_hint": "...xyz",
        },
        headers=_auth(token),
    )
    assert resp.status_code == 201, resp.text


# ---------------------------------------------------------------------------
# 3. PATCH /v1/ai-accounts/{id} updates name/tag/status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_ai_account_updates_fields(async_client, company_a):
    """PATCH /v1/ai-accounts/{id} updates name, tag, and status."""
    token, company_id = company_a

    acc = _seed_harness_account(company_id, label="Old Name", status="ready")

    resp = await async_client.patch(
        f"/v1/ai-accounts/{acc.id}",
        json={"name": "Updated Name", "status": "cooling"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "Updated Name"
    assert data["status"] == "cooling"


@pytest.mark.asyncio
async def test_patch_ai_account_partial_update(async_client, company_a):
    """PATCH with only name updates name, leaves status unchanged."""
    token, company_id = company_a

    acc = _seed_harness_account(company_id, label="Stable", status="ready")

    resp = await async_client.patch(
        f"/v1/ai-accounts/{acc.id}",
        json={"name": "Renamed"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["name"] == "Renamed"
    assert data["status"] == "ready"  # unchanged


# ---------------------------------------------------------------------------
# 4. POST /v1/ai-accounts/check reclassifies near_limit accounts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_check_reclassifies_near_limit(async_client, company_a):
    """POST /v1/ai-accounts/check updates status for accounts at/above pct threshold."""
    token, company_id = company_a

    # An account at 90% should be reclassified as near_limit
    acc_high = _seed_harness_account(
        company_id,
        label="NearLimitCheck",
        status="ready",
        pct_window=90,
    )
    # An account at 30% should stay ready
    acc_low = _seed_harness_account(
        company_id,
        label="HeadroomCheck",
        status="ready",
        pct_window=30,
    )

    resp = await async_client.post("/v1/ai-accounts/check", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    rows = resp.json()

    high_row = next((r for r in rows if r["id"] == acc_high.id), None)
    low_row = next((r for r in rows if r["id"] == acc_low.id), None)

    assert high_row is not None
    assert low_row is not None
    assert high_row["status"] == "near_limit", (
        f"Expected near_limit for pct=90, got {high_row['status']!r}"
    )
    assert low_row["status"] == "ready", (
        f"Expected ready for pct=30, got {low_row['status']!r}"
    )


@pytest.mark.asyncio
async def test_check_at_exact_threshold_is_near_limit(async_client, company_a):
    """pct_window == 85 (exact threshold) should be near_limit after /check."""
    token, company_id = company_a

    acc = _seed_harness_account(
        company_id,
        label="ExactThreshold",
        status="ready",
        pct_window=85,
    )

    resp = await async_client.post("/v1/ai-accounts/check", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    rows = resp.json()

    found = next((r for r in rows if r["id"] == acc.id), None)
    assert found is not None
    assert found["status"] == "near_limit", (
        f"Expected near_limit at pct=85, got {found['status']!r}"
    )


# ---------------------------------------------------------------------------
# 5. Company-scoped: company B cannot see company A's accounts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ai_accounts_company_scoped(async_client, company_a, company_b):
    """Company B cannot see company A's accounts."""
    token_a, cid_a = company_a
    token_b, cid_b = company_b

    acc_a = _seed_harness_account(cid_a, label="CompanyAPrivate", status="ready")

    resp_b = await async_client.get("/v1/ai-accounts", headers=_auth(token_b))
    assert resp_b.status_code == 200
    ids_b = [r["id"] for r in resp_b.json()]
    assert acc_a.id not in ids_b, (
        "Company B should not see company A's accounts"
    )


@pytest.mark.asyncio
async def test_patch_other_company_account_returns_404(async_client, company_a, company_b):
    """Company B cannot PATCH company A's account (404 or 403)."""
    token_a, cid_a = company_a
    token_b, cid_b = company_b

    acc_a = _seed_harness_account(cid_a, label="CompanyAAccount2")

    resp = await async_client.patch(
        f"/v1/ai-accounts/{acc_a.id}",
        json={"name": "Hijacked"},
        headers=_auth(token_b),
    )
    assert resp.status_code in (403, 404), (
        f"Expected 403 or 404 for cross-company PATCH; got {resp.status_code}"
    )


# ---------------------------------------------------------------------------
# 6. POST /v1/ai-accounts/{id}/test returns offline stub {ok:true, status:...}
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_test_account_returns_ok_stub(async_client, company_a):
    """POST /v1/ai-accounts/{id}/test returns {ok:true} without making real calls."""
    token, company_id = company_a

    acc = _seed_harness_account(company_id, label="TestProbe", status="ready")

    resp = await async_client.post(
        f"/v1/ai-accounts/{acc.id}/test",
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data.get("ok") is True
    assert "status" in data


@pytest.mark.asyncio
async def test_test_other_company_account_returns_404(async_client, company_a, company_b):
    """POST /v1/ai-accounts/{id}/test for another company's account → 403 or 404."""
    token_a, cid_a = company_a
    token_b, cid_b = company_b

    acc_a = _seed_harness_account(cid_a, label="CompanyATestable")

    resp = await async_client.post(
        f"/v1/ai-accounts/{acc_a.id}/test",
        headers=_auth(token_b),
    )
    assert resp.status_code in (403, 404), (
        f"Expected 403 or 404 for cross-company test; got {resp.status_code}"
    )
