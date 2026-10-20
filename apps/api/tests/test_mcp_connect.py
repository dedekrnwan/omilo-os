"""Task 4 — broker-less mcp connect route.

POST /connectors/mcp/{slug}/connect accepts a JSON body of {field_name: value, ...},
validates the entry is type=='mcp', checks each declared field is present, renders
auth headers, and upserts a locked kind='mcp' Connector row.

Tests:
  test_mcp_connect_creates_locked_connector — 200 + card connected + hidden from generic list
  test_mcp_connect_missing_field_rejected   — 400 + no connector row created
  test_mcp_connect_does_not_leak_keys       — no header values exposed via connector_public;
                                              DELETE works and cleans up the row

Seeding strategy: same pattern as test_connectors.seeded_repliz_catalog — writes a minimal
type:mcp piece.yaml, monkeypatches MCP_HOSTS, calls pieces.reindex().  get_settings is
lru_cache'd so we call cache_clear() on every env change.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

import omilo_api.pieces as pieces
from omilo_api.config import get_settings


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_repliz_catalog(tmp_path, monkeypatch):
    """Seed a repliz MCP entry into the catalog so P.catalog() returns it.

    Uses a type:mcp manifest (the real threat shape) and adds mcp.repliz.com to
    MCP_HOSTS so validate_manifest passes and the entry indexes as status=ok.
    Tears down env/MCP_HOSTS state AND the connector row so the seeded catalog
    doesn't leak between tests.
    """
    # Monkeypatch MCP_HOSTS so the mcp.url host passes the allowlist check
    monkeypatch.setattr(pieces, "MCP_HOSTS", pieces.MCP_HOSTS | {"mcp.repliz.com"})

    # Valid type:mcp manifest (must pass validate_manifest's mcp-branch checks).
    # Templates use {{ }} so _render_str substitutes field values into headers.
    manifest = {
        "type": "mcp",
        "id": "repliz",
        "label": "Repliz",
        "category": "development",
        "description": "Repliz remote MCP server",
        "mcp": {
            "url": "https://mcp.repliz.com/mcp",
            "auth": {
                "scheme": "header",
                "fields": [
                    {"name": "access_key", "label": "Access Key"},
                    {"name": "secret_key", "label": "Secret Key"},
                ],
                "attach": {"X-Repliz-Access-Key": "{{ access_key }}"},
            },
        },
    }

    source = tmp_path / "pieces-src"
    piece_dir = source / "pieces" / "repliz"
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    pieces.reindex()

    yield

    # Clean up the connector row so tests that run after don't see a leftover connected state
    from omilo_api.db import session_scope
    from omilo_api.models import Connector as _Connector

    with session_scope() as db:
        c = db.get(_Connector, "repliz")
        if c:
            db.delete(c)
            db.commit()

    # Clear the seeded index so later tests don't see the repliz entry
    index = pieces.index_path()
    if index.exists():
        import json as _json
        data = _json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "repliz"]
        index.write_text(_json.dumps(data))

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_mcp_connect_creates_locked_connector(owner, seeded_repliz_catalog):
    """POST /connectors/mcp/repliz/connect with all required fields → 200 + connected."""
    r = owner.post("/api/connectors/mcp/repliz/connect",
                   json={"access_key": "AK", "secret_key": "SK"})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json()["status"] == "connected"

    # kind=mcp must be hidden from the generic connectors list
    connector_ids = [c["id"] for c in owner.get("/api/connectors").json()]
    assert "repliz" not in connector_ids, (
        f"kind=mcp connector 'repliz' must be hidden from GET /connectors, got: {connector_ids}"
    )

    # The catalog card must show connected=True
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "repliz"), None)
    assert card is not None, f"repliz card not found in catalog: {catalog}"
    assert card["connected"] is True, f"Expected connected=True, got: {card['connected']}"


def test_mcp_connect_missing_field_rejected(owner, seeded_repliz_catalog):
    """POST with a missing required field → 400 + no connector row created."""
    # Only provide access_key; secret_key is missing
    r = owner.post("/api/connectors/mcp/repliz/connect", json={"access_key": "AK"})
    assert r.status_code == 400, f"Expected 400 for missing field, got {r.status_code}: {r.text}"

    # No connector row must have been created — card stays not connected
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "repliz"), None)
    assert card is not None, f"repliz card not found in catalog: {catalog}"
    assert card["connected"] is False, (
        f"Expected connected=False after rejected connect, got: {card['connected']}"
    )


def test_mcp_connect_does_not_leak_keys(owner, seeded_repliz_catalog):
    """After connecting, connector_public must not expose header values; DELETE removes it."""
    owner.post("/api/connectors/mcp/repliz/connect",
               json={"access_key": "AK", "secret_key": "SK"})

    # The catalog card's connected flag should be True
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "repliz"), None)
    assert card is not None
    assert card["connected"] is True

    # Verify secrets are not exposed: check that raw key values don't leak through any
    # response (connector_public only returns header_names, not values)
    import json as _json
    card_text = _json.dumps(card)
    assert "AK" not in card_text, "Access key value must not be in catalog card"
    assert "SK" not in card_text, "Secret key value must not be in catalog card"

    # Disconnect works cleanly
    r = owner.delete("/api/connectors/repliz")
    assert r.status_code == 200, f"Expected 200 on DELETE, got {r.status_code}: {r.text}"

    # After delete the card shows not connected
    catalog_after = owner.get("/api/catalog").json()
    card_after = next((c for c in catalog_after if c["slug"] == "repliz"), None)
    assert card_after is not None
    assert card_after["connected"] is False, (
        f"Expected connected=False after delete, got: {card_after['connected']}"
    )
