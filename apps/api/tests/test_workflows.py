"""Workflow automations: checking graphs, templates, runs that wait for you, helpers proposing workflows, webhooks, the marketplace."""
import httpx
import pytest
from conftest import wait_for
from test_flows import tool

from omilo_api import workflows as W


def N(id, type, config=None, **kw):
    return {"id": id, "type": type, "config": config or {}, **kw}


def E(a, b, port="out"):
    return {"from": a, "to": b, "port": port}


# ------------------------------------------------------------------ unit
def test_validate_rules():
    ok = W.validate({"nodes": [N("t", "trigger.manual"), N("a", "data.text", {"template": "hi"})], "edges": [E("t", "a")]})
    assert [n["id"] for n in ok["nodes"]] == ["t", "a"]
    bad = [
        {"nodes": [N("a", "data.text")], "edges": []},  # no trigger
        {"nodes": [N("t", "trigger.manual"), N("u", "trigger.webhook")], "edges": []},  # two triggers
        {"nodes": [N("t", "trigger.manual"), N("a", "nope")], "edges": []},  # unknown block
        {"nodes": [N("t", "trigger.manual"), N("a", "data.text"), N("b", "data.text")], "edges": [E("t", "a"), E("a", "b"), E("b", "a")]},  # loop
        {"nodes": [N("t", "trigger.manual"), N("a", "data.text")], "edges": [E("t", "a", "true")]},  # no such exit
        {"nodes": [N("t", "trigger.schedule", {"cron": "every day"})], "edges": []},  # bad schedule
    ]
    for g in bad:
        with pytest.raises(W.Invalid):
            W.validate(g)


def test_templates_keep_types_and_filters():
    ctx = {"trigger": {"items": [{"n": "a"}, {"n": "b"}], "name": "  Ann ", "total": "1,200"}, "steps": {}, "last": None}
    assert W.render("{{ trigger.items }}", ctx) == [{"n": "a"}, {"n": "b"}]
    assert W.render("{{ trigger.items | length }}", ctx) == 2
    assert W.render("Hi {{ trigger.name | trim }}!", ctx) == "Hi Ann!"
    assert W.render("{{ trigger.total | number }}", ctx) == 1200.0
    assert W.render("{{ trigger.items[1].n | upper }}", ctx) == "B"
    assert W.render("{{ trigger.missing | default:'none' }}", ctx) == "none"
    assert W.render({"a": ["{{ trigger.items[0].n }}"]}, ctx) == {"a": ["a"]}
    assert W._compare("1,500", "gt", "1000") and not W._compare("", "not_empty", None)
    assert W._where({"status": "open"}, "status == open") and not W._where({"n": 3}, "n > 5")


# ------------------------------------------------------------------ end to end
def _run_until(owner, rid, statuses, timeout=15):
    try:
        return _wait(owner, rid, statuses, timeout)
    except AssertionError:
        raise AssertionError(f"run {rid} still {owner.get(f'/api/workflow-runs/{rid}').json()}") from None


def _wait(owner, rid, statuses, timeout):
    return wait_for(lambda: (r := owner.get(f"/api/workflow-runs/{rid}").json())["status"] in statuses and r, timeout=timeout)


