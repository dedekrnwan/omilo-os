"""Harness pool: Claude Code accounts, failover on usage limits with session resume, live events."""
import json
import os
import sys
from pathlib import Path

import pytest
from conftest import wait_for

FAKE = Path(__file__).parent / "bin" / "fake_claude.py"
OK1, LIMITED, OK2 = "sk-ant-oat01-" + "a" * 30 + "LIMITED", "sk-ant-oat01-" + "b" * 30 + "GOOD01", "sk-ant-oat01-" + "c" * 30 + "GOOD02"

# A token that matches TOKEN_RE for consent gate tests (no collision risk from unique suffix).
CONSENT_TOK = "sk-ant-consent01-" + "z" * 30 + "GATE1"


def test_fresh_install_requires_consent_to_enable_pool():
    """Task 5: no accounts + no consent → add_account raises ValueError; after grant_pool_consent it succeeds."""
    from sqlalchemy import select

    from omilo_api import harness as H
    from omilo_api.db import session_scope
    from omilo_api.models import HarnessAccount, Setting

    with session_scope() as db:
        # clean any pre-existing consent state for a clean test
        for key in ("pool_consent", "pool_consent_notice"):
            s = db.get(Setting, key)
            if s is not None:
                db.delete(s)
        # ensure no harness accounts exist (use a temporary disable rather than delete to avoid cascade issues;
        # we cannot delete accounts that other tests depend on, but we CAN check count before acting)
        existing = db.scalars(select(HarnessAccount)).first()
        if existing is not None:
            pytest.skip("DB has pre-existing HarnessAccount rows (shared session); skipping fresh-install test")
        db.commit()

    with session_scope() as db:
        # fresh install: no accounts, no consent → must raise
        with pytest.raises(ValueError, match="disclosure"):
            H.add_account(db, "consent-gate-test", CONSENT_TOK)

    with session_scope() as db:
        # grant consent, then add_account must succeed
        H.grant_pool_consent(db)
        db.commit()

    with session_scope() as db:
        a = H.add_account(db, "consent-gate-test", CONSENT_TOK)
        db.commit()
        assert a.token_hint == CONSENT_TOK[-4:]
        assert H.pool_consent_status(db)["consented"] is True

        # cleanup
        db.delete(a)
        for key in ("pool_consent", "pool_consent_notice"):
            s = db.get(Setting, key)
            if s is not None:
                db.delete(s)
        db.commit()


def test_existing_accounts_are_grandfathered():
    """Task 5: accounts already exist (pre-upgrade) → grandfathered consented=True + notice_pending=True."""
    from omilo_api import harness as H
    from omilo_api.db import session_scope
    from omilo_api.models import HarnessAccount, Setting
    from omilo_api.security import encrypt

    GRAND_TOK = "sk-ant-grand01-" + "x" * 30 + "GRD1"
    GRAND_TOK2 = "sk-ant-grand02-" + "y" * 30 + "GRD2"

    with session_scope() as db:
        # ensure pool_consent is unset
        for key in ("pool_consent", "pool_consent_notice"):
            s = db.get(Setting, key)
            if s is not None:
                db.delete(s)
        # pre-seed a HarnessAccount directly (bypass the gate)
        acct = HarnessAccount(label="grandfathered-account", token_enc=encrypt(GRAND_TOK), token_hint=GRAND_TOK[-4:])
        db.add(acct)
        db.commit()
        acct_id = acct.id

    with session_scope() as db:
        # grandfather side-effect fires: consented=True, notice_pending=True
        status = H.pool_consent_status(db)
        assert status["consented"] is True
        assert status["notice_pending"] is True

    with session_scope() as db:
        # second call is idempotent
        status2 = H.pool_consent_status(db)
        assert status2["consented"] is True

    with session_scope() as db:
        H.dismiss_pool_notice(db)
        db.commit()

    with session_scope() as db:
        status3 = H.pool_consent_status(db)
        assert status3["notice_pending"] is False

    with session_scope() as db:
        # grandfathered: add_account now works
        a2 = H.add_account(db, "grandfathered-add", GRAND_TOK2)
        db.commit()
        assert a2.token_hint == GRAND_TOK2[-4:]

        # cleanup
        for aid in (acct_id, a2.id):
            row = db.get(HarnessAccount, aid)
            if row:
                db.delete(row)
        for key in ("pool_consent", "pool_consent_notice"):
            s = db.get(Setting, key)
            if s is not None:
                db.delete(s)
        db.commit()


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


def test_pool_wait_cap_constant_defined():
    """Task 4: a job waits POOL_WAIT_CAP_S for pool capacity, then surfaces. Default 45 min."""
    from omilo_api import harness as H

    assert isinstance(H.POOL_WAIT_CAP_S, int)
    assert H.POOL_WAIT_CAP_S == 2700


def test_lease_order_tolerates_naive_last_used_at():
    """Regression: SQLite returns last_used_at as a NAIVE datetime (tz stripped on read). lease() sorts
    ready accounts by it, with an aware epoch fallback for never-used accounts. Sorting a naive value
    against the aware fallback used to raise `TypeError: can't compare offset-naive and offset-aware
    datetimes` whenever two+ equally-idle accounts were in the pool. _lease_order must normalize first."""
    import datetime as dt

    from omilo_api import harness as H

    class _Acct:
        def __init__(self, last_used_at):
            self.last_used_at = last_used_at

    naive = dt.datetime(2026, 10, 20, 10, 0, 0)  # what SQLite hands back: no tzinfo
    aware = dt.datetime(2026, 10, 20, 11, 0, 0, tzinfo=dt.UTC)
    rows = [_Acct(naive), _Acct(None), _Acct(aware)]

    # all equally busy -> the tie-break on last_used_at is exercised; must not raise
    rows.sort(key=lambda a: H._lease_order(a, 0))

    # never-used (None) sorts first, then oldest naive, then the aware one
    assert [a.last_used_at for a in rows] == [None, naive, aware]


def test_accounts_validation_and_test(owner, fake_cli):
    # Task 5: grant pool consent before adding accounts (required on a fresh install)
    assert owner.post("/api/harness/pool-consent").status_code == 200
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
    owner.post("/api/harness/pool-consent")  # idempotent; the Task-5 consent tests may have cleared it in a shared session
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
    assert calls[0]["mode"] == "auto" and "mcp__omilo" in (calls[0]["tools"] or "")

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
    owner.post("/api/harness/pool-consent")  # idempotent; the Task-5 consent tests may have cleared it in a shared session
    # guarantee an empty effective pool regardless of accounts other tests left behind
    for a in owner.get("/api/harness").json()["accounts"]:
        if a["enabled"]:
            owner.patch(f"/api/harness/accounts/{a['id']}", json={"enabled": False})
    owner.post("/api/ai", json={"provider": "claude-code", "staff_ids": ["sales"]})
    eng = owner.get("/api/staff/sales").json()["engine"]
    assert eng["type"] == "claude-code" and eng["auth"] == "auto", eng

    # no pool accounts added -> lease() finds nothing -> auto spills over to the API key
    t = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Find 3 office catering prospects"}).json()
    done = wait_for(lambda: (x := owner.get(f"/api/tasks/{t['id']}").json())["status"] in ("done", "failed") and x, timeout=30)
    assert done["status"] == "done", done

    last = json.loads(fake_cli.read_text().splitlines()[-1])
    # fell back to an API key (no pool OAuth token). The exact key may be the env one or a company key on file.
    assert last["token"] == "" and last["api_key"], f"expected an API key, not a pool token: {last}"
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
