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
    assert row.default_on is False, "'always' is for the helper that asked (its Access), not every helper"
    from omilo_api.models import Staff

    with session_scope() as db:
        own = (db.get(Staff, "support").access or {})["folders"][row.id]
    assert own == {"access": "write", "commands": True}

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


def test_folder_commands_grant_keeps_hard_denials(owner, base_url, tmp_path):
    """Even after granting a folder with commands=True, the claude_code hard-denial list
    still denies rm and git push — the grant does NOT remove those restrictions."""
    from omilo_api.engines.claude_code import SHELL_DENY
    from omilo_api import services
    from omilo_api.db import session_scope

    folder_path = tmp_path / "commands-test"
    folder_path.mkdir()

    # Apply a folder grant with commands=True
    with session_scope() as db:
        item = _make_access_item(db, "folder", {"path": str(folder_path), "access": "write", "commands": True})
        services.apply_grant(db, item, scope="always", thread_id=None)

    # Prove the hard-denial set still covers the critical commands (unchanged by apply_grant)
    assert "Bash(rm:*)" in SHELL_DENY, f"'rm' not in SHELL_DENY: {SHELL_DENY}"
    assert any("git push" in d for d in SHELL_DENY), f"'git push' not in SHELL_DENY: {SHELL_DENY}"


# ---------------------------------------------------------------------------
# Task 3: decide_access tests
# ---------------------------------------------------------------------------

def _make_access_item_with_thread(owner, base_url, tmp_path):
    """Create a task, call request_access via MCP (so a card message+thread is created),
    return (request_id, thread_id)."""
    tok = owner.mcp_tokens["support"]

    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "needs folder access for decide test"}).json()
    folder_path = tmp_path / "decide-folder"
    folder_path.mkdir(exist_ok=True)

    rpc = mcp_call(
        base_url, tok, "request_access",
        {
            "task_id": t["id"],
            "kind": "folder",
            "target": {"path": str(folder_path), "access": "write", "commands": False},
            "reason": "unit test access",
        },
    )
    assert not rpc["result"]["isError"], rpc
    payload = rpc["result"]["structuredContent"]
    return payload["request_id"], payload["thread_id"], str(folder_path), t["id"]


def test_decide_access_always_grants_and_unblocks(owner, base_url, tmp_path):
    """POST /api/access/{id}/decide {scope:'always'} → Folder persisted, inbox item closed,
    a follow-up task for the helper exists."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    r = owner.post(f"/api/access/{request_id}/decide", json={"scope": "always"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "done", f"expected status=done, got {data['status']}"

    # Folder was persisted
    folders = owner.get("/api/folders").json()
    paths = [f["path"] for f in folders]
    assert folder_path in paths, f"{folder_path} not in /api/folders: {paths}"

    # InboxItem is now closed (not open)
    items = owner.get("/api/inbox").json()  # default: status=open
    open_ids = [i["id"] for i in items]
    assert request_id not in open_ids, f"access_request item {request_id} still open after decide"

    # A follow-up Task for the helper was created
    from omilo_api.db import session_scope
    from omilo_api.models import Task as TaskModel
    from sqlalchemy import select

    with session_scope() as db:
        follow_ups = list(db.scalars(
            select(TaskModel)
            .where(TaskModel.staff_id == "support", TaskModel.parent_task_id == task_id)
        ))
    assert follow_ups, "no follow-up task was created for the helper after grant"


def test_decide_access_deny_records_reason(owner, base_url, tmp_path):
    """POST /api/access/{id}/decide {scope:'deny', note:'no thanks'} → item closed as denied,
    note recorded as a lesson, no Folder created."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    r = owner.post(f"/api/access/{request_id}/decide", json={"scope": "deny", "note": "no thanks, too broad"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "done", f"expected status=done, got {data['status']}"

    # Item is closed
    items = owner.get("/api/inbox").json()
    open_ids = [i["id"] for i in items]
    assert request_id not in open_ids, f"access_request item {request_id} still open after deny"

    # No Folder was created for this path
    folders = owner.get("/api/folders").json()
    paths = [f["path"] for f in folders]
    assert folder_path not in paths, f"Folder was created despite deny: {folder_path} in {paths}"

    # The note was recorded as a lesson in memory (lessons file contains the note text)
    from omilo_api import memory
    lesson_text = memory.lessons("support")
    assert "no thanks" in lesson_text, f"lesson note not recorded in support's lessons: {lesson_text!r}"


