"""Docs: vault notes with links, versions, conflicts, outside edits, helper edits and suggestions."""
import httpx

from saga_api import docs as D


def _mcp(base_url, tok, name, args):
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"},
                   json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}).json()
    return r["result"]


def test_docs_vault_links_versions_and_agents(owner, base_url):
    tree = owner.get("/api/vault").json()
    paths = {d["path"] for d in tree["docs"]}
    assert "Welcome.md" in paths and any(p.startswith("Company/") for p in paths)

    r = owner.put("/api/vault/write", json={"path": "Projects/Launch plan", "content": "# Launch\nSee [[Welcome]] and [[Nowhere yet]].", "summary": "first draft"})
    assert r.status_code == 200 and r.json()["version"] == 1 and r.json()["path"] == "Projects/Launch plan.md"
    d = owner.get("/api/vault/read", params={"path": "Projects/Launch plan.md"}).json()
    assert {(x["target"], x["path"]) for x in d["links"]} == {("Welcome", "Welcome.md"), ("Nowhere yet", None)}
    w = owner.get("/api/vault/read", params={"path": "Welcome.md"}).json()
    assert any(b["path"] == "Projects/Launch plan.md" for b in w["backlinks"])

    # stale save -> conflict with the current text
    owner.put("/api/vault/write", json={"path": "Projects/Launch plan.md", "content": "# Launch v2", "base_version": 1})
    r = owner.put("/api/vault/write", json={"path": "Projects/Launch plan.md", "content": "# my old edit", "base_version": 1})
    assert r.status_code == 409 and r.json()["detail"]["current"]["version"] == 2

    # edited outside Saga OS (e.g. in Obsidian) -> recorded as an outside version
    D.file_for("Projects/Launch plan.md").write_text("# Launch v3 from Obsidian")
    d = owner.get("/api/vault/read", params={"path": "Projects/Launch plan.md"}).json()
    assert d["version"] == 3 and d["updated_by"]["kind"] == "outside"
    hist = owner.get("/api/vault/history", params={"path": "Projects/Launch plan.md"}).json()
    assert [h["version"] for h in hist] == [3, 2, 1]
    assert owner.get("/api/vault/version", params={"path": "Projects/Launch plan.md", "version": 1}).json()["content"].startswith("# Launch\nSee")

    # a helper edits a shared doc directly (do and tell): versioned, and the owner gets a notice
    tok = owner.mcp_tokens["marketing"]
    res = _mcp(base_url, tok, "docs_write", {"path": "Projects/Campaign notes", "content": "Ideas for [[Launch plan]]", "summary": "kickoff ideas"})
    assert not res["isError"] and res["structuredContent"]["version"] == 1
    d = owner.get("/api/vault/read", params={"path": "Projects/Campaign notes.md"}).json()
    assert d["updated_by"] == {"kind": "agent", "id": "marketing", "name": d["updated_by"]["name"]}
    assert any(n["kind"] == "doc" and "Campaign notes" in n["title"] for n in owner.get("/api/notices").json())
    found = _mcp(base_url, tok, "docs_search", {"query": "campaign"})["structuredContent"]["results"]
    assert found and found[0]["path"] == "Projects/Campaign notes.md"
    stale = _mcp(base_url, tok, "docs_write", {"path": "Projects/Launch plan", "content": "x", "base_version": 1})
    assert stale["structuredContent"]["conflict"] is True

    # company knowledge: the helper's change is a suggestion until the owner approves
    company = [p for p in paths if p.startswith("Company/")][0]
    before = owner.get("/api/vault/read", params={"path": company}).json()["content"]
    res = _mcp(base_url, tok, "docs_write", {"path": company, "content": before + "\n\nWe also sell to roadrunners.", "summary": "new segment"})
    pid = res["structuredContent"]["proposal_id"]
    assert owner.get("/api/vault/read", params={"path": company}).json()["content"] == before
    assert owner.get("/api/vault/read", params={"path": company}).json()["suggestions"]
    owner.post(f"/api/proposals/{pid}/decide", json={"decision": "approve", "note": ""})
    after = owner.get("/api/vault/read", params={"path": company}).json()
    assert "roadrunners" in after["content"] and after["updated_by"]["kind"] == "agent" and not after["suggestions"]

    # rename keeps links working; graph shows notes, links and the missing note
    r = owner.post("/api/vault/move", json={"path": "Projects/Launch plan.md", "to": "Projects/Go-live plan.md"}).json()
    assert r["links_updated"] >= 1
    assert "[[Go-live plan]]" in owner.get("/api/vault/read", params={"path": "Projects/Campaign notes.md"}).json()["content"]
    g = owner.get("/api/vault/graph").json()
    ids = {n["id"] for n in g["nodes"]}
    assert "Projects/Go-live plan.md" in ids and {"source": "Projects/Campaign notes.md", "target": "Projects/Go-live plan.md"} in g["edges"]

    # bad names and deletes
    assert owner.put("/api/vault/write", json={"path": "../etc/passwd", "content": "x"}).status_code == 400
    assert owner.post("/api/vault/delete", json={"path": "Projects/Campaign notes.md"}).json()["ok"]
    assert owner.get("/api/vault/read", params={"path": "Projects/Campaign notes.md"}).status_code == 404
