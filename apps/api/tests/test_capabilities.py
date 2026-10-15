"""Connectors, folders on this computer, skills, attached files, per-chat choices, and how Claude Code runs use them."""
import base64
import json
import os
from pathlib import Path

from conftest import wait_for

from saga_api.capabilities import Resources
from saga_api.engines.claude_code import plan


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

    from saga_api.capabilities import resolve
    from saga_api.db import session_scope
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
    assert set(servers) == {"saga-os", "gmail", "notes"} and servers["notes"]["command"] == "npx"
    assert "mcp__notes" in tools and "mcp__gmail" not in tools and "Bash" in tools
    assert "Bash(git push:*)" in extra and "Bash(rm:*)" in extra
    assert extra[extra.index("--add-dir") + 1] == "/w/app" and "/w/docs" in extra and "/data/files/fil_1" in extra
    assert "Edit(//w/docs/**)" in extra and "Edit(//w/app/**)" not in extra
    r.allow_connectors.add("gmail")  # an approved connector.gmail proposal being executed
    assert "mcp__gmail" in plan(cfg, r)[1]
    servers, tools, extra = plan(cfg, None)
    assert set(servers) == {"saga-os"} and "Bash" not in tools and extra == []


def test_pool_run_in_project_folder(owner, tmp_path):
    import sys
    wrapper = tmp_path / "claude"
    wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {Path(__file__).parent / 'bin' / 'fake_claude.py'} \"$@\"\n")
    wrapper.chmod(0o755)
    log = tmp_path / "calls.jsonl"
    os.environ["SAGA_CLAUDE_BIN"], os.environ["FAKE_CLAUDE_LOG"] = str(wrapper), str(log)
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
        os.environ.pop("SAGA_CLAUDE_BIN", None)
        os.environ.pop("FAKE_CLAUDE_LOG", None)
        owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["dev"]})
        owner.delete(f"/api/folders/{f['id']}")
        owner.delete(f"/api/harness/accounts/{a['id']}")
