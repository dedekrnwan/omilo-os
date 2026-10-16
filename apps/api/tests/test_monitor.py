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
    assert ops["jobs_done"] >= 1 and ops["state"] in ("awake", "sleeping", "working") and ops["last_active"]
    assert any(x["name"] in ("report", "checkpoint", "get_task") for x in m["tools"])
    assert {"accounts", "ready", "total"} <= set(m["pool"])
