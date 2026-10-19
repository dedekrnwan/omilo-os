"""Pure unit tests for omilo_api.oauth — provider registry, client config, and token helpers.

No live server, DB, or Redis needed. All HTTP calls are monkeypatched.

Test conventions:
- get_settings() is lru_cache'd; when we need fresh settings we set the env var and call
  get_settings.cache_clear().
- For monkeypatching the cached settings object directly we use monkeypatch.setattr
  (pydantic_settings 2.x is mutable by default).
- HTTP calls are monkeypatched via monkeypatch.setattr(oauth.httpx, "post", fake_post).
"""
from __future__ import annotations

import json
import os

import pytest


# ---------------------------------------------------------------------------
# Task 1: provider registry
# ---------------------------------------------------------------------------

def test_registry_has_google_and_meta():
    from omilo_api.oauth import OAUTH_PROVIDERS
    assert {"google", "meta"} <= set(OAUTH_PROVIDERS)
    assert OAUTH_PROVIDERS["google"]["refresh_style"] == "refresh_token"
    assert OAUTH_PROVIDERS["meta"]["refresh_style"] == "meta_long_lived"
    # Google must force offline consent so a refresh_token is returned
    assert OAUTH_PROVIDERS["google"]["authorize_extra"].get("access_type") == "offline"


def test_registry_google_urls():
    from omilo_api.oauth import OAUTH_PROVIDERS
    g = OAUTH_PROVIDERS["google"]
    assert g["authorize_url"] == "https://accounts.google.com/o/oauth2/v2/auth"
    assert g["token_url"] == "https://oauth2.googleapis.com/token"
    assert g["revoke_url"] == "https://oauth2.googleapis.com/revoke"
    assert g["authorize_extra"].get("prompt") == "consent"


def test_registry_meta_urls():
    from omilo_api.oauth import OAUTH_PROVIDERS
    m = OAUTH_PROVIDERS["meta"]
    assert m["authorize_url"] == "https://www.facebook.com/v21.0/dialog/oauth"
    assert m["token_url"] == "https://graph.facebook.com/v21.0/oauth/access_token"
    assert m["revoke_url"] is None
    assert m["authorize_extra"] == {}


# ---------------------------------------------------------------------------
# Task 1: provider_client
# ---------------------------------------------------------------------------

def test_provider_client_reads_settings(monkeypatch):
    from omilo_api import oauth
    from omilo_api.config import get_settings
    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )
    assert oauth.provider_client("google") == ("cid", "sec")


def test_provider_client_unconfigured_raises():
    """With no clients configured, provider_client must raise ValueError."""
    import os as _os
    from omilo_api.config import get_settings
    # Ensure no google entry in oauth_clients by patching the cached Settings object
    get_settings.cache_clear()
    _os.environ["OMILO_OAUTH_CLIENTS"] = json.dumps({})
    get_settings.cache_clear()
    try:
        from omilo_api import oauth
        with pytest.raises(ValueError):
            oauth.provider_client("google")
    finally:
        _os.environ.pop("OMILO_OAUTH_CLIENTS", None)
        get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Task 1: oauth_redirect_uri (config addition)
# ---------------------------------------------------------------------------

def test_redirect_uri_built_from_public_url():
    from omilo_api.config import get_settings
    uri = get_settings().oauth_redirect_uri()
    assert uri.endswith("/api/connectors/pieces/connect/callback")


def test_redirect_uri_includes_base_path(monkeypatch):
    from omilo_api.config import get_settings
    monkeypatch.setattr(get_settings(), "public_url", "https://myapp.example.com", raising=False)
    monkeypatch.setattr(get_settings(), "base_path", "/os", raising=False)
    uri = get_settings().oauth_redirect_uri()
    assert uri == "https://myapp.example.com/os/api/connectors/pieces/connect/callback"


def test_redirect_uri_no_double_slash(monkeypatch):
    """Trailing slash on public_url must not produce double-slash."""
    from omilo_api.config import get_settings
    monkeypatch.setattr(get_settings(), "public_url", "https://myapp.example.com/", raising=False)
    monkeypatch.setattr(get_settings(), "base_path", "", raising=False)
    uri = get_settings().oauth_redirect_uri()
    assert "//" not in uri.replace("https://", ""), f"double slash in uri: {uri}"


