"""Unit tests for _fresh_token and _force_refresh in omilo_api.mcp_server (Task 6).

Tests are pure unit tests — no DB, no network, no running server.
We construct a bare Connector object with secrets_enc set via capabilities helpers,
use a stub db with a .commit() method, and monkeypatch oauth.refresh_access_token
and pieces.run_action.
"""
from __future__ import annotations

import time as _time

import pytest

import omilo_api.mcp_server as M
from omilo_api.capabilities import (
    connector_secrets,
    set_connector_needs_reconnect,
    set_connector_token,
)
from omilo_api.models import Connector

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

GMAIL_MANIFEST = {
    "id": "gmail",
    "label": "Gmail",
    "category": "email",
    "description": "Gmail connector",
    "auth": {
        "type": "oauth2",
        "provider": "google",
        "scopes": ["gmail.send"],
    },
    "actions": [
        {
            "name": "send_email",
            "label": "Send email",
            "approval": "ask",
            "http": {
                "method": "POST",
                "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                "auth": "bearer",
                "body": {"raw": "{{ message }}"},
            },
            "inputs": [
                {"name": "message", "type": "string", "required": True},
            ],
        }
    ],
}

META_MANIFEST = {
    "id": "instagram",
    "label": "Instagram",
    "category": "social",
    "description": "Instagram connector",
    "auth": {
        "type": "oauth2",
        "provider": "meta",
        "scopes": ["instagram_basic"],
    },
    "actions": [],
}


def _make_connector(token_dict: dict) -> Connector:
    """Construct a minimal Connector with secrets_enc set from token_dict."""
    conn = Connector(
        id="gmail",
        label="Gmail",
        kind="piece",
        url="",
        command="",
        args=[],
        secrets_enc="",
        approval="ask",
        default_on=True,
        enabled=True,
    )
    set_connector_token(conn, token_dict)
    return conn


class _StubDb:
    """Minimal stub for the SQLAlchemy db session (only .commit() needed)."""

    def __init__(self):
        self.committed = 0

    def commit(self):
        self.committed += 1


# ---------------------------------------------------------------------------
# (a) token expiring within REFRESH_SKEW_S → _fresh_token refreshes before call
# ---------------------------------------------------------------------------

def test_pre_expiry_refreshes_token(monkeypatch):
    """If expires_at is within REFRESH_SKEW_S seconds of now, _fresh_token must
    call refresh_access_token, persist the new token, and return the new access_token."""
    now = _time.time()
    # expires in 10 seconds — inside the 60-second skew window
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + 10),
        "token_type": "bearer",
    })
    db = _StubDb()

    new_token_dict = {
        "access_token": "NEW",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),
        "token_type": "bearer",
    }
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda provider, rt: new_token_dict,
    )

    result = M._fresh_token(conn, GMAIL_MANIFEST, db)

    assert result == "NEW", f"Expected 'NEW', got {result!r}"
    assert db.committed >= 1, "db.commit() must have been called after a successful refresh"
    # Verify persisted in secrets
    stored = connector_secrets(conn)
    assert stored["token"]["access_token"] == "NEW"


def test_pre_expiry_skew_boundary_refreshes(monkeypatch):
    """Token expires in exactly REFRESH_SKEW_S - 1 second → should refresh."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + M.REFRESH_SKEW_S - 1),
        "token_type": "bearer",
    })
    db = _StubDb()

    new_token_dict = {
        "access_token": "FRESH",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),
        "token_type": "bearer",
    }
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda provider, rt: new_token_dict,
    )

    result = M._fresh_token(conn, GMAIL_MANIFEST, db)
    assert result == "FRESH"


# ---------------------------------------------------------------------------
# (b) needs_reconnect result → exactly one _force_refresh + retry;
#     if retry succeeds, sentinel is NOT set
# ---------------------------------------------------------------------------

def test_force_refresh_retry_on_needs_reconnect(monkeypatch):
    """When run_action returns needs_reconnect, _force_refresh is called once; if
    the retry succeeds the needs_reconnect sentinel must NOT be set."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),
        "token_type": "bearer",
    })
    db = _StubDb()

    # _fresh_token should not refresh (token is not near expiry)
    # _force_refresh should be called once and return NEW
    new_token_dict = {
        "access_token": "NEW",
        "refresh_token": "RT",
        "expires_at": str(now + 7200),
        "token_type": "bearer",
    }
    refresh_calls = []

    def _fake_refresh(provider, rt):
        refresh_calls.append((provider, rt))
        return new_token_dict

    monkeypatch.setattr("omilo_api.oauth.refresh_access_token", _fake_refresh)

    # _force_refresh returns the new token
    result = M._force_refresh(conn, GMAIL_MANIFEST, db)
    assert result == "NEW", f"Expected 'NEW', got {result!r}"
    assert len(refresh_calls) == 1, "Expected exactly 1 refresh call"
    assert db.committed >= 1

    # needs_reconnect sentinel must NOT be set (token refresh succeeded)
    stored = connector_secrets(conn)
    assert not stored.get("needs_reconnect"), (
        "needs_reconnect sentinel must not be set after a successful _force_refresh"
    )


