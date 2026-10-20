"""Task 3 — catalog() exposes type + /catalog route renders mcp cards with connect_fields.

Pure tests (no DB):
  test_catalog_includes_type_defaulting_piece — type-absent piece entry reports type=="piece"

Integration tests (DB-bound, use owner/seeded_repliz_catalog fixtures):
  test_catalog_route_renders_mcp_card_with_fields — mcp entry has actions==[], provider=="",
    connect_fields with access_key/secret_key names
  test_catalog_route_piece_card_unchanged — gmail (piece) card keeps actions/provider
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

import omilo_api.pieces as P
from omilo_api.config import get_settings
from tests.test_pieces import GMAIL_MANIFEST


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_piece(source_dir: Path, slug: str, manifest: dict) -> None:
    piece_dir = source_dir / "pieces" / slug
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))


# ---------------------------------------------------------------------------
# Pure tests (no DB, no network)
# ---------------------------------------------------------------------------

def test_catalog_includes_type_defaulting_piece(tmp_path, monkeypatch):
    """A type-absent piece entry must report type == 'piece' in catalog()."""
    source = tmp_path / "src"
    _write_piece(source, "gmail", GMAIL_MANIFEST)  # GMAIL_MANIFEST has no 'type' key

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    P.reindex()

    assert all(e["type"] == "piece" for e in P.catalog() if e["slug"] == "gmail"), (
        "type-absent piece must default to 'piece'"
    )

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_repliz_catalog(tmp_path, monkeypatch):
    """Seed a type:mcp repliz entry into the catalog (function-scoped, same as test_connectors.py)."""
    import omilo_api.pieces as pieces_mod

    monkeypatch.setattr(pieces_mod, "MCP_HOSTS", pieces_mod.MCP_HOSTS | {"mcp.repliz.com"})

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
                "attach": {"X-Repliz-Access-Key": "{access_key}"},
            },
        },
    }

    source = tmp_path / "pieces-src"
    _write_piece(source, "repliz", manifest)

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    P.reindex()

    yield

    index = P.index_path()
    if index.exists():
        import json as _json
        data = _json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "repliz"]
        index.write_text(_json.dumps(data))

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Integration tests (require owner + seeded_repliz_catalog fixtures)
# ---------------------------------------------------------------------------

def test_catalog_route_renders_mcp_card_with_fields(owner, seeded_repliz_catalog):
    """GET /catalog for a type:mcp entry must return actions==[], provider=='', and connect_fields."""
    rows = owner.get("/api/catalog").json()
    repliz_cards = [c for c in rows if c["slug"] == "repliz"]
    assert repliz_cards, f"repliz must appear in /api/catalog, got slugs: {[c['slug'] for c in rows]}"

    card = repliz_cards[0]
    assert card["type"] == "mcp", f"Expected type='mcp', got: {card.get('type')!r}"
    assert card["actions"] == [], f"mcp card must have empty actions, got: {card.get('actions')}"
    assert card["provider"] == "", f"mcp card must have empty provider, got: {card.get('provider')!r}"

    assert "connect_fields" in card, f"mcp card must have connect_fields key: {card}"
    field_names = [f["name"] for f in card["connect_fields"]]
    assert field_names == ["access_key", "secret_key"], (
        f"Expected ['access_key', 'secret_key'], got: {field_names}"
    )

    # Sanity: field dicts carry name+label, no secret values
    for field in card["connect_fields"]:
        assert "name" in field and "label" in field, f"field must have name+label: {field}"
        assert "value" not in field, f"connect_fields must never carry a credential value: {field}"


def test_catalog_route_piece_card_unchanged(owner, seeded_gmail_catalog):
    """GET /catalog for a type:piece entry keeps today's actions/provider derivation."""
    rows = owner.get("/api/catalog").json()
    gmail_cards = [c for c in rows if c["slug"] == "gmail"]
    assert gmail_cards, f"gmail must appear in /api/catalog, got: {[c['slug'] for c in rows]}"

    card = gmail_cards[0]
    assert card.get("type") == "piece", f"Expected type='piece', got: {card.get('type')!r}"
    # actions list is derived from manifest; gmail has one action
    assert isinstance(card["actions"], list) and len(card["actions"]) >= 1, (
        f"gmail card must have at least one action: {card.get('actions')}"
    )
    assert card["provider"] == "google", f"gmail provider must be 'google', got: {card.get('provider')!r}"
    # connect_fields should be absent or empty for piece cards
    assert card.get("connect_fields", []) == [], (
        f"piece card must not carry connect_fields: {card.get('connect_fields')}"
    )


# ---------------------------------------------------------------------------
# Fixture: seed a gmail piece into the catalog (function-scoped)
# ---------------------------------------------------------------------------

@pytest.fixture()
def seeded_gmail_catalog(tmp_path, monkeypatch):
    """Seed gmail into the catalog so GET /catalog returns it."""
    source = tmp_path / "pieces-src"
    _write_piece(source, "gmail", GMAIL_MANIFEST)

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    P.reindex()

    yield

    index = P.index_path()
    if index.exists():
        import json as _json
        data = _json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "gmail"]
        index.write_text(_json.dumps(data))

    get_settings.cache_clear()
