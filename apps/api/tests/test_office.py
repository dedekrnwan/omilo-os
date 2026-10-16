"""The live office: verified events from real work, one authoritative state, and the WebSocket stream."""
import asyncio
import json

import websockets
from conftest import wait_for
from test_plan import tool


def test_office_events_and_state(base_url, owner):
    cur = owner.get("/api/office/events").json()["cursor"]
    t = owner.post("/api/tasks", json={"staff_id": "marketing", "brief": "Draft a post about anvils"}).json()["id"]
    evs = wait_for(lambda: (e := owner.get(f"/api/office/events?after={cur}").json()["events"]) and any(x["kind"] == "job.done" and x["task_id"] == t for x in e) and e)
    kinds = [x["kind"] for x in evs if x["task_id"] == t]
    assert kinds.index("job.queued") < kinds.index("job.started") < kinds.index("job.done")
    assert all(x["staff_id"] == "marketing" for x in evs if x["task_id"] == t)

    # a question to the founder makes the helper "blocked" (waiting on you) in the shared state
    mkt = owner.mcp_tokens["marketing"]
    tool(base_url, mkt, "ask_founder", question="Which anvil colour?", task_id=t)
    st = owner.get("/api/office/state").json()
    m = next(a for a in st["agents"] if a["id"] == "marketing")
    assert m["department"] == "marketing" and m["status"] == "blocked" and m["waiting_count"] >= 1
    assert st["cursor"] >= cur and {d["id"] for d in st["departments"]} >= {"leadership", "marketing"}
    assert any(e["kind"] == "question.asked" for e in owner.get(f"/api/office/events?after={cur}").json()["events"])

    # delegation is a handoff between two helpers
    chief = owner.mcp_tokens["chief-of-staff"]
    tool(base_url, chief, "create_task", staff_id="sales", brief="Call 3 coyotes")
    evs = owner.get(f"/api/office/events?after={cur}").json()["events"]
    assert any(e["kind"] == "handoff" and e["staff_id"] == "chief-of-staff" and e["data"]["to_staff"] == "sales" for e in evs)

    d = owner.get("/api/office/agent/marketing").json()
    assert d["agent"]["id"] == "marketing" and any(j["id"] == t for j in d["jobs"]) and d["events"]
    assert owner.get("/api/office/agent/nobody").status_code == 404


def test_office_websocket(base_url, owner):
    ws_url = base_url.replace("http", "ws") + "/api/office/ws"
    tok = owner.headers["Authorization"][7:]

    async def run():
        # no credentials, or another site's page: refused
        for kw in ({}, {"additional_headers": {"Authorization": f"Bearer {tok}", "Origin": "https://evil.example"}}):
            try:
                async with websockets.connect(ws_url, **kw) as ws:
                    await ws.recv()
                raise AssertionError("should be refused")
            except websockets.exceptions.ConnectionClosed as e:
                assert e.rcvd.code in (4401, 4403)
            except websockets.exceptions.InvalidStatus:
                pass
        async with websockets.connect(ws_url, additional_headers={"Authorization": f"Bearer {tok}"}) as ws:
            first = json.loads(await ws.recv())
            assert first["type"] == "state" and first["state"]["agents"]
            await asyncio.to_thread(owner.post, "/api/tasks", json={"staff_id": "support", "brief": "Answer ticket 7"})
            got = set()
            for _ in range(40):
                m = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if m["type"] == "events":
                    got |= {e["kind"] for e in m["events"] if e["staff_id"] == "support"}
                if "job.done" in got:
                    break
            assert {"job.queued", "job.done"} <= got

    asyncio.run(run())
