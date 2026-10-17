"""The knowledge base: docs, jobs, chats, files and saved pages become searchable chunks (words right away, meaning once
embedded); helpers search it with recall and add to it with kb_add; every search is logged; the map and related views."""
import base64
import json
import sqlite3

import httpx
from conftest import wait_for
from test_flows import tool

from saga_api import kb


def _payload(res):
    return res.get("structuredContent") or json.loads(res["content"][0]["text"])


def test_chunking_keeps_headings_and_size():
    text = "# Pricing\n\n" + ("Anvils cost Rp 50.000 each. " * 60) + "\n\n## Delivery\n\nWe ship to Bandung and Jakarta."
    parts = kb.chunk(text)
    assert len(parts) >= 3 and all(len(t) <= kb.CHUNK + 50 for _, t in parts)
    assert parts[0][0] == "Pricing" and "Delivery:\nWe ship to Bandung and Jakarta." in parts[-1][1]
    assert kb.html_text("<html><title>T</title><script>x()</script><main><h2>Hi</h2><p>Body text</p></main></html>") == ("T", "## Hi\n\nBody text")


def test_docs_jobs_and_search(owner):
    owner.put("/api/vault/write", json={"path": "Sales/Churn notes", "content": "# Churn notes\n\nCustomers leave when delivery is late. "
                                                                               "Pelanggan berhenti kalau pengiriman terlambat."})
    src = wait_for(lambda: next((s for s in owner.get("/api/kb/sources", params={"kind": "doc"}).json()["sources"] if s["ref"] == "Sales/Churn notes.md"), None))
    assert src["chunks"] >= 1
    wait_for(lambda: owner.get(f"/api/kb/sources/{src['id']}").json()["status"] == "ready", timeout=20)
    res = owner.get("/api/kb/search", params={"q": "why do customers leave", "project": "true"}).json()
    assert res["mode"] == "hybrid" and res["results"][0]["ref"] == "Sales/Churn notes.md"
    assert res["results"][0]["meaning"] is not None
    # a finished job is knowledge too
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Summarize late delivery complaints"}).json()["id"]
    wait_for(lambda: owner.get(f"/api/tasks/{t}").json()["status"] in ("done", "failed"), timeout=30)
    job = wait_for(lambda: next((s for s in owner.get("/api/kb/sources", params={"kind": "job"}).json()["sources"] if s["ref"] == t), None), timeout=20)
    assert "late delivery" in job["title"]
    st = owner.get("/api/kb/stats").json()
    assert st["sources"] >= 2 and st["embedder"]["provider"] == "hash" and any(k["kind"] == "job" and k["count"] for k in st["by_kind"])
    # editing the doc replaces its chunks; deleting it removes the source
    owner.put("/api/vault/write", json={"path": "Sales/Churn notes", "content": "# Churn notes\n\nNow mostly price."})
    full = owner.get(f"/api/kb/sources/{src['id']}").json()
    assert "price" in full["chunk_list"][0]["text"]
    assert owner.delete(f"/api/kb/sources/{src['id']}").status_code == 409, "doc sources go with their doc"


def test_helpers_add_and_recall(owner, base_url):
    tok = owner.mcp_tokens["marketing"]
    r = _payload(tool(base_url, tok, "kb_add", title="Competitor price list", text="PT Besi Jaya sells anvils at Rp 45.000. Free shipping above 10.",
                      url="https://example.com/besi-jaya"))
    assert r["chunks"] == 1
    again = _payload(tool(base_url, tok, "kb_add", title="Competitor price list", text="PT Besi Jaya now sells anvils at Rp 47.000.",
                          url="https://example.com/besi-jaya"))
    assert again["source_id"] == r["source_id"], "same source updates"
    hits = _payload(tool(base_url, tok, "recall", query="competitor anvil price", task_id=""))["results"]
    assert hits[0]["title"] == "Competitor price list" and "47.000" in hits[0]["text"] and hits[0]["kind"] == "web"
    qs = owner.get("/api/kb/queries").json()
    assert qs[0]["who"] == "marketing" and qs[0]["query"] == "competitor anvil price" and qs[0]["results"][0]["source_id"] == r["source_id"]
    detail = owner.get(f"/api/kb/sources/{r['source_id']}").json()
    assert detail["retrieved"] and detail["retrieved"][0]["who"] == "marketing"


