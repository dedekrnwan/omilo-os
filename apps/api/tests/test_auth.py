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
async def test_sign_up_seeds_default_area_and_chief(async_client):
    """A fresh sign-up seeds a default area + a Chief Helper (Task A).

    After sign-up: GET /v1/channels returns >= 1 with a default area, and the
    company has an is_chief helper — so goal-create works without a 409.
    """
    email = f"seed_{uuid.uuid4().hex[:8]}@test.example"
    sign_up = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Seed User", "password": "seedP4ss!"},
    )
    assert sign_up.status_code == 201, sign_up.text
    token = sign_up.json()["session"]["access"]
    headers = {"Authorization": f"Bearer {token}"}

    # Default area present.
    channels = await async_client.get("/v1/channels", headers=headers)
    assert channels.status_code == 200, channels.text
    rows = channels.json()
    assert len(rows) >= 1, "sign-up must seed at least one channel"
    assert any(c.get("isDefault") for c in rows), f"a default channel is required: {rows}"
    channel_id = rows[0]["id"]

    # Chief helper present.
    helpers = await async_client.get("/v1/helpers", headers=headers)
    assert helpers.status_code == 200, helpers.text
    hrows = helpers.json()
    assert any(h.get("isChief") for h in hrows), f"a Chief helper is required: {hrows}"


@pytest.mark.asyncio
async def test_sign_up_then_goal_create_succeeds(async_client):
    """After sign-up, POST /v1/goals succeeds (no 409 "No Chief Helper") (Task A)."""
    email = f"goal_{uuid.uuid4().hex[:8]}@test.example"
    sign_up = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Goal User", "password": "goalP4ss!"},
    )
    assert sign_up.status_code == 201, sign_up.text
    token = sign_up.json()["session"]["access"]
    headers = {"Authorization": f"Bearer {token}"}

    channels = await async_client.get("/v1/channels", headers=headers)
    channel_id = channels.json()[0]["id"]

    goal = await async_client.post(
        "/v1/goals",
        headers=headers,
        json={"channel_id": channel_id, "title": "Ship it", "target": "Ship the thing"},
    )
    assert goal.status_code == 200, goal.text
    assert goal.json()["goal"]["id"]


@pytest.mark.asyncio
async def test_patch_me_updates_name(async_client):
    """PATCH /v1/me {name} updates the user's name and round-trips via GET /me (Task B)."""
    email = f"patchme_{uuid.uuid4().hex[:8]}@test.example"
    sign_up = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Old Name", "password": "nameP4ss!"},
    )
    assert sign_up.status_code == 201, sign_up.text
    token = sign_up.json()["session"]["access"]
    headers = {"Authorization": f"Bearer {token}"}

    patched = await async_client.patch(
        "/v1/me", headers=headers, json={"name": "New Name"}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["user"]["name"] == "New Name"
    assert patched.json()["user"]["email"] == email

    me = await async_client.get("/v1/me", headers=headers)
    assert me.json()["user"]["name"] == "New Name"


@pytest.mark.asyncio
async def test_sign_in_remember_issues_long_lived_token(async_client):
    """sign-in with remember=true yields a token with a ~30d exp vs the short default (Task E)."""
    import jwt

    from omilo.config import get_settings

    email = f"remember_{uuid.uuid4().hex[:8]}@test.example"
    await async_client.post(
        "/v1/auth/sign-up",
        json={"email": email, "name": "Remember User", "password": "rememberP4ss!"},
    )

    default_resp = await async_client.post(
        "/v1/auth/sign-in", json={"email": email, "password": "rememberP4ss!"}
    )
    remember_resp = await async_client.post(
        "/v1/auth/sign-in",
        json={"email": email, "password": "rememberP4ss!", "remember": True},
    )
    assert default_resp.status_code == 200, default_resp.text
    assert remember_resp.status_code == 200, remember_resp.text

    secret = get_settings().jwt_secret
    default_exp = jwt.decode(
        default_resp.json()["session"]["access"], secret, algorithms=["HS256"]
    )["exp"]
    remember_exp = jwt.decode(
        remember_resp.json()["session"]["access"], secret, algorithms=["HS256"]
    )["exp"]

    # Remember token lives far longer than the default (at least ~25 days further out).
    assert remember_exp - default_exp > 25 * 24 * 3600, (
        f"remember token exp not extended: default={default_exp} remember={remember_exp}"
    )


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
