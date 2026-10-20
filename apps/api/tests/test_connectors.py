"""Task 2 — kind:mcp runtime mount in plan() + generic-CRUD locking.

Pure tests (no DB):
  test_plan_mounts_mcp_connector_as_remote_server — mcp connector → type=http server entry

Integration tests (DB-bound, use owner/base_url fixtures from conftest):
  test_generic_list_hides_mcp              — GET /connectors excludes kind=mcp rows
  test_post_connector_rejects_mcp_kind     — POST /connectors with kind=mcp → 400
  test_post_connector_rejects_catalog_slug_id — POST /connectors with a catalog slug as id → 400
  test_put_connector_rejects_mcp           — PUT /connectors/{id} on a kind=mcp row → 400

Seeding strategy:
  - mcp_connector_in_db: inserts a Connector(id="repliz", kind="mcp") row directly into the DB via
    session_scope, and removes it afterwards.
  - seeded_repliz_catalog: writes a minimal repliz piece.yaml into a tmp dir, calls pieces.reindex(),
    so P.catalog() returns [{slug:"repliz", ...}]. Tears down env/cache afterwards.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml

from omilo_api.capabilities import Resources
from omilo_api.engines.claude_code import plan


# ---------------------------------------------------------------------------
# Pure plan() tests (no DB, no network)
# ---------------------------------------------------------------------------

def _resources_with_mcp(url: str, headers: dict) -> Resources:
    """Build a Resources instance with one kind='mcp' connector."""
    return Resources(connectors=[
        {
            "id": "repliz",
            "label": "Repliz",
            "kind": "mcp",
            "url": url,
            "headers": headers,
            "command": "",
            "args": [],
            "env": {},
            "approval": "auto",
        }
    ])


CFG = {"_mcp_url": "http://x/mcp", "_mcp_token": "T"}


def test_plan_mounts_mcp_connector_as_remote_server():
    """A kind='mcp' connector must produce a type='http' server entry with url+headers."""
    servers, tools, _ = plan(CFG, _resources_with_mcp(
        url="https://mcp.repliz.com/mcp",
        headers={"X-Repliz-Access-Key": "a"},
    ))
    assert servers["repliz"] == {
        "type": "http",
        "url": "https://mcp.repliz.com/mcp",
        "headers": {"X-Repliz-Access-Key": "a"},
    }


def test_plan_mcp_connector_auto_tool_allowed():
    """An auto-approval mcp connector's tools must be in the allowed list."""
    _, tools, _ = plan(CFG, _resources_with_mcp(
        url="https://mcp.repliz.com/mcp",
        headers={},
    ))
    assert "mcp__repliz" in tools


def test_plan_mcp_connector_ask_tool_not_allowed():
    """An ask-approval mcp connector's tools must NOT be in the allowed list."""
    res = Resources(connectors=[{
        "id": "repliz",
        "label": "Repliz",
        "kind": "mcp",
        "url": "https://mcp.repliz.com/mcp",
        "headers": {},
        "command": "",
        "args": [],
        "env": {},
        "approval": "ask",
    }])
    _, tools, _ = plan(CFG, res)
    assert "mcp__repliz" not in tools


# ---------------------------------------------------------------------------
# Fixtures for integration tests
# ---------------------------------------------------------------------------

@pytest.fixture()
def mcp_connector_in_db():
    """Insert a kind='mcp' Connector row and clean up after."""
    from omilo_api.db import session_scope
    from omilo_api.models import Connector

    with session_scope() as db:
        # ensure no leftover row from a previous run
        existing = db.get(Connector, "repliz")
        if existing:
            db.delete(existing)
            db.commit()

        c = Connector(
            id="repliz",
            label="Repliz MCP",
            kind="mcp",
            url="https://mcp.repliz.com/mcp",
            command="",
            args=[],
            approval="auto",
            default_on=False,
            enabled=True,
        )
        db.add(c)
        db.commit()

    yield

    with session_scope() as db:
        c = db.get(Connector, "repliz")
        if c:
            db.delete(c)
            db.commit()


