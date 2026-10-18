"""The AI onboarding: pick an AI, the interview fills the company profile, the team follows from it, and each helper
proposes its own job for the founder to approve. Practice mode (no AI) runs the same flow with fixed questions; the AI
path runs against a fake LiteLLM."""
import json
import types

import httpx
import pytest
from conftest import wait_for


@pytest.fixture
def co(base_url, owner):
    """A fresh company that isn't onboarded yet (same login)."""
    new = owner.post("/api/companies", json={"name": "Sambal Bu Rini"}).json()
    owner.cookies.clear()
    c = httpx.Client(base_url=base_url, timeout=30, headers={**owner.headers, "X-Omilo-Company": new["id"]})
    yield c
    c.close()


def _say(co, text=""):
    r = co.post("/api/onboarding/interview", json={"message": text})
    assert r.status_code == 200, r.text
    return r.json()


def test_practice_interview_team_and_job_proposals(co):
    st = co.get("/api/onboarding").json()
    assert st["ai"]["provider"] == "fake" and any(p["id"] == "claude" and p["recommended"] for p in st["providers"])
    assert co.post("/api/onboarding/ai", json={"provider": "nope"}).status_code == 400
    assert co.post("/api/onboarding/ai", json={"provider": "fake"}).json()["provider"] == "fake"

    r = _say(co)  # the first question (the company name is known from creating the company)
    q = r["history"][-1]
    assert q["role"] == "ai" and q["field"] == "one_liner"
    answers = {
        "one_liner": "Home-made sambal sold online to busy families in Jakarta",
        "industry": "Food and drink", "stage": "Growing",
        "customers": "Working parents in Jakarta who cook at home", "customer_problem": "No time to make good sambal",
        "offers": "Sambal Bawang 250g - Rp 45.000\nSambal Ijo 250g - Rp 50.000", "different": "Grandma's recipe, no preservatives",
        "goals": "Get more customers, Post content regularly", "focus_note": "200 orders a month by March",
        "workload": "Answering WhatsApp orders and making Instagram posts", "handoff": "Instagram and TikTok content",
        "team_size": "2 to 5 people", "languages": "Bahasa Indonesia", "tones": "Warm, Friendly", "tools": "WhatsApp, Instagram, TikTok",
        "rules_other": "Never mention competitors by name",
    }
    for _ in range(25):
        field = r["history"][-1].get("field")
        if r["topic"] == "finish":
            break
        assert field in answers, field
        if r["history"][-1].get("options"):
            assert r["history"][-1]["options"], "choices come as clickable replies"
        r = _say(co, answers[field])
    assert r["topic"] == "finish"
    a = r["answers"]
    assert a["industry"] == "food" and a["stage"] == "growing" and set(a["goals"]) == {"more_customers", "content"}
    assert a["offers"][1] == {"name": "Sambal Ijo 250g", "price": "Rp 50.000", "note": ""}
    assert a["goal_notes"]["more_customers"] == "200 orders a month by March" and a["handoff"].startswith("Instagram")
    assert a["languages"] == ["id"] and set(a["tones"]) == {"warm", "friendly"} and "tiktok" in a["tools"]
    assert all(t["done"] for t in r["coverage"]), r["coverage"]

    plan = co.post("/api/onboarding/team-plan").json()
    assert plan["helpers"] and all(h["why"] for h in plan["helpers"]) and not any(h["base"] in ("dev", "ops") for h in plan["helpers"])

    helpers = [{"id": "tiktok-creator", "base": "marketing", "name": "TikTok Creator", "focus": "Three TikTok videos a week about our sambal."}]
    done = co.post("/api/onboarding/finish", json={"helpers": helpers, "practice_task": False}).json()
    assert set(done["created"]) == {"chief-of-staff", "tiktok-creator"} and done["engine"] == "fake"
    me = co.get("/api/staff/tiktok-creator").json()
    assert me["name"] == "TikTok Creator" and "Three TikTok videos" in me["job"] and me["role"] == "marketing"

    # each helper proposes its job in its own chat
    def proposal():
        th = co.post("/api/threads", json={"scope": "staff", "staff_id": "tiktok-creator"}).json()
        msgs = co.get(f"/api/threads/{th['id']}").json()["messages"]
        return next((m for m in msgs if any(b.get("type") == "job_proposal" for b in m["blocks"])), None)
    m = wait_for(proposal, timeout=20)
    card = next(b for b in m["blocks"] if b["type"] == "job_proposal")
    assert card["status"] == "pending" and card["responsibilities"]
    assert any(i["title"] == "Your helpers proposed their jobs" for i in co.get("/api/inbox").json())

    r = co.post(f"/api/messages/{m['id']}/job", json={"decision": "approve"})
    assert r.status_code == 200 and "## Agreed with the founder" in r.json()["job"]
    assert co.post(f"/api/messages/{m['id']}/job", json={"decision": "approve"}).status_code == 409
    assert co.get("/api/staff/tiktok-creator").json()["job"].count("## Agreed with the founder") == 1


