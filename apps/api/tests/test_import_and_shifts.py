import datetime as dt
from pathlib import Path

from conftest import wait_for

from omilo_api.importer import oncalendar_to_cron

PROTO = Path(__file__).resolve().parents[3] / "legacy" / "prototype"


def test_oncalendar_conversion():
    assert oncalendar_to_cron("*-*-* *:05:00 Asia/Jakarta") == "5 * * * *"
    assert oncalendar_to_cron("*-*-* 01,13:00:00 Asia/Jakarta") == "0 01,13 * * *"
    assert oncalendar_to_cron("Mon *-*-* 08:00:00 Asia/Jakarta") == "0 08 * * 1"
    assert oncalendar_to_cron("Tue,Thu *-*-* 09:00:00 Asia/Jakarta") == "0 09 * * 2,4"


def test_import_prototype(owner):
    files = {}
    for p in PROTO.rglob("*"):
        if p.is_file() and p.suffix in (".json", ".md"):
            files[str(p.relative_to(PROTO))] = p.read_text()
    out = owner.post("/api/import/prototype", json={"files": files}).json()
    assert out["knowledge"] >= 4, out
    assert not out["skipped"], out
    names = {k["name"] for k in owner.get("/api/knowledge").json()}
    assert {"pricing.md", "goals.md", "brand-voice.md"} <= names


def test_shift_fires(owner):
    sh = owner.post("/api/staff/ops/shifts", json={"name": "every-minute", "cron": "* * * * *", "brief": "tick"}).json()
    # make it due now
    from omilo_api.db import session_scope
    from omilo_api.models import Shift

    with session_scope() as db:
        db.get(Shift, sh["id"]).next_at = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1)
    wait_for(lambda: any(t["origin"] == "shift" for t in owner.get("/api/tasks", params={"staff_id": "ops"}).json()))
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": False})


def test_shift_catchup_fresh_fires_once(owner):
    """A run missed during a SHORT outage (within the grace window) fires one catch-up, tagged."""
    from sqlalchemy import select

    from omilo_api.db import session_scope
    from omilo_api.models import Shift, Task

    sh = owner.post("/api/staff/ops/shifts", json={"name": "hourly-fresh", "cron": "0 * * * *", "brief": "fresh"}).json()
    with session_scope() as db:
        db.get(Shift, sh["id"]).next_at = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=5)  # fresh miss (< 1h grace)

    def fired():
        with session_scope() as db:
            rows = [(t.origin, t.created_by) for t in db.scalars(select(Task).where(Task.shift_id == sh["id"]))]
            return rows or None

    rows = wait_for(fired)
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": False})
    assert any(origin == "shift" and created_by == "catchup" for origin, created_by in rows), rows


def test_shift_catchup_stale_skipped_and_logged(owner):
    """A run missed during a LONG outage (older than grace) fires nothing but is audited, not silent."""
    from sqlalchemy import select

    from omilo_api.db import session_scope
    from omilo_api.models import AuditEvent, Shift, Task

    sh = owner.post("/api/staff/ops/shifts", json={"name": "hourly-stale", "cron": "0 * * * *", "brief": "stale"}).json()
    with session_scope() as db:
        db.get(Shift, sh["id"]).next_at = dt.datetime.now(dt.UTC) - dt.timedelta(days=2)  # way past the grace window

    def advanced():  # wait until the worker has processed it (next_at pushed back to the future)
        with session_scope() as db:
            na = db.get(Shift, sh["id"]).next_at
            return na if na and na > dt.datetime.now(dt.UTC) else None

    wait_for(advanced)
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": False})
    with session_scope() as db:
        tasks = db.scalars(select(Task).where(Task.shift_id == sh["id"])).all()
        missed = db.scalars(select(AuditEvent).where(AuditEvent.action == "shift.missed", AuditEvent.ref == sh["id"])).all()
    assert tasks == [], "a stale slot must fire nothing"
    assert missed, "a dropped stale slot must be logged (shift.missed), not silent"
