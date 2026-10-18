"""Tests for the request_access MCP tool + inline access-request card + InboxItem record,
and apply_grant (Task 2): folder/connector/skill grants at once vs always scope."""
import json

import httpx
import pytest


# ---------------------------------------------------------------------------
# Helper: call an MCP tool via the HTTP endpoint using a staff MCP token
# ---------------------------------------------------------------------------

def mcp_call(base_url: str, token: str, name: str, arguments: dict) -> dict:
    r = httpx.post(
        f"{base_url}/mcp",
        headers={"Authorization": f"Bearer {token}"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
              "params": {"name": name, "arguments": arguments}},
        timeout=20,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_request_access_posts_card_and_inbox(owner, base_url):
    """A staff agent calls request_access(folder, ...) → InboxItem created, thread card posted."""
    tok = owner.mcp_tokens["support"]

    # Give the tool a task so current_run has something to hang the thread off.
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "needs folder access"}).json()

    rpc = mcp_call(
        base_url, tok, "request_access",
        {
            "task_id": t["id"],
            "kind": "folder",
            "target": {"path": "/tmp/x", "access": "write", "commands": True},
            "reason": "copy skills",
        },
    )

    assert not rpc["result"]["isError"], rpc
    payload = rpc["result"]["structuredContent"]
    assert payload["decision"] == "needs_approval"
    request_id = payload["request_id"]
    thread_id = payload["thread_id"]
    assert request_id and thread_id

    # Verify InboxItem was created (GET /api/inbox returns a list)
    items = owner.get("/api/inbox").json()
    matching = [i for i in items if i["id"] == request_id]
    assert matching, f"no InboxItem with id={request_id} in {[i['id'] for i in items]}"
    item = matching[0]
    assert item["kind"] == "access_request"

    # Verify the thread has an agent message with the access_request block
    th = owner.get(f"/api/threads/{thread_id}").json()
    agent_msgs = [m for m in th["messages"] if m["role"] == "agent"]
    assert agent_msgs, "no agent messages found in thread"
    latest = agent_msgs[-1]
    access_blocks = [b for b in latest["blocks"] if b.get("type") == "access_request"]
    assert access_blocks, f"no access_request block in blocks: {latest['blocks']}"
    blk = access_blocks[0]
    assert blk["request_id"] == request_id
    assert blk["kind"] == "folder"


def test_request_access_rejects_bad_kind(owner, base_url):
    """kind='nonsense' is rejected with an error (DomainError → isError=True or refused)."""
    tok = owner.mcp_tokens["support"]
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "bad kind test"}).json()

    rpc = mcp_call(
        base_url, tok, "request_access",
        {
            "task_id": t["id"],
            "kind": "nonsense",
            "target": {"path": "/tmp/x"},
            "reason": "should fail",
        },
    )

    result = rpc["result"]
    assert result["isError"] or rpc.get("result", {}).get("structuredContent", {}).get("error"), rpc


# ---------------------------------------------------------------------------
# Task 2: apply_grant tests
# ---------------------------------------------------------------------------

def _make_access_item(db, kind: str, target: dict, reason: str = "test grant"):
    """Build an access_request InboxItem directly in the DB (bypasses MCP)."""
    from omilo_api.models import InboxItem, Staff
    from sqlalchemy import select

    st = db.scalar(select(Staff).where(Staff.id == "support"))
    from omilo_api import services
    return services.request_access(db, st, task_id=None, thread_id=None, kind=kind, target=target, reason=reason)


def test_grant_folder_always_persists(owner, base_url, tmp_path):
    """apply_grant(folder-request, 'always') creates a Folder row with the right fields
    and it shows up in GET /api/folders."""
    folder_path = tmp_path / "granted-folder"
    folder_path.mkdir()

    from omilo_api import services
    from omilo_api.db import session_scope
    from omilo_api.models import Folder
    from sqlalchemy import select

    with session_scope() as db:
        item = _make_access_item(db, "folder", {"path": str(folder_path), "access": "write", "commands": True})
        services.apply_grant(db, item, scope="always", thread_id=None)

    with session_scope() as db:
        row = db.scalar(select(Folder).where(Folder.path == str(folder_path)))
    assert row is not None, "Folder row was not created"
    assert row.access == "write"
    assert row.commands is True
    assert row.default_on is True

    folders = owner.get("/api/folders").json()
    paths = [f["path"] for f in folders]
    assert str(folder_path) in paths, f"{folder_path} not in GET /api/folders: {paths}"


def test_grant_connector_once_is_thread_scoped(owner, base_url):
    """apply_grant(connector-request, 'once') adds the connector id to the thread's
    ThreadTools.connectors but does NOT change Connector.approval."""
    # Create a connector with approval="ask"
    conn_id = "grant-test-conn"
    owner.post("/api/connectors", json={"id": conn_id, "label": "GrantTest", "url": "http://localhost:9999/mcp", "approval": "ask"})

    # Create a thread to scope the grant
    th = owner.post("/api/threads", json={"scope": "master", "staff_id": "chief"}).json()
    thread_id = th["id"]

    from omilo_api import services
    from omilo_api.db import session_scope
    from omilo_api.models import Connector, ThreadTools

    with session_scope() as db:
        item = _make_access_item(db, "connector", {"id": conn_id})
        services.apply_grant(db, item, scope="once", thread_id=thread_id)

    with session_scope() as db:
        tt = db.get(ThreadTools, thread_id)
        conn = db.get(Connector, conn_id)

    assert tt is not None, "ThreadTools row was not created"
    assert conn_id in (tt.connectors or []), f"{conn_id} not in ThreadTools.connectors: {tt.connectors}"
    assert conn.approval == "ask", f"Connector.approval was mutated to '{conn.approval}'; should stay 'ask'"

    # Cleanup
    owner.delete(f"/api/connectors/{conn_id}")


def test_folder_commands_grant_keeps_hard_denials(owner, base_url):
    """Even after granting a folder with commands=True, the claude_code hard-denial list
    still denies rm and git push — the grant does NOT remove those restrictions."""
    from omilo_api.engines.claude_code import SHELL_DENY

    # Prove the hard-denial set covers the critical commands
    denied_str = " ".join(SHELL_DENY)
    assert "Bash(rm:*)" in SHELL_DENY, f"'rm' not in SHELL_DENY: {SHELL_DENY}"
    assert any("git push" in d for d in SHELL_DENY), f"'git push' not in SHELL_DENY: {SHELL_DENY}"
