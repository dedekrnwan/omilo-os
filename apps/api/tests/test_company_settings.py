"""TDD — Task 1.1: company.settings JSONB + GET/PATCH /v1/company/settings.

Tests:
1. GET /v1/company/settings → returns {} (defaults) for a fresh company.
2. PATCH deep-merges a partial without clobbering sibling keys.
3. Non-owner/admin PATCH → 403.
4. Cross-company isolation: B's settings independent of A's.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Member
from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


async def _sign_up(client, *, name="CS Tester", password="testP4ss!"):
    email = f"cs_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    company_id = me.json()["company"]["id"]
    return token, company_id


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def company_a(async_client):
    token, company_id = await _sign_up(async_client, name="CS Owner A")
    return {"token": token, "company_id": company_id}


@pytest_asyncio.fixture
async def company_b(async_client):
    token, company_id = await _sign_up(async_client, name="CS Owner B")
    return {"token": token, "company_id": company_id}


@pytest.mark.asyncio
async def test_get_settings_defaults_empty(async_client, company_a):
    """GET /v1/company/settings → {} for a fresh company."""
    resp = await async_client.get(
        "/v1/company/settings", headers=_auth(company_a["token"])
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {}


@pytest.mark.asyncio
async def test_patch_settings_deep_merge_no_clobber(async_client, company_a):
    """PATCH merges partials without clobbering sibling keys (deep merge)."""
    # Seed two sub-trees.
    r1 = await async_client.patch(
        "/v1/company/settings",
        json={"safety": {"guardrails": True}, "notifications": {"email": True}},
        headers=_auth(company_a["token"]),
    )
    assert r1.status_code == 200, r1.text
    body = r1.json()
    assert body["safety"] == {"guardrails": True}
    assert body["notifications"] == {"email": True}

    # Patch a nested key inside safety — must NOT drop safety.guardrails
    # nor the sibling notifications tree.
    r2 = await async_client.patch(
        "/v1/company/settings",
        json={"safety": {"max_spend": 100}},
        headers=_auth(company_a["token"]),
    )
    assert r2.status_code == 200, r2.text
    merged = r2.json()
    assert merged["safety"] == {"guardrails": True, "max_spend": 100}, merged
    assert merged["notifications"] == {"email": True}, merged

    # GET reflects the merged state.
    r3 = await async_client.get(
        "/v1/company/settings", headers=_auth(company_a["token"])
    )
    assert r3.status_code == 200, r3.text
    assert r3.json() == merged


@pytest.mark.asyncio
async def test_patch_settings_role_guard(async_client, company_a):
    """'member' cannot PATCH settings (403); owner can."""
    member_token, _ = await _sign_up(async_client, name="CS Member")
    me = await async_client.get("/v1/me", headers=_auth(member_token))
    member_user_id = me.json()["user"]["id"]

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
        "/v1/company/settings",
        json={"safety": {"x": 1}},
        headers={
            "Authorization": f"Bearer {member_token}",
            "X-Company-Id": company_a["company_id"],
        },
    )
    assert resp.status_code == 403, resp.text

    owner_resp = await async_client.patch(
        "/v1/company/settings",
        json={"language": "en"},
        headers=_auth(company_a["token"]),
    )
    assert owner_resp.status_code == 200, owner_resp.text


@pytest.mark.asyncio
async def test_settings_cross_company_isolation(async_client, company_a, company_b):
    """A's settings PATCH does not leak into B."""
    await async_client.patch(
        "/v1/company/settings",
        json={"about": "A's about"},
        headers=_auth(company_a["token"]),
    )
    resp = await async_client.get(
        "/v1/company/settings", headers=_auth(company_b["token"])
    )
    assert resp.status_code == 200, resp.text
    assert "about" not in resp.json()