def test_build_run_and_ask_me(owner):
    graph = {"nodes": [
        N("t", "trigger.manual", {"sample": {"email": "Ann@Example.com", "amount": "2,500"}}),
        N("pick", "data.pick", {"fields": "email: {{ trigger.email | lower }}\namount: {{ trigger.amount | number }}"}),
        N("big", "logic.if", {"left": "{{ steps.pick.output.amount }}", "op": "gt", "right": "1000"}),
        N("ask", "logic.approval", {"title": "Big one from {{ steps.pick.output.email }}?"}),
        N("yes", "data.text", {"template": "approved {{ steps.pick.output.email }}"}),
        N("small", "data.text", {"template": "small"}),
    ], "edges": [E("t", "pick"), E("pick", "big"), E("big", "ask", "true"), E("big", "small", "false"), E("ask", "yes", "approved")]}
    assert owner.post("/api/workflows", json={"name": "Bad", "graph": {"nodes": []}}).status_code == 422
    wf = owner.post("/api/workflows", json={"name": "Big orders", "graph": graph}).json()
    assert wf["status"] == "draft" and not wf["uses_ai"] and wf["steps"] == 5

    run = owner.post(f"/api/workflows/{wf['id']}/run", json={}).json()
    assert run["trigger"] == "test"
    r = _run_until(owner, run["id"], ("waiting",))
    assert r["steps"]["pick"]["output"] == {"email": "ann@example.com", "amount": 2500.0}
    assert r["steps"]["big"]["port"] == "true" and "small" not in r["steps"]
    item = next(i for i in owner.get("/api/inbox").json() if i["kind"] == "workflow" and i["ref_id"].startswith(f"step:{run['id']}"))
    assert item["title"] == "Big one from ann@example.com?" and item["workflow"]["type"] == "approval"
    assert owner.post(f"/api/inbox/{item['id']}/dismiss").status_code == 409
    owner.post(f"/api/inbox/{item['id']}/decide", json={"decision": "approved"}).raise_for_status()
    r = _run_until(owner, run["id"], ("done", "failed"))
    assert r["status"] == "done", r
    assert r["steps"]["yes"]["output"]["text"] == "approved ann@example.com"

    # another input takes the other branch; no Inbox item
    run2 = owner.post(f"/api/workflows/{wf['id']}/run", json={"input": {"email": "b@x.io", "amount": 5}}).json()
    r2 = _run_until(owner, run2["id"], ("done", "failed"))
    assert r2["steps"]["small"]["output"]["text"] == "small" and "ask" not in r2["steps"]
    assert len(owner.get(f"/api/workflows/{wf['id']}/runs").json()) == 2


def test_risky_step_waits_for_ok(owner):
    graph = {"nodes": [N("t", "trigger.manual"), N("post", "app.http", {"method": "POST", "url": "http://127.0.0.1:9/nowhere", "body": {"a": 1}}),
                       N("after", "data.text", {"template": "after"})], "edges": [E("t", "post"), E("post", "after")]}
    wf = owner.post("/api/workflows", json={"name": "Risky", "graph": graph}).json()
    run = owner.post(f"/api/workflows/{wf['id']}/run", json={"input": {}}).json()
    r = _run_until(owner, run["id"], ("waiting",))
    assert r["waiting"]["kind"] == "gate"
    item = next(i for i in owner.get("/api/inbox").json() if i["ref_id"] == f"gate:{run['id']}:post")
    assert item["workflow"]["type"] == "gate"
    owner.post(f"/api/inbox/{item['id']}/decide", json={"decision": "rejected"}).raise_for_status()
    r = _run_until(owner, run["id"], ("done", "failed"))
    assert r["steps"]["post"]["status"] == "skipped" and "after" not in r["steps"]


def test_helper_job_step_and_failure(owner):
    graph = {"nodes": [N("t", "trigger.manual"), N("job", "ai.helper", {"staff_id": "marketing", "brief": "Write a tagline for {{ trigger.what }}"}),
                       N("out", "data.text", {"template": "{{ steps.job.output.status }}"})], "edges": [E("t", "job"), E("job", "out")]}
    wf = owner.post("/api/workflows", json={"name": "Tagline", "graph": graph}).json()
    assert wf["uses_ai"]
    run = owner.post(f"/api/workflows/{wf['id']}/run", json={"input": {"what": "anvils"}}).json()
    r = _run_until(owner, run["id"], ("done", "failed"), timeout=25)
    assert r["status"] == "done", r
    assert r["steps"]["out"]["output"]["text"] == "done" and r["ai_steps"] == 1
    task = owner.get(f"/api/tasks/{r['steps']['job']['output']['task_id']}").json()
    assert "anvils" in task["brief"]

    bad = owner.post("/api/workflows", json={"name": "Bad regex", "graph": {"nodes": [N("t", "trigger.manual"), N("rx", "data.regex", {"pattern": "("})],
                                                                          "edges": [E("t", "rx")]}}).json()
    r = _run_until(owner, owner.post(f"/api/workflows/{bad['id']}/run", json={}).json()["id"], ("done", "failed"))
    assert r["status"] == "failed" and "pattern" in r["error"]


