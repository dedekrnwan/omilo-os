"""End-to-end: the M2 gate (a staff agent proposes, the founder approves, it executes) and the safety rails."""
import httpx
import pytest
from conftest import wait_for

from saga_api import policy


def mcp(base_url, token, method, params=None, id_=1):
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {token}"},
                   json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}})
    return r


def tool(base_url, token, tool_name, **args):
    r = mcp(base_url, token, "tools/call", {"name": tool_name, "arguments": args})
    assert r.status_code == 200, r.text
    return r.json()["result"]


# ------------------------------------------------------------------ policy unit tests
def test_policy_defaults_and_overrides():
    assert policy.level_for("code.merge", {}) == policy.OFF
    assert policy.level_for("outreach.send", {}) == policy.ASK
    assert policy.level_for("content.draft", {"actions": {"content.draft": 3}}) == policy.AUTO
    assert policy.level_for("content.publish", {"actions": {"content.*": 3}}) == policy.AUTO
    # strict mode caps external actions at ASK
    assert policy.level_for("content.publish", {"actions": {"content.publish": 3}}, strict=True) == policy.ASK


# ------------------------------------------------------------------ auth
def test_requires_login(base_url, owner):
    assert httpx.get(f"{base_url}/api/overview").status_code == 401
    assert owner.get("/api/overview").status_code == 200
    # second owner is refused
    assert httpx.post(f"{base_url}/api/setup/owner", json={"email": "x@example.com", "password": "0123456789"}).status_code == 409


def test_cookie_requests_need_csrf_header(base_url, owner):
    c = httpx.Client(base_url=base_url)
    assert c.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1"}).status_code == 200
    assert c.get("/api/overview").status_code == 200
    assert c.post("/api/system", json={"paused": False}).status_code == 403
    assert c.post("/api/system", json={"paused": False}, headers={"X-Saga": "1"}).status_code == 200


