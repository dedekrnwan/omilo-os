"""KPIs: define one with a target and a goal, record values, see progress and history, ask a helper to update it."""
from test_plan import tool


def test_kpi_board(base_url, owner):
    gid = owner.post("/api/goals", json={"title": "Grow MRR"}).json()["id"]
    r = owner.put("/api/kpis/defs/MRR Total", json={"label": "Monthly revenue", "unit": "Rp jt", "target": 10, "direction": "up",
                                                    "goal_id": gid, "owner": "finance", "note": "Paid subscriptions only"})
    assert r.status_code == 200, r.text
    name = r.json()["name"]
    assert name == "mrr_total"
    assert owner.put("/api/kpis/defs/x", json={"direction": "sideways"}).status_code == 400

    a = owner.post("/api/kpis/values", json={"name": name, "value": 4, "period": "2026-09"}).json()["id"]
    b = owner.post("/api/kpis/values", json={"name": name, "value": 5, "period": "2026-10", "source": "Midtrans dashboard"}).json()["id"]
    row = next(k for k in owner.get("/api/kpis/board").json() if k["name"] == name)
    assert row["value"] == 5 and row["previous"] == 4 and row["progress"] == 50
    assert row["goal"] == "Grow MRR" and row["owner_name"] and row["by"] == "You"
    assert [h["value"] for h in row["history"]] == [4, 5]

    owner.delete(f"/api/kpis/values/{b}")
    row = next(k for k in owner.get("/api/kpis/board").json() if k["name"] == name)
    assert row["value"] == 4 and row["previous"] is None

    t = owner.post(f"/api/kpis/{name}/ask").json()
    assert t["staff_id"] == "finance"
    assert "update_kpi" in owner.get(f"/api/tasks/{t['task_id']}").json()["brief"]

    ctx = tool(base_url, owner.mcp_tokens["chief-of-staff"], "get_context")
    assert any(k["name"] == name and k["target"] == 10 for k in ctx["kpis"])
    g = next(x for x in owner.get("/api/plan").json()["goals"] if x["id"] == gid)
    assert g["kpis"][0]["name"] == name

    owner.delete(f"/api/kpis/defs/{name}?values=true")
    assert all(k["name"] != name for k in owner.get("/api/kpis/board").json())
    assert a