def test_helper_proposes_and_runs_a_workflow(owner, base_url):
    tok = owner.mcp_tokens["marketing"]
    blocks = tool(base_url, tok, "workflow_blocks")
    assert "propose_workflow" in str(tool(base_url, tok, "whoami")) or blocks
    res = tool(base_url, tok, "propose_workflow", name="Weekly post log", description="Log each week's post", reason="I do this every Monday",
               graph={"nodes": [N("t", "trigger.manual"), N("d", "omilo.doc", {"path": "Marketing/Post log", "content": "- {{ trigger.post }}"})],
                      "edges": [E("t", "d")]})
    assert not res.get("isError"), res
    wid = res["structuredContent"]["workflow_id"] if "structuredContent" in res else None
    wfs = owner.get("/api/workflows").json()
    wf = next(w for w in wfs if w["name"] == "Weekly post log")
    assert wf["status"] == "pending" and wf["created_by"]["kind"] == "helper" and (wid in (None, wf["id"]))
    bad = tool(base_url, tok, "run_workflow", workflow_id=wf["id"])
    assert bad.get("isError"), "pending workflows can't run"
    item = next(i for i in owner.get("/api/inbox").json() if i["ref_id"] == f"wf:{wf['id']}")
    assert item["workflow"]["type"] == "proposal" and item["workflow"]["workflow"]["graph"]
    owner.post(f"/api/inbox/{item['id']}/decide", json={"decision": "approved"}).raise_for_status()
    assert owner.get(f"/api/workflows/{wf['id']}").json()["status"] == "active"
    assert any(w["id"] == wf["id"] for w in __import__("json").loads(tool(base_url, tok, "list_workflows")["content"][0]["text"])["workflows"])
    ok = tool(base_url, tok, "run_workflow", workflow_id=wf["id"], input={"post": "Anvils on sale"})
    assert not ok.get("isError"), ok
    rid = __import__("json").loads(ok["content"][0]["text"])["run_id"]
    r = _run_until(owner, rid, ("done", "failed"))
    assert r["status"] == "done", r
    assert "Anvils on sale" in owner.get("/api/vault/read", params={"path": "Marketing/Post log"}).json()["content"]

    bad = tool(base_url, tok, "propose_workflow", name="x", description="x", reason="x", graph={"nodes": [], "edges": []})
    assert bad.get("isError")


def test_marketplace_install_and_webhook(owner, base_url):
    market = owner.get("/api/workflows/market").json()
    assert len(market) >= 8 and all(m["graph"]["nodes"] for m in market)
    for m in market:
        r = owner.post(f"/api/workflows/market/{m['slug']}/install")
        assert r.status_code == 200, (m["slug"], r.text)
    gh = next(w for w in owner.get("/api/workflows").json() if w["source"] == "market:github-issues-digest")
    assert owner.get(f"/api/workflows/{gh['id']}").json()["graph"]["nodes"][1]["config"]["connector"] == ""  # no GitHub connector here

    inv = next(w for w in owner.get("/api/workflows").json() if w["source"] == "market:invoice-numbers")
    assert httpx.post(f"{base_url}/api/hooks/notatokenatall1234").status_code == 404
    full = owner.post(f"/api/workflows/{inv['id']}/activate").json()
    assert full["status"] == "active" and full["hook_path"].startswith("/api/hooks/")
    r = httpx.post(base_url + full["hook_path"], json={"text": "Pay INV-77 and INV-78 today"})
    assert r.status_code == 200, r.text
    run = _run_until(owner, r.json()["run_id"], ("done", "failed"))
    assert run["status"] == "done", run
    assert [m["invoice"] for m in run["steps"]["find"]["output"]] == ["INV-77", "INV-78"]
    assert "INV-77" in owner.get("/api/vault/read", params={"path": "Finance/Invoices"}).json()["content"]
    owner.post(f"/api/workflows/{inv['id']}/pause").raise_for_status()
    assert httpx.post(base_url + full["hook_path"], json={}).status_code == 404

    exp = owner.get(f"/api/workflows/{inv['id']}/export").json()
    imp = owner.post("/api/workflows/import", json={"data": exp}).json()
    assert imp["status"] == "draft" and imp["source"] == "import"
    assert owner.delete(f"/api/workflows/{imp['id']}").json()["ok"]


