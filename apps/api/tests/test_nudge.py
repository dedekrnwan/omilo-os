"""M3: the nudge ladder, quiet hours and focus, snooze, the push cap, notification buttons and the morning brief."""
import datetime as dt
import json
from zoneinfo import ZoneInfo

import httpx
import pytest
import pywebpush
from conftest import wait_for

JKT = ZoneInfo("Asia/Jakarta")


def local(y, mo, d, h, mi=0):
    return dt.datetime(y, mo, d, h, mi, tzinfo=JKT).astimezone(dt.UTC)


@pytest.fixture
def quiet_worker(monkeypatch):
    """Keep the background worker's own ladder out of the way: these tests drive it with chosen clock times."""
    from omilo_api.worker import Worker

    monkeypatch.setattr(Worker, "nudges", lambda self: None)


@pytest.fixture
def jakarta(owner):
    from omilo_api import services as S
    from omilo_api.db import session_scope

    with session_scope() as db:
        S.set_setting(db, "timezone", "Asia/Jakarta")
    yield


def _item(created, kind="question", level="decision", blocking=False, staff="support", title="Which price?"):
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem

    with session_scope() as db:
        i = InboxItem(kind=kind, staff_id=staff, title=title, body=title, level=level, blocking=blocking, created_at=created)
        db.add(i)
        db.flush()
        return i.id


def _proposal(owner_id, risk="low", type_="content.publish", title="Post the weekly tip"):
    from sqlalchemy import select

    from omilo_api import services as S
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem, Staff

    with session_scope() as db:
        p = S.create_proposal(db, db.get(Staff, "marketing"), None, title, type_, risk, "Tip of the week: …", actor=owner_id)
        item = db.scalar(select(InboxItem).where(InboxItem.ref_id == p.id))
        return p.id, item.id


def _tick(iid, at, owner_id=None):
    from omilo_api import nudge
    from omilo_api.db import session_scope

    with session_scope() as db:
        return nudge.tick(db, owner_id, at=at, only={iid})


def _owner_id():
    from sqlalchemy import select

    from omilo_api import company as C
    from omilo_api.db import session_scope
    from omilo_api.models import User

    with session_scope(C.MAIN) as db:
        return db.scalar(select(User.id).order_by(User.created_at))


def _nudges(iid):
    from sqlalchemy import select

    from omilo_api.db import session_scope
    from omilo_api.models import Notice

    with session_scope() as db:
        return [(n.title, n.level) for n in db.scalars(select(Notice).where(Notice.item_id == iid, Notice.kind == "nudge").order_by(Notice.id))]


# ------------------------------------------------------------------ pure rules
def test_quiet_hours_over_midnight_focus_and_old_prefs(owner, jakarta):
    from omilo_api import notify as N
    from omilo_api.db import session_scope

    with session_scope() as db:
        p = N._normalize({"inbox": False, "reply": True})  # the older one-switch-per-type format
        assert p["kinds"]["inbox"] == {"push": False, "app": False} and p["quiet"] == {"on": True, "start": "22:00", "end": "07:00"}
        assert N.is_quiet(db, p, local(2026, 10, 19, 23, 30)) and N.is_quiet(db, p, local(2026, 10, 20, 6, 59))
        assert not N.is_quiet(db, p, local(2026, 10, 20, 7, 0)) and not N.is_quiet(db, p, local(2026, 10, 20, 21, 59))
        day = {**p, "quiet": {"on": True, "start": "12:00", "end": "13:00"}}
        assert N.is_quiet(db, day, local(2026, 10, 20, 12, 30)) and not N.is_quiet(db, day, local(2026, 10, 20, 13, 30))
        assert not N.is_quiet(db, {**p, "quiet": {"on": False, "start": "22:00", "end": "07:00"}}, local(2026, 10, 19, 23, 30))
        f = N.focus_until(db, "2h")
        focused = {**p, "focus": f}
        assert N.in_focus(focused) and not N.in_focus(focused, local(2020, 1, 1, 10))
        assert N.held(db, focused, "decision") and not N.held(db, focused, "critical")
        with pytest.raises(ValueError):
            N.focus_until(db, "99h")


