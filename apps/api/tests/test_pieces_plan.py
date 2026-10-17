"""Task 4 — Piece MCP endpoint + plan() / capabilities wiring.

Pure tests (no DB):
  test_plan_adds_http_server_for_connected_piece  — piece connector → http server entry
  test_ask_piece_tools_not_allowed_until_approved — ask piece → tools stay denied

Endpoint test (DB-bound, uses monkeypatch to stub DB lookup):
  test_piece_mcp_endpoint_tools_list  — tools/list returns action_tools output
  test_piece_mcp_endpoint_tools_call  — tools/call routes through run_action
"""
from __future__ import annotations

import json

import pytest

from omilo_api.capabilities import Resources
from omilo_api.engines.claude_code import plan


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resources(connectors: list[dict]) -> Resources:
    """Build a Resources instance from a list of connector dicts."""
    return Resources(connectors=connectors)


def _piece_connector(
    id_: str = "gmail",
    label: str = "Gmail",
    approval: str = "auto",
) -> dict:
    """Minimal piece connector dict (matches connector_runtime output shape)."""
    return {
        "id": id_,
        "label": label,
        "kind": "piece",
        "url": "",          # url/headers populated by plan(), not carried in connector dict
        "headers": {},
        "command": "",
        "args": [],
        "env": {},
        "approval": approval,
    }


# ---------------------------------------------------------------------------
# Pure plan() tests (TDD primary — no DB, no network)
# ---------------------------------------------------------------------------

class TestPlanPieceConnector:
    """plan() handles kind='piece' connectors correctly."""

    def test_plan_adds_http_server_for_connected_piece(self):
        """A piece connector produces a type='http' server entry with /piece/{slug} URL."""
        res = _resources(connectors=[_piece_connector(id_="gmail", approval="auto")])
        servers, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)

        assert "gmail" in servers, f"Expected 'gmail' key in servers, got: {set(servers)}"
        entry = servers["gmail"]
        assert entry["type"] == "http", f"Expected type='http', got: {entry.get('type')!r}"
        assert entry["url"].endswith("/piece/gmail"), (
            f"Expected URL ending '/piece/gmail', got: {entry['url']!r}"
        )
        assert entry["headers"]["Authorization"] == "Bearer T", (
            f"Expected Authorization header with token, got: {entry['headers']}"
        )

    def test_ask_piece_tools_not_allowed_until_approved(self):
        """An 'ask' piece connector's tools must NOT be in the allowed list."""
        res = _resources(connectors=[_piece_connector(id_="gmail", approval="ask")])
        _, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)

        tool_str = " ".join(tools)
        assert "mcp__gmail" not in tool_str, (
            f"Expected 'mcp__gmail' to be absent (ask approval), but tools are: {tools}"
        )

    def test_auto_piece_tool_is_allowed(self):
        """An 'auto' piece connector's tools ARE in the allowed list."""
        res = _resources(connectors=[_piece_connector(id_="gmail", approval="auto")])
        _, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)

        assert "mcp__gmail" in tools, (
            f"Expected 'mcp__gmail' in tools for auto approval, got: {tools}"
        )

    def test_piece_server_url_uses_piece_mcp_url(self):
        """piece_mcp_url is derived from the config _mcp_url by appending /piece/{slug}."""
        res = _resources(connectors=[_piece_connector(id_="slack", approval="auto")])
        servers, _, _ = plan({"_mcp_url": "http://example.com/mcp", "_mcp_token": "tok"}, res)

        assert servers["slack"]["url"] == "http://example.com/mcp/piece/slack"

    def test_piece_and_http_connectors_coexist(self):
        """plan() handles both 'piece' and 'http' connectors in the same run."""
        res = _resources(connectors=[
            _piece_connector(id_="gmail", approval="auto"),
            {
                "id": "crm", "label": "CRM", "kind": "http",
                "url": "https://crm/mcp", "headers": {"X-Key": "abc"},
                "command": "", "args": [], "env": {}, "approval": "auto",
            },
        ])
        servers, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)

        assert "gmail" in servers and "crm" in servers
        assert servers["gmail"]["type"] == "http"
        assert servers["crm"]["url"] == "https://crm/mcp"
        assert "mcp__gmail" in tools and "mcp__crm" in tools

    def test_ask_piece_approved_via_allow_connectors(self):
        """An 'ask' piece approved for this execution task gets its tools allowed."""
        res = _resources(connectors=[_piece_connector(id_="gmail", approval="ask")])
        res.allow_connectors.add("gmail")
        _, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)

        assert "mcp__gmail" in tools, (
            f"Expected 'mcp__gmail' allowed after explicit approval, got: {tools}"
        )


