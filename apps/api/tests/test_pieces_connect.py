"""Task 5 — BrokerClient connect/disconnect flow.

TDD: tests written first (failing), then implementation added.

Catalog seeding strategy:
  The API server shares the same process as the tests (session-scoped uvicorn in conftest).
  OMILO_DATA_DIR is set before the server starts; pieces.reindex() writes into that same dir.
  We point PIECES_SOURCE at a temp dir written here, call pieces.reindex() in-process, and
  the server thread reads the resulting index.json from the shared OMILO_DATA_DIR.

  get_settings() is lru_cache'd, so we call get_settings.cache_clear() when we need
  settings to re-read the (already-set) env vars. PIECES_SOURCE is set on os.environ
  directly (the server and test share the same process/env).
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

# GMAIL_MANIFEST shape from the existing test module — avoid duplication
from tests.test_pieces import GMAIL_MANIFEST

import omilo_api.pieces as pieces
from omilo_api.config import get_settings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_piece(source_dir: Path, slug: str, manifest: dict) -> None:
    """Write pieces/<slug>/piece.yaml under source_dir."""
    piece_dir = source_dir / "pieces" / slug
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))


def _seed_catalog(tmp_path: Path) -> None:
    """Write a gmail piece into a PIECES_SOURCE dir and reindex the shared catalog."""
    source = tmp_path / "pieces-src"
    _write_piece(source, "gmail", GMAIL_MANIFEST)
    # Point the module at this source and rebuild the index
    os.environ["PIECES_SOURCE"] = str(source)
    # data_dir is already OMILO_DATA_DIR (set in conftest before server start)
    get_settings.cache_clear()
    pieces.reindex()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPiecesConnect:
    """Connect / disconnect flow for piece connectors (BrokerClient + DevBroker)."""

    @pytest.fixture(autouse=True)
    def seed(self, tmp_path):
        """Seed the gmail piece into the catalog before each test in this class."""
        _seed_catalog(tmp_path)
        yield
        # Clean up env so we don't pollute other test modules
        os.environ.pop("PIECES_SOURCE", None)
        get_settings.cache_clear()

    def test_connect_creates_piece_connector(self, owner):
        """POST /connect returns state; GET /connect/<state> returns connected; connector appears in list."""
        # Step 1: start connect
        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "auth_url" in data, f"Expected auth_url in response: {data}"
        assert "state" in data, f"Expected state in response: {data}"
        state = data["state"]
        assert state  # non-empty

        # Step 2: poll — DevBroker resolves immediately
        r2 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r2.status_code == 200, r2.text
        assert r2.json()["status"] == "connected", f"Expected connected, got: {r2.json()}"

        # Step 3: connector appears in list with kind==piece, enabled, and correct approval
        connectors = owner.get("/api/connectors").json()
        gmail = next((c for c in connectors if c["id"] == "gmail"), None)
        assert gmail is not None, f"gmail not in connectors: {connectors}"
        assert gmail["kind"] == "piece", f"Expected kind=piece, got: {gmail['kind']}"
        assert gmail["enabled"] is True, f"Expected enabled=True, got: {gmail['enabled']}"
        # Gmail manifest has an action with approval='ask' → most-restrictive wins
        assert gmail["approval"] == "ask", f"Expected approval=ask, got: {gmail['approval']}"

        # Step 4: public view must NOT contain the raw token
        assert "token" not in gmail, f"Raw token must not appear in public view: {gmail}"
        # The token is stored encrypted server-side; verify via secrets retrieval
        # We can't call connector_secrets from here directly (no DB session), but we can
        # confirm the public dict has no plaintext token field.
        assert "access_token" not in gmail, f"access_token must not appear in public view: {gmail}"

    def test_disconnect_removes_connector(self, owner):
        """After connect, DELETE /api/connectors/gmail removes the connector."""
        # Connect first
        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        state = r.json()["state"]
        r2 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r2.json()["status"] == "connected"

        # Disconnect
        r3 = owner.delete("/api/connectors/gmail")
        assert r3.status_code == 200, r3.text

        # Confirm gone
        connectors = owner.get("/api/connectors").json()
        ids = [c["id"] for c in connectors]
        assert "gmail" not in ids, f"gmail should be gone after disconnect: {ids}"

    def test_connect_unknown_slug_404(self, owner):
        """Connecting a slug not in the catalog returns 404."""
        r = owner.post("/api/connectors/pieces/no-such-piece/connect")
        assert r.status_code == 404, f"Expected 404 for unknown slug, got {r.status_code}: {r.text}"

    def test_poll_fabricated_state_returns_expired(self, owner):
        """Polling a fabricated or already-consumed state returns status=expired (not pending)."""
        r = owner.get("/api/connectors/pieces/connect/not-a-real-state-xyz123")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "expired", (
            f"Expected status=expired for unknown state, got: {body}"
        )

    def test_poll_consumed_state_returns_expired(self, owner):
        """After a successful connect, polling the same state again returns status=expired."""
        # Connect (state is consumed on success)
        r = owner.post("/api/connectors/pieces/gmail/connect")
        assert r.status_code == 200, r.text
        state = r.json()["state"]

        # First poll — completes the connect, consumes the state
        r2 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r2.json()["status"] == "connected"

        # Second poll on the same state — state is consumed, must signal expired
        r3 = owner.get(f"/api/connectors/pieces/connect/{state}")
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "expired", (
            f"Expected status=expired after state consumed, got: {r3.json()}"
        )
