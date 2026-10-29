"""sweep/goals-routines — cadence fixes, run history, schedule, run detail,
preview/clash, Chief suggestions, feedback/resend, job cancel, pause-until,
and the Goal status/due/measured_by/helper_ids/period/session fields.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from tests.utils import run_alembic


@pytest.fixture(scope="module", autouse=True)
def ensure_schema():
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, result.stdout + result.stderr
    yield


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _seed(company_id: str) -> dict:
    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.base import prefixed_id
    from omilo.models.workspace import Channel

    ids = {}
    with SessionLocal() as s:
        with s.begin():
            for key, name, chief in (("chief", "Chief", True), ("ops", "Ops", False), ("fin", "Finance", False)):
                h = Helper(
                    id=prefixed_id("hlp"), company_id=company_id, name=name, area="ops",
                    is_chief=chief, engine={"type": "fake"}, autonomy_cap=None,
                    permissions=[], status="active", channel_ids=[],
                )
                s.add(h)
                ids[key] = h.id
            ch = Channel(
                id=prefixed_id("chn"), company_id=company_id, name="Eng", accent="dev",
                is_default=True, agent_count=1, chat_count=0, open_items=0,
            )
            s.add(ch)
            ids["channel"] = ch.id
    return ids


@pytest.fixture()
async def co(async_client):
    email = f"sweep_{uuid.uuid4().hex[:8]}@test.example"
    r = await async_client.post(
        "/v1/auth/sign-up", json={"email": email, "name": "Sweep", "password": "testP4ss!"}
    )
    assert r.status_code == 201, r.text
    token = r.json()["session"]["access"]
    me = await async_client.get("/v1/me", headers=_auth(token))
    company_id = me.json()["company"]["id"]
    return token, company_id, _seed(company_id)


async def _create(client, token, helper_id, **kw):
    body = {
        "helper_id": helper_id, "name": kw.pop("name", "R"), "instructions": "Do it.",
        "freq": "daily", "at": "09:00", "timezone": "UTC",
    }
    body.update(kw)
    r = await client.post("/v1/routines", json=body, headers=_auth(token))
    assert r.status_code == 201, r.text
    return r.json()["routine"]


# ── cadence ─────────────────────────────────────────────────────────────────


def test_cadence_build_cron_and_last_working_day():
    from omilo.scheduler.cadence import build_cron, iter_fires, last_working_day

    assert build_cron("Weekly", "09:00", [0, 3], None) == "0 9 * * 1,4"
    assert build_cron("Weekdays", "07:30", None, None) == "30 7 * * 1-5"
    assert build_cron("monthly", "09:00", None, "date") == "0 9 1 * *"
    # Oct 31 2026 is a Saturday → last working day is Fri Oct 30.
    assert last_working_day(2026, 10) == date(2026, 10, 30)
    r = {"freq": "monthly", "at": "09:00", "monthly": "last-working-day", "timezone": "UTC"}
    fires = iter_fires(r, datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2027, 1, 1, tzinfo=timezone.utc))
    assert [f.date() for f in fires] == [date(2026, 10, 30), date(2026, 11, 30), date(2026, 12, 31)]


@pytest.mark.asyncio
async def test_create_weekly_capitalised_freq_respects_days(async_client, co):
    token, _, ids = co
    r = await _create(async_client, token, ids["ops"], freq="Weekly", days=[0, 3], at="09:00")
    assert r["freq"] == "weekly"
    assert r["cron"] == "0 9 * * 1,4"
    nxt = datetime.fromisoformat(r["next_at"])
    assert nxt.weekday() in (0, 3)
    assert r["allow_chief_shift"] is True and r["skip_holidays"] is False
    assert r["recent_runs"] == []


@pytest.mark.asyncio
async def test_create_monthly_last_working_day(async_client, co):
    token, _, ids = co
    r = await _create(async_client, token, ids["ops"], freq="Monthly", monthly="last-working-day")
    assert r["monthly"] == "last_working_day"
    nxt = datetime.fromisoformat(r["next_at"]).date()
    from omilo.scheduler.cadence import last_working_day
    assert nxt == last_working_day(nxt.year, nxt.month)


# ── runs ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_run_now_records_history_and_detail(async_client, co):
    token, _, ids = co
    r = await _create(async_client, token, ids["ops"], name="Digest")
    run = await async_client.post(f"/v1/routines/{r['id']}/run-now", headers=_auth(token))
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["job_id"].startswith("job_") and body["run_id"].startswith("rrn_")
    assert body["outcome"] in ("ok", "fail")

    lst = (await async_client.get("/v1/routines", headers=_auth(token))).json()
    row = next(x for x in lst if x["id"] == r["id"])
    assert len(row["recent_runs"]) == 1
    assert row["recent_runs"][0]["trigger"] == "manual"
    assert row["last_at"] is not None

    det = await async_client.get(f"/v1/routines/{r['id']}/runs/{body['run_id']}", headers=_auth(token))
    assert det.status_code == 200, det.text
    d = det.json()
    assert d["job"]["id"] == body["job_id"]
    assert d["running"] is False
    assert d["steps"][0]["text"].startswith("Run started")
    assert d["routine"]["helper_name"] == "Ops"
    if d["job"]["status"] == "done":
        assert d["output"] is not None

    # feedback
    fb = await async_client.post(
        f"/v1/routines/runs/{body['run_id']}/feedback", json={"vote": "up"}, headers=_auth(token)
    )
    assert fb.status_code == 200 and fb.json()["run"]["feedback"] == "up"
    bad = await async_client.post(
        f"/v1/routines/runs/{body['run_id']}/feedback", json={"vote": "meh"}, headers=_auth(token)
    )
    assert bad.status_code == 422

    # resend → re-runs (no delivery infra) and says so
    rs = await async_client.post(f"/v1/routines/runs/{body['run_id']}/resend", headers=_auth(token))
    assert rs.status_code == 200
    assert rs.json()["resent"] is False and rs.json()["job_id"].startswith("job_")

    # job already finished → cancel 409
    c = await async_client.post(f"/v1/jobs/{body['job_id']}/cancel", headers=_auth(token))
    assert c.status_code == 409


@pytest.mark.asyncio
async def test_cancel_running_job(async_client, co):
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.execution import Job

    token, company_id, ids = co
    job_id = prefixed_id("job")
    with SessionLocal() as s:
        with s.begin():
            s.add(Job(
                id=job_id, company_id=company_id, helper_id=ids["ops"], origin="routine",
                brief="x", status="running", cost_credits=0, tokens_in=0, tokens_out=0,
                attempts=1, checkpoint={},
            ))
    c = await async_client.post(f"/v1/jobs/{job_id}/cancel", headers=_auth(token))
    assert c.status_code == 200, c.text
    assert c.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_skip_next_records_skip(async_client, co):
    token, _, ids = co
    r = await _create(async_client, token, ids["ops"])
    before = r["next_at"]
    sk = await async_client.post(f"/v1/routines/{r['id']}/skip-next", headers=_auth(token))
    assert sk.status_code == 200
    assert sk.json()["next_at"] > before
    det = (await async_client.get(f"/v1/routines/{r['id']}", headers=_auth(token))).json()
    assert det["runs"][0]["outcome"] == "skip"


# ── schedule ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_schedule_expands_week(async_client, co):
    token, _, ids = co
    r = await _create(async_client, token, ids["ops"], freq="weekdays", at="07:30", name="Brief")
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    await async_client.post(f"/v1/routines/{r['id']}/run-now", headers=_auth(token))
    res = await async_client.get(
        "/v1/routines/schedule",
        params={"from": start.isoformat(), "to": end.isoformat()},
        headers=_auth(token),
    )
    assert res.status_code == 200, res.text
    items = [i for i in res.json()["items"] if i["routine_id"] == r["id"]]
    scheduled = [i for i in items if i["trigger"] == "schedule"]
    assert len(scheduled) == 5
    assert all(datetime.fromisoformat(i["at"]).weekday() < 5 for i in scheduled)
    assert any(i["trigger"] == "manual" for i in items)
    assert {i["status"] for i in scheduled} <= {"scheduled", "missed", "ok", "fail", "skip"}


# ── preview + suggestions ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_preview_detects_clash_and_offers_slots(async_client, co):
    token, _, ids = co
    await _create(async_client, token, ids["fin"], name="Payout reconcile", freq="weekly", days=[4], at="15:00")
    pv = await async_client.post(
        "/v1/routines/preview",
        json={"freq": "weekly", "days": [4], "at": "15:15", "helper_id": ids["fin"], "timezone": "UTC"},
        headers=_auth(token),
    )
    assert pv.status_code == 200, pv.text
    p = pv.json()
    assert p["clashes"][0]["name"] == "Payout reconcile"
    assert 1 <= len(p["suggested_slots"]) <= 3
    assert p["suggested_slots"][0]["recommended"] is True
    assert datetime.fromisoformat(p["next_at"]).weekday() == 4

    free = await async_client.post(
        "/v1/routines/preview",
        json={"freq": "daily", "at": "11:00", "helper_id": ids["fin"], "timezone": "UTC"},
        headers=_auth(token),
    )
    assert free.json()["clashes"] == [] and len(free.json()["next_dates"]) == 3


@pytest.mark.asyncio
async def test_suggestions_apply_and_dismiss(async_client, co):
    token, _, ids = co
    a = await _create(async_client, token, ids["ops"], name="A", at="08:00")
    b = await _create(async_client, token, ids["ops"], name="B", at="08:10")
    sugs = (await async_client.get("/v1/routines/suggestions", headers=_auth(token))).json()
    clash = next(s for s in sugs if s["kind"] == "clash")
    assert clash["moves"][0]["routine_id"] == b["id"]
    assert clash["moves"][0]["to_at"] == "09:00"

    ap = await async_client.post(f"/v1/routines/suggestions/{clash['id']}/apply", headers=_auth(token))
    assert ap.status_code == 200, ap.text
    moved = (await async_client.get(f"/v1/routines/{b['id']}", headers=_auth(token))).json()["routine"]
    assert moved["at"] == "09:00"
    sugs = (await async_client.get("/v1/routines/suggestions", headers=_auth(token))).json()
    assert not any(s["kind"] == "clash" for s in sugs)

    # A fresh clash, dismissed, stays gone.
    await _create(async_client, token, ids["ops"], name="C", at="08:05")
    sugs = (await async_client.get("/v1/routines/suggestions", headers=_auth(token))).json()
    c = next(s for s in sugs if s["kind"] == "clash")
    d = await async_client.post(f"/v1/routines/suggestions/{c['id']}/dismiss", headers=_auth(token))
    assert d.status_code == 200
    sugs = (await async_client.get("/v1/routines/suggestions", headers=_auth(token))).json()
    assert not any(s["id"] == c["id"] for s in sugs)
    assert a["id"]


@pytest.mark.asyncio
async def test_failing_suggestion_pauses(async_client, co):
    from omilo.db import SessionLocal
    from omilo.models.base import prefixed_id
    from omilo.models.routines import RoutineRun

    token, company_id, ids = co
    r = await _create(async_client, token, ids["ops"], name="Flaky", at="13:00")
    with SessionLocal() as s:
        with s.begin():
            for i in range(3):
                s.add(RoutineRun(
                    id=prefixed_id("rrn"), company_id=company_id, routine_id=r["id"],
                    when=datetime.now(timezone.utc) - timedelta(days=3 - i), outcome="fail",
                    skipped=False, cost_credits=0, error="Connector expired",
                    created_at=datetime.now(timezone.utc) - timedelta(days=3 - i),
                ))
    sugs = (await async_client.get("/v1/routines/suggestions", headers=_auth(token))).json()
    f = next(s for s in sugs if s["kind"] == "failing")
    assert "Connector expired" in f["desc"]
    await async_client.post(f"/v1/routines/suggestions/{f['id']}/apply", headers=_auth(token))
    got = (await async_client.get(f"/v1/routines/{r['id']}", headers=_auth(token))).json()["routine"]
    assert got["paused"] is True


# ── pause until + flags ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_paused_until_auto_resumes_on_tick(async_client, co):
    from omilo.db import SessionLocal
    from omilo.models.routines import Routine
    from omilo.scheduler.tick import scheduler_tick

    token, company_id, ids = co
    r = await _create(async_client, token, ids["ops"])
    until = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    p = await async_client.patch(
        f"/v1/routines/{r['id']}",
        json={"paused_until": until, "allow_chief_shift": False, "skip_holidays": True, "ask_before_sending": True},
        headers=_auth(token),
    )
    assert p.status_code == 200, p.text
    got = p.json()["routine"]
    assert got["paused"] is True and got["paused_until"] is not None
    assert got["allow_chief_shift"] is False and got["skip_holidays"] is True
    assert got["ask_before_sending"] is True

    later = datetime.now(timezone.utc) + timedelta(days=3)
    with SessionLocal() as db:
        with db.begin():
            db.execute(text(f"SET LOCAL app.company_id = '{company_id}'"))
            scheduler_tick(db, later)
    with SessionLocal() as db:
        row = db.get(Routine, r["id"])
        assert row.paused is False and row.paused_until is None

    # Resume clears paused_until.
    await async_client.patch(f"/v1/routines/{r['id']}", json={"paused_until": until}, headers=_auth(token))
    res = await async_client.patch(f"/v1/routines/{r['id']}", json={"paused": False}, headers=_auth(token))
    assert res.json()["routine"]["paused_until"] is None


# ── goals ───────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_goal_fields_status_and_session(async_client, co):
    token, _, ids = co
    cr = await async_client.post(
        "/v1/goals",
        json={
            "channel_id": ids["channel"], "title": "Passkeys", "target": "100% of logins",
            "due": "2026-12-31", "measured_by": "Share of passwordless logins",
            "helper_ids": [ids["ops"]], "draft_key_results": False,
        },
        headers=_auth(token),
    )
    assert cr.status_code == 200, cr.text
    goal = cr.json()["goal"]
    assert cr.json()["job_count"] == 0
    assert goal["due"] == "2026-12-31" and goal["period"] == "2026-Q4"
    assert goal["measuredBy"] == "Share of passwordless logins"
    assert goal["helperIds"] == [ids["ops"]]
    assert goal["target"] == "100% of logins"
    assert goal["status"] in ("on_track", "at_risk")

    lst = (await async_client.get("/v1/goals", headers=_auth(token))).json()
    row = next(g for g in lst if g["id"] == goal["id"])
    assert row["status"] in ("on_track", "at_risk") and row["measuredBy"]
    ch = (await async_client.get(f"/v1/channels/{ids['channel']}/goals", headers=_auth(token))).json()
    assert ch[0]["status"]

    # user override then back to auto
    p = await async_client.patch(f"/v1/goals/{goal['id']}", json={"status": "blocked"}, headers=_auth(token))
    assert p.json()["goal"]["status"] == "blocked"
    p = await async_client.patch(f"/v1/goals/{goal['id']}", json={"status": "auto"}, headers=_auth(token))
    assert p.json()["goal"]["status"] != "blocked"
    bad = await async_client.patch(f"/v1/goals/{goal['id']}", json={"status": "nope"}, headers=_auth(token))
    assert bad.status_code == 422

    s1 = await async_client.post(f"/v1/goals/{goal['id']}/session", headers=_auth(token))
    s2 = await async_client.post(f"/v1/goals/{goal['id']}/session", headers=_auth(token))
    assert s1.status_code == 200, s1.text
    assert s1.json()["id"] == s2.json()["id"]
    assert s1.json()["goal"] == "Passkeys"

    # Planning honours draft_key_results=True and assigned helpers.
    cr2 = await async_client.post(
        "/v1/goals",
        json={"channel_id": ids["channel"], "title": "Uptime", "target": "99.95 percent uptime",
              "helper_ids": [ids["fin"]]},
        headers=_auth(token),
    )
    assert cr2.json()["job_count"] >= 2
    det = (await async_client.get(f"/v1/goals/{cr2.json()['goal']['id']}", headers=_auth(token))).json()
    deleg = [j for j in det["jobs"] if j["origin"] == "delegation"]
    assert deleg and all(j["helperId"] == ids["fin"] for j in deleg)
