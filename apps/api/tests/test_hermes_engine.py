"""HermesEngine against a mock OpenAI-compatible server that behaves like a Hermes profile with the saga-os MCP server configured."""
import re
import threading
import time

import httpx
import pytest
from conftest import _free_port, wait_for
from fastapi import FastAPI, Request

STATE = {"token": None, "mcp": None, "sessions": [], "systems": []}
mock = FastAPI()


@mock.get("/health")
def health():
    return {"status": "ok"}


@mock.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    STATE["sessions"].append(request.headers.get("x-hermes-session-id"))
    STATE["systems"].append(body["messages"][0]["content"])
    last = body["messages"][-1]["content"]
    m = re.search(r"Task (tsk_[0-9a-f]+)", last)
    if m:  # like Hermes: use the MCP tools, then answer
        h = {"Authorization": f"Bearer {STATE['token']}"}
        call = lambda name, **a: httpx.post(STATE["mcp"], headers=h, json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",  # noqa: E731
                                                                            "params": {"name": name, "arguments": a}}).json()
        call("checkpoint", task_id=m.group(1), next="write report")
        call("report", task_id=m.group(1), headline="Hermes did it", body="## Summary\n- done by the mock Hermes")
        return {"choices": [{"message": {"role": "assistant", "content": "finished"}}], "usage": {"total_tokens": 1234}}
    return {"choices": [{"message": {"role": "assistant", "content": f"Hermes here. You said: {last}"}}]}


@pytest.fixture(scope="module")
def hermes_url():
    import uvicorn

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(mock, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        try:
            httpx.get(f"http://127.0.0.1:{port}/health")
            break
        except httpx.HTTPError:
            time.sleep(0.05)
    yield f"http://127.0.0.1:{port}/v1"
    server.should_exit = True


def test_hermes_task_and_chat(owner, base_url, hermes_url):
    created = owner.post("/api/staff", json={"id": "researcher", "name": "Researcher", "job": "Find facts with sources.",
                                             "engine": {"type": "hermes", "base_url": hermes_url}}).json()
    STATE["token"], STATE["mcp"] = created["mcp_token"], f"{base_url}/mcp"

    assert owner.get("/api/health/engines").json()["researcher"]["ok"] is True

    t = owner.post("/api/tasks", json={"staff_id": "researcher", "brief": "Find 3 estates", "founder_note": "Depok only"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x)
    assert done["status"] == "done", done
    assert done["report"]["headline"] == "Hermes did it"
    assert done["checkpoints"] and done["checkpoints"][0]["next"] == "write report"
    assert f"task-{t['id']}" in STATE["sessions"]
    assert "Find facts with sources." in STATE["systems"][-1], "job description reaches the engine"

    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "researcher"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "hi"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x)
    assert got["messages"][-1]["text"] == "Hermes here. You said: hi"
