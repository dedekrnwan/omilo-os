"""Task 4 — broker-less apikey connect route + catalog connect_fields.

POST /connectors/apikey/{slug}/connect accepts a JSON body of {field_name: value, ...},
validates the entry is type=='piece' with auth.type=='apikey', checks each declared
field is present and non-empty, upserts a kind='piece' Connector row, and stores the
collected fields encrypted under secrets["fields"].

Tests:
  test_apikey_connect_stores_fields       — 200 + card connected + connect_fields on card
  test_apikey_connect_missing_field_rejected  — 400 + no connector row created
  test_apikey_connect_does_not_leak_value — no field values exposed via connector_public
                                            or catalog card

Seeding strategy: same pattern as test_mcp_connect.seeded_repliz_catalog — writes a
minimal type:piece + auth.type:apikey piece.yaml (slug=acme, provider=stripe, one field
api_key), calls pieces.reindex().  get_settings is lru_cache'd so we call cache_clear()
on every env change.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

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


# Minimal valid apikey piece manifest — mirrors the _APIKEY_MANIFEST from test_pieces.py
# but used here as the integration fixture. provider="stripe" is required for SSRF
# allowlist (Task 1/Task 3 ruling). http.auth omitted on the ping action (allowed for
# apikey by Task 1 validate_manifest change).
_ACME_MANIFEST = {
    "id": "acme",
    "label": "Acme",
    "category": "ops",
    "description": "Acme REST API.",
    "auth": {
        "type": "apikey",
        "scheme": "header",
        "provider": "stripe",
        "fields": [
            {"name": "api_key", "label": "API Key", "secret": True},
        ],
        "attach": {"X-Api-Key": "{{ api_key }}"},
    },
    "actions": [
        {
            "name": "ping",
            "label": "Ping",
            "approval": "auto",
            "http": {
                "method": "GET",
                "url": "https://api.stripe.com/ping",
                # no http.auth needed for apikey actions (Task 1 ruling)
            },
        }
    ],
}


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_apikey_piece(tmp_path, monkeypatch):
    """Seed an apikey piece (slug=acme) into the catalog.

    Writes a valid type:piece + auth.type:apikey manifest, sets PIECES_SOURCE,
    and calls reindex() so P.catalog() returns it.

    Tears down the index entry and any connector row after the test so state
    does not bleed into subsequent tests.
    """
    source = tmp_path / "pieces-src"
    _write_piece(source, "acme", _ACME_MANIFEST)

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    pieces.reindex()

    yield

    # Clean up the connector row (if created by the test)
    from omilo_api.db import session_scope
    from omilo_api.models import Connector as _Connector

    with session_scope() as db:
        c = db.get(_Connector, "acme")
        if c:
            db.delete(c)
            db.commit()

    # Remove the seeded index entry so later tests don't see it
    index = pieces.index_path()
    if index.exists():
        data = json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "acme"]
        index.write_text(json.dumps(data))

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_apikey_connect_stores_fields(owner, seeded_apikey_piece):
    """POST /connectors/apikey/acme/connect with all fields → 200 + card connected.

    Also verifies:
    - connect_fields appears on the card with the correct field name.
    - The card shows connected=True after a successful connect.
    """
    r = owner.post("/api/connectors/apikey/acme/connect", json={"api_key": "K"})
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json()["status"] == "connected"

    # The catalog card must show connected=True and include connect_fields
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "acme"), None)
    assert card is not None, f"acme card not found in catalog: {[c['slug'] for c in catalog]}"
    assert card["connected"] is True, f"Expected connected=True, got: {card['connected']}"

    assert "connect_fields" in card, f"connect_fields missing from apikey card: {card}"
    field_names = [f["name"] for f in card["connect_fields"]]
    assert field_names == ["api_key"], (
        f"Expected ['api_key'], got: {field_names}"
    )

    # Verify field dicts carry name + label, never a value
    for field in card["connect_fields"]:
        assert "name" in field and "label" in field, f"field must have name+label: {field}"
        assert "value" not in field, f"connect_fields must never carry a credential value: {field}"

    # Verify secrets["fields"] is stored encrypted server-side
    from omilo_api import capabilities as C
    from omilo_api.db import session_scope
    from omilo_api.models import Connector as _Connector

    with session_scope() as db:
        c = db.get(_Connector, "acme")
        assert c is not None, "acme Connector row must exist after connect"
        assert c.kind == "piece", f"Expected kind=piece, got: {c.kind}"
        assert c.enabled is True
        secrets = C.connector_secrets(c)

    stored_fields = secrets.get("fields", {})
    assert stored_fields.get("api_key") == "K", (
        f"Expected api_key='K' in secrets['fields'], got: {stored_fields}"
    )


def test_apikey_connect_missing_field_rejected(owner, seeded_apikey_piece):
    """POST with an empty body → 400 and no connector row created."""
    r = owner.post("/api/connectors/apikey/acme/connect", json={})
    assert r.status_code == 400, f"Expected 400 for missing field, got {r.status_code}: {r.text}"
    assert "api_key" in r.text or "missing required field" in r.text.lower(), (
        f"Expected error message mentioning field name, got: {r.text}"
    )

    # No connector row must have been created — card stays not connected
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "acme"), None)
    assert card is not None, "acme card not found in catalog"
    assert card["connected"] is False, (
        f"Expected connected=False after rejected connect, got: {card['connected']}"
    )


def test_apikey_connect_does_not_leak_value(owner, seeded_apikey_piece):
    """After connecting, the field value must not appear in any public response.

    Checks:
    - GET /connectors returns acme (kind=piece is visible)
    - The raw value "K" does not appear anywhere in the connector's public repr
    - The catalog card does not carry the value either
    """
    owner.post("/api/connectors/apikey/acme/connect", json={"api_key": "K"})

    # piece connectors ARE visible in GET /connectors (kind=piece, not filtered out)
    connectors = owner.get("/api/connectors").json()
    pub = next((c for c in connectors if c["id"] == "acme"), None)
    assert pub is not None, (
        f"acme must appear in GET /connectors after apikey connect; ids: "
        f"{[c['id'] for c in connectors]}"
    )

    # The raw value "K" must not appear anywhere in the public connector repr
    assert "K" not in json.dumps(pub), (
        f"Field value 'K' must not leak through connector_public: {pub}"
    )

    # connector_public must not expose the raw fields dict
    assert "fields" not in pub or pub.get("fields") is None or pub.get("fields") == {}, (
        f"connector_public must not expose the fields dict: {pub.get('fields')}"
    )

    # Catalog card must also not carry the value
    catalog = owner.get("/api/catalog").json()
    card = next((c for c in catalog if c["slug"] == "acme"), None)
    assert card is not None
    assert "K" not in json.dumps(card), (
        f"Field value 'K' must not appear in catalog card: {card}"
    )
