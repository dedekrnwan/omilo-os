"""The calendar: shift runs expanded from cron in the company's time zone, jobs, skipping one run, the upcoming list."""
import datetime as dt
from zoneinfo import ZoneInfo

from conftest import wait_for

JKT = ZoneInfo("Asia/Jakarta")


def _setup(owner):
    from omilo_api import services as S
    from omilo_api.db import session_scope

    with session_scope() as db:
        S.set_setting(db, "timezone", "Asia/Jakarta")
    sh = owner.post("/api/staff/sales/shifts", json={"name": "calendar-check", "cron": "15 9 * * *", "brief": "Check the calendar\nmore"}).json()
    return sh


def test_events_upcoming_skip_and_run_now(owner):
    sh = _setup(owner)
    t0 = dt.datetime.now(dt.UTC)
    r = owner.get("/api/calendar", params={"start": t0.isoformat(), "end": (t0 + dt.timedelta(days=7)).isoformat(), "staff_id": "sales"})
    assert r.status_code == 200 and r.json()["timezone"] == "Asia/Jakarta"
    mine = [e for e in r.json()["events"] if e["kind"] == "shift" and e["ref_id"] == sh["id"]]
    assert len(mine) == 7, "one run a day for a week"
    first = dt.datetime.fromisoformat(mine[0]["start"]).astimezone(JKT)
    assert (first.hour, first.minute) == (9, 15) and mine[0]["title"] == "Calendar check" and mine[0]["detail"] == "Check the calendar"
    assert mine[0]["status"] == "scheduled" and mine[0]["end"] > mine[0]["start"]
    assert mine[0]["when"] == "Every day at 09:15" and mine[0]["brief"] == "Check the calendar more" and mine[0]["typical_min"] >= 5
    starts = [e["start"] for e in r.json()["events"]]
    assert starts == sorted(starts)

    # range limits
    assert owner.get("/api/calendar", params={"start": t0.isoformat(), "end": (t0 + dt.timedelta(days=90)).isoformat()}).status_code == 400
    assert owner.get("/api/calendar", params={"start": "nope", "end": t0.isoformat()}).status_code == 400

    # the upcoming list pages forward, oldest first, never repeating
    page1 = owner.get("/api/calendar/upcoming", params={"limit": 5, "staff_id": "sales"}).json()
    later = [i for i in page1["items"] if not i.get("now")]
    assert len(later) == 5 and page1["next"]
    page2 = owner.get("/api/calendar/upcoming", params={"limit": 5, "staff_id": "sales", **page1["next"]}).json()
    assert not any(i.get("now") for i in page2["items"]), "jobs running now only on the first page"
    allx = later + page2["items"]
    assert [i["start"] for i in allx] == sorted(i["start"] for i in allx) and len({i["id"] for i in allx}) == 10
    assert all(i["start"] > t0.isoformat()[:19] for i in allx)

    # skip one run: shown crossed out, and the worker lets it pass
    at = mine[1]["start"]
    assert owner.post(f"/api/shifts/{sh['id']}/skip", json={"at": "2020-01-01T00:00:00+00:00"}).status_code == 409
    assert owner.post(f"/api/shifts/{sh['id']}/skip", json={"at": (dt.datetime.fromisoformat(at) + dt.timedelta(minutes=3)).isoformat()}).status_code == 400
    assert owner.post(f"/api/shifts/{sh['id']}/skip", json={"at": at}).json()["at"] == at
    r = owner.get("/api/calendar", params={"start": t0.isoformat(), "end": (t0 + dt.timedelta(days=7)).isoformat(), "staff_id": "sales"})
    assert next(e for e in r.json()["events"] if e["start"] == at and e["ref_id"] == sh["id"])["status"] == "skipped"
    assert owner.delete(f"/api/shifts/{sh['id']}/skip", params={"at": at}).status_code == 200
    r = owner.get("/api/calendar", params={"start": t0.isoformat(), "end": (t0 + dt.timedelta(days=7)).isoformat(), "staff_id": "sales"})
    assert next(e for e in r.json()["events"] if e["start"] == at and e["ref_id"] == sh["id"])["status"] == "scheduled"

    # paused: still on the calendar (to resume it), not in the upcoming list
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": False})
    r = owner.get("/api/calendar", params={"start": t0.isoformat(), "end": (t0 + dt.timedelta(days=2)).isoformat(), "staff_id": "sales"})
    assert {e["status"] for e in r.json()["events"] if e["ref_id"] == sh["id"]} == {"paused"}
    up = owner.get("/api/calendar/upcoming", params={"limit": 50, "staff_id": "sales"}).json()
    assert not any(i.get("ref_id") == sh["id"] for i in up["items"]), [(i["start"], i["status"], i.get("cron"), i["title"]) for i in up["items"] if i.get("ref_id") == sh["id"]][:2]
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": True})

    # run now: a job from that shift, on the calendar and at the top of the list
    t = owner.post(f"/api/shifts/{sh['id']}/run").json()
    assert t["staff_id"] == "sales"
    r = owner.get("/api/calendar", params={"start": (t0 - dt.timedelta(hours=1)).isoformat(), "end": (t0 + dt.timedelta(days=1)).isoformat()})
    job = next(e for e in r.json()["events"] if e["kind"] == "task" and e["ref_id"] == t["id"])
    assert job["title"] == "Calendar check" and job["shift_id"] == sh["id"]
    wait_for(lambda: owner.get(f"/api/tasks/{t['id']}").json()["status"] in ("done", "failed"), timeout=20)
    r = owner.get("/api/calendar", params={"start": (t0 - dt.timedelta(hours=1)).isoformat(), "end": (t0 + dt.timedelta(days=1)).isoformat()})
    assert next(e for e in r.json()["events"] if e["ref_id"] == t["id"])["status"] in ("done", "failed"), "past runs stay as history"
    owner.delete(f"/api/shifts/{sh['id']}")