def test_push_cap_merges_the_overflow(owner):
    from omilo_api import notify as N
    from omilo_api.db import session_scope
    from omilo_api.models import Notice

    rows = [Notice(id=1000 + i, kind="inbox", title=t, body="", url="/", tag="", level="decision", who=w)
            for i, (t, w) in enumerate([("Marketing needs your approval", "Marketing"), ("Sales needs your approval", "Sales"),
                                        ("Marketing needs your approval", "Marketing"), ("Sales has a question", "Sales"),
                                        ("Support needs your approval", "Support")])]
    crit = Notice(id=2000, kind="inbox", title="Production is down", level="critical", url="/", tag="", body="", who="Ops")
    m = N.merged(rows[:3])
    assert m["title"] == "3 approvals from Marketing and Sales" and m["kind"] == "digest" and m["count"] == 3
    assert N.merged(rows[:4])["title"].startswith("3 approvals and 1 question from Marketing and Sales")
    with session_scope() as db:
        p = {**N._normalize(None), "max_per_hour": 3}
        out, keep = N.plan_pushes(db, "usr_nobody", p, rows + [crit])
        # critical always goes; 3 - 1 = 2 slots left: one single push, the other four merged into one
        assert [o["title"] for o in out][0] == "Production is down" and len(out) == 3 and not keep
        assert out[-1]["kind"] == "digest" and out[-1]["count"] == 4
        out, keep = N.plan_pushes(db, "usr_nobody", {**p, "max_per_hour": 1}, rows + [crit])
        assert len(out) == 1 and keep == [r.id for r in rows], "no room: kept for when a slot frees up"


# ------------------------------------------------------------------ the ladder
def test_decision_ladder_push_cos_brief(owner, jakarta, quiet_worker):
    t0 = local(2026, 10, 20, 9, 0)
    iid = _item(t0)
    assert _tick(iid, t0 + dt.timedelta(minutes=1)) == [f"decision {iid} step 0 push"]
    assert _nudges(iid) == [], "the item's own notice is the first step"
    assert _tick(iid, t0 + dt.timedelta(hours=1, minutes=59)) == []
    assert _tick(iid, t0 + dt.timedelta(hours=2, minutes=1)) == [f"decision {iid} step 1 push"]
    assert _nudges(iid)[-1] == ("Reminder: Support needs an answer", "decision")
    assert _tick(iid, t0 + dt.timedelta(hours=6, minutes=2)) == [f"decision {iid} step 2 cos"]
    assert _nudges(iid)[-1][0] == "Chief of Staff: Support is still waiting on you"
    chief_says = owner.get("/api/threads").json()
    master = next(t for t in chief_says if t["scope"] == "master")
    msgs = owner.get(f"/api/threads/{master['id']}").json()["messages"]
    assert any("Which price?" in m["text"] and "Waiting on you for" in m["text"] for m in msgs)
    # at 15:02 the next step waits for the 07:30 brief (and quiet hours hold it anyway)
    assert _tick(iid, local(2026, 10, 20, 23, 0)) == []
    assert _tick(iid, local(2026, 10, 21, 7, 31)) == [f"decision {iid} step 3 brief"]
    assert len(_nudges(iid)) == 2, "the brief step does not push"
    assert _tick(iid, local(2026, 10, 22, 12, 0)) == [], "the ladder ends at the brief"
    lst = {i["id"]: i for i in owner.get("/api/inbox").json()}
    assert lst[iid]["nudge"]["ladder"] == "decision" and lst[iid]["nudge"]["next_at"] is None


def test_quiet_hours_start_the_ladder_late_not_skip_it(owner, jakarta, quiet_worker):
    t0 = local(2026, 10, 20, 23, 15)
    iid = _item(t0, title="Night question")
    assert _tick(iid, t0 + dt.timedelta(minutes=1)) == [], "held by quiet hours"
    assert _tick(iid, local(2026, 10, 21, 7, 1)) == [f"decision {iid} step 0 push"]
    assert _nudges(iid) == [("Support needs an answer", "decision")], "delivered when quiet hours end"
    assert _tick(iid, local(2026, 10, 21, 8, 0)) == [], "next step counts from the delivery, not the creation"


def test_blocking_and_critical_ladders(owner, jakarta, quiet_worker):
    t0 = local(2026, 10, 20, 10, 0)
    b = _item(t0, blocking=True, title="Which supplier?")
    _tick(b, t0)
    assert _tick(b, t0 + dt.timedelta(minutes=31)) == [f"blocking {b} step 1 push"]
    assert _tick(b, t0 + dt.timedelta(hours=2, minutes=2)) == [f"blocking {b} step 2 cos"]
    assert _tick(b, t0 + dt.timedelta(hours=4, minutes=3)) == [f"blocking {b} step 3 push"]
    assert _tick(b, t0 + dt.timedelta(hours=6, minutes=4)) == [f"blocking {b} step 3 push"], "every 2 h"
    assert _tick(b, local(2026, 10, 20, 23, 0)) == [], "not at night"

    c = _item(local(2026, 10, 20, 23, 0), kind="alert", level="critical", staff="chief-of-staff", title="Site is down")
    t = local(2026, 10, 20, 23, 1)
    assert _tick(c, t) == [f"critical {c} step 0 push"], "Critical ignores quiet hours"
    assert _tick(c, t + dt.timedelta(minutes=16)) == [f"critical {c} step 1 push"]
    assert _nudges(c)[-1] == ("Still critical: Site is down", "critical")
    assert owner.post("/api/notify/seen", json={"item_ids": [c]}).json() == {"seen": 1}
    assert owner.post("/api/notify/seen", json={"item_ids": [c]}).json() == {"seen": 0}, "once per reminder"
    assert _tick(c, t + dt.timedelta(minutes=40)) == [], "seen: the repeats stop"


