"""Connectors, folders on this computer, skills, attached files, per-chat choices, and how Claude Code runs use them."""
import base64
import json
import os
from pathlib import Path

from conftest import wait_for

from omilo_api.capabilities import Resources
from omilo_api.engines.claude_code import plan


def test_connectors_folders_skills_files(owner, base_url, tmp_path):
    tok = owner.mcp_tokens["support"]
    bad = owner.post("/api/connectors", json={"id": "Bad Id", "url": "x"})
    assert bad.status_code == 400
    c = owner.post("/api/connectors", json={"id": "own-system", "label": "Our system", "url": f"{base_url}/mcp",
                                            "headers": {"Authorization": f"Bearer {tok}"}, "approval": "ask"}).json()
    assert c["header_names"] == ["Authorization"] and tok not in json.dumps(owner.get("/api/connectors").json())
    t = owner.post("/api/connectors/own-system/test").json()
    assert t["ok"] and "report" in t["tools"]

    proj = tmp_path / "my-app"
    proj.mkdir()
    assert owner.post("/api/folders", json={"path": str(Path.home())}).status_code == 400
    assert owner.post("/api/folders", json={"path": str(tmp_path / "nope")}).status_code == 400
    f = owner.post("/api/folders", json={"path": str(proj), "access": "write", "commands": True}).json()
    fs = owner.get("/api/fs", params={"path": str(tmp_path)}).json()
    assert "my-app" in fs["dirs"] and fs["parent"]

    sk = owner.post("/api/skills", json={"slug": "brand-voice", "name": "Brand voice", "description": "How we write", "body": "Warm. Short."}).json()
    assert sk["body"] == "Warm. Short." and any(s["slug"] == "brand-voice" for s in owner.get("/api/skills").json())

    up = owner.post("/api/files", json={"name": "menu.txt", "data": base64.b64encode(b"Nasi box 35k").decode()}).json()
    assert up["mime"] == "text/plain" and owner.get(f"/api/files/{up['id']}").content == b"Nasi box 35k"

    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "support"}).json()
    tools = owner.get(f"/api/threads/{th['id']}/tools").json()
    assert "own-system" in tools["connectors"]["on"] and f["id"] not in tools["folders"]["on"]  # folders are off by default
    tools = owner.put(f"/api/threads/{th['id']}/tools", json={"folders": [f["id"]], "skills": ["brand-voice"]}).json()
    assert tools["folders"]["on"] == [f["id"]] and tools["skills"]["on"] == ["brand-voice"]

    from omilo_api.capabilities import resolve
    from omilo_api.db import session_scope
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "see the menu", "blocks": [{"type": "file", **up}]})
    with session_scope() as db:
        r = resolve(db, thread_id=th["id"])
    assert [x["path"] for x in r.folders] == [str(proj.resolve())]
    assert [x["id"] for x in r.connectors] == ["own-system"] and r.skills[0]["name"] == "Brand voice"
    assert r.files and r.files[0]["name"] == "menu.txt"
    note = r.note()
    assert "read and write, terminal commands allowed" in note and "request_action(action='connector.own-system'" in note
    assert "Warm. Short." in note and "menu.txt" in note
    for x in ("own-system",):
        owner.delete(f"/api/connectors/{x}")
    owner.delete(f"/api/folders/{f['id']}")
    owner.delete("/api/skills/brand-voice")


def test_claude_code_plan():
    cfg = {"_mcp_url": "http://x/mcp", "_mcp_token": "t"}
    r = Resources(
        folders=[{"path": "/w/app", "access": "write", "commands": True}, {"path": "/w/docs", "access": "read", "commands": False}],
        connectors=[{"id": "gmail", "label": "Gmail", "kind": "http", "url": "https://g/mcp", "headers": {"A": "b"}, "env": {}, "args": [], "command": "", "approval": "ask"},
                    {"id": "notes", "label": "Notes", "kind": "stdio", "url": "", "headers": {}, "env": {"K": "v"}, "args": ["-y"], "command": "npx", "approval": "auto"}],
        files=[{"id": "fil_1", "name": "a.png", "mime": "image/png", "path": "/data/files/fil_1/a.png"}])
    servers, tools, extra = plan(cfg, r)
    assert set(servers) == {"omilo", "gmail", "notes"} and servers["notes"]["command"] == "npx"
    assert "mcp__notes" in tools and "mcp__gmail" not in tools and "Bash" in tools
    assert "Bash(git push:*)" in extra and "Bash(rm:*)" in extra
    assert extra[extra.index("--add-dir") + 1] == "/w/app" and "/w/docs" in extra and "/data/files/fil_1" in extra
    assert "Edit(//w/docs/**)" in extra and "Edit(//w/app/**)" not in extra
    r.allow_connectors.add("gmail")  # an approved connector.gmail proposal being executed
    assert "mcp__gmail" in plan(cfg, r)[1]
    servers, tools, extra = plan(cfg, None)
    assert set(servers) == {"omilo"} and "Bash" not in tools and extra == []


