"""Unit tests for HttpBroker — Redis-backed authorization-code OAuth flow.

Redis is real (db 15, see conftest.py REDIS_URL). No live server required.
Tests use random state keys and clean up after themselves to avoid key collisions.

Test conventions (same as test_oauth.py):
- get_settings() is lru_cache'd; when we need custom settings we monkeypatch the
  cached Settings object directly (monkeypatch.setattr on the cached instance).
- bus.reset() is called so the Redis client picks up the right URL after env changes.
- OMILO_REDIS_PREFIX is already set to a random hex prefix by conftest.py, so all
  keys are automatically namespaced for this test run.
"""
from __future__ import annotations

import json
import os
import secrets

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _random_state() -> str:
    """Generate a random state string so tests don't collide."""
    return secrets.token_urlsafe(16)


# ---------------------------------------------------------------------------
# Test: start_connect builds authorize URL and stores state in Redis
# ---------------------------------------------------------------------------

def test_start_connect_builds_authorize_url_and_stores_state(monkeypatch):
    """start_connect must build a real authorize URL with all required params,
    store state→slug in Redis, and return {"auth_url", "state"}."""
    from omilo_api import broker, oauth
    from omilo_api.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    b = broker.HttpBroker()
    m = {"id": "gmail", "auth": {"provider": "google", "scopes": ["s1", "s2"]}}
    res = b.start_connect(m)

    # Must return both keys
    assert "state" in res and res["state"]
    assert "auth_url" in res

    # auth_url must start with Google's authorize URL
    assert res["auth_url"].startswith(oauth.OAUTH_PROVIDERS["google"]["authorize_url"])

    # Must include client_id
    assert "client_id=cid" in res["auth_url"]

    # Must include scopes (URL-encoded space is '+' or '%20')
    assert "s1" in res["auth_url"]
    assert "s2" in res["auth_url"]

    # Must include response_type=code
    assert "response_type=code" in res["auth_url"]

    # Must include state
    assert f"state={res['state']}" in res["auth_url"]

    # State must be stored in Redis
    assert b.slug_for_state(res["state"]) == "gmail"

    # Cleanup
    b.consume_state(res["state"])


def test_start_connect_includes_authorize_extra(monkeypatch):
    """Google's authorize_extra (access_type=offline, prompt=consent) must appear in the URL."""
    from omilo_api import broker, oauth
    from omilo_api.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    b = broker.HttpBroker()
    m = {"id": "gmail", "auth": {"provider": "google", "scopes": ["email"]}}
    res = b.start_connect(m)

    extra = oauth.OAUTH_PROVIDERS["google"]["authorize_extra"]
    for key, value in extra.items():
        assert f"{key}={value}" in res["auth_url"], (
            f"Expected {key}={value} in auth_url from authorize_extra"
        )

    b.consume_state(res["state"])


def test_start_connect_includes_redirect_uri(monkeypatch):
    """start_connect must include the configured redirect_uri in the authorize URL."""
    from omilo_api import broker
    from omilo_api.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    b = broker.HttpBroker()
    m = {"id": "gmail", "auth": {"provider": "google", "scopes": ["email"]}}
    res = b.start_connect(m)

    redirect_uri = get_settings().oauth_redirect_uri()
    assert "redirect_uri=" in res["auth_url"]
    # The redirect_uri is URL-encoded in the query string
    import urllib.parse
    decoded = urllib.parse.unquote_plus(res["auth_url"])
    assert redirect_uri in decoded

    b.consume_state(res["state"])


# ---------------------------------------------------------------------------
# Test: poll / stash_token / consume_state lifecycle
# ---------------------------------------------------------------------------

def test_poll_returns_none_before_stash():
    """poll must return None if no token has been stashed yet for a state."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "gmail")
    try:
        assert b.poll(state) is None
    finally:
        b.consume_state(state)


def test_poll_returns_token_after_stash():
    """After stash_token, poll must return {"token": <dict>}."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "gmail")
    b.stash_token(state, {"access_token": "AT"})
    try:
        result = b.poll(state)
        assert result == {"token": {"access_token": "AT"}}
    finally:
        b.consume_state(state)


