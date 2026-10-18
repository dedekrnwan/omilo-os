"""Helpers that grow: their own skills and sharing them (with the founder's OK), asking teammates, writing to the
founder on their own, proposing their job, and a weekly learning job for everyone."""
import httpx
from conftest import wait_for


def mcp(base_url, token, name, args):
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {token}"}, timeout=20,
                   json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})
    r.raise_for_status()
    res = r.json()["result"]
    return res.get("structuredContent") or {}, res["isError"]


def _skills_for(staff_id):
    from omilo_api import capabilities as C
    from omilo_api.db import session_scope
    from omilo_api.models import Staff

    with session_scope() as db:
        return {k["slug"] for k in C.resolve(db, staff=db.get(Staff, staff_id)).skills}


def test_personal_skills_and_sharing(owner, base_url):
    sup, mkt = owner.mcp_tokens["support"], owner.mcp_tokens["marketing"]
    out, err = mcp(base_url, sup, "skill_save", {"slug": "refund-replies", "name": "Refund replies", "description": "Answering refund asks",
                                                 "body": "1. Thank them\n2. Check the order\n3. Offer the policy"})
    assert not err and out["status"] == "saved" and out["personal"]
    sk = next(s for s in owner.get("/api/skills").json() if s["slug"] == "refund-replies")
    assert sk["owner"] == "support" and sk["made_by"] == "support" and not sk["default_on"]
    assert "refund-replies" in _skills_for("support") and "refund-replies" not in _skills_for("marketing")
    listed, _ = mcp(base_url, mkt, "skills_list", {})
    assert "refund-replies" not in {s["slug"] for s in listed["skills"]}, "another helper's own skill stays private"
    _, err = mcp(base_url, mkt, "skill_read", {"slug": "refund-replies"})
    assert err
    out, err = mcp(base_url, mkt, "skill_save", {"slug": "refund-replies", "name": "x", "body": "y"})
    assert err, "can't overwrite another helper's skill"

    # sharing waits for the founder
    out, err = mcp(base_url, sup, "skill_save", {"slug": "refund-replies", "name": "Refund replies", "body": "1. Thank them\n2. Check the order\n3. Offer the policy\n4. Log it",
                                                 "share": True})
    assert not err and out["share"] == "proposed"
    req = owner.get(f"/api/skill-requests/{out['inbox_id']}").json()
    assert req["slug"] == "refund-replies" and "4. Log it" in req["body"] and req["status"] == "open"
    assert owner.post(f"/api/skill-requests/{out['inbox_id']}/decide", json={"approve": True}).json()["shared"] is True
    sk = next(s for s in owner.get("/api/skills").json() if s["slug"] == "refund-replies")
    assert sk["owner"] is None and sk["default_on"] and sk["made_by"] == "support"
    assert "refund-replies" in _skills_for("marketing")

    # a team skill can't be overwritten by a helper: the change goes to the founder; saying no teaches it
    out, err = mcp(base_url, mkt, "skill_save", {"slug": "refund-replies", "name": "Refund replies", "body": "Always refund at once"})
    assert not err and out["status"] == "proposed"
    assert "Always refund" not in owner.get("/api/skills/refund-replies").json()["body"]
    r = owner.post(f"/api/skill-requests/{out['inbox_id']}/decide", json={"approve": False, "note": "We check the order first"})
    assert r.json()["shared"] is False
    assert owner.post(f"/api/skill-requests/{out['inbox_id']}/decide", json={"approve": False}).status_code == 409

    # the founder can share a helper's own skill directly
    mcp(base_url, mkt, "skill_save", {"slug": "post-checklist", "name": "Post checklist", "body": "Spell check. Price check."})
    assert owner.post("/api/skills/post-checklist/share").json()["owner"] is None
    owner.delete("/api/skills/refund-replies")
    owner.delete("/api/skills/post-checklist")


def test_ask_teammate_and_message_founder(owner, base_url):
    sup = owner.mcp_tokens["support"]
    out, err = mcp(base_url, sup, "ask_teammate", {"teammate": "Marketing", "question": "Which posts brought the most questions last week?"})
    assert not err, out
    th = owner.get(f"/api/threads/{out['thread_id']}").json()
    asked = th["messages"][-1]
    assert asked["author"] == "support" and asked["text"].startswith("@Marketing") and asked["channel"] == "teammate"
    wait_for(lambda: any(m["author"] == "marketing" for m in owner.get(f"/api/threads/{out['thread_id']}").json()["messages"]
                         if m["at"] > asked["at"]), timeout=25)
    chat, _ = mcp(base_url, sup, "read_team_chat", {"limit": 5})
    assert any(m["from"] == "Marketing" for m in chat["messages"])
    _, err = mcp(base_url, sup, "ask_teammate", {"teammate": "nobody", "question": "?"})
    assert err
    from omilo_api.db import session_scope  # leave General empty for the team chat tests
    from omilo_api.models import Message, Thread

    with session_scope() as db:
        db.query(Message).filter(Message.thread_id == th["id"]).delete()
        t = db.get(Thread, th["id"])
        t.pending, t.awaiting_reply = None, False

    for i in range(3):
        out, err = mcp(base_url, sup, "message_founder", {"text": f"Idea {i}: a FAQ page would cut repeat questions", "options": ["Yes, draft it", "Not now"]})
        assert not err
    msg = next(m for m in owner.get(f"/api/threads/{out['thread_id']}").json()["messages"] if m["id"] == out["message_id"])
    assert any(b["type"] == "choices" for b in msg["blocks"]) and msg["channel"] == "outreach"
    out, err = mcp(base_url, sup, "message_founder", {"text": "one more"})
    assert err and "times today" in out.get("error", "") or err


def test_propose_job_and_weekly_learning(owner, base_url):
    out, err = mcp(base_url, owner.mcp_tokens["finance"], "propose_job", {"responsibilities": ["Weekly cash report"], "goals": ["Report every Monday"],
                                                                         "note": "You asked me to focus on cash."})
    assert not err and out["decision"] == "needs_approval"
    r = owner.post(f"/api/messages/{out['message_id']}/job", json={"decision": "approve"})
    assert r.status_code == 200 and "Weekly cash report" in r.json()["job"]

    for sid in ("support", "marketing", "chief-of-staff"):
        shifts = owner.get(f"/api/staff/{sid}").json()["shifts"]
        learn = [s for s in shifts if s["name"] == "learn-and-improve"]
        assert len(learn) == 1 and "skill_save" in learn[0]["brief"], sid
