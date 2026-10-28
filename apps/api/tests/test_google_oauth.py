"""TDD — P10 T1: Google OAuth backend (config-gated).

Endpoints:
  GET /v1/auth/google/start?client=web|desktop
  GET /v1/auth/google/callback?code=&state=

Gate: disabled (404) unless GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set.

State mechanism: a short-lived signed JWT carrying {client, nonce} signed with
jwt_secret (HS256), exp=10min.  The callback verifies the JWT before exchange.

Exchange seam: google.py exposes _exchange_code(code, redirect_uri) and
_fetch_userinfo(access_token) which tests monkeypatch — no real network.

Tests:
  A. /start → 404 when unconfigured.
  B. /start (configured) → 302 to accounts.google.com with required params + state.
  C. /callback with missing/bad state → 400.
  D. /callback (fake exchange) new email → creates user+company, 302 to frontend#token.
  E. /callback existing email → no duplicate user, token for their company.
  F. client=desktop → Location starts omilo://auth/callback?token=
"""
from __future__ import annotations

import uuid
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import pytest

from omilo.config import Settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _configured_settings(**kwargs) -> Settings:
    """Settings with both Google creds set (minimum required for OAuth)."""
    return Settings(
        google_client_id="test-client-id",
        google_client_secret="test-client-secret",
        google_redirect_base="http://localhost:8000",
        frontend_base="http://localhost:5173",
        **kwargs,
    )


def _unconfigured_settings() -> Settings:
    return Settings()


def _fake_exchange(
    email: str = "newuser@example.com",
    name: str = "New User",
    email_verified: bool = True,
):
    """Return a monkeypatch pair: fake _exchange_code + fake _fetch_userinfo."""
    async def _exchange_code(code: str, redirect_uri: str) -> dict:
        return {"access_token": "fake-access-token", "token_type": "Bearer"}

    async def _fetch_userinfo(access_token: str) -> dict:
        return {
            "email": email,
            "name": name,
            "email_verified": email_verified,
            "sub": f"google|{email}",
        }

    return _exchange_code, _fetch_userinfo


# ---------------------------------------------------------------------------
# A. /start → 404 when unconfigured
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_start_404_when_unconfigured(async_client):
    """GET /v1/auth/google/start → 404 when GOOGLE_CLIENT_ID/SECRET not set."""
    settings = _unconfigured_settings()
    with patch("omilo.auth.google.get_settings", return_value=settings):
        resp = await async_client.get("/v1/auth/google/start?client=web")
    assert resp.status_code == 404, resp.text


# ---------------------------------------------------------------------------
# B. /start (configured) → 302 to accounts.google.com with correct params + state
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_b_start_redirects_to_google_when_configured(async_client):
    """GET /v1/auth/google/start (configured) → 302 to accounts.google.com."""
    settings = _configured_settings()
    with patch("omilo.auth.google.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/auth/google/start?client=web",
            follow_redirects=False,
        )

    assert resp.status_code == 302, resp.text
    location = resp.headers["location"]
    parsed = urlparse(location)

    assert parsed.scheme == "https"
    assert "accounts.google.com" in parsed.netloc or "accounts.google.com" in location
    qs = parse_qs(parsed.query)

    assert qs["client_id"] == ["test-client-id"]
    assert qs["response_type"] == ["code"]
    assert "openid" in qs["scope"][0]
    assert "email" in qs["scope"][0]
    assert "profile" in qs["scope"][0]
    assert "state" in qs  # CSRF state must be present
    assert qs["state"][0]  # non-empty
    assert qs["redirect_uri"] == ["http://localhost:8000/v1/auth/google/callback"]


# ---------------------------------------------------------------------------
# C. /callback with missing/bad state → 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_c_callback_missing_state_returns_400(async_client):
    """GET /v1/auth/google/callback with no state → 400."""
    settings = _configured_settings()
    with patch("omilo.auth.google.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/auth/google/callback?code=somecode",
            follow_redirects=False,
        )
    assert resp.status_code == 400, resp.text