def test_poll_returns_none_after_consume():
    """After consume_state, both poll and slug_for_state must return None."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "gmail")
    b.stash_token(state, {"access_token": "AT"})
    b.consume_state(state)

    assert b.poll(state) is None
    assert b.slug_for_state(state) is None


def test_full_lifecycle_matches_brief():
    """Canonical lifecycle from the brief: store, no-token→None, stash, poll→token, consume."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = "st-" + _random_state()

    b._store_state(state, "gmail")
    assert b.poll(state) is None

    b.stash_token(state, {"access_token": "AT"})
    assert b.poll(state) == {"token": {"access_token": "AT"}}

    b.consume_state(state)
    assert b.poll(state) is None
    assert b.slug_for_state(state) is None


# ---------------------------------------------------------------------------
# Test: slug_for_state
# ---------------------------------------------------------------------------

def test_slug_for_state_returns_none_for_unknown():
    """slug_for_state must return None for a state that was never stored."""
    from omilo_api import broker

    b = broker.HttpBroker()
    assert b.slug_for_state("completely-unknown-state-xyz") is None


def test_slug_for_state_returns_correct_slug():
    """slug_for_state returns the slug that was associated with the state."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "calendar")
    try:
        assert b.slug_for_state(state) == "calendar"
    finally:
        b.consume_state(state)


# ---------------------------------------------------------------------------
# Test: consume_state idempotency
# ---------------------------------------------------------------------------

def test_consume_state_is_idempotent():
    """Calling consume_state twice must not raise — it is safe to call on an already-gone state."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "gmail")
    b.consume_state(state)
    b.consume_state(state)  # Must not raise


# ---------------------------------------------------------------------------
# Test: stash_token stores JSON and TTL is set
# ---------------------------------------------------------------------------

def test_stash_token_stores_complex_token():
    """stash_token must preserve the full token dict including all fields."""
    from omilo_api import broker

    b = broker.HttpBroker()
    state = _random_state()
    b._store_state(state, "sheets")
    token = {"access_token": "AT", "refresh_token": "RT", "expires_at": 9999.0, "token_type": "bearer"}
    b.stash_token(state, token)
    try:
        result = b.poll(state)
        assert result is not None
        assert result["token"]["refresh_token"] == "RT"
        assert result["token"]["expires_at"] == 9999.0
    finally:
        b.consume_state(state)


# ---------------------------------------------------------------------------
# Test: revoke — best-effort POST, no raise on failure
# ---------------------------------------------------------------------------

def test_revoke_posts_to_revoke_url(monkeypatch):
    """revoke must POST to the provider's revoke_url with the token in the request
    body (RFC 7009 §2.1), NOT as a query parameter."""
    from omilo_api import broker
    from omilo_api.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    captured = []

    import httpx as _httpx

    def fake_post(url, **kwargs):
        captured.append({"url": url, "kwargs": kwargs})

        class R:
            def raise_for_status(self):
                pass

        return R()

    monkeypatch.setattr(_httpx, "post", fake_post)

    b = broker.HttpBroker()
    b.revoke({"access_token": "AT", "provider": "google"})

    assert len(captured) == 1, f"Expected exactly one POST call, got: {captured}"
    call = captured[0]

    # Token must be in the body (data=), not in query params
    assert call["kwargs"].get("data") == {"token": "AT"}, (
        f"Expected data={{'token': 'AT'}}, got: {call['kwargs'].get('data')}"
    )
    assert "params" not in call["kwargs"] or call["kwargs"].get("params") is None, (
        f"Token must NOT be sent as query param, but got params={call['kwargs'].get('params')}"
    )

    # URL must be Google's revoke endpoint
    assert "google" in call["url"] or "oauth2.googleapis.com" in call["url"], (
        f"Expected a POST to Google's revoke URL, got: {call['url']}"
    )


def test_revoke_swallows_errors(monkeypatch):
    """revoke must not raise even when the HTTP call fails."""
    from omilo_api import broker
    from omilo_api.config import get_settings
    import httpx as _httpx

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    def exploding_post(url, **kwargs):
        raise _httpx.ConnectError("boom")

    monkeypatch.setattr(_httpx, "post", exploding_post)

    b = broker.HttpBroker()
    # Must not raise
    b.revoke({"access_token": "AT", "provider": "google"})