def test_worker_lets_a_skipped_run_pass(owner):
    from sqlalchemy import select

    from omilo_api import agenda
    from omilo_api.db import session_scope
    from omilo_api.models import Shift, ShiftSkip, Task, now
    from omilo_api.worker import Worker

    sh = _setup(owner)
    due = now().replace(microsecond=0) - dt.timedelta(seconds=5)
    with session_scope() as db:
        s = db.get(Shift, sh["id"])
        s.next_at = due
        db.add(ShiftSkip(shift_id=s.id, at=due))
    Worker().schedule_shifts()
    with session_scope() as db:
        s = db.get(Shift, sh["id"])
        assert s.next_at > now() and not db.scalars(select(Task).where(Task.shift_id == s.id)).first()
        assert agenda.is_skipped(db, s, due)
    owner.delete(f"/api/shifts/{sh['id']}")


def test_upcoming_keeps_runs_at_the_same_time_across_pages(owner):
    _setup(owner)
    a = owner.post("/api/staff/finance/shifts", json={"name": "tie-a", "cron": "17 3 * * *"}).json()
    b = owner.post("/api/staff/finance/shifts", json={"name": "tie-b", "cron": "17 3 * * *"}).json()
    c = owner.post("/api/staff/finance/shifts", json={"name": "tie-c", "cron": "17 3 * * *"}).json()
    seen, cur = [], None
    for _ in range(30):  # one item a page: three runs share every timestamp (the helper has other jobs too)
        if len(seen) >= 6:
            break
        r = owner.get("/api/calendar/upcoming", params={"limit": 1, "staff_id": "finance", **(cur or {})}).json()
        seen += [i["id"] for i in r["items"] if not i.get("now") and i["ref_id"] in (a["id"], b["id"], c["id"])]
        cur = r["next"]
    assert len(seen) >= 6 and len(set(seen)) == len(seen), seen
    assert {s.split(":")[1] for s in seen[:3]} == {a["id"], b["id"], c["id"]}, "all three runs of the first day, none lost"

    # resuming a paused job does not fire the run it missed
    owner.patch(f"/api/shifts/{a['id']}", json={"enabled": False})
    from omilo_api.db import session_scope
    from omilo_api.models import Shift, now

    with session_scope() as db:
        db.get(Shift, a["id"]).next_at = now() - dt.timedelta(hours=3)
    sh = owner.patch(f"/api/shifts/{a['id']}", json={"enabled": True}).json()
    assert dt.datetime.fromisoformat(sh["next_at"]) > dt.datetime.now(dt.UTC)
    for x in (a, b, c):
        owner.delete(f"/api/shifts/{x['id']}")
