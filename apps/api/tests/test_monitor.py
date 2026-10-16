from conftest import wait_for


def test_monitor_ranges_and_numbers(owner):
    t = owner.post("/api/tasks", json={"staff_id": "ops", "brief": "Check the servers"}).json()
    wait_for(lambda: owner.get(f"/api/tasks/{t['id']}").json()["status"] in ("done", "failed"), timeout=30)
    for rng, n, unit in (("24h", 24, "hour"), ("7d", 7, "day"), ("30d", 30, "day")):
        m = owner.get("/api/monitor", params={"range": rng}).json()
        assert m["range"] == rng and len(m["buckets"]) == n and m["unit"] == unit
        assert len(m["jobs"]["done"]) == n
    m = owner.get("/api/monitor", params={"range": "nonsense"}).json()
    assert m["range"] == "7d"
    k = m["kpi"]
    assert k["jobs_done"] >= 1 and sum(m["jobs"]["done"]) == k["jobs_done"]
    assert k["runs"] >= 1 and k["helpers"] == len(m["helpers"])
    ops = [h for h in m["helpers"] if h["id"] == "ops"][0]
    assert ops["jobs_done"] >= 1 and ops["state"] in ("ready", "waiting", "working") and ops["last_active"]
    assert any(x["name"] in ("report", "checkpoint", "get_task") for x in m["tools"])
    assert {"accounts", "ready", "total"} <= set(m["pool"])


def test_budget_alerts_then_pauses(owner):
    from saga_api import budgets
    from saga_api.db import session_scope
    from saga_api.models import RunEvent

    assert owner.patch("/api/staff/finance", json={"budget_tokens_month": 1000}).status_code == 200
    assert owner.get("/api/staff/finance").json()["budget"]["budget_tokens"] == 1000
    with session_scope() as db:
        db.add(RunEvent(staff_id="finance", kind="usage", data={"tokens": 850, "cost_usd": 0.01, "seconds": 3}))
        db.commit()
        assert budgets.check(db, "finance") == "warn"
        assert budgets.check(db, "finance") is None, "the 80% alert fires once a month"
        db.add(RunEvent(staff_id="finance", kind="usage", data={"tokens": 200, "cost_usd": 0.01, "seconds": 3}))
        db.commit()
        assert budgets.check(db, "finance") == "paused"
    st = owner.get("/api/staff/finance").json()
    assert st["status"] == "paused" and st["budget"]["pct"] >= 100
    titles = [i["title"] for i in owner.get("/api/inbox").json()]
    assert any("80% of its monthly budget" in t for t in titles) and any("reached its monthly budget" in t for t in titles)
    th = owner.post("/api/threads", json={"scope": "staff", "staff_id": "finance"}).json()
    owner.post(f"/api/threads/{th['id']}/messages", json={"text": "hi"})
    got = wait_for(lambda: (x := owner.get(f"/api/threads/{th['id']}").json())["awaiting_reply"] is False and x, timeout=20)
    assert "is paused" in got["messages"][-1]["text"]
    owner.patch("/api/staff/finance", json={"status": "active", "budget_tokens_month": 0})


def test_monitor_insights_and_digest(owner):
    m = owner.get("/api/monitor", params={"range": "30d"}).json()
    assert {"timing", "failures", "value", "pool_history", "budgets"} <= set(m)
    assert len(m["pool_history"]["hours"]) == 24 and "engines" in m["timing"]
    d = owner.get("/api/digest").json()
    assert d["enabled"] is True and d["preview"].startswith("## Your week in Saga OS")
    tid = owner.post("/api/digest/send").json()["thread_id"]
    msgs = owner.get(f"/api/threads/{tid}").json()["messages"]
    assert any(x["text"].startswith("## Your week") and x["role"] == "agent" for x in msgs)
    assert owner.get("/api/digest").json()["last_sent"]
    assert owner.put("/api/digest", json={"enabled": False}).json()["enabled"] is False
    owner.put("/api/digest", json={"enabled": True})