def test_snooze_choices_wake_up_and_restart(owner, jakarta, quiet_worker):
    from omilo_api import nudge
    from omilo_api.db import session_scope

    iid = _item(local(2026, 10, 20, 9, 0), title="Snooze me")
    r = owner.post(f"/api/inbox/{iid}/snooze", json={"until": "monday"})
    assert r.status_code == 200 and r.json()["status"] == "snoozed"
    until = dt.datetime.fromisoformat(r.json()["snooze_until"]).astimezone(JKT)
    assert until.weekday() == 0 and (until.hour, until.minute) == (8, 0)
    assert owner.post(f"/api/inbox/{iid}/snooze", json={"until": "someday"}).status_code == 400
    with session_scope() as db:
        assert nudge.snooze_until(db, until="tomorrow").astimezone(JKT).hour == 8
    after = dt.datetime.fromisoformat(r.json()["snooze_until"]) + dt.timedelta(minutes=1)
    assert _tick(iid, after) == [f"woke {iid}", f"decision {iid} step 0 push"]
    assert _nudges(iid)[-1][0] == "Back from snooze: Snooze me"
    assert owner.get("/api/inbox").json() and any(i["id"] == iid for i in owner.get("/api/inbox").json())


def test_ask_cos_delegates_and_stops_the_ladder(owner, jakarta, quiet_worker):
    t0 = local(2026, 10, 20, 9, 0)
    iid = _item(t0, title="Explain me")
    _tick(iid, t0)
    th = owner.post(f"/api/inbox/{iid}/ask-cos").json()
    assert th["scope"] == "master"
    msgs = owner.get(f"/api/threads/{th['id']}").json()["messages"]
    assert any("Explain me" in m["text"] and m["role"] == "owner" for m in msgs)
    assert _tick(iid, t0 + dt.timedelta(hours=3)) == [], "delegated: no more reminders"


# ------------------------------------------------------------------ deciding from a notification, similar proposals
def test_one_tap_approve_needs_a_fresh_login_and_low_risk(owner, base_url, jakarta):
    from omilo_api import company as C
    from omilo_api import notify as N

    uid = _owner_id()
    low_pid, low = _proposal(uid)
    _, med = _proposal(uid, risk="medium", title="Run an ad")
    sig = N.sign(C.MAIN, low)
    assert owner.post("/api/notify/act", json={"item_id": low, "action": "approve", "sig": "nope"}).status_code == 403
    r = owner.post("/api/notify/act", json={"item_id": low, "action": "approve", "sig": sig})
    assert r.status_code == 401 and r.json()["detail"] == "login_required", "an API token is not a fresh browser sign-in"

    web = httpx.Client(base_url=base_url, headers={"X-Omilo": "1"})
    assert web.post("/api/auth/login", json={"email": "owner@example.com", "password": "correct-horse-1"}).status_code == 200
    r = web.post("/api/notify/act", json={"item_id": med, "action": "approve", "sig": N.sign(C.MAIN, med)})
    assert r.status_code == 409, "medium risk always opens the item"
    r = web.post("/api/notify/act", json={"item_id": low, "action": "approve", "sig": sig})
    assert r.status_code == 200 and r.json()["approved"] == low_pid
    assert owner.get(f"/api/proposals/{low_pid}").json()["status"] in ("approved", "executing", "done")
    assert web.post("/api/notify/act", json={"item_id": med, "action": "snooze", "sig": N.sign(C.MAIN, med)}).status_code == 200
    assert next(i for i in owner.get("/api/inbox?status=all").json() if i["id"] == med)["status"] == "snoozed"
    assert web.post("/api/notify/act", json={"item_id": med, "action": "open", "sig": N.sign(C.MAIN, med)}).json()["url"] == f"/?item={med}"