def test_revoke_noop_when_no_revoke_url(monkeypatch):
    """revoke must silently do nothing when the provider has no revoke_url (e.g. Meta)."""
    from omilo_api import broker
    from omilo_api.config import get_settings
    import httpx as _httpx

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"meta": {"client_id": "cid", "client_secret": "sec"}},
        raising=False,
    )

    calls = []
    monkeypatch.setattr(_httpx, "post", lambda url, **kwargs: calls.append(url))

    b = broker.HttpBroker()
    b.revoke({"access_token": "AT", "provider": "meta"})
    assert calls == [], "revoke must not POST when revoke_url is None"


# ---------------------------------------------------------------------------
# Test: HttpBroker implements BrokerClient Protocol
# ---------------------------------------------------------------------------

def test_http_broker_implements_protocol():
    """HttpBroker must satisfy the BrokerClient Protocol (runtime_checkable)."""
    from omilo_api import broker

    b = broker.HttpBroker()
    assert isinstance(b, broker.BrokerClient)


# ---------------------------------------------------------------------------
# Test: DevBroker still works (regression guard)
# ---------------------------------------------------------------------------

def test_dev_broker_still_works():
    """DevBroker must still satisfy the BrokerClient protocol and work in-process."""
    from omilo_api import broker

    b = broker.DevBroker()
    assert isinstance(b, broker.BrokerClient)

    m = {"id": "gmail", "auth": {"provider": "google", "scopes": ["email"]}}
    res = b.start_connect(m)
    assert "state" in res and "auth_url" in res

    # DevBroker returns a fixture token immediately
    tok = b.poll(res["state"])
    assert tok is not None
    assert "token" in tok

    b.consume_state(res["state"])
    assert b.slug_for_state(res["state"]) is None


# ---------------------------------------------------------------------------
# Task 5: get_broker() selection tests
# ---------------------------------------------------------------------------

def test_default_broker_is_dev_without_clients(monkeypatch):
    """get_broker() must return a DevBroker when oauth_clients is empty."""
    from omilo_api import broker
    from omilo_api.config import get_settings

    monkeypatch.setattr(get_settings(), "oauth_clients", {}, raising=False)
    assert isinstance(broker.get_broker(), broker.DevBroker)


def test_default_broker_is_http_with_clients(monkeypatch):
    """get_broker() must return an HttpBroker when oauth_clients is non-empty."""
    from omilo_api import broker
    from omilo_api.config import get_settings

    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "c", "client_secret": "s"}},
        raising=False,
    )
    assert isinstance(broker.get_broker(), broker.HttpBroker)


# ---------------------------------------------------------------------------
# Task 5: set_connector_token round-trip test
# ---------------------------------------------------------------------------

def test_set_connector_token_round_trips():
    """set_connector_token must store the token dict and clear needs_reconnect."""
    from omilo_api.capabilities import connector_secrets, set_connector_token
    from omilo_api.models import Connector

    c = Connector(id="gmail")
    set_connector_token(
        c,
        {
            "access_token": "AT",
            "refresh_token": "RT",
            "expires_at": 123.0,
            "token_type": "bearer",
        },
    )
    s = connector_secrets(c)
    assert s["token"]["access_token"] == "AT"
    assert s["token"]["refresh_token"] == "RT"
    assert s["token"]["expires_at"] == 123.0
    assert "needs_reconnect" not in s


def test_set_connector_token_clears_needs_reconnect():
    """set_connector_token must clear a pre-existing needs_reconnect sentinel."""
    from omilo_api.capabilities import (
        connector_secrets,
        set_connector_needs_reconnect,
        set_connector_token,
    )
    from omilo_api.models import Connector

    c = Connector(id="gmail")
    # Pre-set needs_reconnect
    set_connector_needs_reconnect(c, True)
    assert connector_secrets(c).get("needs_reconnect") is True

    # Now store a fresh token — needs_reconnect must be gone
    set_connector_token(c, {"access_token": "AT2", "refresh_token": "RT2", "expires_at": 0.0, "token_type": "bearer"})
    s = connector_secrets(c)
    assert "needs_reconnect" not in s
    assert s["token"]["access_token"] == "AT2"
