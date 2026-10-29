"""The real AI path: encrypted accounts, SSE chat turns, jobs on a real model.

Runs against tests/fake_llm.py (a local HTTP server that streams like the
Anthropic and OpenAI APIs), so every byte goes over real HTTP + SSE parsing.
"""
from __future__ import annotations

import uuid

import pytest

from omilo.db import SessionLocal
from tests.fake_llm import FakeLLM, parse_sse


@pytest.fixture(scope="module")
def llm():
    server = FakeLLM().start()
    yield server
    server.stop()


@pytest.fixture
def ai_env(llm, monkeypatch):
    monkeypatch.setenv("OMILO_ANTHROPIC_BASE_URL", llm.base)
    monkeypatch.setenv("OMILO_OPENAI_BASE_URL", llm.base)
    llm.requests.clear()
    return llm


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _workspace(client) -> tuple[str, str]:
    r = await client.post("/v1/auth/sign-up", json={
        "email": f"ai-{uuid.uuid4().hex[:10]}@test.example", "name": "Dede", "password": "testP4ss!"})
    assert r.status_code == 201, r.text
    from omilo.auth.tokens import decode_token

    access = r.json()["session"]["access"]
    return access, decode_token(access)["cmp"]


async def _session(client, token: str) -> str:
    r = await client.post("/v1/sessions", json={"title": "Test chat"}, headers=_h(token))
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


async def _connect(client, token: str, harness: str = "anthropic", key: str = "sk-test-123") -> dict:
    r = await client.post("/v1/ai-accounts", json={"harness": harness, "name": harness.title(), "token_enc": key},
                          headers=_h(token))
    assert r.status_code == 201, r.text
    return r.json()


# ── secrets ───────────────────────────────────────────────────────────────────

def test_secrets_roundtrip_and_legacy_plaintext():
    from omilo.ai.secrets import decrypt, encrypt, hint

    enc = encrypt("sk-ant-abcdef123456")
    assert enc.startswith("fernet:") and "abcdef" not in enc
    assert decrypt(enc) == "sk-ant-abcdef123456"
    assert decrypt("sk-legacy-plain") == "sk-legacy-plain"  # rows saved before encryption
    assert encrypt("") == "" and decrypt("") == ""
    assert hint("sk-ant-abcdef123456") == "sk-ant…3456"


async def test_account_key_is_encrypted_and_becomes_default(async_client, ai_env):
    from omilo.models.accounts import HarnessAccount
    from omilo.models.tenancy import Company

    token, cid = await _workspace(async_client)
    acc = await _connect(async_client, token, key="sk-test-123")
    assert acc["tokens"] == "…****" and "sk-test-123" not in str(acc)
    with SessionLocal() as db:
        row = db.get(HarnessAccount, acc["id"])
        assert row.token_enc.startswith("fernet:")
        assert (db.get(Company, cid).settings or {})["aiEngine"]["defaultAccountId"] == acc["id"]
    r = await async_client.post(f"/v1/ai-accounts/{acc['id']}/test", headers=_h(token))
    assert r.status_code == 200 and r.json()["ok"] is True, r.text


async def test_account_test_reports_a_bad_key(async_client, ai_env):
    token, _ = await _workspace(async_client)
    acc = await _connect(async_client, token, key="sk-wrong-999")
    r = await async_client.post(f"/v1/ai-accounts/{acc['id']}/test", headers=_h(token))
    body = r.json()
    assert body["ok"] is False and body["status"] == "error" and "key" in body["detail"].lower()


# ── chat over SSE ─────────────────────────────────────────────────────────────

async def test_chat_stream_on_claude(async_client, ai_env):
    from omilo.models.chat import Message
    from omilo.models.execution import Job

    token, _ = await _workspace(async_client)
    await _connect(async_client, token)
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "Halo Chief"},
                                headers=_h(token))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    names = [e for e, _ in events]
    assert names[0] == "user" and names[1] == "helper" and names[-1] == "done", names
    assert "".join(d["delta"] for e, d in events if e == "text") == "Halo! Saya siap membantu."
    done = events[-1][1]
    assert done["message"]["content"] == "Halo! Saya siap membantu."
    # What the model saw: our system prompt + the owner's message, hosted web tools on
    req = ai_env.requests[-1]["body"]
    assert req["stream"] is True and req["messages"][-1]["content"] == "Halo Chief"
    assert "Chief" in req["system"][0]["text"]
    assert {t.get("name") for t in req.get("tools") or []} >= {"web_search", "web_fetch"}
    with SessionLocal() as db:
        msgs = db.query(Message).filter(Message.session_id == sid).order_by(Message.created_at).all()
        assert [m.author["kind"] for m in msgs] == ["you", "helper"]
        job = db.get(Job, done["jobId"])
        assert job.origin == "chat" and job.status == "done" and job.tokens_in == 50 and job.engine_type == "anthropic"
    # The next turn carries the history
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "Lanjut"}, headers=_h(token))
    hist = ai_env.requests[-1]["body"]["messages"]
    assert [m["role"] for m in hist] == ["user", "assistant", "user"]


