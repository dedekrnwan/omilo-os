"""Tests for Task 1: proposal cards in chat + InboxItem.thread_id.

Three required test cases from the brief:
  - test_propose_in_chat_posts_proposal_card
  - test_propose_without_thread_files_inbox_only
  - test_decide_proposal_from_inbox_after_chat_card_is_idempotent
"""
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

def test_propose_in_chat_posts_proposal_card(owner, base_url):
    """A staff agent calls propose via MCP while a chat thread is awaiting its reply.
    The thread should have an agent message whose blocks include {"type":"proposal",...};
    the InboxItem.thread_id should equal that thread's id.
    """
    tok = owner.mcp_tokens["support"]

    # Create a staff thread and mark it awaiting_reply via the DB so current_run finds it
    th_resp = owner.post("/api/threads", json={"scope": "staff", "staff_id": "support"}).json()
    thread_id = th_resp["id"]

    from omilo_api.db import session_scope
    from omilo_api.models import Thread as ThreadModel
    with session_scope() as db:
        th_row = db.get(ThreadModel, thread_id)
        th_row.awaiting_reply = True
        db.commit()

    # Call propose via MCP — the handler should resolve the thread via current_run
    rpc = mcp_call(
        base_url, tok, "propose",
        {
            "title": "Run a paid ad campaign",
            "type": "content.publish",
            "risk": "medium",
            "body": "We should run Facebook ads this week.\n\nBudget: $500.\nTarget: anvil buyers.",
        },
    )

    assert not rpc["result"]["isError"], rpc
    payload = rpc["result"]["structuredContent"]
    proposal_id = payload["proposal_id"]
    assert proposal_id

    # The thread should have an agent message with a proposal block
    th_detail = owner.get(f"/api/threads/{thread_id}").json()
    agent_msgs = [m for m in th_detail["messages"] if m["role"] == "agent"]
    assert agent_msgs, f"no agent messages in thread {thread_id}"

    proposal_blocks = [
        b for m in agent_msgs for b in m["blocks"] if b.get("type") == "proposal"
    ]
    assert proposal_blocks, f"no proposal block in agent messages: {[m['blocks'] for m in agent_msgs]}"

    blk = proposal_blocks[0]
    assert blk["proposal_id"] == proposal_id
    assert blk["title"] == "Run a paid ad campaign"
    assert blk["risk"] == "medium"
    # summary = first non-empty line of body
    assert blk["summary"] == "We should run Facebook ads this week."

    # InboxItem.thread_id should be set
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem
    from sqlalchemy import select

    with session_scope() as db:
        item = db.scalar(select(InboxItem).where(InboxItem.kind == "proposal", InboxItem.ref_id == proposal_id))
    assert item is not None, "InboxItem not created"
    assert item.thread_id == thread_id, f"InboxItem.thread_id={item.thread_id!r}, expected {thread_id!r}"


def test_propose_without_thread_files_inbox_only(owner, base_url):
    """create_proposal with th=None (e.g. background task with no open chat) still creates
    the Proposal + InboxItem, posts no message, and thread_id is None. No exception raised.
    """
    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem, Staff, Thread
    from sqlalchemy import func, select

    with session_scope() as db:
        st = db.get(Staff, "support")
        # Call create_proposal directly with th=None (backward-compat path)
        p = S.create_proposal(
            db, st,
            task_id=None,
            title="Proposal without thread",
            type_="other",
            risk="low",
            body="First line: a summary.\n\nMore details here.",
            th=None,
            thread_id=None,
        )

    # Proposal was created
    assert p.id.startswith("prp_")

    # InboxItem exists with thread_id=None
    with session_scope() as db:
        item = db.scalar(select(InboxItem).where(InboxItem.kind == "proposal", InboxItem.ref_id == p.id))
    assert item is not None, "InboxItem not created"
    assert item.thread_id is None, f"expected thread_id=None, got {item.thread_id!r}"

    # No message was posted to any thread (no Thread row for this proposal)
    with session_scope() as db:
        thread_count_for_proposal = db.scalar(
            select(func.count()).select_from(Thread).where(Thread.scope == "task", Thread.ref_id == p.id)
        )
    assert thread_count_for_proposal == 0, "unexpected thread created for proposal"


def test_decide_proposal_from_inbox_after_chat_card_is_idempotent(owner, base_url):
    """After a proposal card is posted in chat, deciding it once via the API succeeds (200);
    deciding it a second time returns 409 (unchanged decide_proposal guard).
    """
    tok = owner.mcp_tokens["support"]

    # Create a task for the proposal (use task-based path so thread resolution is stable)
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "test idempotent decide"}).json()
    task_id = t["id"]

    # Call propose via MCP with a task_id so the thread is created via get_or_create_thread
    rpc = mcp_call(
        base_url, tok, "propose",
        {
            "task_id": task_id,
            "title": "Idempotent decide test proposal",
            "type": "other",
            "risk": "low",
            "body": "Summary line.\n\nDetails follow.",
        },
    )

    assert not rpc["result"]["isError"], rpc
    proposal_id = rpc["result"]["structuredContent"]["proposal_id"]

    # First decide: approve
    r1 = owner.post(f"/api/proposals/{proposal_id}/decide", json={"decision": "approve", "note": ""})
    assert r1.status_code == 200, f"first decide failed: {r1.status_code} {r1.text}"

    # Second decide: must be 409
    r2 = owner.post(f"/api/proposals/{proposal_id}/decide", json={"decision": "approve", "note": ""})
    assert r2.status_code == 409, f"expected 409 on second decide, got {r2.status_code}: {r2.text}"
