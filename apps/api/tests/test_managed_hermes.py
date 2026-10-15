"""Managed Hermes end to end: Saga OS writes the profile, runs a real `hermes gateway`, and a task flows
Saga OS -> Hermes -> (mock) Claude -> Saga OS MCP tools. Skipped when Hermes is not installed
(set SAGA_HERMES_BIN, e.g. to a venv with `pip install "hermes-agent[anthropic,mcp,messaging,cron,web]"`)."""
import os
import shutil
import threading

import httpx
import pytest
from conftest import _free_port, wait_for

from saga_api import hermes_manager as HM

KEY = "sk-ant-test-0000000000009999"
pytestmark = pytest.mark.skipif(not (os.environ.get("SAGA_HERMES_BIN") or shutil.which("hermes")), reason="Hermes not installed")


@pytest.fixture(scope="module")
def stream_mock():
    import uvicorn
    from mock_anthropic_stream import app

    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    threading.Thread(target=server.run, daemon=True).start()
    wait_for(lambda: httpx.get(f"http://127.0.0.1:{port}/v1/models").status_code == 200)
    os.environ["SAGA_ANTHROPIC_BASE_URL"] = f"http://127.0.0.1:{port}"
    yield
    os.environ.pop("SAGA_ANTHROPIC_BASE_URL", None)
    server.should_exit = True


def test_managed_hermes_runs_tasks_and_chat(owner, stream_mock):
    r = owner.post("/api/ai", json={"provider": "claude", "api_key": KEY, "model": "claude-sonnet-5-5", "staff_ids": ["support"]})
    assert r.status_code == 200, r.text
    ai = r.json()
    assert ai["staff"]["support"]["provider"] == "claude" and ai["hermes"]["installed"]
    eng = owner.get("/api/staff/support").json()["engine"]
    assert eng["managed"] and "api_key_enc" not in eng

    home = HM.home_for("support")
    env = (home / ".env").read_text()
    assert f"ANTHROPIC_API_KEY={KEY}" in env and "API_SERVER_KEY=" in env and oct((home / ".env").stat().st_mode)[-3:] == "600"
    assert "saga-os" in (home / "config.yaml").read_text() and KEY not in (home / "config.yaml").read_text()

    # the helper sleeps until it has work (unless earlier tests in this session gave it work); a task wakes it up
    awake = {s["id"]: s.get("awake") for s in owner.get("/api/staff").json()}
    if not awake.get("support"):
        assert "sleeping" in owner.get("/api/health/engines").json()["support"]["detail"]

    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Group this week's tickets"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=120, every=1)
    assert done["status"] == "done", done
    assert done["report"]["headline"] == "Hermes+Claude did it"
    assert done["checkpoints"] and done["checkpoints"][0]["next"] == "report"

    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "support"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "hi"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x, timeout=90, every=1)
    reply = got["messages"][-1]["text"]
    assert reply.startswith("Hermes-Claude here"), reply
    assert int(reply.split("(")[1].split()[0]) > 20, "Hermes gives the helper its own tools (browser, terminal, ...) besides saga-os"

    # back to practice mode: the gateway is stopped
    owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["support"]})
    wait_for(lambda: not _port_open(eng["port"]), timeout=40, every=1)


def _port_open(port: int) -> bool:
    try:
        httpx.get(f"http://127.0.0.1:{port}/health", timeout=1)
        return True
    except httpx.HTTPError:
        return False
