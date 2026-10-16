"""Letting a helper go keeps its history; the Chief can't be let go; a helper can be hired back."""
from conftest import wait_for


def test_let_go_and_rehire(owner):
    st = owner.post("/api/staff", json={"id": "temp-writer", "name": "Temp Writer", "role": "content", "job": "Writes", "engine": {"type": "fake"}}).json()
    t = owner.post("/api/tasks", json={"staff_id": st["id"], "brief": "Write one post"}).json()["id"]
    wait_for(lambda: owner.get(f"/api/tasks/{t}").json()["status"] in ("done", "failed"))
    assert owner.delete("/api/staff/chief-of-staff").status_code == 400

    r = owner.delete(f"/api/staff/{st['id']}").json()
    assert r["ok"]
    assert all(s["id"] != st["id"] for s in owner.get("/api/staff").json()), "gone from the team"
    assert any(s["id"] == st["id"] for s in owner.get("/api/staff?former=true").json())
    assert owner.get(f"/api/tasks/{t}").status_code == 200, "its past work stays"
    assert all(a["id"] != st["id"] for a in owner.get("/api/office/state").json()["agents"])
    assert owner.post("/api/tasks", json={"staff_id": st["id"], "brief": "x"}).status_code == 409

    back = owner.post(f"/api/staff/{st['id']}/rehire").json()
    assert back["status"] == "active" and back["mcp_token"]
    assert any(s["id"] == st["id"] for s in owner.get("/api/staff").json())