def test_pool_run_in_project_folder(owner, tmp_path):
    import sys
    wrapper = tmp_path / "claude"
    wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {Path(__file__).parent / 'bin' / 'fake_claude.py'} \"$@\"\n")
    wrapper.chmod(0o755)
    log = tmp_path / "calls.jsonl"
    os.environ["OMILO_CLAUDE_BIN"], os.environ["FAKE_CLAUDE_LOG"] = str(wrapper), str(log)
    try:
        proj = tmp_path / "shop-web"
        proj.mkdir()
        f = owner.post("/api/folders", json={"path": str(proj), "access": "write", "commands": True, "default_on": True}).json()
        a = owner.post("/api/harness/accounts", json={"label": "Dev", "token": "sk-ant-oat01-" + "d" * 30 + "GOOD99"}).json()
        owner.post("/api/ai", json={"provider": "claude-code", "staff_ids": ["dev"]})
        t = owner.post("/api/tasks", json={"staff_id": "dev", "brief": "Fix the footer"}).json()
        done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=30)
        assert done["status"] == "done", done
        call = json.loads(log.read_text().splitlines()[-1])
        assert Path(call["cwd"]).resolve() == proj.resolve(), "develops inside the owner's project folder"
        assert "--add-dir" in call["argv"] and "Bash" in call["argv"]
        assert str(proj.resolve()) in call["system"]
    finally:
        os.environ.pop("OMILO_CLAUDE_BIN", None)
        os.environ.pop("FAKE_CLAUDE_LOG", None)
        owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["dev"]})
        owner.delete(f"/api/folders/{f['id']}")
        owner.delete(f"/api/harness/accounts/{a['id']}")


def test_share_file_previews_and_health(owner, base_url, tmp_path):
    import httpx

    proj = tmp_path / "share"
    proj.mkdir()
    (proj / "report.csv").write_text("a,b\n1,2\n")
    (proj / "page.html").write_text("<script>alert(1)</script>")
    (tmp_path / "secret.txt").write_text("nope")
    fid = owner.post("/api/folders", json={"path": str(proj), "access": "read"}).json()["id"]

    # files in a shared folder can be previewed; html is served as text; files outside are refused
    r = owner.get("/api/fs/file", params={"path": str(proj / "report.csv")})
    assert r.status_code == 200 and r.text.startswith("a,b") and r.headers["content-disposition"].startswith("inline")
    r = owner.get("/api/fs/file", params={"path": str(proj / "page.html")})
    assert r.headers["content-type"].startswith("text/plain") and r.headers["x-content-type-options"] == "nosniff"
    assert owner.get("/api/fs/file", params={"path": str(proj / "report.csv"), "download": True}).headers["content-disposition"].startswith("attachment")
    assert owner.get("/api/fs/file", params={"path": str(tmp_path / "secret.txt")}).status_code == 404
    assert owner.get("/api/fs/file", params={"path": str(proj / ".." / "secret.txt")}).status_code == 404

    # a helper shares a file from the folder into a task thread: it lands as a file block
    tok = owner.mcp_tokens["support"]
    t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Make the report"}).json()

    def call(args):
        return httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"}, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "share_file", "arguments": args}}).json()["result"]

    r = call({"task_id": t["id"], "path": str(proj / "report.csv"), "note": "The report"})
    assert not r["isError"], r
    out = r["structuredContent"]
    th = owner.get(f"/api/threads/{out['thread_id']}").json()
    msg = [m for m in th["messages"] if m["id"] == out["message_id"]][0]
    f = [b for b in msg["blocks"] if b["type"] == "file"][0]
    assert f["name"] == "report.csv" and f["mime"] == "text/csv"
    assert owner.get(f"/api/files/{f['id']}").text == "a,b\n1,2\n"
    assert call({"task_id": t["id"], "path": str(tmp_path / "secret.txt")})["isError"]

    # connector health: a command that is not installed is reported, and shows up in the chat box tools
    owner.post("/api/connectors", json={"id": "nothere", "label": "Nothere", "kind": "stdio", "command": "definitely-not-installed-xyz"})
    h = owner.post("/api/connectors/check").json()
    assert h["nothere"]["ok"] is False and "not installed" in h["nothere"]["detail"]
    master = owner.post("/api/threads", json={"scope": "master"}).json()
    conns = owner.get(f"/api/threads/{master['id']}/tools").json()["connectors"]["all"]
    assert [c for c in conns if c["id"] == "nothere"][0]["health"]["ok"] is False
    owner.delete("/api/connectors/nothere")
    owner.delete(f"/api/folders/{fid}")
