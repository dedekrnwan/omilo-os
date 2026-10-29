"""TDD — P5d Task 1b: Company profile fields + GET/PATCH /v1/company endpoint.

Tests:
1. GET /v1/company → returns company with currency "IDR" and null profile fields.
2. PATCH /v1/company {industry, team_size, region, pic_role} → 200; GET reflects them;
   currency still "IDR".
3. GET /me → company object includes the 5 profile fields.
4. Non-owner/admin member PATCH → 403; owner PATCH → ok.
5. Cross-company isolation: company B's GET shows its own defaults, not A's.

RED → implement → GREEN.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User
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
# HTTP helpers
# ---------------------------------------------------------------------------


async def _sign_up(client, *, name="CP Tester", password="testP4ss!"):
    email = f"cp_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = body["session"]["access"]
    me_resp = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200, me_resp.text
    company_id = me_resp.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def company_a(async_client):
    """Company A: signed-up owner."""
    token, company_id = await _sign_up(async_client, name="CP Owner A")
    return {"token": token, "company_id": company_id}


@pytest_asyncio.fixture
async def company_b(async_client):
    """Company B: signed-up owner."""
    token, company_id = await _sign_up(async_client, name="CP Owner B")
    return {"token": token, "company_id": company_id}


# ---------------------------------------------------------------------------
# Test 1: GET /v1/company — defaults: currency "IDR", null profile fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_company_defaults(async_client, company_a):
    """GET /v1/company returns currency='IDR' and null industry/team_size/region/pic_role."""
    resp = await async_client.get(
        "/v1/company",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["id"] == company_a["company_id"]
    assert "name" in body
    assert body["currency"] == "IDR"
    assert body["industry"] is None
    assert body["team_size"] is None
    assert body["region"] is None
    assert body["pic_role"] is None


# ---------------------------------------------------------------------------
# Test 2: PATCH /v1/company — update profile fields; GET reflects them
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_company_profile(async_client, company_a):
    """PATCH profile fields → 200; GET reflects them; currency unchanged."""
    resp = await async_client.patch(
        "/v1/company",
        json={
            "industry": "Fintech",
            "team_size": "11-50",
            "region": "Indonesia",
            "pic_role": "Ops Lead",
        },
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["industry"] == "Fintech"
    assert body["team_size"] == "11-50"
    assert body["region"] == "Indonesia"
    assert body["pic_role"] == "Ops Lead"
    assert body["currency"] == "IDR"  # unchanged default

    # GET /v1/company reflects changes
    get_resp = await async_client.get(
        "/v1/company",
        headers=_auth(company_a["token"]),
    )
    assert get_resp.status_code == 200, get_resp.text
    get_body = get_resp.json()

    assert get_body["industry"] == "Fintech"
    assert get_body["team_size"] == "11-50"
    assert get_body["region"] == "Indonesia"
    assert get_body["pic_role"] == "Ops Lead"
    assert get_body["currency"] == "IDR"


# ---------------------------------------------------------------------------
# Test 3: GET /me — company object includes profile fields
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_me_company_includes_profile_fields(async_client, company_a):
    """GET /me → company includes industry, team_size, region, currency, pic_role."""
    resp = await async_client.get(
        "/v1/me",
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    company = body["company"]

    assert "currency" in company, "company.currency must be present in /me"
    assert "industry" in company, "company.industry must be present in /me"
    assert "team_size" in company, "company.team_size must be present in /me"
    assert "region" in company, "company.region must be present in /me"
    assert "pic_role" in company, "company.pic_role must be present in /me"
    assert company["currency"] == "IDR"


# ---------------------------------------------------------------------------
# Test 4: Role guard — non-owner/admin PATCH → 403; owner → ok
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_role_guard(async_client, company_a):
    """'member' role cannot PATCH company; 'owner' can."""
    # Sign up a second user and seed a 'member' row in company A
    member_token, _ = await _sign_up(async_client, name="CP Member User")

    me_resp = await async_client.get("/v1/me", headers=_auth(member_token))
    member_user_id = me_resp.json()["user"]["id"]

    with SessionLocal() as session:
        with session.begin():
            m = Member(
                id=prefixed_id("mem"),
                company_id=company_a["company_id"],
                user_id=member_user_id,
                role="member",
            )
            session.add(m)

    # 'member' PATCH → 403
    resp = await async_client.patch(
        "/v1/company",
        json={"industry": "Should Fail"},
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_a["company_id"],
        },
    )
    assert resp.status_code == 403, (
        f"Expected 403 for member role PATCH, got {resp.status_code}: {resp.text}"
    )

    # Owner PATCH → 200
    owner_resp = await async_client.patch(
        "/v1/company",
        json={"currency": "USD"},
        headers=_auth(company_a["token"]),
    )
    assert owner_resp.status_code == 200, (
        f"Expected 200 for owner PATCH, got {owner_resp.status_code}: {owner_resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 5: Cross-company isolation — company B's profile is independent
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_company_isolation(async_client, company_a, company_b):
    """PATCH company A's profile does not affect company B's GET."""
    # Patch company A
    await async_client.patch(
        "/v1/company",
        json={"industry": "E-commerce", "region": "Singapore"},
        headers=_auth(company_a["token"]),
    )

    # Company B should see its own defaults (null industry/region)
    resp = await async_client.get(
        "/v1/company",
        headers=_auth(company_b["token"]),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["id"] == company_b["company_id"], "Company B sees its own company"
    assert body["industry"] is None, "Company B's industry must be null"
    assert body["region"] is None, "Company B's region must be null"
    assert body["currency"] == "IDR"


# ---------------------------------------------------------------------------
# Autonomy dial — PATCH /v1/company {autonomy_default} persists to the column
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_patch_autonomy_default_persists(async_client, company_a):
    """PATCH {autonomy_default:'yolo'} → 200; persists to the column; GET reflects it."""
    resp = await async_client.patch(
        "/v1/company",
        json={"autonomy_default": "yolo"},
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["autonomy_default"] == "yolo"

    # Column is actually written
    with SessionLocal() as session:
        company = session.get(Company, company_a["company_id"])
        assert company.autonomy_default == "yolo"

    # GET /v1/company and /me both expose it
    get_resp = await async_client.get("/v1/company", headers=_auth(company_a["token"]))
    assert get_resp.json()["autonomy_default"] == "yolo"

    me_resp = await async_client.get("/v1/me", headers=_auth(company_a["token"]))
    assert me_resp.json()["company"]["autonomy_default"] == "yolo"


@pytest.mark.asyncio
async def test_patch_autonomy_default_rejects_invalid(async_client, company_a):
    """An out-of-range autonomy value is rejected (422), column untouched."""
    resp = await async_client.patch(
        "/v1/company",
        json={"autonomy_default": "banana"},
        headers=_auth(company_a["token"]),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_patch_autonomy_default_role_guarded(async_client, company_a):
    """A 'member' cannot change autonomy_default → 403 (same guard as other fields)."""
    member_token, _ = await _sign_up(async_client, name="CP Autonomy Member")
    me_resp = await async_client.get("/v1/me", headers=_auth(member_token))
    member_user_id = me_resp.json()["user"]["id"]

    with SessionLocal() as session:
        with session.begin():
            session.add(
                Member(
                    id=prefixed_id("mem"),
                    company_id=company_a["company_id"],
                    user_id=member_user_id,
                    role="member",
                )
            )

    resp = await async_client.patch(
        "/v1/company",
        json={"autonomy_default": "yolo"},
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_a["company_id"],
        },
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# Task 1.6: DELETE /v1/company (owner only, removes members)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_deletes_company(async_client, company_a):
    """Owner DELETE /v1/company → 204; the member row is gone."""
    from omilo.models.tenancy import Member

    company_id = company_a["company_id"]
    resp = await async_client.delete("/v1/company", headers=_auth(company_a["token"]))
    assert resp.status_code == 204, resp.text

    with SessionLocal() as session:
        remaining = (
            session.query(Member).filter(Member.company_id == company_id).count()
        )
        company = session.get(Company, company_id)
    assert remaining == 0, "members must be removed on company delete"
    assert company is None, "company row must be removed"


@pytest.mark.asyncio
async def test_non_owner_cannot_delete_company(async_client, company_a):
    """A 'member' (and 'admin') cannot delete the company → 403."""
    member_token, _ = await _sign_up(async_client, name="CP Del Member")
    me = await async_client.get("/v1/me", headers=_auth(member_token))
    member_user_id = me.json()["user"]["id"]

    with SessionLocal() as session:
        with session.begin():
            session.add(
                Member(
                    id=prefixed_id("mem"),
                    company_id=company_a["company_id"],
                    user_id=member_user_id,
                    role="admin",
                )
            )

    resp = await async_client.delete(
        "/v1/company",
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_a["company_id"],
        },
    )
    assert resp.status_code == 403, resp.text