@pytest.mark.asyncio
async def test_c2_callback_bad_state_returns_400(async_client):
    """GET /v1/auth/google/callback with tampered state → 400."""
    settings = _configured_settings()
    with patch("omilo.auth.google.get_settings", return_value=settings):
        resp = await async_client.get(
            "/v1/auth/google/callback?code=somecode&state=not.a.valid.jwt",
            follow_redirects=False,
        )
    assert resp.status_code == 400, resp.text


# ---------------------------------------------------------------------------
# D. /callback (fake exchange) new email → creates user+company, 302 to frontend#token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_d_callback_new_user_creates_account_and_redirects(async_client):
    """callback with new email creates user+company and 302-redirects with #token."""
    settings = _configured_settings()
    new_email = f"oauth_new_{uuid.uuid4().hex[:8]}@example.com"
    fake_exchange, fake_userinfo = _fake_exchange(email=new_email, name="OAuth User")

    # First, get a real state token from /start
    with patch("omilo.auth.google.get_settings", return_value=settings):
        start_resp = await async_client.get(
            "/v1/auth/google/start?client=web",
            follow_redirects=False,
        )
    assert start_resp.status_code == 302
    state = parse_qs(urlparse(start_resp.headers["location"]).query)["state"][0]

    # Now hit callback with the real state + fake exchange
    with patch("omilo.auth.google.get_settings", return_value=settings), \
         patch("omilo.auth.google._exchange_code", fake_exchange), \
         patch("omilo.auth.google._fetch_userinfo", fake_userinfo):
        cb_resp = await async_client.get(
            f"/v1/auth/google/callback?code=fake-code&state={state}",
            follow_redirects=False,
        )

    assert cb_resp.status_code == 302, cb_resp.text
    location = cb_resp.headers["location"]
    assert location.startswith("http://localhost:5173/auth/callback#token=")

    # Decode the JWT from the fragment
    import jwt as _jwt
    token_str = location.split("#token=")[1]
    claims = _jwt.decode(token_str, options={"verify_signature": False})
    assert "cmp" in claims
    assert "sub" in claims


# ---------------------------------------------------------------------------
# E. /callback existing email → no duplicate user, token for their company
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_e_callback_existing_email_no_duplicate(async_client):
    """callback with existing email signs in without creating a duplicate user."""
    # Create a user via normal sign-up first
    existing_email = f"oauth_exist_{uuid.uuid4().hex[:8]}@example.com"
    signup_resp = await async_client.post(
        "/v1/auth/sign-up",
        json={"email": existing_email, "name": "Existing User", "password": "pass!W0rd1"},
    )
    assert signup_resp.status_code == 201
    original_company_id = signup_resp.json()["session"]["access"]

    # Decode original token to get company_id
    import jwt as _jwt
    orig_claims = _jwt.decode(original_company_id, options={"verify_signature": False})
    orig_company_id = orig_claims["cmp"]

    settings = _configured_settings()
    fake_exchange, fake_userinfo = _fake_exchange(email=existing_email, name="Existing User")

    # Get state from /start
    with patch("omilo.auth.google.get_settings", return_value=settings):
        start_resp = await async_client.get(
            "/v1/auth/google/start?client=web",
            follow_redirects=False,
        )
    assert start_resp.status_code == 302
    state = parse_qs(urlparse(start_resp.headers["location"]).query)["state"][0]

    # Hit callback
    with patch("omilo.auth.google.get_settings", return_value=settings), \
         patch("omilo.auth.google._exchange_code", fake_exchange), \
         patch("omilo.auth.google._fetch_userinfo", fake_userinfo):
        cb_resp = await async_client.get(
            f"/v1/auth/google/callback?code=fake-code&state={state}",
            follow_redirects=False,
        )

    assert cb_resp.status_code == 302, cb_resp.text
    location = cb_resp.headers["location"]
    token_str = location.split("#token=")[1]
    claims = _jwt.decode(token_str, options={"verify_signature": False})

    # Token must be for the SAME company (no new company created)
    assert claims["cmp"] == orig_company_id, (
        f"Expected company {orig_company_id}, got {claims['cmp']} — duplicate created?"
    )