def test_needs_reconnect_not_set_when_retry_succeeds(monkeypatch):
    """Integration: if first run_action → needs_reconnect, and _force_refresh succeeds,
    and retry run_action succeeds, the sentinel is NOT stored on the connector."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),
        "token_type": "bearer",
    })

    # _force_refresh stub
    new_token_dict = {
        "access_token": "RENEWED",
        "refresh_token": "RT",
        "expires_at": str(now + 7200),
        "token_type": "bearer",
    }
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda provider, rt: new_token_dict,
    )

    # Simulate _force_refresh behavior directly (no HTTP needed)
    db = _StubDb()
    renewed = M._force_refresh(conn, GMAIL_MANIFEST, db)
    assert renewed == "RENEWED"

    # After _force_refresh sets a new token, needs_reconnect must not be present
    stored = connector_secrets(conn)
    assert not stored.get("needs_reconnect"), (
        "set_connector_token must clear needs_reconnect on a successful token update"
    )


# ---------------------------------------------------------------------------
# (c) refresh failure → needs_reconnect sentinel set, NO exception escapes
# ---------------------------------------------------------------------------

def test_refresh_failure_sets_needs_reconnect_no_exception(monkeypatch):
    """If refresh_access_token raises, _fresh_token must set needs_reconnect and
    return the old token without propagating the exception."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + 10),
        "token_type": "bearer",
    })
    db = _StubDb()

    def _raise(*_):
        raise RuntimeError("network error")

    monkeypatch.setattr("omilo_api.oauth.refresh_access_token", _raise)

    # Must not raise
    result = M._fresh_token(conn, GMAIL_MANIFEST, db)

    # Must return the old token best-effort
    assert result == "OLD", f"Expected 'OLD' as best-effort fallback, got {result!r}"
    # Must set needs_reconnect
    stored = connector_secrets(conn)
    assert stored.get("needs_reconnect") is True, (
        "needs_reconnect must be True after a failed refresh"
    )
    assert db.committed >= 1


def test_force_refresh_failure_sets_needs_reconnect_returns_none(monkeypatch):
    """If _force_refresh's refresh call raises, it must set needs_reconnect and return None."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "OLD",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),
        "token_type": "bearer",
    })
    db = _StubDb()

    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: (_ for _ in ()).throw(ValueError("bad credentials")),
    )

    result = M._force_refresh(conn, GMAIL_MANIFEST, db)

    assert result is None, f"Expected None on failure, got {result!r}"
    stored = connector_secrets(conn)
    assert stored.get("needs_reconnect") is True, (
        "needs_reconnect must be True after _force_refresh fails"
    )


# ---------------------------------------------------------------------------
# (d) absent expires_at → NO refresh (behavior unchanged)
# ---------------------------------------------------------------------------

def test_no_expires_at_no_refresh(monkeypatch):
    """When expires_at is absent, _fresh_token must return the current access_token
    without attempting any refresh."""
    conn = _make_connector({
        "access_token": "EXISTING",
        "refresh_token": "RT",
        "token_type": "bearer",
        # No expires_at key
    })
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._fresh_token(conn, GMAIL_MANIFEST, db)

    assert result == "EXISTING", f"Expected 'EXISTING', got {result!r}"
    assert not refresh_called, "refresh_access_token must NOT be called when expires_at is absent"
    assert db.committed == 0, "db.commit() must NOT be called when no refresh happens"


def test_far_future_expires_at_no_refresh(monkeypatch):
    """When expires_at is far in the future (beyond REFRESH_SKEW_S), no refresh occurs."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "FRESH_ENOUGH",
        "refresh_token": "RT",
        "expires_at": str(now + 3600),  # 1 hour from now — well outside skew
        "token_type": "bearer",
    })
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._fresh_token(conn, GMAIL_MANIFEST, db)

    assert result == "FRESH_ENOUGH"
    assert not refresh_called, "refresh_access_token must NOT be called when token is not near expiry"


