"""Loop engineering: lessons from your decisions, run logs, memory tools, the retro's measured self-improvement,
automatic retries, and Hermes helpers moved to Claude Code."""
import datetime as dt
import json
import os
import sys
from pathlib import Path

import httpx
from conftest import wait_for


def tool(base_url, token, name, **args):
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {token}"},
                   json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["result"]


def test_decisions_become_lessons_and_runs_read_them(base_url, owner):
    from omilo_api import memory as M
    from omilo_api.db import session_scope
    from omilo_api.models import Staff

    tok = owner.mcp_tokens["marketing"]
    p = tool(base_url, tok, "propose", title="Post: 50% off everything", type="content.publish", risk="medium", body="Big sale!!! 🎉🎉")
    pid = p["structuredContent"]["proposal_id"]
    r = owner.post(f"/api/proposals/{pid}/decide", json={"decision": "reject", "note": "No discounts above 20%, and no emojis in posts."})
    assert r.status_code == 200, r.text

    doc = owner.get("/api/vault/read", params={"path": "Memory/marketing/Lessons.md"}).json()
    assert "No discounts above 20%" in doc["content"] and "Rejected “Post: 50% off everything”" in doc["content"]
    assert doc["updated_by"]["kind"] == "agent"
    idx = owner.get("/api/vault/read", params={"path": "Memory/Index.md"}).json()
    assert "Memory/marketing/Lessons" in idx["content"]
    g = owner.get("/api/vault/graph").json()
    assert any(e["source"] == "Memory/Index.md" and e["target"] == "Memory/marketing/Lessons.md" for e in g["edges"]), "memory shows in the graph"

    # the owner edits a lesson in Docs: helpers follow the edited version
    edited = doc["content"].replace("No discounts above 20%", "No discounts above 15%")
    owner.put("/api/vault/write", json={"path": "Memory/marketing/Lessons.md", "content": edited, "base_version": doc["version"]})
    with session_scope() as db:
        brief = M.brief_for(db, db.get(Staff, "marketing"))
    assert "No discounts above 15%" in brief and "rejected" in brief.lower() and "Post: 50% off everything" in brief

    # a second identical note is not added twice
    p2 = tool(base_url, tok, "propose", title="Another sale", type="content.publish", risk="medium", body="…")["structuredContent"]["proposal_id"]
    owner.post(f"/api/proposals/{p2}/decide", json={"decision": "reject", "note": "No discounts above 15%, and no emojis in posts."})
    assert owner.get("/api/vault/read", params={"path": "Memory/marketing/Lessons.md"}).json()["content"].count("above 15%") == 1


def test_memory_tools_remember_and_recall(base_url, owner):
    tok = owner.mcp_tokens["marketing"]
    r = tool(base_url, tok, "remember", text="Instagram posts do best at 19:00 WIB on weekdays.", title="Posting times")
    assert r["structuredContent"]["saved_in"] == "Memory/marketing/Posting times.md"
    tool(base_url, tok, "remember", text="The owner likes short captions.")
    notes = owner.get("/api/vault/read", params={"path": "Memory/marketing/Notes.md"}).json()["content"]
    assert "short captions" in notes and "[[Memory/marketing/Posting times|Posting times]]" in notes
    hits = tool(base_url, tok, "recall", query="instagram posting", memory_only=True)["structuredContent"]["results"]
    assert hits and hits[0]["path"] == "Memory/marketing/Posting times.md" and "19:00" in hits[0]["snippet"]
    # prefix and ranked search over all Docs
    owner.put("/api/vault/write", json={"path": "Projects/Catering menu", "content": "# Catering menu\nNasi kotak for offices."})
    found = owner.get("/api/vault/search", params={"q": "cater"}).json()
    assert found[0]["path"] == "Projects/Catering menu.md"