# ------------------------------------------------------------------ the M2 gate
def test_propose_approve_execute(base_url, owner):
    t = owner.post("/api/tasks", json={"staff_id": "marketing", "brief": "Plan one launch post"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x)
    assert done["status"] == "done", done
    assert done["report"]["headline"].startswith("1 draft waiting")
    assert done["checkpoints"], "agent saved a checkpoint"
    assert {"get_task", "checkpoint", "propose", "report"} <= {c["tool"] for c in done["tool_calls"]}
    pid = done["proposals"][0]["id"]

    inbox = owner.get("/api/inbox").json()
    assert any(i["kind"] == "proposal" and i["ref_id"] == pid for i in inbox)

    # approving creates an execution task for the same agent; it executes the approved text
    p = owner.post(f"/api/proposals/{pid}/decide", json={"decision": "approve", "note": "post Tuesday"}).json()
    assert p["status"] == "approved" and p["execution_task_id"]
    final = wait_for(lambda: (x := owner.get(f"/api/proposals/{pid}").json())["status"] in ("done", "failed") and x)
    assert final["status"] == "done", final
    ex = owner.get(f"/api/tasks/{p['execution_task_id']}").json()
    assert ex["origin"] == "execution" and ex["status"] == "done"
    assert not any(i["ref_id"] == pid for i in owner.get("/api/inbox").json()), "decided item left the inbox"


def test_reject_needs_note_and_changes_loop(base_url, owner):
    t = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Draft outreach to Barokah"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] == "done" and x)
    pid = done["proposals"][0]["id"]
    assert owner.post(f"/api/proposals/{pid}/decide", json={"decision": "reject"}).status_code == 400
    r = owner.post(f"/api/proposals/{pid}/decide", json={"decision": "changes", "note": "shorter, warmer"})
    assert r.json()["status"] == "changes_requested"
    revised = wait_for(lambda: (x := owner.get(f"/api/proposals/{pid}").json())["status"] == "pending" and x)
    assert revised["current_revision"] == 2 and "shorter, warmer" in revised["body_md"]
    assert len(revised["revisions"]) == 2
    rej = owner.post(f"/api/proposals/{pid}/decide", json={"decision": "reject", "note": "not now"}).json()
    assert rej["status"] == "rejected"


# ------------------------------------------------------------------ MCP endpoint and policy gate
def test_mcp_auth_and_tools(base_url, owner):
    assert mcp(base_url, "nope", "tools/list").status_code == 401
    tok = owner.mcp_tokens["marketing"]
    init = mcp(base_url, tok, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    assert init.json()["result"]["protocolVersion"] == "2025-06-18"
    names = {t["name"] for t in mcp(base_url, tok, "tools/list").json()["result"]["tools"]}
    assert {"report", "propose", "request_action", "checkpoint", "ask_founder", "get_context"} <= names


def test_request_action_policy(base_url, owner):
    tok = owner.mcp_tokens["marketing"]
    off = tool(base_url, tok, "request_action", action="code.merge", summary="merge", details="git merge")
    assert off["structuredContent"]["decision"] == "refused"
    ask = tool(base_url, tok, "request_action", action="content.publish", summary="post on IG", details="caption ...")
    assert ask["structuredContent"]["decision"] == "needs_approval" and ask["structuredContent"]["proposal_id"]
    ok = tool(base_url, tok, "request_action", action="content.draft", summary="draft", details="...")
    assert ok["structuredContent"]["decision"] == "allowed"


def test_only_chief_delegates_and_kpi_permissions(base_url, owner):
    res = tool(base_url, owner.mcp_tokens["marketing"], "create_task", staff_id="sales", brief="help")
    assert res["isError"] and "Chief of Staff" in res["structuredContent"]["error"]
    res = tool(base_url, owner.mcp_tokens["chief-of-staff"], "create_task", staff_id="sales", brief="research 3 estates")
    assert not res["isError"]
    assert tool(base_url, owner.mcp_tokens["marketing"], "update_kpi", name="mrr", value=1, source="x")["isError"]
    assert not tool(base_url, owner.mcp_tokens["finance"], "update_kpi", name="mrr_idr", value=0, source="replica", period="2026-W42")["isError"]
    assert owner.get("/api/kpis").json()["mrr_idr"]["value"] == 0


def test_agent_cannot_touch_other_agents_work(base_url, owner):
    t = owner.post("/api/tasks", json={"staff_id": "ops", "brief": "check health"}).json()
    res = tool(base_url, owner.mcp_tokens["marketing"], "report", task_id=t["id"], headline="x", body="y")
    assert res["isError"]


def test_question_answer_creates_followup(base_url, owner):
    q = tool(base_url, owner.mcp_tokens["support"], "ask_founder", question="Which RT goes first?", blocking=True)
    qid = q["structuredContent"]["question_id"]
    items = owner.get("/api/inbox").json()
    assert any(i["id"] == qid and i["blocking"] for i in items)
    owner.post(f"/api/inbox/{qid}/answer", json={"answer": "RT 03"})
    tasks = owner.get("/api/tasks", params={"staff_id": "support"}).json()
    assert any(t["origin"] == "answer" and "RT 03" in t["brief"] for t in tasks)


# ------------------------------------------------------------------ chat
def test_master_chat_gets_reply(base_url, owner):
    th = owner.post("/api/threads", json={"scope": "master"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "What needs my attention?"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x)
    assert got["messages"][-1]["role"] == "agent"
    assert "What needs my attention?" in got["messages"][-1]["text"]


# ------------------------------------------------------------------ official MCP client compatibility
@pytest.mark.asyncio
async def test_official_mcp_client(base_url, owner):
    mcp_mod = pytest.importorskip("mcp")
    try:
        from mcp.client.streamable_http import streamable_http_client as connect
    except ImportError:
        from mcp.client.streamable_http import streamablehttp_client as connect
    from mcp import ClientSession

    tok = owner.mcp_tokens["marketing"]
    http = httpx.AsyncClient(headers={"Authorization": f"Bearer {tok}"}, timeout=10)
    try:
        cm = connect(f"{base_url}/mcp", http_client=http)
    except TypeError:
        cm = connect(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"})
    async with cm as streams:
        read, write = streams[0], streams[1]
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            assert any(t.name == "propose" for t in tools.tools)
            res = await session.call_tool("whoami", {})
            assert not getattr(res, "is_error", getattr(res, "isError", False))
    await http.aclose()
    assert mcp_mod