# ---------------------------------------------------------------------------
# F. client=desktop → Location starts omilo://auth/callback?token=
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_f_desktop_client_redirects_to_deep_link(async_client):
    """client=desktop → 302 with Location: omilo://auth/callback?token=<jwt>."""
    settings = _configured_settings()
    desktop_email = f"oauth_desk_{uuid.uuid4().hex[:8]}@example.com"
    fake_exchange, fake_userinfo = _fake_exchange(email=desktop_email, name="Desktop User")

    # Get state for desktop
    with patch("omilo.auth.google.get_settings", return_value=settings):
        start_resp = await async_client.get(
            "/v1/auth/google/start?client=desktop",
            follow_redirects=False,
        )
    assert start_resp.status_code == 302
    state = parse_qs(urlparse(start_resp.headers["location"]).query)["state"][0]

    with patch("omilo.auth.google.get_settings", return_value=settings), \
         patch("omilo.auth.google._exchange_code", fake_exchange), \
         patch("omilo.auth.google._fetch_userinfo", fake_userinfo):
        cb_resp = await async_client.get(
            f"/v1/auth/google/callback?code=fake-code&state={state}",
            follow_redirects=False,
        )

    assert cb_resp.status_code == 302, cb_resp.text
    location = cb_resp.headers["location"]
    assert location.startswith("omilo://auth/callback?token="), (
        f"Desktop redirect should be omilo://, got: {location}"
    )


# ---------------------------------------------------------------------------
# G. /callback with an UNVERIFIED Google email → 403 (no account takeover)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_g_callback_unverified_email_rejected(async_client):
    """A Google email that is not verified must NOT be used to sign in/link."""
    settings = _configured_settings()
    email = f"oauth_unverified_{uuid.uuid4().hex[:8]}@example.com"
    fake_exchange, fake_userinfo = _fake_exchange(email=email, name="Spoofer", email_verified=False)

    with patch("omilo.auth.google.get_settings", return_value=settings):
        start_resp = await async_client.get(
            "/v1/auth/google/start?client=web", follow_redirects=False
        )
    state = parse_qs(urlparse(start_resp.headers["location"]).query)["state"][0]

    with patch("omilo.auth.google.get_settings", return_value=settings), \
         patch("omilo.auth.google._exchange_code", fake_exchange), \
         patch("omilo.auth.google._fetch_userinfo", fake_userinfo):
        cb_resp = await async_client.get(
            f"/v1/auth/google/callback?code=fake-code&state={state}",
            follow_redirects=False,
        )

    assert cb_resp.status_code == 403, cb_resp.text


# ---------------------------------------------------------------------------
# H. Google HTTP error during exchange → 502 (never a 500 internal leak)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_h_google_http_error_returns_502(async_client):
    """If Google's token endpoint errors, the callback returns 502, not 500."""
    import httpx

    settings = _configured_settings()

    async def _boom_exchange(code: str, redirect_uri: str) -> dict:
        raise httpx.HTTPError("google token endpoint failed")

    with patch("omilo.auth.google.get_settings", return_value=settings):
        start_resp = await async_client.get(
            "/v1/auth/google/start?client=web", follow_redirects=False
        )
    state = parse_qs(urlparse(start_resp.headers["location"]).query)["state"][0]

    with patch("omilo.auth.google.get_settings", return_value=settings), \
         patch("omilo.auth.google._exchange_code", _boom_exchange):
        cb_resp = await async_client.get(
            f"/v1/auth/google/callback?code=fake-code&state={state}",
            follow_redirects=False,
        )

    assert cb_resp.status_code == 502, cb_resp.text
