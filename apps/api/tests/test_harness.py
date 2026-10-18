"""Harness pool: Claude Code accounts, failover on usage limits with session resume, live events."""
import json
import os
import sys
from pathlib import Path

import pytest
from conftest import wait_for

FAKE = Path(__file__).parent / "bin" / "fake_claude.py"
OK1, LIMITED, OK2 = "sk-ant-oat01-" + "a" * 30 + "LIMITED", "sk-ant-oat01-" + "b" * 30 + "GOOD01", "sk-ant-oat01-" + "c" * 30 + "GOOD02"


@pytest.fixture()
def fake_cli(tmp_path):
    wrapper = tmp_path / "claude"
    wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {FAKE} \"$@\"\n")
    wrapper.chmod(0o755)
    log = tmp_path / "calls.jsonl"
    os.environ["OMILO_CLAUDE_BIN"], os.environ["FAKE_CLAUDE_LOG"] = str(wrapper), str(log)
    from omilo_api import harness as H
    H._version.clear()
    yield log
    os.environ.pop("OMILO_CLAUDE_BIN", None)
    os.environ.pop("FAKE_CLAUDE_LOG", None)


def test_accounts_validation_and_test(owner, fake_cli):
    assert owner.post("/api/harness/accounts", json={"label": "x", "token": "hello"}).status_code == 400
    a = owner.post("/api/harness/accounts", json={"label": "Sub #1", "token": OK2}).json()
    assert a["token_hint"] == OK2[-4:] and a["state"] == "new"
    assert OK2 not in json.dumps(owner.get("/api/harness").json())
    r = owner.post(f"/api/harness/accounts/{a['id']}/test").json()
    assert r["ok"] and r["account"]["state"] == "ready"
    h = owner.get("/api/harness").json()
    assert h["cli"]["version"].startswith("2.9.9") and h["ready"] >= 1
    owner.delete(f"/api/harness/accounts/{a['id']}")


def test_pool_failover_resumes_session(owner, fake_cli):
    lim = owner.post("/api/harness/accounts", json={"label": "Limited", "token": OK1}).json()
    good = owner.post("/api/harness/accounts", json={"label": "Good", "token": LIMITED}).json()
    # make the limited one the least recently used, so it is tried first
    owner.patch(f"/api/harness/accounts/{good['id']}", json={"enabled": False})
    owner.post("/api/ai", json={"provider": "claude-code", "staff_ids": ["sales"]})
    owner.patch(f"/api/harness/accounts/{good['id']}", json={"enabled": True})
    assert owner.get("/api/staff/sales").json()["engine"]["type"] == "claude-code"

    t = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Find 3 office catering prospects"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=30)
    assert done["status"] == "done", done
    assert done["report"]["headline"] == "Claude Code did it"

    calls = [json.loads(x) for x in fake_cli.read_text().splitlines()]
    assert calls[0]["token"] == OK1[-6:] and calls[1]["token"] == LIMITED[-6:]
    assert calls[1]["resume"], "the second account resumes the first account's session"
    assert calls[1]["prompt"].startswith("Continue")
    assert calls[0]["mode"] == "dontAsk" and "mcp__omilo" in (calls[0]["tools"] or "")

    accts = {a["label"]: a for a in owner.get("/api/harness").json()["accounts"]}
    assert accts["Limited"]["state"] == "cooling" and accts["Limited"]["cooldown_until"].startswith("2100")
    assert accts["Good"]["runs"] >= 1 and accts["Good"]["cost_usd"] > 0

    ev = owner.get("/api/events", params={"task_id": t["id"]}).json()
    kinds = [e["kind"] for e in ev]
    for k in ("status", "session", "thinking", "tool", "sources", "browser", "text", "usage"):
        assert k in kinds, (k, kinds)
    switching = [e for e in ev if e["kind"] == "status" and e["data"].get("state") == "switching"]
    assert switching and switching[0]["data"]["account"] == "Limited"
    omilo_tools = [e for e in ev if e["kind"] == "tool" and e["data"]["name"].startswith("omilo")]
    assert {e["data"]["name"] for e in omilo_tools} >= {"omilo · checkpoint", "omilo · report"}

    # chat on the pool keeps one Claude Code session per thread
    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "sales"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "hello"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x, timeout=30)
    assert got["messages"][-1]["text"].startswith("Claude Code here")
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "again"})
    wait_for(lambda: owner.get(f"/api/threads/{th['id']}").json()["awaiting_reply"] is False, timeout=30)
    last = json.loads(fake_cli.read_text().splitlines()[-1])
    assert last["resume"], "second chat turn resumes the thread's session"
    assert owner.get("/api/events", params={"thread_id": th["id"]}).json()

    # the meter: one entry per account, with what Claude Code reported (exact) or the rest state
    m = owner.get("/api/harness/meter").json()
    by = {a["label"]: a for a in m["accounts"]}
    assert m["total"] == 2 and by["Limited"]["five_hour"]["pct"] == 100 and by["Limited"]["state"] == "cooling"
    assert by["Good"]["five_hour"] == {**by["Good"]["five_hour"], "pct": 37, "source": "claude", "status": "allowed"}
    assert by["Good"]["tokens_5h"] > 0 and m["avg_pct"] is not None
    hist = {a["label"]: a for a in owner.get("/api/monitor", params={"range": "24h"}).json()["pool_history"]["accounts"]}
    assert hist["Limited"]["hits"] and sum(hist["Good"]["tokens"]) > 0

    owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["sales"]})
    for a in (lim, good):
        owner.delete(f"/api/harness/accounts/{a['id']}")


def test_auto_mode_spills_over_to_api_key_when_pool_empty(owner, fake_cli, monkeypatch):
    """Provider 'claude-code' is the hybrid 'auto' mode: with no pool account free it must fall back to the
    company's API key (same CLI) rather than erroring, so work still runs."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-api03-" + "z" * 24 + "APIKEY")
    owner.post("/api/ai", json={"provider": "claude-code", "staff_ids": ["sales"]})
    eng = owner.get("/api/staff/sales").json()["engine"]
    assert eng["type"] == "claude-code" and eng["auth"] == "auto", eng

    # no pool accounts added -> lease() finds nothing -> auto spills over to the API key
    t = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Find 3 office catering prospects"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=30)
    assert done["status"] == "done", done

    last = json.loads(fake_cli.read_text().splitlines()[-1])
    assert last["token"] == "" and last["api_key"].endswith("APIKEY"), f"expected the API key, not a pool token: {last}"
    ev = owner.get("/api/events", params={"task_id": t["id"]}).json()
    assert any(e["kind"] == "status" and e["data"].get("account") == "your API key" for e in ev), "overflow to API key not shown"

    owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["sales"]})


def test_offer_choices_and_tool_events(owner, base_url):
    import httpx

    tok = owner.mcp_tokens["support"]
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Pick a tone"}).json()
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"}, json={
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "offer_choices", "arguments": {"task_id": t["id"], "question": "Which tone?", "options": ["Warm", "Formal"]}}}).json()
    assert not r["result"]["isError"], r
    th = owner.get(f"/api/threads/{r['result']['structuredContent']['thread_id']}").json()
    msg = [m for m in th["messages"] if m["text"] == "Which tone?"][0]
    assert msg["blocks"] == [{"type": "choices", "options": ["Warm", "Formal"]}]
    ev = owner.get("/api/events", params={"task_id": t["id"]}).json()
    assert any(e["kind"] == "tool" and e["data"]["name"] == "omilo · offer_choices" for e in ev)
    assert owner.get("/api/events").status_code == 400