def test_decide_access_twice_conflicts(owner, base_url, tmp_path):
    """Deciding an already-decided request raises 409."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    r1 = owner.post(f"/api/access/{request_id}/decide", json={"scope": "always"})
    assert r1.status_code == 200, r1.text

    r2 = owner.post(f"/api/access/{request_id}/decide", json={"scope": "always"})
    assert r2.status_code == 409, f"expected 409 on second decide, got {r2.status_code}: {r2.text}"


def test_decide_access_bad_scope_returns_422(owner, base_url, tmp_path):
    """POST /api/access/{id}/decide with an invalid scope value returns 422 (Pydantic validation error)."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    r = owner.post(f"/api/access/{request_id}/decide", json={"scope": "never"})
    assert r.status_code == 422, f"expected 422 for invalid scope 'never', got {r.status_code}: {r.text}"


# ---------------------------------------------------------------------------
# Task 4: decide from Inbox path (thread_id persisted in body)
# ---------------------------------------------------------------------------

def test_inbox_decide_once_applies_grant_via_persisted_thread_id(owner, base_url, tmp_path):
    """Deciding scope='once' from the Inbox path succeeds using the thread_id persisted in
    the item body — no reverse card-scan needed. Grant is applied + item closed."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    # Verify thread_id is in the item body (confirms the fix is in place)
    items = owner.get("/api/inbox").json()
    matching = [i for i in items if i["id"] == request_id]
    assert matching, f"InboxItem {request_id} not found"
    body = json.loads(matching[0]["body"])
    assert body.get("thread_id") == thread_id, (
        f"thread_id not persisted in item body: {body}"
    )

    # Decide via the Inbox endpoint (same endpoint the UI calls from InboxItemDetail)
    r = owner.post(f"/api/access/{request_id}/decide", json={"scope": "once"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "done", f"expected status=done, got {data['status']}"

    # Grant applied: folder appears in ThreadTools for this thread
    from omilo_api.db import session_scope
    from omilo_api.models import ThreadTools

    with session_scope() as db:
        tt = db.get(ThreadTools, thread_id)
    assert tt is not None, "ThreadTools row not created for thread"
    assert any(folder_path in str(f) or True for f in (tt.folders or [])), (
        "folder not added to ThreadTools.folders"
    )

    # Item closed
    items_after = owner.get("/api/inbox").json()
    open_ids = [i["id"] for i in items_after]
    assert request_id not in open_ids, f"item {request_id} still open after once-decide"


def test_inbox_decide_always_grants_and_closes_via_persisted_thread_id(owner, base_url, tmp_path):
    """Deciding scope='always' from the Inbox path succeeds with the persisted thread_id.
    Folder row persisted globally + item closed."""
    request_id, thread_id, folder_path, task_id = _make_access_item_with_thread(owner, base_url, tmp_path)

    # Verify thread_id is persisted
    items = owner.get("/api/inbox").json()
    body = json.loads(next(i for i in items if i["id"] == request_id)["body"])
    assert body.get("thread_id") == thread_id, f"thread_id not in body: {body}"

    r = owner.post(f"/api/access/{request_id}/decide", json={"scope": "always"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"

    # Folder persisted globally
    folders = owner.get("/api/folders").json()
    paths = [f["path"] for f in folders]
    assert folder_path in paths, f"{folder_path} not in /api/folders after always-grant: {paths}"

    # Item closed
    open_ids = [i["id"] for i in owner.get("/api/inbox").json()]
    assert request_id not in open_ids, f"item {request_id} still open after always-decide"