class _Msg:
    def __init__(self, content, calls=()):
        self.content = content
        self.tool_calls = [types.SimpleNamespace(id=f"t{i}", function=types.SimpleNamespace(name=n, arguments=json.dumps(a)))
                           for i, (n, a) in enumerate(calls)] or None


def _resp(content, calls=()):
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=_Msg(content, calls))])


def test_ai_interview_with_tools(co, monkeypatch):
    """The AI path: update_profile / suggest_replies / set_topic through LiteLLM, for any provider."""
    import litellm

    seen = []

    async def fake(**kw):
        seen.append(kw)
        sys = kw["messages"][0]["content"]
        if "Say OK" in json.dumps(kw["messages"]):
            return _resp("OK")
        if kw.get("tools") and kw["tools"][0]["function"]["name"] == "propose_team":
            return _resp("", [("propose_team", {"helpers": [
                {"base": "marketing", "name": "Content & TikTok", "focus": "Short videos", "why": "You want to hand off TikTok"},
                {"base": "dev", "name": "Dev", "focus": "x", "why": "y"}]})])
        if kw["messages"][-1]["role"] == "tool":
            return _resp("Nice. Who buys from you most?")
        assert "Interview plan" in sys and "Current topic" in sys
        return _resp("", [("update_profile", {"one_liner": "Sambal for busy families", "industry": "food", "made_up": 1}),
                          ("suggest_replies", {"options": ["Working parents", "Students", "Offices"]}),
                          ("set_topic", {"topic": "customers"})])

    monkeypatch.setattr(litellm, "acompletion", fake)
    r = co.post("/api/onboarding/ai", json={"provider": "openai", "api_key": "sk-test-123", "model": "gpt-test"})
    assert r.status_code == 200, r.text
    assert r.json()["provider"] == "openai" and seen[-1]["model"] == "openai/gpt-test" and seen[-1]["api_key"] == "sk-test-123"
    r = _say(co, "We sell sambal online")
    last = r["history"][-1]
    assert last["text"] == "Nice. Who buys from you most?" and last["options"] == ["Working parents", "Students", "Offices"]
    assert r["answers"]["one_liner"] == "Sambal for busy families" and "made_up" not in r["answers"] and r["topic"] == "customers"
    assert set(last["saved"]) == {"one_liner", "industry"}

    plan = co.post("/api/onboarding/team-plan").json()
    assert plan["by"] == "ai" and [h["id"] for h in plan["helpers"]] == ["content-tiktok"], "no software roles without software"

    async def broken(**kw):
        raise RuntimeError("401 invalid key")
    monkeypatch.setattr(litellm, "acompletion", broken)
    r = co.post("/api/onboarding/ai", json={"provider": "gemini", "api_key": "bad"})
    assert r.status_code == 400 and "didn't answer" in r.json()["detail"]