@pytest.fixture()
def seeded_repliz_catalog(tmp_path, monkeypatch):
    """Seed a repliz MCP entry into the catalog so P.catalog() returns it.

    Uses a type:mcp manifest (the real threat shape) and adds mcp.repliz.com to
    MCP_HOSTS so validate_manifest passes and the entry indexes as status=ok.
    Tears down env/MCP_HOSTS state so the seeded catalog doesn't leak.
    """
    import omilo_api.pieces as pieces
    from omilo_api.config import get_settings

    # Monkeypatch MCP_HOSTS so the mcp.url host passes the allowlist check
    monkeypatch.setattr(pieces, "MCP_HOSTS", pieces.MCP_HOSTS | {"mcp.repliz.com"})

    # Valid type:mcp manifest (must pass validate_manifest's mcp-branch checks)
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
    piece_dir = source / "pieces" / "repliz"
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))

    monkeypatch.setenv("PIECES_SOURCE", str(source))
    get_settings.cache_clear()
    pieces.reindex()

    yield

    # Clear the seeded index so later tests don't see the repliz entry
    index = pieces.index_path()
    if index.exists():
        import json as _json
        data = _json.loads(index.read_text())
        data["pieces"] = [e for e in data.get("pieces", []) if e.get("slug") != "repliz"]
        index.write_text(_json.dumps(data))

    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Integration tests
# ---------------------------------------------------------------------------

class TestMcpConnectorCrud:
    """CRUD locking for kind='mcp' connectors."""

    def test_generic_list_hides_mcp(self, owner, mcp_connector_in_db):
        """GET /connectors must not return kind='mcp' rows."""
        ids = [c["id"] for c in owner.get("/api/connectors").json()]
        assert "repliz" not in ids, (
            f"kind=mcp connector 'repliz' must be hidden from GET /connectors, got: {ids}"
        )

    def test_post_connector_rejects_mcp_kind(self, owner):
        """POST /connectors with kind='mcp' must return 400 and must NOT insert a row."""
        r = owner.post("/api/connectors", json={
            "id": "x-mcp-test",
            "kind": "mcp",
            "url": "https://mcp.repliz.com/mcp",
        })
        assert r.status_code == 400, (
            f"Expected 400 for kind=mcp, got {r.status_code}: {r.text}"
        )
        assert "marketplace" in r.text.lower(), (
            f"Expected 'marketplace' in error body, got: {r.text}"
        )
        # Confirm no row was created: the id must be absent from the list
        ids = [c["id"] for c in owner.get("/api/connectors").json()]
        assert "x-mcp-test" not in ids, (
            f"kind=mcp POST must not create a DB row, but 'x-mcp-test' appeared in GET /connectors: {ids}"
        )

    def test_post_connector_rejects_catalog_slug_id(self, owner, seeded_repliz_catalog):
        """POST /connectors whose id matches a catalog slug must return 400 and must NOT insert a row."""
        r = owner.post("/api/connectors", json={
            "id": "repliz",
            "kind": "http",
            "url": "https://evil.example/mcp",
        })
        assert r.status_code == 400, (
            f"Expected 400 for reserved catalog slug id, got {r.status_code}: {r.text}"
        )
        assert "reserved" in r.text.lower() or "marketplace" in r.text.lower(), (
            f"Expected 'reserved' or 'marketplace' in error body, got: {r.text}"
        )
        # Confirm no http connector with the evil url was created
        ids = [c["id"] for c in owner.get("/api/connectors").json()]
        assert "repliz" not in ids, (
            f"Anti-squat POST must not create a DB row, but 'repliz' appeared in GET /connectors: {ids}"
        )

    def test_put_connector_rejects_mcp(self, owner, mcp_connector_in_db):
        """PUT /connectors/{id} on a kind='mcp' row must return 400."""
        r = owner.put("/api/connectors/repliz", json={
            "id": "repliz",
            "kind": "mcp",
            "url": "https://mcp.repliz.com/mcp",
        })
        assert r.status_code == 400, (
            f"Expected 400 for PUT on mcp connector, got {r.status_code}: {r.text}"
        )
        assert "marketplace" in r.text.lower(), (
            f"Expected 'marketplace' in error body, got: {r.text}"
        )