def test_files_notes_web_map_and_settings(owner):
    txt = base64.b64encode(b"Opening hours: 08:00-17:00 WIB, closed on Sunday.").decode()
    f = owner.post("/api/kb/files", json={"name": "hours.txt", "data": txt}).json()
    assert f["kind"] == "file" and f["url"].startswith("/api/files/")
    bad = owner.post("/api/kb/files", json={"name": "photo.png", "data": base64.b64encode(b"\x89PNG....").decode()})
    assert bad.status_code == 400
    n = owner.post("/api/kb/notes", json={"title": "Return policy", "text": "Returns within 7 days with the receipt."}).json()
    assert n["kind"] == "note"
    assert owner.post("/api/kb/web", json={"url": "http://127.0.0.1:9/x"}).status_code == 400, "no local addresses"
    res = owner.get("/api/kb/search", params={"q": "when are you open on sunday"}).json()
    hit = res["results"][0]
    assert hit["source_id"] == f["id"]
    wait_for(lambda: owner.get("/api/kb/stats").json()["pending"] == 0, timeout=20)
    m = owner.get("/api/kb/map").json()
    assert len(m["points"]) >= 3 and all(-1.01 <= p["x"] <= 1.01 for p in m["points"]) and m["sources"]
    rel = owner.get(f"/api/kb/sources/{n['id']}").json()["related"]
    assert isinstance(rel, list)
    s = owner.get("/api/kb/settings").json()
    assert s["current"]["provider"] == "hash" and "local" in s["providers"]
    assert owner.put("/api/kb/settings", json={"provider": "voyage"}).status_code == 400, "a key is needed"
    assert owner.post("/api/kb/reindex").json()["chunks"] >= 3
    wait_for(lambda: owner.get("/api/kb/stats").json()["pending"] == 0, timeout=20)


def test_workflow_knowledge_steps(owner):
    graph = {"nodes": [{"id": "t", "type": "trigger.manual", "config": {}},
                       {"id": "save", "type": "saga.kb_save", "config": {"title": "Supplier {{ trigger.name }}", "text": "{{ trigger.terms }}",
                                                                         "source": "crm:supplier:{{ trigger.name }}", "kind": "connector"}},
                       {"id": "find", "type": "saga.kb_search", "config": {"query": "payment terms supplier", "limit": 3}}],
             "edges": [{"from": "t", "to": "save"}, {"from": "save", "to": "find"}]}
    wf = owner.post("/api/workflows", json={"name": "Supplier knowledge", "graph": graph}).json()
    run = owner.post(f"/api/workflows/{wf['id']}/run", json={"input": {"name": "Baja Prima", "terms": "Payment terms: 30 days net."}}).json()
    r = wait_for(lambda: (x := owner.get(f"/api/workflow-runs/{run['id']}").json())["status"] in ("done", "failed") and x, timeout=20)
    assert r["status"] == "done", r
    assert r["steps"]["find"]["output"]["results"][0]["title"] == "Supplier Baja Prima"


def test_old_sqlite_data_moves_in(owner, base_url):
    """A company that was a SQLite file before 0.4 is copied into Postgres once."""
    from saga_api import company as C
    from saga_api import import_sqlite as I

    cid = owner.post("/api/companies", json={"name": "Old Toko"}).json()["id"]
    owner.cookies.clear()
    f = C.dir_for(cid) / "saga.db"
    con = sqlite3.connect(f)
    con.execute("CREATE TABLE staff (id VARCHAR PRIMARY KEY, name VARCHAR, role VARCHAR, is_chief BOOLEAN, job TEXT, engine JSON, permissions JSON, "
                "budget_usd_month FLOAT, max_task_minutes INTEGER, status VARCHAR, created_at DATETIME, updated_at DATETIME)")
    con.execute("INSERT INTO staff VALUES ('kasir', 'Kasir', 'support', 0, 'Answers', '{\"type\": \"fake\"}', '{}', 0, 30, 'active', "
                "'2026-09-01 10:00:00.000000', '2026-09-01 10:00:00.000000')")
    con.execute("CREATE TABLE setting (key VARCHAR PRIMARY KEY, value JSON)")
    con.execute("INSERT INTO setting VALUES ('company_name', '\"Old Toko\"')")
    con.commit()
    con.close()
    with C.use(cid):
        counts = I.import_company(cid)
        assert counts and counts["staff"] == 1
        assert I.import_company(cid) is None, "only once"
    co = httpx.Client(base_url=base_url, timeout=20, headers={**owner.headers, "X-Saga-Company": cid})
    assert [s["id"] for s in co.get("/api/staff").json()] == ["kasir"]
    owner.patch(f"/api/companies/{cid}", json={"archived": True})
