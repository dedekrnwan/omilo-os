"""Tests for POST /v1/auth/switch-company — TDD: written before implementation.

Cases:
  (a) member of TWO companies → switch to second → 200, returned token's `cmp` claim
      equals the second company id.
  (b) switch to a company the user is NOT a member of → 403.
  (c) switch to a non-existent company id → 404.
  (d) no Bearer token → 401.
"""
from __future__ import annotations

import uuid

import pytest

from omilo.auth.tokens import decode_token


# ---------------------------------------------------------------------------
# Helpers (mirrors pattern from test_tenancy_isolation.py)
# ---------------------------------------------------------------------------

def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _sign_up(client, *, email: str, name: str = "Switch User") -> dict:
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": "Switch!P4ss"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _insert_second_company(user_id: str) -> str:
    """Directly insert a second Company+Member and return the new company id."""
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.tenancy import Company, Member

    with SessionLocal() as session:
        with session.begin():
            cmp2 = Company(
                id=prefixed_id("cmp"),
                name="Second Workspace",
                color="#f59e0b",
                timezone="UTC",
            )
            session.add(cmp2)
            session.flush()
            mem2 = Member(
                id=prefixed_id("mem"),
                company_id=cmp2.id,
                user_id=user_id,
                role="admin",
            )
            session.add(mem2)
            cmp2_id = cmp2.id  # capture before session closes

    return cmp2_id


# ---------------------------------------------------------------------------
# (a) Valid switch → 200, token cmp claim updated
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_switch_company_valid_returns_new_token(async_client):
    """User with two memberships switches to the second company → 200 and the
    returned token's `cmp` claim equals the second company id."""
    email = f"switch_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email)
    token = body["session"]["access"]

    # Decode original token to get user_id and original cmp
    orig_claims = decode_token(token)
    user_id = orig_claims["sub"]
    orig_cmp = orig_claims["cmp"]

    # Insert second company for this user
    second_cmp_id = await _insert_second_company(user_id)
    assert second_cmp_id != orig_cmp

    # Switch to second company
    resp = await async_client.post(
        "/v1/auth/switch-company",
        json={"company_id": second_cmp_id},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Response shape matches SignInResponse
    assert "user" in data
    assert "session" in data
    assert "companies" in data
    assert "access" in data["session"]
    assert "expires_at" in data["session"]

    # user.id matches original user
    assert data["user"]["id"] == user_id

    # companies[] contains at least two entries
    assert len(data["companies"]) >= 2

    # The new token's cmp claim must equal the second company
    new_token = data["session"]["access"]
    new_claims = decode_token(new_token)
    assert new_claims["cmp"] == second_cmp_id, (
        f"Expected cmp={second_cmp_id!r} but got {new_claims['cmp']!r}"
    )
    assert new_claims["role"] == "admin"  # role from second membership


# ---------------------------------------------------------------------------
# (b) User is NOT a member of the target company → 403
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_switch_company_not_member_returns_403(async_client):
    """Switching to a company the user is not a member of returns 403."""
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.tenancy import Company

    email = f"sw403_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email)
    token = body["session"]["access"]

    # Create an orphan company that this user has NO membership in
    with SessionLocal() as session:
        with session.begin():
            other_cmp = Company(
                id=prefixed_id("cmp"),
                name="Other Company",
                color="#ef4444",
                timezone="UTC",
            )
            session.add(other_cmp)
            other_cmp_id = other_cmp.id

    resp = await async_client.post(
        "/v1/auth/switch-company",
        json={"company_id": other_cmp_id},
        headers=_auth(token),
    )
    assert resp.status_code == 403, resp.text


# ---------------------------------------------------------------------------
# (c) Target company does not exist → 404
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_switch_company_nonexistent_returns_404(async_client):
    """Switching to a company id that doesn't exist returns 404."""
    email = f"sw404_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email)
    token = body["session"]["access"]

    resp = await async_client.post(
        "/v1/auth/switch-company",
        json={"company_id": "cmp_doesnotexist_00000000"},
        headers=_auth(token),
    )
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# (d) No Bearer token → 401
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_switch_company_no_token_returns_401(async_client):
    """POST /switch-company without Authorization header returns 401."""
    resp = await async_client.post(
        "/v1/auth/switch-company",
        json={"company_id": "cmp_anything"},
    )
    assert resp.status_code == 401, resp.text


# ── POST /v1/auth/companies (sweep) ───────────────────────────────────────────

async def test_create_company_switches_and_seeds(async_client):
    body = await _sign_up(async_client, email=f"newco-{uuid.uuid4().hex[:8]}@example.com")
    token = body["session"]["access"]
    r = await async_client.post(
        "/v1/auth/companies",
        json={"name": "Warung Dua", "industry": "Retail", "timezone": "Asia/Jakarta"},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    out = r.json()
    names = [c["name"] for c in out["companies"]]
    assert "Warung Dua" in names and len(names) == 2
    new_token = out["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(new_token))
    assert me.status_code == 200
    # Seeded like sign-up: a Chief helper exists in the new company.
    helpers = (await async_client.get("/v1/helpers", headers=_auth(new_token))).json()
    assert any(h.get("isChief") or h.get("is_chief") for h in helpers)


async def test_create_company_requires_name(async_client):
    body = await _sign_up(async_client, email=f"noname-{uuid.uuid4().hex[:8]}@example.com")
    r = await async_client.post(
        "/v1/auth/companies", json={"name": "  "}, headers=_auth(body["session"]["access"])
    )
    assert r.status_code == 422
