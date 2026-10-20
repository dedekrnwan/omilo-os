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
def seeded_repliz_catalog(tmp_path):
    """Seed a repliz piece into the catalog so P.catalog() returns it."""
    import omilo_api.pieces as pieces
    from omilo_api.config import get_settings

    # Use a fully valid manifest (must pass validate_manifest) — same shape as GMAIL_MANIFEST
    manifest = {
        "id": "repliz",
        "label": "Repliz",
        "category": "development",
        "description": "Repliz remote MCP server",
        "auth": {
            "type": "oauth2",
            "provider": "repliz",
            "scopes": ["repliz.access"],
        },
        "actions": [
            {
                "name": "run-code",
                "label": "Run code",
                "approval": "auto",
                "http": {
                    "method": "POST",
                    "url": "https://api.repliz.com/run",
                    "auth": "bearer",
                },
                "inputs": [
                    {"name": "code", "type": "string", "required": True},
                ],
            }
        ],
    }

    source = tmp_path / "pieces-src"
    piece_dir = source / "pieces" / "repliz"
    piece_dir.mkdir(parents=True, exist_ok=True)
    (piece_dir / "piece.yaml").write_text(yaml.dump(manifest))

    os.environ["PIECES_SOURCE"] = str(source)
    get_settings.cache_clear()
    pieces.reindex()

    yield

    os.environ.pop("PIECES_SOURCE", None)
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
        """POST /connectors with kind='mcp' must return 400."""
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

    def test_post_connector_rejects_catalog_slug_id(self, owner, seeded_repliz_catalog):
        """POST /connectors whose id matches a catalog slug must return 400."""
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