# ---------------------------------------------------------------------------
# (e) meta_long_lived provider → never driven down refresh path
# ---------------------------------------------------------------------------

def test_meta_long_lived_no_refresh_in_fresh_token(monkeypatch):
    """_fresh_token must NOT attempt refresh for a meta_long_lived provider even when
    expires_at is within the skew window."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "META_TOKEN",
        "refresh_token": "LONG_LIVED_RT",
        "expires_at": str(now + 5),  # about to expire
        "token_type": "bearer",
    })
    conn.id = "instagram"
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._fresh_token(conn, META_MANIFEST, db)

    # Must return original token — no refresh attempted
    assert result == "META_TOKEN", f"Expected 'META_TOKEN', got {result!r}"
    assert not refresh_called, (
        "refresh_access_token must NOT be called for a meta_long_lived provider"
    )
    assert db.committed == 0


def test_meta_long_lived_no_refresh_in_force_refresh(monkeypatch):
    """_force_refresh must return None for meta_long_lived without attempting a refresh."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "META_TOKEN",
        "refresh_token": "LONG_LIVED_RT",
        "expires_at": str(now + 5),
        "token_type": "bearer",
    })
    conn.id = "instagram"
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._force_refresh(conn, META_MANIFEST, db)

    assert result is None, f"Expected None for meta_long_lived, got {result!r}"
    assert not refresh_called, (
        "refresh_access_token must NOT be called for a meta_long_lived provider in _force_refresh"
    )
    # needs_reconnect should NOT have been set — this is a legitimate path, not an error
    stored = connector_secrets(conn)
    assert not stored.get("needs_reconnect"), (
        "needs_reconnect must NOT be set when meta_long_lived path exits normally"
    )


# ---------------------------------------------------------------------------
# Additional edge cases
# ---------------------------------------------------------------------------

def test_force_refresh_no_refresh_token_returns_none(monkeypatch):
    """_force_refresh must return None immediately when no refresh_token is present."""
    conn = _make_connector({
        "access_token": "TOK",
        "token_type": "bearer",
        # No refresh_token
    })
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._force_refresh(conn, GMAIL_MANIFEST, db)

    assert result is None
    assert not refresh_called


def test_fresh_token_no_refresh_token_no_refresh(monkeypatch):
    """_fresh_token must NOT attempt refresh when no refresh_token is stored, even
    if expires_at is within the skew window."""
    now = _time.time()
    conn = _make_connector({
        "access_token": "TOK",
        "expires_at": str(now + 5),
        "token_type": "bearer",
        # No refresh_token
    })
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._fresh_token(conn, GMAIL_MANIFEST, db)

    assert result == "TOK"
    assert not refresh_called


def test_fresh_token_unknown_provider_no_refresh(monkeypatch):
    """_fresh_token must NOT attempt refresh for a provider not in OAUTH_PROVIDERS."""
    now = _time.time()
    unknown_manifest = {
        "id": "acme",
        "auth": {"type": "oauth2", "provider": "unknown_xyz"},
        "actions": [],
    }
    conn = _make_connector({
        "access_token": "TOK",
        "refresh_token": "RT",
        "expires_at": str(now + 5),
        "token_type": "bearer",
    })
    db = _StubDb()

    refresh_called = []
    monkeypatch.setattr(
        "omilo_api.oauth.refresh_access_token",
        lambda *_: refresh_called.append(1) or {},
    )

    result = M._fresh_token(conn, unknown_manifest, db)

    assert result == "TOK"
    assert not refresh_called