async def test_chat_stream_on_openai(async_client, ai_env):
    token, _ = await _workspace(async_client)
    await _connect(async_client, token, harness="openai", key="sk-oa")
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "hi"}, headers=_h(token))
    events = parse_sse(r.text)
    assert "".join(d["delta"] for e, d in events if e == "text") == "Hello from GPT."
    assert events[-1][0] == "done"
    assert ai_env.requests[-1]["api"] == "openai"
    assert ai_env.requests[-1]["headers"]["authorization"] == "Bearer sk-oa"


async def test_chat_stream_practice_mode_without_ai(async_client, ai_env):
    token, _ = await _workspace(async_client)
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "hello"}, headers=_h(token))
    events = parse_sse(r.text)
    text = "".join(d["delta"] for e, d in events if e == "text")
    assert "practice mode" in text and events[-1][0] == "done"
    assert not ai_env.requests  # nothing left the server


async def test_chat_stream_error_is_saved_and_reported(async_client, ai_env):
    token, _ = await _workspace(async_client)
    await _connect(async_client, token, key="sk-wrong-999")
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "hello"}, headers=_h(token))
    events = parse_sse(r.text)
    ev, data = events[-1]
    assert ev == "error" and "key" in data["error"].lower() and data["jobId"]
    assert data["message"]["content"].startswith("I couldn't answer just now")


async def test_chat_stream_other_company_session_is_404(async_client, ai_env):
    token_a, _ = await _workspace(async_client)
    sid = await _session(async_client, token_a)
    token_b, _ = await _workspace(async_client)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "x"}, headers=_h(token_b))
    assert r.status_code == 404


# ── jobs on a real model ──────────────────────────────────────────────────────

async def test_job_runs_on_connected_ai_and_request_action_becomes_a_proposal(async_client, ai_env):
    from omilo.db import set_company
    from omilo.loop.runner import start_job
    from omilo.models.agents import Helper
    from omilo.models.approvals import Proposal
    from sqlalchemy import text

    token, cid = await _workspace(async_client)
    await _connect(async_client, token)
    with SessionLocal() as db, db.begin():
        db.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(db, cid)
        chief = db.query(Helper).filter(Helper.is_chief.is_(True)).first()
        job = start_job(db, company_id=cid, helper_id=chief.id, origin="routine",
                        brief="APPROVE: tell customers about the promo")
        jid, status = job.id, job.status
        assert job.engine_type == "anthropic"
    assert status == "waiting"
    with SessionLocal() as db:
        p = db.query(Proposal).filter(Proposal.job_id == jid).one()
        assert p.title == "Send the promo to 120 customers" and p.type == "message"
        assert "Diskon 20%" in p.body_md
    tools = {t.get("name") for t in ai_env.requests[0]["body"]["tools"]}
    assert "request_action" in tools


async def test_job_fails_cleanly_when_the_ai_refuses_the_key(async_client, ai_env):
    from omilo.db import set_company
    from omilo.loop.runner import start_job
    from omilo.models.agents import Helper
    from sqlalchemy import text

    token, cid = await _workspace(async_client)
    await _connect(async_client, token, key="sk-wrong-999")
    with SessionLocal() as db, db.begin():
        db.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(db, cid)
        chief = db.query(Helper).filter(Helper.is_chief.is_(True)).first()
        job = start_job(db, company_id=cid, helper_id=chief.id, origin="routine", brief="Write the weekly summary")
        assert job.status == "failed" and "key" in (job.error or "").lower()


# ── the owner's own Claude Code sign-in (CLI, stream-json) ──────────────────

_FAKE_CLAUDE = r'''#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
open(sys.argv[0] + ".args", "w").write(json.dumps(args))
if "--include-partial-messages" in args:
    print(json.dumps({"type": "system", "subtype": "init", "session_id": "s1"}))
    for t in ("Halo ", "dari Claude Code."):
        print(json.dumps({"type": "stream_event", "event": {"type": "content_block_delta", "index": 0,
                          "delta": {"type": "text_delta", "text": t}}}), flush=True)
    print(json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "Halo dari Claude Code."}]}}))
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "result": "Halo dari Claude Code.",
                      "usage": {"input_tokens": 9, "output_tokens": 5}, "total_cost_usd": 0.001}))
elif "json" in args:
    print(json.dumps({"type": "result", "subtype": "success", "is_error": False,
                      "result": json.dumps({"reply": "Noted!", "calls": [{"name": "save_note", "args": {"topic": "goals", "content": "Grow to 100 clients"}}]})}))
'''


