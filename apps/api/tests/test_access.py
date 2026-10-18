"""Tests for the request_access MCP tool + inline access-request card + InboxItem record."""
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