# ---------------------------------------------------------------------------
# Task 2: exchange_code
# ---------------------------------------------------------------------------

def test_exchange_code_posts_and_normalizes(monkeypatch):
    from omilo_api import oauth

    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["url"] = url
        captured["data"] = data

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "access_token": "AT",
                    "refresh_token": "RT",
                    "expires_in": 3600,
                    "token_type": "bearer",
                }

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    tok = oauth.exchange_code("google", "CODE", "https://omilo/cb")

    assert captured["url"] == oauth.OAUTH_PROVIDERS["google"]["token_url"]
    assert captured["data"]["grant_type"] == "authorization_code"
    assert captured["data"]["code"] == "CODE"
    assert captured["data"]["client_id"] == "cid"
    assert captured["data"]["client_secret"] == "sec"
    assert tok["access_token"] == "AT"
    assert tok["refresh_token"] == "RT"
    assert tok["expires_at"] is not None
    assert tok["token_type"] == "bearer"


def test_exchange_code_no_expires_in_gives_none(monkeypatch):
    """When token response has no expires_in, expires_at must be None."""
    from omilo_api import oauth

    def fake_post(url, data=None, timeout=None):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT", "token_type": "bearer"}

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    tok = oauth.exchange_code("google", "CODE", "https://omilo/cb")
    assert tok["expires_at"] is None
    assert tok["refresh_token"] is None


def test_exchange_code_expires_at_is_float(monkeypatch):
    """expires_at must be a float (time.time() + expires_in)."""
    import time
    from omilo_api import oauth

    def fake_post(url, data=None, timeout=None):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT", "expires_in": 3600, "token_type": "bearer"}

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    before = time.time()
    tok = oauth.exchange_code("google", "CODE", "https://omilo/cb")
    after = time.time()

    assert isinstance(tok["expires_at"], float)
    assert before + 3600 <= tok["expires_at"] <= after + 3600


# ---------------------------------------------------------------------------
# Task 2: refresh_access_token
# ---------------------------------------------------------------------------

def test_refresh_preserves_refresh_token_when_omitted(monkeypatch):
    """When the refresh response omits refresh_token, the original must be preserved."""
    from omilo_api import oauth

    def fake_post(url, data=None, timeout=None):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT2", "expires_in": 3600}

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    tok = oauth.refresh_access_token("google", "RT")
    assert tok["access_token"] == "AT2"
    assert tok["refresh_token"] == "RT"


def test_refresh_uses_new_refresh_token_when_present(monkeypatch):
    """When the refresh response includes a new refresh_token, use it."""
    from omilo_api import oauth

    def fake_post(url, data=None, timeout=None):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT2", "refresh_token": "RT2", "expires_in": 3600}

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    tok = oauth.refresh_access_token("google", "RT")
    assert tok["refresh_token"] == "RT2"


def test_refresh_posts_correct_grant(monkeypatch):
    """refresh_access_token must POST grant_type=refresh_token to the provider token_url."""
    from omilo_api import oauth

    captured = {}

    def fake_post(url, data=None, timeout=None):
        captured["url"] = url
        captured["data"] = data

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT2", "expires_in": 3600}

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    oauth.refresh_access_token("google", "MY_RT")
    assert captured["url"] == oauth.OAUTH_PROVIDERS["google"]["token_url"]
    assert captured["data"]["grant_type"] == "refresh_token"
    assert captured["data"]["refresh_token"] == "MY_RT"


def test_refresh_meta_style_raises():
    """refresh_access_token for Meta (meta_long_lived style) must raise ValueError."""
    from omilo_api import oauth

    with pytest.raises(ValueError):
        oauth.refresh_access_token("meta", "whatever")


def test_token_type_always_bearer(monkeypatch):
    """token_type must always be 'bearer' regardless of what provider returns."""
    from omilo_api import oauth

    def fake_post(url, data=None, timeout=None):
        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {"access_token": "AT", "token_type": "Bearer"}  # case variation

        return R()

    monkeypatch.setattr(oauth, "provider_client", lambda p: ("cid", "sec"))
    monkeypatch.setattr(oauth.httpx, "post", fake_post)

    tok = oauth.exchange_code("google", "CODE", "https://omilo/cb")
    assert tok["token_type"] == "bearer"
