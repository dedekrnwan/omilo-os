"""Auth endpoint tests — TDD: write failing tests first, then implement.

Tests cover:
- POST /v1/auth/sign-up → 201 + user + session token
- POST /v1/auth/sign-in → 200 + user + session + companies[]
- GET  /v1/me with valid token → 200 + user + member + company
- GET  /v1/me with bad/absent token → 401
- POST /v1/auth/sign-up with duplicate email → 409
- GET  /v1/me with NotConfiguredError from control plane → 503 (P6-T1)
"""
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

import omilo.auth.deps as _auth_deps_mod
from omilo.control.factory import NotConfiguredError
from omilo.main import create_app


@pytest.mark.asyncio
async def test_sign_up_creates_user_and_token(async_client):
    """Sign-up returns 201, a user object, and a session token."""
    email = f"signup_{uuid.uuid4().hex[:8]}@test.example"
    resp = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Test User", "password": "hunter2!XY"},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()

    # user fields
    assert body["user"]["email"] == email
    assert body["user"]["name"] == "Test User"
    assert "id" in body["user"]

    # session fields
    assert "access" in body["session"]
    assert "expires_at" in body["session"]
    assert body["session"]["access"]  # non-empty


@pytest.mark.asyncio
async def test_sign_in_returns_token_and_companies(async_client):
    """Sign-in returns 200, user, session, and a non-empty companies list."""
    email = f"signin_{uuid.uuid4().hex[:8]}@test.example"
    # Create the account first
    await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Signin User", "password": "pass!W0rd"},
    )

    resp = await async_client.post(
        "/v1/auth/sign-in",
        json={"email": email, "password": "pass!W0rd"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["user"]["email"] == email
    assert "access" in body["session"]
    assert "expires_at" in body["session"]
    assert isinstance(body["companies"], list)
    assert len(body["companies"]) >= 1
    assert "id" in body["companies"][0]
    assert "name" in body["companies"][0]


@pytest.mark.asyncio
async def test_me_returns_user_member_company(async_client):
    """GET /v1/me with valid Bearer token returns user, member, company."""
    email = f"me_{uuid.uuid4().hex[:8]}@test.example"
    sign_up = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Me User", "password": "mepass!Z9"},
    )
    assert sign_up.status_code == 201
    token = sign_up.json()["session"]["access"]

    resp = await async_client.get(
        "/v1/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # user shape
    assert body["user"]["email"] == email
    assert body["user"]["name"] == "Me User"
    assert "id" in body["user"]

    # member shape
    assert body["member"]["role"] == "owner"

    # company shape
    assert "id" in body["company"]
    assert "name" in body["company"]

    # companies[] shape — spec §3 requires companies[] in /me response
    assert isinstance(body["companies"], list), "companies[] must be present"
    assert len(body["companies"]) >= 1, "companies[] must contain at least one entry"
    assert "id" in body["companies"][0]
    assert "name" in body["companies"][0]
    # The active company must be in companies[]
    assert any(c["id"] == body["company"]["id"] for c in body["companies"])


@pytest.mark.asyncio
async def test_me_without_token_returns_401(async_client):
    """GET /v1/me with no Authorization header returns 401."""
    resp = await async_client.get("/v1/me")
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_me_with_bad_token_returns_401(async_client):
    """GET /v1/me with a malformed/invalid token returns 401."""
    resp = await async_client.get(
        "/v1/me",
        headers={"Authorization": "Bearer not.a.valid.jwt"},
    )
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_sign_in_wrong_password_returns_401(async_client):
    """Sign-in with wrong password returns 401."""
    email = f"badpw_{uuid.uuid4().hex[:8]}@test.example"
    await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Bad PW", "password": "correct!P4ss"},
    )

    resp = await async_client.post(
        "/v1/auth/sign-in",
        json={"email": email, "password": "wrong!password"},
    )
    assert resp.status_code == 401, resp.text


@pytest.mark.asyncio
async def test_duplicate_email_returns_409(async_client):
    """Signing up with a duplicate email returns 409 Conflict."""
    email = f"dup_{uuid.uuid4().hex[:8]}@test.example"
    first = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "First", "password": "firstP4ss!"},
    )
    assert first.status_code == 201

    second = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Duplicate", "password": "secondP4ss!"},
    )
    assert second.status_code == 409, second.text


@pytest.mark.asyncio
async def test_me_with_misconfigured_control_plane_returns_503(monkeypatch):
    """P6-T1: NotConfiguredError from get_control_plane() must yield 503, not 500.

    Simulates a deployment where OMILO_MODE=runtime is set but RemoteControlPlane
    is not yet wired — get_control_plane() raises NotConfiguredError before
    verify_token is ever called.  The auth dependency must catch this and return
    503 Service Unavailable rather than letting the exception bubble as a 500.
    """
    def _raise_not_configured():
        raise NotConfiguredError("OMILO_MODE=runtime not configured")

    monkeypatch.setattr(_auth_deps_mod, "get_control_plane", _raise_not_configured)

    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.get(
            "/v1/me",
            headers={"Authorization": "Bearer any.token.here"},
        )

    assert resp.status_code == 503, (
        f"Expected 503 when control plane raises NotConfiguredError, got {resp.status_code}: {resp.text}"
    )
