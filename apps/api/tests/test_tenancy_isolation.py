"""TDD: Task 5 — Tenancy resolution + RLS enforcement.

Tests:
1. GET /v1/_whoami as userA → channel_ids contains ONLY company A's channel.
   (Proves real RLS isolation via omilo_app role at runtime.)
2. userA forging X-Company-Id: <companyB_id> (no membership) → 403.
3. Regression: sign-up / sign-in / me still work after the role split.
4. Multi-company regression: a user member of two companies sees both in companies[].
"""
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

_API_DIR = Path(__file__).parent.parent


@pytest.fixture(scope="module", autouse=True)
def ensure_schema_for_isolation_tests():
    """Ensure the DB schema is at head before isolation tests run.

    test_models_migration.py downgrades to base in its teardown; since pytest
    collects alphabetically, it runs before this module.  Re-upgrading here
    makes this module self-contained.
    """
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
# Helpers
# ---------------------------------------------------------------------------

async def _sign_up(client, email=None, name="Test User", password="testP4ss!"):
    email = email or f"iso_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": name, "password": password},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _sign_in(client, email, password="testP4ss!"):
    resp = await client.post(
        "/v1/auth/sign-in",
        json={"email": email, "password": password},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Test 1: RLS isolation — A sees only A's channel via real omilo_app session
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_whoami_isolation(async_client):
    """
    Seed company A (userA signs up → gets companyA + a channel seeded directly).
    Seed company B (userB signs up → gets companyB + a channel seeded directly).

    GET /v1/channels as userA must:
    - return ONLY the channel for A, NOT B's.

    This proves RLS enforcement at runtime (not app-level filtering):
    the session runs as omilo_app (non-superuser), so FORCE RLS applies.

    Note: The _whoami probe route was removed in Task 7.  The isolation assertion
    is now made via GET /v1/channels which runs through the same RLS-scoped session.
    """
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.workspace import Channel

    email_a = f"isoa_{uuid.uuid4().hex[:8]}@test.example"
    email_b = f"isob_{uuid.uuid4().hex[:8]}@test.example"

    # Sign up A and B — each gets their own company
    body_a = await _sign_up(async_client, email=email_a, name="User A")
    body_b = await _sign_up(async_client, email=email_b, name="User B")

    token_a = body_a["session"]["access"]
    token_b = body_b["session"]["access"]

    # Resolve company IDs via /me
    me_a = (await async_client.get("/v1/me", headers=_auth(token_a))).json()
    me_b = (await async_client.get("/v1/me", headers=_auth(token_b))).json()
    cmp_a = me_a["company"]["id"]
    cmp_b = me_b["company"]["id"]

    # Seed a channel for each company via privileged session (bypass RLS)
    with SessionLocal() as session:
        with session.begin():
            ch_a = Channel(
                id=prefixed_id("chn"),
                company_id=cmp_a,
                name="Channel A",
            )
            ch_b = Channel(
                id=prefixed_id("chn"),
                company_id=cmp_b,
                name="Channel B",
            )
            session.add(ch_a)
            session.add(ch_b)
    chan_a_id = ch_a.id
    chan_b_id = ch_b.id

    # GET /v1/channels as userA — RLS must filter to company A only
    resp = await async_client.get("/v1/channels", headers=_auth(token_a))
    assert resp.status_code == 200, resp.text
    channel_ids = [c["id"] for c in resp.json()]

    assert chan_a_id in channel_ids, f"A's channel not visible: {channel_ids}"
    assert chan_b_id not in channel_ids, (
        f"B's channel should NOT be visible to A — RLS isolation FAILED: {channel_ids}"
    )


# ---------------------------------------------------------------------------
# Test 2: X-Company-Id forge → 403 when no membership
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forge_x_company_id_no_membership_returns_403(async_client):
    """
    userA forges X-Company-Id header pointing at companyB (no Member row).
    Must get 403.
    """
    email_a = f"forge_a_{uuid.uuid4().hex[:8]}@test.example"
    email_b = f"forge_b_{uuid.uuid4().hex[:8]}@test.example"

    body_a = await _sign_up(async_client, email=email_a, name="Forge A")
    body_b = await _sign_up(async_client, email=email_b, name="Forge B")

    token_a = body_a["session"]["access"]

    me_b = (await async_client.get("/v1/me", headers=_auth(body_b["session"]["access"]))).json()
    cmp_b = me_b["company"]["id"]

    # userA sends X-Company-Id of companyB — has no membership there
    # Use GET /v1/channels (Task 7 endpoint) instead of the removed _whoami probe.
    resp = await async_client.get(
        "/v1/channels",
        headers={**_auth(token_a), "X-Company-Id": cmp_b},
    )
    assert resp.status_code == 403, f"Expected 403 for unauthorized company override, got {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Test 3: Auth regression — sign-up / sign-in / me still work
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_auth_regression_signup_signin_me(async_client):
    """After the role split, sign-up / sign-in / me still work correctly."""
    email = f"reg_{uuid.uuid4().hex[:8]}@test.example"

    # sign-up
    su = await _sign_up(async_client, email=email, name="Regression User")
    token = su["session"]["access"]

    # me
    resp = await async_client.get("/v1/me", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["email"] == email
    assert body["member"]["role"] == "owner"
    assert "id" in body["company"]

    # sign-in
    si = await _sign_in(async_client, email=email)
    assert "access" in si["session"]
    assert len(si["companies"]) >= 1


# ---------------------------------------------------------------------------
# Test 4: Multi-company regression — sign-in lists both companies
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_multi_company_signin_regression(async_client):
    """
    A user who is a Member of two companies sees both in companies[] at sign-in.
    We simulate this by manually inserting a second Member row via the privileged
    session (the UI would do this via an invite flow, which is P1).
    """
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.tenancy import Company, Member

    email = f"multi_{uuid.uuid4().hex[:8]}@test.example"
    body = await _sign_up(async_client, email=email, name="Multi Co User")
    token = body["session"]["access"]

    me_resp = (await async_client.get("/v1/me", headers=_auth(token))).json()
    user_id = me_resp["user"]["id"]

    # Insert a second company + member via privileged session
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

    # Sign in — companies[] should include both
    si = await _sign_in(async_client, email=email)
    assert len(si["companies"]) >= 2, (
        f"Expected >=2 companies after second membership, got {si['companies']}"
    )
