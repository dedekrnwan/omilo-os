"""Google OAuth 2.0 router — config-gated (P10).

Endpoints (mounted under /v1 → real paths):
  GET /v1/auth/google/start?client=web|desktop
  GET /v1/auth/google/callback?code=&state=

Disabled (404) unless both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.

State mechanism
---------------
The CSRF `state` parameter is a short-lived HS256-signed JWT carrying:
  {"client": "web"|"desktop", "nonce": <uuid4 hex>, "exp": <now+10min>}
signed with Settings.jwt_secret.  The callback verifies the signature + expiry
before accepting the code.  No server-side store needed — the signature is the
proof of origin.

Exchange seam
-------------
`_exchange_code` and `_fetch_userinfo` are module-level async functions that
tests monkeypatch.  Production uses httpx; tests inject fakes without touching
the network.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from jwt.exceptions import PyJWTError

from omilo.auth.passwords import hash_password
from omilo.auth.tokens import make_access_token
from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.tenancy import Company, Member, User

router = APIRouter(prefix="/auth/google", tags=["auth"])

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
_STATE_TTL_SECONDS = 600  # 10 minutes


# ---------------------------------------------------------------------------
# Seam functions — monkeypatch these in tests
# ---------------------------------------------------------------------------


async def _exchange_code(code: str, redirect_uri: str) -> dict:
    """Exchange an authorization code for tokens at Google's token endpoint."""
    settings = get_settings()
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        resp.raise_for_status()
        return resp.json()


async def _fetch_userinfo(access_token: str) -> dict:
    """Fetch the authenticated user's profile from Google's OpenID userinfo endpoint."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_configured():
    """Raise 404 if Google OAuth is not configured."""
    settings = get_settings()
    if not (settings.google_client_id and settings.google_client_secret):
        raise HTTPException(status_code=404, detail="Google OAuth is not configured.")
    return settings


def _make_state(client: str, settings) -> str:
    """Create a signed state JWT encoding {client, nonce, exp}."""
    now = datetime.now(tz=timezone.utc)
    payload = {
        "typ": "oauth_state",  # domain-separate from access tokens (same jwt_secret in HS256)
        "client": client,
        "nonce": uuid.uuid4().hex,
        "iat": now,
        "exp": now + timedelta(seconds=_STATE_TTL_SECONDS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _decode_state(state: str, settings) -> dict:
    """Decode and validate the state JWT; raise HTTPException(400) on failure."""
    try:
        claims = jwt.decode(state, settings.jwt_secret, algorithms=["HS256"])
    except PyJWTError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid or expired state: {exc}") from exc
    # Reject anything that isn't an oauth_state token (e.g. a replayed access token).
    if claims.get("typ") != "oauth_state":
        raise HTTPException(status_code=400, detail="Invalid state.")
    return claims


def _upsert_user(email: str, name: str) -> tuple[User, Company, str]:
    """Find or create a User+Company+owner Member for the given Google email.

    Returns: (user, active_company, role)
    """
    with SessionLocal() as session:
        with session.begin():
            existing_user = session.query(User).filter_by(email=email).first()

            if existing_user is not None:
                # Existing user — use their first (owner) company.
                member = (
                    session.query(Member).filter_by(user_id=existing_user.id).first()
                )
                if member is None:
                    raise HTTPException(
                        status_code=500,
                        detail="User has no company membership.",
                    )
                company = session.get(Company, member.company_id)
                if company is None:
                    raise HTTPException(
                        status_code=500,
                        detail="User's active company not found.",
                    )
                return existing_user, company, member.role

            # New user — create User + Company + owner Member (mirrors sign_up).
            user = User(
                id=prefixed_id("usr"),
                email=email,
                name=name,
                # OAuth users have no password; set a random unusable hash so the
                # nullable field is populated (they can set a password later).
                password_hash=hash_password(secrets.token_urlsafe(32)),
            )
            session.add(user)

            company = Company(
                id=prefixed_id("cmp"),
                name=f"{name}'s workspace",
                color="#6366f1",
                timezone="UTC",
            )
            session.add(company)
            session.flush()

            member = Member(
                id=prefixed_id("mem"),
                company_id=company.id,
                user_id=user.id,
                role="owner",
            )
            session.add(member)
            # Objects are still accessible after commit (expire_on_commit=False).

    return user, company, "owner"


# ---------------------------------------------------------------------------
# GET /v1/auth/google/start
# ---------------------------------------------------------------------------


@router.get("/start")
async def google_start(client: str = Query(default="web")) -> RedirectResponse:
    """Initiate the Google OAuth flow.

    Builds the Google authorization URL with a signed CSRF state and redirects.
    Returns 404 if GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured.
    """
    settings = _require_configured()

    if client not in ("web", "desktop"):
        raise HTTPException(status_code=400, detail="client must be 'web' or 'desktop'.")

    state = _make_state(client, settings)
    redirect_uri = f"{settings.google_redirect_base}/v1/auth/google/callback"

    params = urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
    })
    return RedirectResponse(
        url=f"{_GOOGLE_AUTH_URL}?{params}",
        status_code=302,
    )


# ---------------------------------------------------------------------------
# GET /v1/auth/google/callback
# ---------------------------------------------------------------------------


@router.get("/callback")
async def google_callback(
    code: str = Query(default=None),
    state: str = Query(default=None),
) -> RedirectResponse:
    """Handle Google's redirect back after user consent.

    Validates state, exchanges code for tokens, fetches userinfo, upserts
    the user, mints an access token, and redirects to the client.
    Returns 404 if unconfigured; 400 if state is missing/invalid.
    """
    settings = _require_configured()

    if not state:
        raise HTTPException(status_code=400, detail="Missing state parameter.")

    state_claims = _decode_state(state, settings)
    oauth_client: str = state_claims.get("client", "web")

    if not code:
        raise HTTPException(status_code=400, detail="Missing code parameter.")

    redirect_uri = f"{settings.google_redirect_base}/v1/auth/google/callback"

    # Exchange code for tokens (Google HTTP errors → 502, never a 500 leak).
    try:
        token_data = await _exchange_code(code, redirect_uri)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Google authentication failed.") from exc
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail="Google did not return an access token.")

    # Fetch user profile.
    try:
        userinfo = await _fetch_userinfo(access_token)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Google authentication failed.") from exc
    email: str = userinfo.get("email", "")
    name: str = userinfo.get("name", email)

    if not email:
        raise HTTPException(status_code=502, detail="Google did not return an email address.")

    # SECURITY: only treat the email as an identity key if Google says it's verified.
    # Otherwise an unverified Google email matching an existing email+password
    # account would hijack it (account-takeover). Google returns a JSON boolean.
    if userinfo.get("email_verified") is not True:
        raise HTTPException(status_code=403, detail="Your Google email is not verified.")

    # Upsert user record.
    user, company, role = _upsert_user(email, name)

    # Mint access token.
    jwt_token, _expires = make_access_token(user.id, company.id, role)

    # Redirect to client.
    if oauth_client == "desktop":
        destination = f"omilo://auth/callback?token={jwt_token}"
    else:
        destination = f"{settings.frontend_base}/auth/callback#token={jwt_token}"

    return RedirectResponse(url=destination, status_code=302)