def test_decide_similar_low_risk_proposals(owner):
    uid = _owner_id()
    a, _ = _proposal(uid, type_="social.reply", title="Reply to Ana")
    b, _ = _proposal(uid, type_="social.reply", title="Reply to Budi")
    c, _ = _proposal(uid, type_="social.reply", title="Reply to Citra")
    hi, _ = _proposal(uid, risk="high", type_="social.reply", title="Reply to the press")
    sim = [p["id"] for p in owner.get(f"/api/proposals/{a}/similar").json()]
    assert set(sim) >= {b, c} and hi not in sim
    assert owner.post(f"/api/proposals/{hi}/decide-similar", json={}).status_code == 409
    r = owner.post(f"/api/proposals/{a}/decide-similar", json={"decision": "approve", "ids": [b]}).json()
    assert r["decided"] == [a, b]
    assert owner.get(f"/api/proposals/{c}").json()["status"] == "pending"


def test_brief_lists_what_waits_and_similar_groups(owner, jakarta):
    from omilo_api import nudge
    from omilo_api.db import session_scope
    from omilo_api.models import InboxItem

    uid = _owner_id()
    ids = [_proposal(uid, type_="seo.fix", title=f"Fix title tag {n}")[1] for n in range(2)]
    old = dt.datetime.now(dt.UTC) - dt.timedelta(days=2)
    with session_scope() as db:
        for iid in ids:
            db.get(InboxItem, iid).created_at = old
    with session_scope() as db:
        text = nudge.brief_section(db)
    assert "Waiting on the founder" in text and "Fix title tag 0" in text and "low risk" in text
    assert "2 similar low-risk seo.fix proposals from marketing" in text


# ------------------------------------------------------------------ settings and push delivery
def test_settings_quiet_focus_and_push_payload(owner, monkeypatch, jakarta):
    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api.db import session_scope
    from omilo_api.models import Notification, PushSub, Setting

    with session_scope(C.MAIN) as adb:  # other tests' fake browsers would make real (slow, failing) push calls
        adb.query(PushSub).delete()
    with session_scope() as db:  # no tab open, and a fresh hour: earlier tests' pushes count toward the cap
        if s := db.get(Setting, f"presence:{_owner_id()}"):
            db.delete(s)
        db.query(Notification).filter(Notification.channel == "push").delete()
        db.query(Setting).filter(Setting.key.like("push_overflow:%")).delete(synchronize_session=False)
    sent = []
    monkeypatch.setattr(pywebpush, "webpush", lambda sub, data, **kw: sent.append(json.loads(data)))
    cfg = owner.get("/api/notify").json()
    assert cfg["prefs"]["kinds"]["inbox"] == {"push": True, "app": True} and "push" in cfg["channels"] and cfg["timezone"] == "Asia/Jakarta"
    assert owner.put("/api/notify/prefs", json={"quiet": {"start": "25:00"}}).status_code == 400
    p = owner.put("/api/notify/prefs", json={"quiet": {"on": False}, "kinds": {"reply": {"push": False}}, "sound": True}).json()
    assert p["quiet"]["on"] is False and p["kinds"]["reply"] == {"push": False, "app": True} and p["sound"] is True
    owner.post("/api/notify/subscribe", json={"endpoint": "https://push.example/m3", "keys": {"p256dh": "k", "auth": "a"}})

    def caught_up():  # earlier tests' notices go out first (merged under the cap); start counting after them
        with session_scope() as db:
            db.query(Notification).filter(Notification.channel == "push").delete()
            return db.get(Setting, "push_cursor").value == N.latest_id(db)

    wait_for(caught_up, timeout=15)
    sent.clear()

    # a low-risk approval goes out with its buttons and a signature
    _, iid = _proposal(_owner_id(), title="Share the newsletter")
    got = wait_for(lambda: [d for d in sent if d.get("item_id") == iid], timeout=15)[0]
    assert got["actions"][0] == {"action": "approve", "title": "Approve"} and got["sig"] and got["co"] == "main"
    assert N.check_sig("main", iid, got["sig"])

    # focus holds everything but Critical
    f = owner.put("/api/notify/prefs", json={"focus": "1h"}).json()
    assert f["focus_now"] is True and f["focus"]["until"]
    _, held = _proposal(_owner_id(), title="Held while focusing")
    crit = _item(dt.datetime.now(dt.UTC), kind="alert", level="critical", staff="chief-of-staff", title="Payments failing")
    wait_for(lambda: any(d.get("item_id") == crit for d in sent), timeout=15)
    assert not any(d.get("item_id") == held for d in sent)
    assert owner.put("/api/notify/prefs", json={"focus": "off", "quiet": {"on": True}}).json()["focus"] is None
    owner.post("/api/notify/unsubscribe", json={"endpoint": "https://push.example/m3"})