@pytest.fixture
def fake_claude_cli(tmp_path, monkeypatch):
    p = tmp_path / "claude"
    p.write_text(_FAKE_CLAUDE)
    p.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}:" + __import__("os").environ.get("PATH", ""))
    return p


async def test_chat_stream_on_local_claude_code(async_client, ai_env, fake_claude_cli):
    import json as _json

    token, _ = await _workspace(async_client)
    r = await async_client.post("/v1/ai-accounts", json={"harness": "claude-code", "name": "Claude Code",
                                                         "token_enc": "", "tag": "session"}, headers=_h(token))
    assert r.status_code == 201 and r.json()["tokens"] == "Local session"
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "halo"}, headers=_h(token))
    events = parse_sse(r.text)
    assert [d["delta"] for e, d in events if e == "text"] == ["Halo ", "dari Claude Code."]
    assert events[-1][0] == "done" and events[-1][1]["message"]["content"] == "Halo dari Claude Code."
    args = _json.loads((fake_claude_cli.parent / "claude.args").read_text())
    assert "-p" in args and "--append-system-prompt" in args and "Bash" in args  # dev tools denied
    assert args[args.index("--output-format") + 1] == "stream-json"


async def test_cli_tool_protocol(fake_claude_cli):
    from omilo.ai import AiConfig, complete

    seen = []

    async def on_call(name, args):
        seen.append((name, args))
        return "ok"

    cfg = AiConfig(provider="cli", vendor="claude-code", label="Claude Code")
    done = await complete(cfg, "system", [{"role": "user", "content": "we want 100 clients"}],
                          tools=[{"name": "save_note", "parameters": {"type": "object"}}], on_call=on_call,
                          final_tools={"save_note"})
    assert done["text"] == "Noted!" and seen == [("save_note", {"topic": "goals", "content": "Grow to 100 clients"})]


# ── onboarding interview ─────────────────────────────────────────────────────

async def test_interview_practice_mode_walks_the_topics(async_client, ai_env):
    token, _ = await _workspace(async_client)
    r = await async_client.post("/v1/onboarding/interview/stream", json={}, headers=_h(token))
    events = parse_sse(r.text)
    assert events[-1][0] == "done"
    first = events[-1][1]
    assert first["ai"]["practice"] is True and first["topic"] == "company"
    assert "What does" in first["history"][-1]["text"]
    r = await async_client.post("/v1/onboarding/interview/stream",
                                json={"message": "We build Omilo, an AI office for UMKM. 4 people."}, headers=_h(token))
    events = parse_sse(r.text)
    notes = [d for e, d in events if e == "note"]
    assert notes == [{"topic": "company", "content": "We build Omilo, an AI office for UMKM. 4 people."}]
    done = events[-1][1]
    assert done["topic"] == "customers" and done["coverage"][0]["done"] is True
    # Reopening shows where we were, without a new turn
    r = await async_client.get("/v1/onboarding/interview", headers=_h(token))
    assert r.json()["notes"]["company"].startswith("We build Omilo") and len(r.json()["history"]) == 3


async def test_interview_on_claude_saves_notes_and_suggestions(async_client, ai_env):
    token, _ = await _workspace(async_client)
    await _connect(async_client, token)
    r = await async_client.post("/v1/onboarding/interview/stream", json={"message": "NOTE: we are Saga"},
                                headers=_h(token))
    events = parse_sse(r.text)
    assert ("note", {"topic": "company", "content": "Saga builds Omilo, an AI office."}) in events
    assert "".join(d["delta"] for e, d in events if e == "text").startswith("Siap, saya catat.")
    done = events[-1][1]
    assert done["options"] == ["UMKM", "Startups"] and done["ai"]["practice"] is False
    body = ai_env.requests[-1]["body"]
    assert {t["name"] for t in body["tools"]} >= {"save_note", "suggest_replies", "set_topic", "read_website"}
    # save_note + suggest_replies are "silent": no second model turn needed after the reply
    assert len([q for q in ai_env.requests if q["api"] == "anthropic"]) == 1


