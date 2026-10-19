"""OAuth2 broker helpers — provider registry, client config, token exchange and refresh.

All functions are pure helpers (no DB, no Redis). They are consumed by the connector
endpoints that implement the authorization-code flow for piece connectors.

Security: client_secret, code, access_token, and refresh_token are NEVER logged.
"""
from __future__ import annotations

import logging
import time

import httpx

from .config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

OAUTH_PROVIDERS: dict[str, dict] = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "revoke_url": "https://oauth2.googleapis.com/revoke",
        "authorize_extra": {"access_type": "offline", "prompt": "consent"},
        "refresh_style": "refresh_token",
    },
    "meta": {
        "authorize_url": "https://www.facebook.com/v21.0/dialog/oauth",
        "token_url": "https://graph.facebook.com/v21.0/oauth/access_token",
        "revoke_url": None,
        "authorize_extra": {},
        "refresh_style": "meta_long_lived",
    },
}


# ---------------------------------------------------------------------------
# Client config
# ---------------------------------------------------------------------------

def provider_client(provider: str) -> tuple[str, str]:
    """Return (client_id, client_secret) for *provider* from Settings.

    Raises ValueError if the provider is not configured in OMILO_OAUTH_CLIENTS.
    client_secret is intentionally not logged here or anywhere in this module.
    """
    clients = get_settings().oauth_clients
    entry = clients.get(provider)
    if not entry:
        raise ValueError(
            f"OAuth provider {provider!r} is not configured. "
            "Set OMILO_OAUTH_CLIENTS with a JSON map of {provider: {client_id, client_secret}}."
        )
    return entry["client_id"], entry["client_secret"]


# ---------------------------------------------------------------------------
# Token normalization
# ---------------------------------------------------------------------------

def _normalize_token(raw: dict, existing_refresh_token: str | None = None) -> dict:
    """Map a raw provider token response to our canonical token dict shape.

    Shape: {"access_token": str, "refresh_token": str|None,
            "expires_at": float|None, "token_type": "bearer"}

    expires_at = time.time() + expires_in when the response carries expires_in, else None.
    If the response omits refresh_token, existing_refresh_token is preserved.
    token_type is always normalized to lowercase "bearer".
    """
    expires_in = raw.get("expires_in")
    expires_at = time.time() + float(expires_in) if expires_in is not None else None
    refresh_token = raw.get("refresh_token") or existing_refresh_token
    return {
        "access_token": raw["access_token"],
        "refresh_token": refresh_token,
        "expires_at": expires_at,
        "token_type": "bearer",
    }


# ---------------------------------------------------------------------------
# Token exchange
# ---------------------------------------------------------------------------

def exchange_code(provider: str, code: str, redirect_uri: str) -> dict:
    """Exchange an authorization code for tokens.

    Posts to the provider's token_url with grant_type=authorization_code.
    Returns a normalized token dict.

    Security: code and client_secret are not logged.
    """
    cfg = OAUTH_PROVIDERS[provider]
    client_id, client_secret = provider_client(provider)

    logger.info("exchange_code: provider=%s redirect_uri=%s", provider, redirect_uri)

    resp = httpx.post(
        cfg["token_url"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return _normalize_token(resp.json())


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------

def refresh_access_token(provider: str, refresh_token: str) -> dict:
    """Refresh an access token using an existing refresh_token.

    For refresh_style=="refresh_token": POSTs grant_type=refresh_token to the provider.
    The existing refresh_token is preserved if the response omits one.

    For refresh_style=="meta_long_lived": raises ValueError — Meta tokens are not
    auto-refreshable in this phase (use the fb_exchange_token grant manually).

    Security: refresh_token is not logged.
    """
    cfg = OAUTH_PROVIDERS[provider]

    if cfg["refresh_style"] == "meta_long_lived":
        raise ValueError(
            f"Provider {provider!r} uses the 'meta_long_lived' refresh style and cannot be "
            "automatically refreshed. Use the Meta long-lived token exchange (fb_exchange_token) instead."
        )

    client_id, client_secret = provider_client(provider)

    logger.info("refresh_access_token: provider=%s", provider)

    resp = httpx.post(
        cfg["token_url"],
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return _normalize_token(resp.json(), existing_refresh_token=refresh_token)
