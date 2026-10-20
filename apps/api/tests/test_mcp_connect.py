"""Task 4 — broker-less mcp connect route.

POST /connectors/mcp/{slug}/connect accepts a JSON body of {field_name: value, ...},
validates the entry is type=='mcp', checks each declared field is present, renders
auth headers, and upserts a locked kind='mcp' Connector row.

Tests:
  test_mcp_connect_creates_locked_connector — 200 + card connected + hidden from generic list
                                              + BOTH rendered headers present in stored connector
  test_mcp_connect_missing_field_rejected   — 400 + no connector row created
  test_mcp_connect_does_not_leak_keys       — no header values exposed via connector_public;
                                              DELETE works and cleans up the row
  test_mcp_connect_rejects_non_mcp_slug     — 404 for a type:piece slug
  test_mcp_connect_rejects_disallowed_host  — 400 when MCP_HOSTS excludes the entry's host

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

    The attach block templates BOTH declared fields (access_key and secret_key) so
    test_mcp_connect_creates_locked_connector can prove the render path fires for each.
    """
    # Monkeypatch MCP_HOSTS so the mcp.url host passes the allowlist check
    monkeypatch.setattr(pieces, "MCP_HOSTS", pieces.MCP_HOSTS | {"mcp.repliz.com"})

    # Valid type:mcp manifest (must pass validate_manifest's mcp-branch checks).
    # Templates use {{ }} so _render_str substitutes field values into headers.
    # Both declared fields (access_key, secret_key) are rendered into attach headers.
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
                "attach": {
                    "X-Repliz-Access-Key": "{{ access_key }}",
                    "X-Repliz-Secret-Key": "{{ secret_key }}",
                },
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
    """POST /connectors/mcp/repliz/connect with all required fields → 200 + connected.

    Also verifies that BOTH rendered headers (X-Repliz-Access-Key and X-Repliz-Secret-Key)
    are stored in the connector, proving the render path fires for every attach entry.
    """
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

    # Both rendered headers must be stored — connector_runtime exposes headers with their
    # values (used by plan()); connector_public exposes only header_names (no values).
    # Read the connector row directly via capabilities to prove both rendered values arrived.
    from omilo_api.db import session_scope
    from omilo_api.models import Connector as _Connector
    from omilo_api import capabilities as C

    with session_scope() as db:
        c = db.get(_Connector, "repliz")
        assert c is not None, "repliz Connector row must exist after connect"
        runtime = C.connector_runtime(c)

    stored_headers = runtime["headers"]
    assert "X-Repliz-Access-Key" in stored_headers, (
        f"X-Repliz-Access-Key missing from stored headers: {stored_headers}"
    )
    assert stored_headers["X-Repliz-Access-Key"] == "AK", (
        f"X-Repliz-Access-Key value mismatch: {stored_headers['X-Repliz-Access-Key']!r}"
    )
    assert "X-Repliz-Secret-Key" in stored_headers, (
        f"X-Repliz-Secret-Key missing from stored headers: {stored_headers}"
    )
    assert stored_headers["X-Repliz-Secret-Key"] == "SK", (
        f"X-Repliz-Secret-Key value mismatch: {stored_headers['X-Repliz-Secret-Key']!r}"
    )


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


# ---------------------------------------------------------------------------
# M-3 rejection-branch tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_gmail_piece(tmp_path, monkeypatch):
    """Seed a type:piece (gmail) entry so the route can 404 on it.

    Uses the canonical GMAIL_MANIFEST from test_pieces.  Tears down the index
    entry after the test so the seeded gmail piece doesn't leak.
    """
    from tests.test_pieces import GMAIL_MANIFEST

    source = tmp_path / "pieces-src-gmail"
    piece_dir = source / "pieces" / "gmail"
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(GMAIL_MANIFEST))

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    pieces.reindex()

    yield

    index = pieces.index_path()
    if index.exists():
        import json as _json
        data = _json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "gmail"]
        index.write_text(_json.dumps(data))

    get_settings.cache_clear()


def test_mcp_connect_rejects_non_mcp_slug(owner, seeded_gmail_piece):
    """POST to the mcp-connect route with a type:piece slug must return 404.

    The route must reject non-mcp entries regardless of whether the slug exists in
    the catalog; this guards against callers accidentally routing piece slugs here.
    """
    r = owner.post("/api/connectors/mcp/gmail/connect",
                   json={"access_key": "AK", "secret_key": "SK"})
    assert r.status_code == 404, (
        f"Expected 404 for a type:piece slug, got {r.status_code}: {r.text}"
    )


def test_mcp_connect_rejects_disallowed_host(owner, seeded_repliz_catalog, monkeypatch):
    """POST to the mcp-connect route must return 400 when the entry's host is not in MCP_HOSTS.

    Monkeypatches MCP_HOSTS to an empty set right before the connect call so that
    the route's own re-check (defense-in-depth step 2) fires even though the entry
    was indexed while the host was still allowed.  No Connector row must be created.
    """
    # Remove mcp.repliz.com from the live MCP_HOSTS so the route's re-check fails
    monkeypatch.setattr(pieces, "MCP_HOSTS", set())

    r = owner.post("/api/connectors/mcp/repliz/connect",
                   json={"access_key": "AK", "secret_key": "SK"})
    assert r.status_code == 400, (
        f"Expected 400 for disallowed host, got {r.status_code}: {r.text}"
    )

    # No connector row must have been created
    from omilo_api.db import session_scope
    from omilo_api.models import Connector as _Connector

    with session_scope() as db:
        c = db.get(_Connector, "repliz")
        assert c is None, "No Connector row must be created when the host is disallowed"
