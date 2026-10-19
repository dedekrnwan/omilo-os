"""Task 4 — OAuth callback route tests.

Tests for GET /connectors/pieces/connect/callback?code=&state=

The server runs in the same process as the tests (session-scoped uvicorn in conftest),
so monkeypatching module-level functions is effective immediately.

Strategy for HttpBroker activation:
  monkeypatch the lru_cache'd Settings instance's oauth_clients attr directly
  (same pattern as test_broker_http.py) — this causes get_broker() to return
  HttpBroker without any cache_clear or env-var juggling.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

import omilo_api.pieces as pieces
from omilo_api.config import get_settings
from tests.test_pieces import GMAIL_MANIFEST

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_piece(source_dir: Path, slug: str, manifest: dict) -> None:
    piece_dir = source_dir / "pieces" / slug
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))


def _seed_catalog(tmp_path: Path) -> None:
    """Write a gmail piece into a PIECES_SOURCE dir and reindex the shared catalog."""
    source = tmp_path / "pieces-src"
    _write_piece(source, "gmail", GMAIL_MANIFEST)
    os.environ["PIECES_SOURCE"] = str(source)
    get_settings.cache_clear()
    pieces.reindex()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def seed(tmp_path):
    """Seed the gmail piece into the catalog."""
    _seed_catalog(tmp_path)
    yield
    os.environ.pop("PIECES_SOURCE", None)
    get_settings.cache_clear()


@pytest.fixture()
def http_broker(monkeypatch):
    """Make get_broker() return an HttpBroker by injecting google oauth_clients."""
    monkeypatch.setattr(
        get_settings(),
        "oauth_clients",
        {"google": {"client_id": "c", "client_secret": "s"}},
        raising=False,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestOAuthCallback:
    """Integration tests for the callback route; server is the session uvicorn."""

    @pytest.fixture(autouse=True)
    def _setup(self, seed, http_broker):
        """Seed the catalog and activate HttpBroker for every test in this class."""

    def test_callback_stashes_token_and_poll_returns_connected(self, owner, monkeypatch):
        """Full flow: start → callback (monkeypatched exchange) → poll → connected.

        Verifies:
          - callback returns 200 HTML
          - poll returns {"status": "connected"}
          - stored token carries "provider": "google"
        """

        fake_token = {
            "access_token": "AT",
            "refresh_token": "RT",
            "expires_at": None,
            "token_type": "bearer",
        }
        monkeypatch.setattr(
            "omilo_api.oauth.exchange_code",
            lambda provider, code, redirect_uri: dict(fake_token),
        )

        # Step 1: start the connect flow — must return a real HttpBroker state
        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "state" in data
        state = data["state"]

        # Step 2: simulate provider redirect to callback
        r2 = owner.get(
            "/api/connectors/pieces/connect/callback",
            params={"code": "AUTHCODE", "state": state},
        )
        assert r2.status_code == 200, r2.text
        # Must return HTML, not JSON
        assert "text/html" in r2.headers.get("content-type", "")
        assert "close this window" in r2.text.lower()

        # Step 3: open poll completes the upsert
        r3 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "connected", f"Unexpected: {r3.json()}"

        # Step 4: connector list shows gmail as connected
        connectors = owner.get("/api/connectors").json()
        gmail = next((c for c in connectors if c["id"] == "gmail"), None)
        assert gmail is not None, f"gmail not in connectors: {connectors}"
        assert gmail["enabled"] is True

    def test_callback_token_carries_provider(self, owner, monkeypatch):
        """The stashed token must include provider='google' so revoke() works later."""
        from omilo_api import broker as B

        fake_token = {
            "access_token": "AT2",
            "refresh_token": "RT2",
            "expires_at": None,
            "token_type": "bearer",
        }
        monkeypatch.setattr(
            "omilo_api.oauth.exchange_code",
            lambda provider, code, redirect_uri: dict(fake_token),
        )

        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        state = r.json()["state"]

        r2 = owner.get(
            "/api/connectors/pieces/connect/callback",
            params={"code": "CODE", "state": state},
        )
        assert r2.status_code == 200, r2.text

        # Read the stashed token directly from the broker before poll consumes the state
        broker = B.get_broker()
        token_result = broker.poll(state)
        assert token_result is not None, "Token not stashed in broker"
        assert token_result["token"].get("provider") == "google", (
            f"Expected provider='google' in stashed token, got: {token_result['token']}"
        )

        # Clean up: consume the state so subsequent tests don't see stale state
        broker.consume_state(state)

    def test_callback_unknown_state_returns_400(self, owner):
        """A bogus or expired state must return HTTP 400 with no connector side-effects.

        We verify no stash_token call is made by checking the broker has no token
        for the bogus state after the failed callback.
        """
        from omilo_api import broker as B

        r = owner.get(
            "/api/connectors/pieces/connect/callback",
            params={"code": "X", "state": "bogus-state-xyz"},
        )
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

        # The broker must not have a token stashed for that unknown state
        broker = B.get_broker()
        assert broker.poll("bogus-state-xyz") is None, (
            "stash_token must NOT be called on an unknown state"
        )

    def test_callback_literal_not_captured_by_state_route(self, owner):
        """'callback' must not be swallowed by the {state} wildcard route.

        The path /connectors/pieces/connect/callback is hit without a ?state= query
        param so that both routes would receive a different value:
          - Callback route: state="" → slug_for_state("") → None → 400
          - {state} route: state="callback" (path segment) → slug_for_state("callback")
            → None → 200 {"status": "expired"}

        We assert the response is 400, confirming the literal callback route matched
        first and NOT the {state} wildcard route.
        """
        # Hit /connectors/pieces/connect/callback with no query params at all.
        # The callback route will receive state="" → unknown → 400.
        # The {state} route would receive state="callback" (path) → return 200/expired.
        r = owner.get("/api/connectors/pieces/connect/callback")
        assert r.status_code == 400, (
            f"Expected 400 from the literal callback route but got {r.status_code}: {r.text}. "
            "Likely the {{state}} wildcard route matched 'callback' before the literal route — "
            "check FastAPI declaration order in api.py."
        )

    def test_callback_exchange_failure_returns_400_no_leak(self, owner, monkeypatch):
        """exchange_code failure → HTTP 400; response body must not contain the exception
        text or provider detail; nothing must be stashed in the broker.

        Covers the finding: unhandled exchange_code failure could produce a 500 that
        leaks traceback / provider error body to the browser.
        """
        from omilo_api import broker as B

        PROVIDER_ERROR = "invalid_grant: the authorization code has already been used"

        monkeypatch.setattr(
            "omilo_api.oauth.exchange_code",
            lambda provider, code, redirect_uri: (_ for _ in ()).throw(
                ValueError(PROVIDER_ERROR)
            ),
        )

        # Obtain a real, live state via start-connect so slug_for_state() resolves it
        r_start = owner.post("/api/connectors/pieces/gmail/connect")
        assert r_start.status_code == 200, r_start.text
        state = r_start.json()["state"]

        # Hit the callback — exchange_code will raise
        r = owner.get(
            "/api/connectors/pieces/connect/callback",
            params={"code": "EXPIRED_CODE", "state": state},
        )

        # (a) Must return 400, not 500
        assert r.status_code == 400, (
            f"Expected 400 on exchange failure, got {r.status_code}: {r.text}"
        )

        # (b) Response body must NOT contain any provider error detail or exception text
        body = r.text
        assert PROVIDER_ERROR not in body, (
            f"Provider error detail leaked into response body: {body!r}"
        )
        assert "Traceback" not in body, f"Traceback leaked into response body: {body!r}"
        assert "invalid_grant" not in body, (
            f"Provider error keyword leaked into response body: {body!r}"
        )

        # (c) Nothing must be stashed in the broker for this state
        broker = B.get_broker()
        assert broker.poll(state) is None, (
            "broker.poll(state) must be None after a failed exchange — nothing was stashed"
        )
