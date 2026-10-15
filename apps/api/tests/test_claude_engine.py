"""Built-in Claude engine against a mock Anthropic API: key check, model list, the tool loop through MCP."""
import os
import threading
import time

import httpx
import pytest
from conftest import _free_port, wait_for
from fastapi import FastAPI, Request

KEY = "sk-ant-test-0000000000001234"
SEEN = {"bodies": [], "keys": set()}
mock = FastAPI()


@mock.get("/v1/models")
def models(request: Request):
    if request.headers.get("x-api-key") != KEY:
        return _unauth()
    return {"data": [{"id": "claude-haiku-x", "display_name": "Claude Haiku"}, {"id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5"}]}


def _unauth():
    from fastapi.responses import JSONResponse

    return JSONResponse({"type": "error", "error": {"type": "authentication_error"}}, status_code=401)


@mock.post("/v1/messages")
async def messages(request: Request):
    SEEN["keys"].add(request.headers.get("x-api-key"))
    body = await request.json()
    SEEN["bodies"].append(body)
    names = {t["name"] for t in body.get("tools", [])}
    if body["model"] == "claude-noweb" and "web_search" in names:
        from fastapi.responses import JSONResponse

        return JSONResponse({"type": "error", "error": {"type": "invalid_request_error", "message": "web_search is not enabled"}}, status_code=400)
    if body["model"] == "claude-pause":
        paused = sum(1 for m in body["messages"] if m["role"] == "assistant")
        if paused < 2:
            return {"content": [{"type": "server_tool_use", "id": f"srv_{paused}", "name": "web_search", "input": {"query": "q"}}],
                    "stop_reason": "pause_turn", "usage": {"input_tokens": 1, "output_tokens": 1, "server_tool_use": {"web_search_requests": 1}}}
        return {"content": [{"type": "text", "text": f"resumed after {paused}"}], "stop_reason": "end_turn", "usage": {"input_tokens": 1, "output_tokens": 1}}
    msgs = body["messages"]
    first = msgs[0]["content"] if isinstance(msgs[0]["content"], str) else ""
    usage = {"input_tokens": 100, "output_tokens": 20}
    if "Task tsk_" in first:
        task_id = first.split("Task ")[1].split(" ")[0]
        step = sum(1 for m in msgs if m["role"] == "assistant")
        plan = [("get_task", {"task_id": task_id}), ("checkpoint", {"task_id": task_id, "next": "report"}),
                ("report", {"task_id": task_id, "headline": "Claude did it", "body": "## Summary\n- done"})]
        if step < len(plan):
            name, args = plan[step]
            return {"content": [{"type": "text", "text": f"calling {name}"},
                                {"type": "tool_use", "id": f"tu_{step}", "name": name, "input": args}],
                    "stop_reason": "tool_use", "usage": usage}
        assert msgs[-1]["content"][0]["type"] == "tool_result"
        return {"content": [{"type": "text", "text": "finished"}], "stop_reason": "end_turn", "usage": usage}
    return {"content": [{"type": "text", "text": f"Claude here. Tools: {len(body.get('tools', []))}"}], "stop_reason": "end_turn", "usage": usage}


@pytest.fixture(scope="module")
def anthropic_url():
    import uvicorn

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(mock, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            httpx.get(f"http://127.0.0.1:{port}/docs")
            break
        except httpx.HTTPError:
            time.sleep(0.05)
    os.environ["SAGA_ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{port}"
    yield
    os.environ.pop("SAGA_ANTHROPIC_BASE_URL", None)
    server.should_exit = True


def test_claude_key_check_and_switch(owner, anthropic_url):
    assert owner.post("/api/ai/check", json={"api_key": "sk-ant-wrong"}).json()["ok"] is False
    ok = owner.post("/api/ai/check", json={"api_key": KEY}).json()
    assert ok["ok"] and ok["recommended"] == "claude-sonnet-5-5"

    st = owner.post("/api/ai", json={"provider": "claude", "api_key": KEY, "model": "claude-sonnet-5-5", "staff_ids": ["marketing"]}).json()
    assert st["changed"] == ["marketing"] and st["claude_key_hint"] == "1234"
    assert KEY not in str(owner.get("/api/ai").json()) and KEY not in str(owner.get("/api/staff/marketing").json())
    assert owner.get("/api/health/engines").json()["marketing"]["ok"] is True

    t = owner.post("/api/tasks", json={"staff_id": "marketing", "brief": "Write a post"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x)
    assert done["status"] == "done", done
    assert done["report"]["headline"] == "Claude did it"
    assert done["checkpoints"][0]["next"] == "report"
    assert done["tokens"] >= 480
    assert SEEN["keys"] == {KEY}
    task_bodies = [b for b in SEEN["bodies"] if b.get("tools") and "Task tsk_" in str(b["messages"][0]["content"])]
    assert {"report", "propose", "request_action", "web_search", "web_fetch"} <= {tl["name"] for tl in task_bodies[0]["tools"]}

    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "marketing"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "hi"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x)
    assert got["messages"][-1]["text"].startswith("Claude here. Tools: ")

    # back to practice mode for the other tests
    owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["marketing"]})


def test_claude_needs_a_key(base_url):
    c = httpx.Client(base_url=base_url)
    assert c.post("/api/ai", json={"provider": "claude"}).status_code == 401


def test_web_tools_fallback_and_pause(anthropic_url):
    import asyncio

    from saga_api.engines.claude import ClaudeEngine

    e = ClaudeEngine()
    msgs = lambda: [{"role": "user", "content": "hello"}]  # noqa: E731
    r = asyncio.run(e._loop({"api_key": KEY, "model": "claude-noweb"}, "sys", msgs(), None, None, 4, 10))
    assert r.error == "" and r.text.startswith("Claude here"), r  # retried without web tools
    r = asyncio.run(e._loop({"api_key": KEY, "model": "claude-pause"}, "sys", msgs(), None, None, 6, 10))
    assert r.text == "resumed after 2" and abs(r.cost_usd - 0.02) < 1e-9, r