def test_retro_reviews_improves_measures_and_rolls_back(base_url, owner):
    from omilo_api import loops as L
    from omilo_api.db import session_scope
    from omilo_api.models import Improvement, Shift, Staff, Task, now

    chief, mkt = owner.mcp_tokens["chief-of-staff"], owner.mcp_tokens["marketing"]
    week = tool(base_url, chief, "review_week")["structuredContent"]
    assert {h["id"] for h in week["helpers"]} >= {"marketing", "chief-of-staff"} and week["allowed_this_week"] == 3
    assert any(sh["name"] == "weekly-retro" for h in week["helpers"] for sh in h["shifts"]), "the retro loop exists"
    m = next(h for h in week["helpers"] if h["id"] == "marketing")
    assert any("No discounts" in d["note"] for d in m["decisions"]) and "15%" in m["lessons"]

    assert tool(base_url, mkt, "improve", staff_id="marketing", kind="job", change="x", reason="y")["isError"], "only the Chief"
    with session_scope() as db:
        old_job = db.get(Staff, "marketing").job
    new_job = old_job + "\nNever offer discounts above 15%. Write captions without emojis."
    r = tool(base_url, chief, "improve", staff_id="marketing", kind="job", change=new_job, reason="2 posts rejected for discounts and emojis")
    iid = r["structuredContent"]["improvement_id"]
    with session_scope() as db:
        assert db.get(Staff, "marketing").job == new_job
    imps = owner.get("/api/improvements").json()
    assert imps[0]["id"] == iid and imps[0]["status"] == "active" and imps[0]["staff"] == "Marketing"
    retro = owner.get("/api/vault/read", params={"path": L.M.retro_path()}).json()["content"]
    assert "Changed: instructions of Marketing" in retro and "2 posts rejected" in retro

    # undo puts the old instructions back
    assert owner.post(f"/api/improvements/{iid}/undo").json()["status"] == "undone"
    with session_scope() as db:
        assert db.get(Staff, "marketing").job == old_job

    # a change that makes results worse is rolled back automatically after a week
    with session_scope() as db:
        sh = next(s for s in db.get(Staff, "marketing").shifts)
        sid, old_brief = sh.id, sh.brief
    r = tool(base_url, chief, "improve", staff_id="marketing", kind="shift_brief", shift_id=sid, change="Only post memes.", reason="try something new")
    iid2 = r["structuredContent"]["improvement_id"]
    with session_scope() as db:
        imp = db.get(Improvement, iid2)
        imp.baseline = {**imp.baseline, "success": 100, "runs": 5}
        imp.created_at = now() - dt.timedelta(days=8)
        for i in range(3):
            db.add(Task(staff_id="marketing", origin="shift", brief="b", status="failed", shift_id=sid, error="bad",
                        created_at=now() - dt.timedelta(days=7 - i), ended_at=now() - dt.timedelta(days=7 - i)))
        db.commit()
        L.evaluate(db)
        assert db.get(Improvement, iid2).status == "rolled_back"
        assert db.get(Shift, sid).brief == old_brief

    # at most three a week
    for k in range(3):
        tool(base_url, chief, "improve", staff_id="marketing", kind="shift_schedule", shift_id=sid, change=f"{k} 9 * * 1", reason="test")
    over = tool(base_url, chief, "improve", staff_id="marketing", kind="shift_schedule", shift_id=sid, change="5 9 * * 1", reason="test")
    assert over["isError"] and "at most 3" in over["structuredContent"]["error"]

    # scorecard per loop
    loops = owner.get("/api/loops").json()["loops"]
    row = next(x for x in loops if x["shift_id"] == sid)
    assert row["runs"] >= 3 and row["failed"] >= 3 and row["stalled"] and row["log"].startswith("Memory/Loops/marketing")


def test_retro_run_writes_the_loop_log(base_url, owner):
    t = owner.post("/api/loops/retro").json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['task_id']}").json())["status"] in ("done", "failed") and x, timeout=20)
    assert done["status"] == "done"
    log = wait_for(lambda: owner.get("/api/vault/read", params={"path": "Memory/Loops/chief-of-staff · weekly-retro.md"}).json().get("content"))
    assert "✓ done" in log and "[[Memory/chief-of-staff/Lessons" in log


def test_transient_errors_are_retried():
    from omilo_api import loops as L

    assert L.transient("ConnectError: All connection attempts failed")
    assert L.transient("Claude Code: Request timed out")
    assert not L.transient("usage limit reached (timed out)")
    assert not L.transient("no MCP token for this helper")


def test_claude_code_runs_with_the_api_key(owner, tmp_path):
    wrapper = tmp_path / "claude"
    wrapper.write_text(f"#!/bin/sh\nexec {sys.executable} {Path(__file__).parent / 'bin' / 'fake_claude.py'} \"$@\"\n")
    wrapper.chmod(0o755)
    log = tmp_path / "calls.jsonl"
    os.environ["OMILO_CLAUDE_BIN"], os.environ["FAKE_CLAUDE_LOG"] = str(wrapper), str(log)
    try:
        r = owner.post("/api/ai", json={"provider": "claude", "api_key": "sk-ant-api03-" + "k" * 30 + "KEY123", "model": "claude-sonnet-5-5",
                                        "staff_ids": ["support"]})
        assert r.status_code == 200, r.text
        assert r.json()["staff"]["support"]["provider"] == "claude"
        t = owner.post("/api/tasks", json={"staff_id": "support", "brief": "Summarise open tickets"}).json()
        done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=30)
        assert done["status"] == "done", done
        call = json.loads(log.read_text().splitlines()[-1])
        # api-key runs share the pool's config dir (…/harness/config) so "auto" can resume a session across pool↔key
        assert call["api_key"] == "KEY123" and call["token"] == "" and call["cfgdir"].endswith("/config")
    finally:
        os.environ.pop("OMILO_CLAUDE_BIN", None)
        owner.post("/api/ai", json={"provider": "fake", "staff_ids": ["support"]})


def test_hermes_helpers_move_to_claude_code(tmp_path):
    from conftest import DB_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from omilo_api.db import Base, _migrate
    from omilo_api.models import Staff

    boot = create_engine(DB_URL)
    with boot.begin() as c:
        c.exec_driver_sql('CREATE SCHEMA IF NOT EXISTS "co_hermes_test"')
    boot.dispose()
    eng = create_engine(DB_URL, connect_args={"options": "-csearch_path=co_hermes_test,public"})
    Base.metadata.create_all(eng)
    with Session(eng) as db:
        db.add(Staff(id="dev", name="Dev", engine={"type": "hermes", "managed": True, "port": 8650, "claude_model": "claude-opus-5-5", "timeout_s": 900}))
        db.add(Staff(id="ops", name="Ops", engine={"type": "hermes", "base_url": "http://x/v1", "model": "hermes-agent"}))
        db.commit()
    _migrate(eng)
    with Session(eng) as db:
        assert db.get(Staff, "dev").engine == {"type": "claude-code", "auth": "auto", "model": "claude-opus-5-5", "timeout_s": 900}
        assert db.get(Staff, "ops").engine == {"type": "claude-code", "auth": "auto"}
