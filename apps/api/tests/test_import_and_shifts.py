import datetime as dt
from pathlib import Path

from conftest import wait_for

from saga_api.importer import oncalendar_to_cron

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
    from saga_api.db import session_scope
    from saga_api.models import Shift

    with session_scope() as db:
        db.get(Shift, sh["id"]).next_at = dt.datetime.now(dt.UTC) - dt.timedelta(seconds=1)
    wait_for(lambda: any(t["origin"] == "shift" for t in owner.get("/api/tasks", params={"staff_id": "ops"}).json()))
    owner.patch(f"/api/shifts/{sh['id']}", json={"enabled": False})
