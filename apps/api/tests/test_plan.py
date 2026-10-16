"""The plan: goals you set → the work the Chief hands out for them → sub-jobs, executions and regular jobs."""
import httpx
from conftest import wait_for


def tool(base_url, token, name, **args):
    r = httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {token}"},
                   json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["result"]["structuredContent"]


def test_goal_tree(base_url, owner):
    gid = owner.post("/api/goals", json={"title": "10 paying RTs by December", "target": "MRR Rp 5 juta", "due": "2026-12-31"}).json()["id"]
    chief, mkt = owner.mcp_tokens["chief-of-staff"], owner.mcp_tokens["marketing"]
    assert any(g["id"] == gid for g in tool(base_url, chief, "get_context")["goals"]), "the Chief sees your goals"

    # the Chief hands out work for the goal; what comes out of it stays under the goal
    t = tool(base_url, chief, "create_task", staff_id="marketing", brief="Plan a campaign for RT leaders", goal_id=gid)["task_id"]
    p = tool(base_url, mkt, "propose", task_id=t, title="Post: Barokah for your RT", type="content.publish", risk="medium", body="…")["proposal_id"]
    owner.post(f"/api/proposals/{p}/decide", json={"decision": "approve", "note": ""})
    # a regular job linked to the goal
    sh = owner.get("/api/staff/sales").json()["shifts"][0]
    owner.patch(f"/api/goals/{gid}", json={"shift_ids": [sh["id"]]})
    run = owner.post("/api/tasks", json={"staff_id": "sales", "brief": "Find 5 RTs", "goal_id": gid}).json()["id"]

    plan = wait_for(lambda: (x := owner.get("/api/plan").json()) and any(g["id"] == gid and g["work"] for g in x["goals"]) and x)
    g = next(x for x in plan["goals"] if x["id"] == gid)
    top = {n["id"]: n for n in g["work"]}
    assert t in top and run in top
    node = top[t]
    assert node["staff"] == "Marketing" and node["proposals"][0]["id"] == p
    assert any(c["origin"] == "execution" for c in node["children"]), "the execution of the approved post sits under its job"
    assert g["jobs"][0]["id"] == sh["id"] and g["progress"]["total"] >= 3
    assert all(n["id"] != t for n in plan["unlinked"])

    # every job knows where it comes from: its goal and the jobs above it
    ex = next(c for c in node["children"] if c["origin"] == "execution")
    lin = owner.get(f"/api/tasks/{ex['id']}").json()["lineage"]
    assert lin["goal"]["id"] == gid and lin["parents"][-1]["id"] == t
    listed = next(x for x in owner.get("/api/tasks").json() if x["id"] == ex["id"])
    assert listed["lineage"]["parents"][-1]["id"] == t
    board = owner.get("/api/board").json()
    assert all(c.get("lineage") is None or "parents" in c["lineage"] for c in board["running"] + board["done"])

    # move a job out of the goal, then delete the goal
    owner.put(f"/api/tasks/{run}/goal", json={"goal_id": None})
    plan = owner.get("/api/plan").json()
    assert any(n["id"] == run for n in plan["unlinked"])
    assert owner.delete(f"/api/goals/{gid}").json()["ok"]