# ---------------------------------------------------------------------------
# Endpoint tests (stub-based, no live DB)
# ---------------------------------------------------------------------------

FAKE_MANIFEST = {
    "id": "gmail",
    "label": "Gmail",
    "category": "email",
    "description": "Send and read Gmail",
    "auth": {"type": "oauth2", "provider": "google", "scopes": ["https://mail.google.com/"]},
    "actions": [
        {
            "name": "send-email",
            "label": "Send an email",
            "approval": "ask",
            "http": {
                "method": "POST",
                "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                "auth": "bearer",
            },
        }
    ],
}


class _FakeStaff:
    id = "support"
    name = "Support"
    status = "active"
    is_chief = False
    permissions = {}


class _FakeDB:
    """No-op DB that returns a fake Connector for 'gmail'."""
    def close(self): pass
    def scalars(self, *a, **kw): return []
    def get(self, model, id_=None):
        from omilo_api.models import Connector
        if model is Connector and id_ == "gmail":
            return _FakeConnector()
        return None
    def add(self, *a, **kw): pass
    def commit(self): pass
    def rollback(self): pass


class _FakeConnector:
    id = "gmail"
    enabled = True


@pytest.fixture()
def piece_app(monkeypatch):
    """Return a TestClient for the FastAPI app with pieces.get_piece and DB lookups stubbed."""
    # Stub pieces.get_piece
    from omilo_api import pieces as P
    monkeypatch.setattr(P, "get_piece", lambda slug: FAKE_MANIFEST if slug == "gmail" else None)

    # Patch staff_from_mcp_token in mcp_server's own namespace (where it was imported)
    import omilo_api.mcp_server as MS
    monkeypatch.setattr(MS, "staff_from_mcp_token",
                        lambda db, token: _FakeStaff() if token == "test-mcp-token" else None)

    # Patch get_db in mcp_server's own namespace
    monkeypatch.setattr(MS, "get_db", lambda: iter([_FakeDB()]))

    # Stub connector_secrets in capabilities to return the fake token
    from omilo_api import capabilities as CAP
    monkeypatch.setattr(CAP, "connector_secrets", lambda c: {"token": "oauth-access-token"})

    from fastapi.testclient import TestClient
    from omilo_api.main import app
    return TestClient(app), _FakeConnector()


