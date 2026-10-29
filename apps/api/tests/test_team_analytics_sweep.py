"""sweep/team-analytics — Team + Analytics endpoints built in the dummy-UI sweep.

Covers: helper list extras, retire (let go), extended create/patch, per-helper
channels / tools / skills / working files, the one-off budget override, the
analytics range aliases + previous-period values, stacked series endpoints,
loops, reliability / failures / retry, the activity feed, the channel filter
and the runner's behavior wiring.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest


async def _company(client) -> dict:
    email = f"sweep_{uuid.uuid4().hex[:8]}@test.example"
    resp = await client.post(
        "/v1/auth/sign-up", json={"email": email, "name": "Dede", "password": "testP4ss!"}
    )
    assert resp.status_code == 201, resp.text
    token = resp.json()["session"]["access"]
    me = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    return {"h": {"Authorization": f"Bearer {token}"}, "company_id": me.json()["company"]["id"]}


def _session():
    from omilo.db import SessionLocal

    return SessionLocal()


def _set_company(session, company_id: str) -> None:
    from sqlalchemy import text

    session.execute(text("SELECT set_config('app.company_id', :c, true)"), {"c": company_id})


def _seed_helper(company_id: str, name: str, *, is_chief=False, area="ops", channel_ids=None) -> str:
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id

    with _session() as s, s.begin():
        h = Helper(
            id=prefixed_id("hlp"),
            company_id=company_id,
            name=name,
            area=area,
            role="Worker",
            job_description="Do the work.",
            is_chief=is_chief,
            engine={"type": "fake"},
            permissions=[],
            status="active",
            channel_ids=channel_ids or [],
        )
        s.add(h)
        s.flush()
        return h.id


def _seed_job(company_id, helper_id, *, status="done", error=None, credits=10, tokens=(100, 50),
              attempts=1, ago=timedelta(hours=1), brief="Do a thing", session_id=None) -> str:
    from omilo.models.base import prefixed_id
    from omilo.models.billing import CreditLedger
    from omilo.models.execution import Job

    at = datetime.now(timezone.utc) - ago
    with _session() as s, s.begin():
        j = Job(
            id=prefixed_id("job"),
            company_id=company_id,
            helper_id=helper_id,
            origin="chat",
            brief=brief,
            status=status,
            error=error,
            tokens_in=tokens[0],
            tokens_out=tokens[1],
            cost_credits=credits,
            attempts=attempts,
            created_at=at,
            started_at=at,
            ended_at=at + timedelta(seconds=30),
            session_id=session_id,
        )
        s.add(j)
        if credits:
            s.add(
                CreditLedger(
                    id=prefixed_id("cl"),
                    company_id=company_id,
                    delta=-credits,
                    balance_after=0,
                    reason="job",
                    job_id=j.id,
                    helper_id=helper_id,
                    credits_charged=credits,
                    at=at,
                )
            )
        s.flush()
        return j.id


# ── Helpers ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_extras_and_retire(async_client):
    c = await _company(async_client)
    chief = _seed_helper(c["company_id"], "Chief", is_chief=True)
    dev = _seed_helper(c["company_id"], "Builder", area="dev")
    _seed_job(c["company_id"], dev, credits=25)
    _seed_job(c["company_id"], dev, status="running", credits=0, brief="Open the PR\nmore")

    rows = (await async_client.get("/v1/helpers", headers=c["h"])).json()
    b = next(r for r in rows if r["id"] == dev)
    assert b["costMonth"] == 25
    assert b["jobsMonth"] == 2
    assert b["currentJob"]["brief"] == "Open the PR"
    assert b["lastActive"]

    # Chief can't be let go
    r = await async_client.post(f"/v1/helpers/{chief}/retire", headers=c["h"])
    assert r.status_code == 409
    r = await async_client.post(f"/v1/helpers/{dev}/retire", headers=c["h"])
    assert r.status_code == 200 and r.json()["status"] == "retired"
    ids = [x["id"] for x in (await async_client.get("/v1/helpers", headers=c["h"])).json()]
    assert dev not in ids and chief in ids
    ids = [
        x["id"]
        for x in (await async_client.get("/v1/helpers?include_retired=true", headers=c["h"])).json()
    ]
    assert dev in ids
    # history kept: detail still loads
    assert (await async_client.get(f"/v1/helpers/{dev}", headers=c["h"])).status_code == 200
    # retired helper can't be resumed through PATCH
    r = await async_client.patch(f"/v1/helpers/{dev}", json={"status": "active"}, headers=c["h"])
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_create_with_setup_fields_and_patch_profile(async_client):
    c = await _company(async_client)
    chief = _seed_helper(c["company_id"], "Chief", is_chief=True)
    r = await async_client.post(
        "/v1/helpers",
        json={
            "name": "Sales",
            "area": "sales",
            "role": "Sales",
            "model": "Sonnet 5.5",
            "reports_to": chief,
            "channels": ["Omilo chat", "telegram", "email"],
        },
        headers=c["h"],
    )
    assert r.status_code == 201, r.text
    h = r.json()
    assert h["model"] == "Sonnet 5.5" and h["reportsTo"] == chief
    chans = (await async_client.get(f"/v1/helpers/{h['id']}/channels", headers=c["h"])).json()
    assert sorted(x["kind"] for x in chans) == ["email", "telegram"]
    assert all(x["status"] == "pending_setup" for x in chans)

    r = await async_client.patch(
        f"/v1/helpers/{h['id']}",
        json={
            "name": "Closer",
            "title": "Sales · Partnerships",
            "reports_to": "owner",
            "look": {"color": "#EC4899", "shape": "blob", "prop": "tie"},
            "behavior": {"language": "English", "never_discuss": ["Legal"]},
            "budget_credits_month": 500,
            "autonomy_cap": "strict",
        },
        headers=c["h"],
    )
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["name"] == "Closer" and p["title"] == "Sales · Partnerships"
    assert p["reportsTo"] == "owner" and p["look"]["prop"] == "tie"
    assert p["behavior"]["language"] == "English" and p["budgetCreditsMonth"] == 500
    assert p["autonomyCap"] == "strict"

    # null clears budget; behavior key null removes; empty model → company default
    r = await async_client.patch(
        f"/v1/helpers/{h['id']}",
        json={"budget_credits_month": None, "behavior": {"language": None}, "model": ""},
        headers=c["h"],
    )
    p = r.json()
    assert p["budgetCreditsMonth"] is None and "language" not in p["behavior"]
    assert p["model"] is None
    # bad status rejected
    r = await async_client.patch(f"/v1/helpers/{h['id']}", json={"status": "retired"}, headers=c["h"])
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_channels_crud_hides_secrets(async_client):
    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Support", area="support")
    r = await async_client.post(
        f"/v1/helpers/{hid}/channels",
        json={"kind": "telegram", "config": {"audience": "anyone", "token": "123456:SECRET"}},
        headers=c["h"],
    )
    assert r.status_code == 201
    ch = r.json()
    assert ch["config"] == {"audience": "anyone"}
    assert ch["secretsSet"] == ["token"]
    assert "SECRET" not in r.text
    r = await async_client.patch(
        f"/v1/helpers/{hid}/channels/{ch['id']}", json={"config": {"audience": "group"}}, headers=c["h"]
    )
    assert r.json()["config"]["audience"] == "group"
    r = await async_client.post(f"/v1/helpers/{hid}/channels", json={"kind": "pager"}, headers=c["h"])
    assert r.status_code == 422
    detail = (await async_client.get(f"/v1/helpers/{hid}", headers=c["h"])).json()
    assert detail["counts"]["channels"] == 2  # omilo chat + telegram
    r = await async_client.delete(f"/v1/helpers/{hid}/channels/{ch['id']}", headers=c["h"])
    assert r.status_code == 204
    assert (await async_client.get(f"/v1/helpers/{hid}/channels", headers=c["h"])).json() == []


@pytest.mark.asyncio
async def test_tools_skills_and_files(async_client):
    from omilo.models.base import prefixed_id
    from omilo.models.connectors import Connector
    from omilo.models.skills import Skill

    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Support", area="support")
    other = _seed_helper(c["company_id"], "Builder", area="dev")
    with _session() as s, s.begin():
        _set_company(s, c["company_id"])
        con = Connector(
            id=prefixed_id("con"), company_id=c["company_id"], source="native",
            slug="notion", label="Notion", kind="mcp",
        )
        own = Skill(id=prefixed_id("skl"), company_id=c["company_id"], helper_id=hid,
                    name="Dues reminder", body_md="Writes a reminder", created_by="helper")
        shared = Skill(id=prefixed_id("skl"), company_id=c["company_id"], helper_id=other,
                       name="Refund check", body_md="Checks refunds", created_by="operator")
        s.add_all([con, own, shared])
        s.flush()
        con_id, own_id, shared_id = con.id, own.id, shared.id

    tools = (await async_client.get(f"/v1/helpers/{hid}/tools", headers=c["h"])).json()
    assert tools["connectors"][0]["on"] is False
    assert {b["id"]: b["on"] for b in tools["builtins"]} == {
        "browser": True, "web_search": True, "code_runner": False,
    }
    r = await async_client.put(
        f"/v1/helpers/{hid}/tools",
        json={"connectors": [{"id": con_id, "on": True, "access": "ask"}], "builtins": {"code_runner": True}},
        headers=c["h"],
    )
    t = r.json()
    assert t["connectors"][0]["on"] and t["connectors"][0]["access"] == "ask"
    assert next(b for b in t["builtins"] if b["id"] == "code_runner")["on"] is True
    r = await async_client.put(
        f"/v1/helpers/{hid}/tools", json={"connectors": [{"id": con_id, "on": False}]}, headers=c["h"]
    )
    assert r.json()["connectors"][0]["on"] is False

    skills = (await async_client.get(f"/v1/helpers/{hid}/skills", headers=c["h"])).json()
    assert [s["id"] for s in skills] == [own_id]
    r = await async_client.put(
        f"/v1/helpers/{hid}/skills",
        json={"skills": [{"id": shared_id, "enabled": True, "permission": "ask"},
                         {"id": own_id, "enabled": False, "permission": "always"}]},
        headers=c["h"],
    )
    got = {s["id"]: s for s in r.json()}
    assert got[shared_id]["permission"] == "ask" and got[shared_id]["own"] is False
    assert got[own_id]["enabled"] is False

    files = (await async_client.get(f"/v1/helpers/{hid}/files", headers=c["h"])).json()
    assert [f["name"] for f in files] == ["PERSONA.md", "STYLE.md", "PLAYBOOK.md", "MEMORY.md"]
    assert files[2]["docId"] is None
    r = await async_client.put(
        f"/v1/helpers/{hid}/files/PLAYBOOK.md", json={"content": "# Dues\n1. Look it up"}, headers=c["h"]
    )
    assert r.status_code == 200 and r.json()["docId"]
    files = (await async_client.get(f"/v1/helpers/{hid}/files", headers=c["h"])).json()
    assert files[2]["content"].startswith("# Dues")
    r = await async_client.put(f"/v1/helpers/{hid}/files/SECRET.md", json={"content": "x"}, headers=c["h"])
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_budget_allow_one_more_job(async_client):
    from omilo.billing.balance import check_can_start_job
    from omilo.models.agents import Helper
    from omilo.models.tenancy import Company

    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Builder", area="dev")
    _seed_job(c["company_id"], hid, credits=100)
    await async_client.patch(f"/v1/helpers/{hid}", json={"budget_credits_month": 50}, headers=c["h"])

    rows = (await async_client.get("/v1/analytics/helpers", headers=c["h"])).json()
    row = next(r for r in rows if r["helperId"] == hid)
    assert row["budget"] == {"spent": 100, "limit": 50} and row["budgetReached"] is True

    r = await async_client.post(f"/v1/helpers/{hid}/budget/allow-one", headers=c["h"])
    assert r.status_code == 200 and r.json()["budgetAllowJobs"] == 1

    with _session() as s, s.begin():
        _set_company(s, c["company_id"])
        h = s.get(Helper, hid)
        co = s.get(Company, c["company_id"])
        assert check_can_start_job(s, co, h, engine_type="fake")[0] is True
        assert h.budget_allow_jobs == 0
        allowed, reason = check_can_start_job(s, co, h, engine_type="fake")
        assert (allowed, reason) == (False, "helper_budget_exceeded")


# ── Analytics ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_overview_ranges_prev_and_series(async_client):
    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Builder", area="dev")
    _seed_job(c["company_id"], hid, credits=10)
    _seed_job(c["company_id"], hid, status="failed", error="timed out", credits=5)
    _seed_job(c["company_id"], hid, credits=7, ago=timedelta(days=10))  # previous week

    for label in ("7 days", "week"):
        ov = (await async_client.get(f"/v1/analytics/overview?range={label}", headers=c["h"])).json()
        stats = {s["label"]: s for s in ov["stats"]}
        assert stats["Jobs done"]["value"] == 1 and stats["Jobs done"]["prev"] == 1
        assert stats["Spend"]["value"] == 15 and stats["Spend"]["prev"] == 7
        assert stats["Success rate"]["failed"] == 1
    series = {s["label"]: s for s in ov["series"]}
    assert sum(series["Done"]["values"]) == 1 and sum(series["Failed"]["values"]) == 1
    assert len(ov["buckets"]) == 7

    q = (await async_client.get("/v1/analytics/overview?range=90 days", headers=c["h"])).json()
    assert len(q["buckets"]) == 13
    assert {s["label"]: s for s in q["stats"]}["Jobs done"]["value"] == 2

    spend = (await async_client.get("/v1/analytics/spend-by-channel?range=week", headers=c["h"])).json()
    assert spend["total"] == 15 and spend["series"][0]["label"] == "General"
    tok = (await async_client.get("/v1/analytics/tokens-by-helper?range=week", headers=c["h"])).json()
    assert tok["total"] == 300 and tok["series"][0]["label"] == "Builder"


@pytest.mark.asyncio
async def test_channel_filter(async_client):
    c = await _company(async_client)
    a = _seed_helper(c["company_id"], "A", channel_ids=["chn_x"])
    b = _seed_helper(c["company_id"], "B", channel_ids=["chn_y"])
    _seed_job(c["company_id"], a, credits=3)
    _seed_job(c["company_id"], b, credits=4)
    ov = (await async_client.get("/v1/analytics/overview?channel_id=chn_x", headers=c["h"])).json()
    assert {s["label"]: s for s in ov["stats"]}["Spend"]["value"] == 3
    rows = (await async_client.get("/v1/analytics/helpers?channel_id=chn_x", headers=c["h"])).json()
    assert [r["helperId"] for r in rows] == [a]


@pytest.mark.asyncio
async def test_loops_reliability_failures_retry(async_client):
    from omilo.models.base import prefixed_id
    from omilo.models.routines import Routine

    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Builder", area="dev")
    with _session() as s, s.begin():
        _set_company(s, c["company_id"])
        s.add(Routine(id=prefixed_id("rtn"), company_id=c["company_id"], helper_id=hid,
                      name="Nightly build", freq="weekdays", at="01:00"))
    loops = (await async_client.get("/v1/analytics/loops", headers=c["h"])).json()
    assert loops[0]["name"] == "Nightly build" and loops[0]["schedule"] == "Weekdays · 01:00"
    assert loops[0]["kind"] == "routine" and loops[0]["on"] is True

    failed = _seed_job(c["company_id"], hid, status="failed", error="GitHub token expired")
    _seed_job(c["company_id"], hid, status="failed", error="429 rate limit")
    _seed_job(c["company_id"], hid, status="done", attempts=2)

    rel = (await async_client.get("/v1/analytics/reliability", headers=c["h"])).json()
    stats = {s["label"]: s for s in rel["stats"]}
    assert stats["Failed jobs"]["value"] == 2
    assert stats["Retried and recovered"]["value"] == 1
    assert {x["label"] for x in rel["causes"]} == {"Expired or missing connection", "Rate limits"}

    fails = (await async_client.get("/v1/analytics/failures", headers=c["h"])).json()
    by = {f["jobId"]: f for f in fails}
    assert by[failed]["action"] == "connect" and by[failed]["status"] == "failed"
    assert any(f["status"] == "recovered" for f in fails)

    r = await async_client.post(f"/v1/jobs/{failed}/retry", headers=c["h"])
    assert r.status_code == 200, r.text
    assert r.json()["attempts"] == 2
    r = await async_client.post(f"/v1/jobs/{failed}/retry", headers=c["h"])
    assert r.status_code == 409  # no longer failed


@pytest.mark.asyncio
async def test_activity_feed(async_client):
    c = await _company(async_client)
    hid = _seed_helper(c["company_id"], "Builder", area="dev")
    other = _seed_helper(c["company_id"], "Support", area="support")
    _seed_job(c["company_id"], hid, brief="Fix OTP", ago=timedelta(minutes=5))
    _seed_job(c["company_id"], hid, status="failed", error="timeout", brief="Latency report",
              ago=timedelta(minutes=10))
    _seed_job(c["company_id"], other, status="running", brief="Triage", ago=timedelta(minutes=1))

    feed = (await async_client.get("/v1/activity", headers=c["h"])).json()
    kinds = [i["kind"] for i in feed["items"]]
    assert kinds == ["started", "done", "failed"]
    assert feed["items"][1]["what"] == "finished Fix OTP"
    assert feed["counts"]["done"] == 1 and feed["counts"]["failed"] == 1

    f = (await async_client.get("/v1/activity?kinds=failed", headers=c["h"])).json()
    assert [i["kind"] for i in f["items"]] == ["failed"]
    f = (await async_client.get(f"/v1/activity?helper={other}", headers=c["h"])).json()
    assert [i["who"] for i in f["items"]] == ["Support"]
    page = (await async_client.get("/v1/activity?limit=1", headers=c["h"])).json()
    assert len(page["items"]) == 1 and page["nextCursor"]
    nxt = (
        await async_client.get("/v1/activity", params={"limit": 1, "cursor": page["nextCursor"]}, headers=c["h"])
    ).json()
    assert nxt["items"][0]["kind"] == "done"


# ── Runner behavior wiring ────────────────────────────────────────────────────


def test_behavior_instructions_and_spend_cap():
    from types import SimpleNamespace

    from omilo.loop.behavior import build_helper_instructions, spend_cap_credits

    h = SimpleNamespace(
        job_description="You are Support.",
        title="Resident support",
        behavior={
            "language": "Bahasa Indonesia",
            "never_discuss": ["Legal", "Politics"],
            "handoff_to": "owner",
            "spend_per_task_idr": 50000,
            "messages_per_hour": 60,
        },
    )
    text = build_helper_instructions(h)
    assert "You are Support." in text
    assert "Bahasa Indonesia" in text and "Legal, Politics" in text
    assert "Rp 50.000" in text and "60 messages" in text
    assert spend_cap_credits(h) == 1000  # Rp 50.000 at Rp 50 per credit (billing.catalog)
    assert spend_cap_credits(SimpleNamespace(behavior={})) is None