async def test_interview_reads_a_website_in_the_message(async_client, ai_env):
    token, _ = await _workspace(async_client)
    await _connect(async_client, token)
    url = f"{ai_env.base}/v1/models"
    r = await async_client.post("/v1/onboarding/interview/stream", json={"message": f"learn from {url}"},
                                headers=_h(token))
    events = parse_sse(r.text)
    assert ("activity", {"label": f"Reading {url}…"}) in events
    sent = ai_env.requests[-1]["body"]["messages"][-1]["content"]
    assert "<website>" in sent and "claude-sonnet-5-5" in sent  # the page text reached the model
    assert events[-1][0] == "done" and events[-1][1]["website"] == url


async def test_notes_edit_and_team_plan(async_client, ai_env):
    token, _ = await _workspace(async_client)
    r = await async_client.put("/v1/onboarding/notes/systems",
                               json={"content": "WhatsApp Business, Google Sheets, our app code on GitHub"},
                               headers=_h(token))
    assert r.status_code == 200 and r.json()["notes"]["systems"].startswith("WhatsApp")
    assert (await async_client.put("/v1/onboarding/notes/nope", json={"content": "x"}, headers=_h(token))).status_code == 404
    plan = (await async_client.post("/v1/onboarding/team-plan", headers=_h(token))).json()
    ids = [h["id"] for h in plan["helpers"]]
    assert plan["by"] == "rules" and "builder" in ids and "support" in ids  # app code + WhatsApp


async def test_reply_is_saved_even_if_nobody_reads_the_stream(async_client, ai_env):
    """The browser going away (tab closed, StrictMode remount) must not lose the reply."""
    import asyncio

    from omilo.api.chat_stream import StreamBody, _prepare, _run_turn
    from omilo.auth.tokens import decode_token
    from omilo.models.chat import Message
    from omilo.tenancy.context import RequestContext

    token, cid = await _workspace(async_client)
    await _connect(async_client, token)
    sid = await _session(async_client, token)
    claims = decode_token(token)
    ctx = RequestContext(user_id=claims["sub"], company_id=cid, role="owner")
    prep = await asyncio.to_thread(_prepare, ctx, sid, StreamBody(content="halo"))
    await _run_turn(ctx, sid, prep, asyncio.Queue())  # nobody consumes the queue
    with SessionLocal() as db:
        kinds = [m.author["kind"] for m in db.query(Message).filter(Message.session_id == sid).order_by(Message.created_at)]
        assert kinds == ["you", "helper"]


# ── Omilo Cloud's own AI (pooled, metered in credits) ───────────────────────

async def test_cloud_ai_needs_credits_then_charges_them(async_client, ai_env, monkeypatch):
    from omilo.models.billing import CreditLedger
    from omilo.models.execution import Job

    monkeypatch.setenv("OMILO_POOL_ANTHROPIC_API_KEY", "sk-test-123")  # the server's key (fake LLM accepts it)
    token, cid = await _workspace(async_client)
    status = (await async_client.get("/v1/onboarding/ai-status", headers=_h(token))).json()
    assert status["ready"] is False and status["pooled"] is True and "trial" in status["reason"]
    sid = await _session(async_client, token)
    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "hi"}, headers=_h(token))
    assert r.status_code == 402 and "credits" in r.json()["detail"]

    # Reading the subscription starts the free trial (credits granted once)
    sub = await async_client.get("/v1/billing/subscription", headers=_h(token))
    assert sub.status_code == 200, sub.text
    status = (await async_client.get("/v1/onboarding/ai-status", headers=_h(token))).json()
    assert status == {"ready": True, "label": "Omilo Cloud", "pooled": True, "mode": "cloud", "reason": None}

    r = await async_client.post(f"/v1/sessions/{sid}/messages/stream", json={"content": "hi"}, headers=_h(token))
    events = parse_sse(r.text)
    assert events[-1][0] == "done"
    with SessionLocal() as db:
        job = db.get(Job, events[-1][1]["jobId"])
        assert job.engine_type == "litellm"  # the credit-metered cloud engine
        rows = db.query(CreditLedger).filter(CreditLedger.job_id == job.id).all()
        assert rows and rows[0].credits_charged > 0


async def test_ai_status_with_own_account_is_ready(async_client, ai_env):
    token, _ = await _workspace(async_client)
    assert (await async_client.get("/v1/onboarding/ai-status", headers=_h(token))).json()["ready"] is False
    await _connect(async_client, token)
    st = (await async_client.get("/v1/onboarding/ai-status", headers=_h(token))).json()
    assert st["ready"] is True and st["pooled"] is False and st["label"] == "Claude"