def _rpc(method: str, params: dict | None = None, id_: int = 1) -> dict:
    return {"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}


class TestPieceMcpEndpoint:
    """POST /mcp/piece/{slug} JSON-RPC endpoint tests."""

    def test_tools_list_returns_action_tools(self, piece_app, monkeypatch):
        """tools/list returns the piece's action_tools output."""
        client, _ = piece_app

        r = client.post(
            "/mcp/piece/gmail",
            json=_rpc("tools/list"),
            headers={"Authorization": "Bearer test-mcp-token"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "result" in body, body
        tools = body["result"]["tools"]
        names = [t["name"] for t in tools]
        assert "send-email" in names, f"Expected 'send-email' in tools, got: {names}"

    def test_unknown_slug_returns_404_error(self, piece_app):
        """tools/list with unknown slug returns JSON-RPC error."""
        client, _ = piece_app

        r = client.post(
            "/mcp/piece/unknown-xyz",
            json=_rpc("tools/list"),
            headers={"Authorization": "Bearer test-mcp-token"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "error" in body, f"Expected error for unknown slug, got: {body}"
        assert body["error"]["code"] == -32602  # Invalid params / not found

    def test_missing_auth_returns_401(self, piece_app):
        """Missing Bearer token returns 401."""
        client, _ = piece_app

        r = client.post("/mcp/piece/gmail", json=_rpc("tools/list"))
        assert r.status_code == 401, r.text

    def test_invalid_token_returns_401(self, piece_app):
        """Invalid Bearer token returns 401."""
        client, _ = piece_app

        r = client.post(
            "/mcp/piece/gmail",
            json=_rpc("tools/list"),
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert r.status_code == 401, r.text

    def test_tools_call_routes_to_run_action(self, piece_app, monkeypatch):
        """tools/call invokes run_action with decrypted token and returns result."""
        client, _ = piece_app

        from omilo_api import pieces as P
        import omilo_api.mcp_server as MS

        captured = {}

        def _fake_run_action(manifest, action, args, token):
            captured["action"] = action
            captured["token"] = token
            return "Action 'send-email' completed with status 200.", {"status": 200, "needs_reconnect": False}

        monkeypatch.setattr(P, "run_action", _fake_run_action)

        r = client.post(
            "/mcp/piece/gmail",
            json=_rpc("tools/call", {"name": "send-email", "arguments": {}}),
            headers={"Authorization": "Bearer test-mcp-token"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "result" in body, body
        assert not body["result"]["isError"], body
        assert captured.get("action") == "send-email"
        assert captured.get("token") == "oauth-access-token"

    def test_tools_call_needs_reconnect_sets_sentinel_and_commits(self, piece_app, monkeypatch):
        """When run_action returns needs_reconnect=True, the sentinel is stored in secrets_enc
        AND db.commit() is called — not conn.enabled = False."""
        import omilo_api.mcp_server as MS
        from omilo_api import pieces as P
        from omilo_api import capabilities as CAP

        def _fake_run_action_reconnect(manifest, action, args, token):
            return "Action 'send-email' failed with 401; reconnect required.", {"status": 401, "needs_reconnect": True}

        monkeypatch.setattr(P, "run_action", _fake_run_action_reconnect)

        # Track the connector and whether commit() was called
        class _TrackingConn:
            id = "gmail"
            enabled = True
            secrets_enc = ""  # start empty so sentinel can be written

        tracking_conn = _TrackingConn()
        commits = []

        class _TrackingDB:
            def close(self): pass
            def scalars(self, *a, **kw): return []
            def get(self, model, id_=None):
                from omilo_api.models import Connector
                if model is Connector and id_ == "gmail":
                    return tracking_conn
                return None
            def add(self, *a, **kw): pass
            def commit(self): commits.append(True)
            def rollback(self): pass

        # Restore the real connector_secrets so that set_connector_needs_reconnect can read
        # and write secrets_enc correctly.  The piece_app fixture has already replaced
        # CAP.connector_secrets with a stub; we need the real decrypt implementation.
        # We get it by importing the underlying security primitives and rebuilding the logic.
        import omilo_api.capabilities as CAP
        from omilo_api.security import decrypt, encrypt

        def _real_connector_secrets(c):
            import json
            raw = decrypt(c.secrets_enc) if c.secrets_enc else None
            try:
                return json.loads(raw) if raw else {}
            except ValueError:
                return {}

        monkeypatch.setattr(CAP, "connector_secrets", _real_connector_secrets)
        monkeypatch.setattr(MS, "get_db", lambda: iter([_TrackingDB()]))

        client, _ = piece_app
        r = client.post(
            "/mcp/piece/gmail",
            json=_rpc("tools/call", {"name": "send-email", "arguments": {}}),
            headers={"Authorization": "Bearer test-mcp-token"},
        )
        assert r.status_code == 200, r.text
        body = r.json()

        # The response must indicate needs_reconnect / isError
        result = body.get("result", {})
        content_text = result.get("content", [{}])[0].get("text", "{}")
        payload = json.loads(content_text) if isinstance(content_text, str) else {}
        assert payload.get("needs_reconnect") is True or result.get("isError"), (
            f"Expected needs_reconnect in response, got: {body}"
        )

        # CRITICAL: enabled must remain True — sentinel lives in secrets_enc, not enabled flag
        assert tracking_conn.enabled is True, (
            "connector.enabled must NOT be set to False; use the needs_reconnect sentinel in secrets_enc"
        )

        # The needs_reconnect sentinel must be set in the connector's secrets (via the real decrypt)
        secrets = _real_connector_secrets(tracking_conn)
        assert secrets.get("needs_reconnect") is True, (
            f"Expected needs_reconnect=True in connector secrets, got: {secrets}"
        )

        # db.commit() must have been called (not just in-memory mutation)
        assert commits, "db.commit() was never called after setting the needs_reconnect sentinel"

    def test_tools_call_absent_connector_returns_rpc_error(self, piece_app, monkeypatch):
        """tools/call for a slug that IS in the catalog but has no Connector row in the DB
        must return a JSON-RPC error — not crash."""
        import omilo_api.mcp_server as MS
        from omilo_api import pieces as P

        # piece is in the catalog (get_piece already returns FAKE_MANIFEST for 'gmail' via fixture)
        # but the DB has no Connector row for it
        class _EmptyDB:
            def close(self): pass
            def scalars(self, *a, **kw): return []
            def get(self, model, id_=None): return None  # always None — no connector row
            def add(self, *a, **kw): pass
            def commit(self): pass
            def rollback(self): pass

        monkeypatch.setattr(MS, "get_db", lambda: iter([_EmptyDB()]))

        client, _ = piece_app
        r = client.post(
            "/mcp/piece/gmail",
            json=_rpc("tools/call", {"name": "send-email", "arguments": {}}),
            headers={"Authorization": "Bearer test-mcp-token"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Must be a JSON-RPC error, not a crash / 5xx
        assert "error" in body, (
            f"Expected JSON-RPC error for absent connector, got: {body}"
        )
        assert isinstance(body["error"].get("code"), int), body