def test_patterns_and_build(owner):
    for _ in range(3):
        owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Check the CRM for new leads and summarize them"})
    pats = owner.get("/api/workflows/patterns").json()
    p = next(p for p in pats if p["staff"]["id"] == "sales")
    assert p["count"] >= 3
    b = owner.post("/api/workflows/build", json={"description": "Summarize new CRM leads each morning", "staff_id": "sales", "task_ids": p["task_ids"]}).json()
    t = owner.get(f"/api/tasks/{b['task_id']}").json()
    assert "propose_workflow" in t["brief"] and "CRM" in t["brief"]
    wait_for(lambda: owner.get(f"/api/tasks/{b['task_id']}").json()["status"] in ("done", "failed"), timeout=30)
    t = owner.get(f"/api/tasks/{b['task_id']}").json()
    assert t["status"] == "done", t.get("error")
    wf = wait_for(lambda: next((w for w in owner.get("/api/workflows").json() if w["created_by"]["id"] == "sales" and w["status"] == "pending"), None), timeout=20)
    assert wf["name"].startswith("Summarize new CRM leads")


STDIO_SERVER = r'''
import json, sys
for line in sys.stdin:
    m = json.loads(line)
    if "id" not in m:
        continue
    if m["method"] == "initialize":
        r = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "t", "version": "1"}}
    elif m["method"] == "tools/list":
        r = {"tools": [{"name": "add", "description": "Add", "inputSchema": {"type": "object", "properties": {"a": {}, "b": {}}}}]}
    else:
        a = m["params"]["arguments"]
        r = {"content": [{"type": "text", "text": json.dumps({"sum": a["a"] + a["b"]})}]}
    print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
'''


def test_connector_steps(owner, base_url, tmp_path):
    import sys

    tok = owner.mcp_tokens["support"]
    owner.post("/api/connectors", json={"id": "wf-self", "label": "Omilo itself", "url": f"{base_url}/mcp",
                                        "headers": {"Authorization": f"Bearer {tok}"}, "approval": "auto"}).raise_for_status()
    srv = tmp_path / "srv.py"
    srv.write_text(STDIO_SERVER)
    r = owner.post("/api/connectors", json={"id": "wf-calc", "label": "Calc", "kind": "stdio", "command": sys.executable, "args": [str(srv)],
                                            "approval": "ask"})
    assert r.status_code == 200, r.text
    tools = owner.get("/api/workflows/connector-tools/wf-calc").json()
    assert tools["tools"][0]["name"] == "add", tools
    assert "whoami" in [t["name"] for t in owner.get("/api/workflows/connector-tools/wf-self").json()["tools"]]

    graph = {"nodes": [N("t", "trigger.manual"), N("me", "app.connector", {"connector": "wf-self", "tool": "whoami", "args": {}}),
                       N("add", "app.connector", {"connector": "wf-calc", "tool": "add", "args": {"a": "{{ trigger.a }}", "b": 2}})],
             "edges": [E("t", "me"), E("me", "add")]}
    wf = owner.post("/api/workflows", json={"name": "Connectors", "graph": graph}).json()
    run = owner.post(f"/api/workflows/{wf['id']}/run", json={"input": {"a": 40}}).json()
    r = _run_until(owner, run["id"], ("waiting",), timeout=30)  # the calc connector asks first
    assert r["steps"]["me"]["output"]["id"] == "support"
    item = next(i for i in owner.get("/api/inbox").json() if i["ref_id"] == f"gate:{run['id']}:add")
    owner.post(f"/api/inbox/{item['id']}/decide", json={"decision": "approved"}).raise_for_status()
    r = _run_until(owner, run["id"], ("done", "failed"), timeout=30)
    assert r["status"] == "done", r
    assert r["steps"]["add"]["output"] == {"sum": 42}
