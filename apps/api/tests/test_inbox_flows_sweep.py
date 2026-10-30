"""sweep/inbox-flows: inbox read state + proposal normalisation, proposal
patch/approve-with-params/undo, flow publish→approve, flow cards/detail extras,
run detail + approve/decline/retry/cancel, versions + restore, suggestions.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.connectors import Connector
from omilo.models.inbox import InboxItem
from tests.test_flows_crud import (  # noqa: F401 — fixtures re-used
    _get_token_for_company,
    _tenant_session,
    ensure_schema,
    tenant_a,
    tenant_b,
)

_TRIGGER = {"kind": "manual", "spec": {}}


def _h(token: str, company_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-Company-Id": company_id}


async def _auth(client, tenant):
    company_id, helper_id = tenant
    token = await _get_token_for_company(client, company_id)
    return company_id, helper_id, _h(token, company_id)


async def _publish(client, h, nodes=None, edges=None, title="Sweep flow"):
    resp = await client.post(
        "/v1/flows",
        json={"title": title, "trigger": _TRIGGER, "nodes": nodes or [], "edges": edges or []},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    flow = resp.json()
    resp = await client.post(f"/v1/flows/{flow['id']}/publish", headers=h)
    assert resp.status_code == 200, resp.text
    return flow, resp.json()


# ── Inbox ────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_inbox_proposals_are_normalised_list(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    _flow, proposal = await _publish(async_client, h)
    resp = await async_client.get("/v1/inbox", headers=h)
    assert resp.status_code == 200, resp.text
    items = resp.json()
    item = next(i for i in items if (i.get("proposals") or [{}])[0].get("proposalId") == proposal["id"])
    entry = item["proposals"][0]
    assert entry["type"] == "flow_publish"
    assert entry["who"] == item["asker"]
    assert entry["text"] == item["title"]
    assert "due" in entry
    # newest first
    created = [i["createdAt"] for i in items]
    assert created == sorted(created, reverse=True)


@pytest.mark.asyncio
async def test_legacy_dict_proposals_still_serialise(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    with _tenant_session(company_id) as db:
        item = InboxItem(
            id=prefixed_id("inb"), company_id=company_id, title="Legacy", summary="",
            session_id="", channel_id="", kind="decision", status="pending",
            asker="Chief", asker_area="ops",
            proposals={"proposal_id": "prp_legacy", "type": "send", "risk": "low"},
        )
        db.add(item)
        item_id = item.id
    resp = await async_client.get(f"/v1/inbox/{item_id}", headers=h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["proposals"][0]["proposalId"] == "prp_legacy"
    with _tenant_session(company_id) as db:
        assert db.get(InboxItem, item_id).proposal_id == "prp_legacy"


@pytest.mark.asyncio
async def test_read_and_read_all(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    with _tenant_session(company_id) as db:
        ids = []
        for n in range(2):
            it = InboxItem(
                id=prefixed_id("inb"), company_id=company_id, title=f"Upd {n}", summary="",
                session_id="ses_x", channel_id="", kind="update", status="done",
                asker="Chief", asker_area="ops",
            )
            db.add(it)
            ids.append(it.id)
    resp = await async_client.post(f"/v1/inbox/{ids[0]}/read", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["readAt"]
    resp = await async_client.post("/v1/inbox/read-all", json={}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["updated"] >= 1
    with _tenant_session(company_id) as db:
        assert all(db.get(InboxItem, i).read_at is not None for i in ids)
    resp = await async_client.post("/v1/inbox/inb_missing/read", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_read_all_before_cutoff(async_client, tenant_b):
    company_id, _, h = await _auth(async_client, tenant_b)
    with _tenant_session(company_id) as db:
        it = InboxItem(
            id=prefixed_id("inb"), company_id=company_id, title="Fresh", summary="",
            session_id="", channel_id="", kind="update", status="pending",
            asker="Chief", asker_area="ops",
        )
        db.add(it)
        fresh = it.id
    before = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    resp = await async_client.post("/v1/inbox/read-all", json={"before": before}, headers=h)
    assert resp.status_code == 200
    with _tenant_session(company_id) as db:
        assert db.get(InboxItem, fresh).read_at is None


# ── Proposals ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_proposal_assignee_and_due(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    _flow, proposal = await _publish(async_client, h)
    resp = await async_client.patch(
        f"/v1/proposals/{proposal['id']}", json={"assignee": "Ari", "due": "2026-11-05"}, headers=h
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["proposal"]["assignee"] == "Ari"
    items = (await async_client.get("/v1/inbox", headers=h)).json()
    entry = next(
        p for i in items for p in (i.get("proposals") or []) if p.get("proposalId") == proposal["id"]
    )
    assert entry["who"] == "Ari"
    assert entry["due"] == "2026-11-05"


@pytest.mark.asyncio
async def test_approve_flow_publish_publishes_and_undo_reverts(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    flow, proposal = await _publish(async_client, h)

    detail = (await async_client.get(f"/v1/flows/{flow['id']}", headers=h)).json()
    assert detail["publish_state"] == "pending"
    assert detail["pending_proposal_id"] == proposal["id"]

    resp = await async_client.post(
        f"/v1/proposals/{proposal['id']}/approve", json={"params": {"amount": 3000}}, headers=h
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["proposal"]["params"]["amount"] == 3000

    detail = (await async_client.get(f"/v1/flows/{flow['id']}", headers=h)).json()
    assert detail["status"] == "published"
    assert detail["enabled"] is True
    assert detail["publish_state"] == "live"
    versions = (await async_client.get(f"/v1/flows/{flow['id']}/versions", headers=h)).json()
    assert any(v["status"] == "live" for v in versions)

    resp = await async_client.post(f"/v1/proposals/{proposal['id']}/undo", json={}, headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["proposal"]["status"] == "pending"
    detail = (await async_client.get(f"/v1/flows/{flow['id']}", headers=h)).json()
    assert detail["status"] == "draft"
    assert detail["enabled"] is False
    with _tenant_session(company_id) as db:
        item = db.query(InboxItem).filter(InboxItem.proposal_id == proposal["id"]).first()
        assert item.status == "pending"

    # Second undo → 409 (nothing to undo)
    resp = await async_client.post(f"/v1/proposals/{proposal['id']}/undo", json={}, headers=h)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_undo_after_window_is_rejected(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    _flow, proposal = await _publish(async_client, h)
    await async_client.post(f"/v1/proposals/{proposal['id']}/approve", json={}, headers=h)
    with _tenant_session(company_id) as db:
        p = db.get(Proposal, proposal["id"])
        p.decided_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    resp = await async_client.post(f"/v1/proposals/{proposal['id']}/undo", json={}, headers=h)
    assert resp.status_code == 409


# ── Flows ────────────────────────────────────────────────────────────────────

_GRAPH_NODES = [
    {"id": "t", "kind": "trigger", "label": "Start", "x": 0, "y": 0, "config": {"ui": {"app": "github"}}},
    {"id": "a", "kind": "ai_step", "label": "Think", "x": 0, "y": 100},
    {"id": "ok", "kind": "approval", "label": "You approve", "x": 0, "y": 200},
    {"id": "c", "kind": "connector", "label": "Post", "x": 0, "y": 300, "config": {"ui": {"app": "slack"}}},
]
_GRAPH_EDGES = [
    {"id": "e1", "from": "t", "to": "a"},
    {"id": "e2", "from": "a", "to": "ok"},
    {"id": "e3", "from": "ok", "to": "c"},
]


async def _flow(client, h, title="Graph flow"):
    resp = await client.post(
        "/v1/flows",
        json={"title": title, "trigger": _TRIGGER, "nodes": _GRAPH_NODES, "edges": _GRAPH_EDGES},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_flow_cards_have_run_stats(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    flow = await _flow(async_client, h, title="Stats flow")
    resp = await async_client.post(f"/v1/flows/{flow['id']}/test-run", json={}, headers=h)
    assert resp.status_code == 200, resp.text
    cards = (await async_client.get("/v1/flows", headers=h)).json()
    card = next(c for c in cards if c["id"] == flow["id"])
    assert card["apps"] == ["github", "approval", "slack"] or card["apps"][0] == "github"
    assert card["ai_steps"] == 1
    assert len(card["runs_7d"]) == 7 and card["runs_7d"][-1] >= 1
    assert card["last_run"]["status"] == "done"
    detail = (await async_client.get(f"/v1/flows/{flow['id']}", headers=h)).json()
    assert "tokens_this_month" in detail
    assert detail["publish_state"] == "draft"


@pytest.mark.asyncio
async def test_run_detail_steps_and_approve_resume(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    flow = await _flow(async_client, h)
    run = (await async_client.post(f"/v1/flows/{flow['id']}/run", json={}, headers=h)).json()
    assert run["status"] == "needs_you"
    detail = (await async_client.get(f"/v1/flows/{flow['id']}/runs/{run['id']}", headers=h)).json()
    kinds = [s["kind"] for s in detail["steps"]]
    assert kinds == ["trigger", "ai_step", "approval"]
    assert detail["steps"][-1]["status"] == "waiting"
    assert "result" in detail["steps"][1]["output"]

    # Inbox decision item carries the flow-run link
    items = (await async_client.get("/v1/inbox", headers=h)).json()
    entry = next(
        p for i in items for p in (i.get("proposals") or []) if p.get("flowRunId") == run["id"]
    )
    assert entry["flowId"] == flow["id"]

    resp = await async_client.post(
        f"/v1/flows/{flow['id']}/runs/{run['id']}/approve", json={"approve": True}, headers=h
    )
    assert resp.status_code == 200, resp.text
    done = resp.json()
    assert done["status"] == "done"
    assert [s["kind"] for s in done["steps"]] == ["trigger", "ai_step", "approval", "connector"]
    assert done["steps"][2]["status"] == "done"

    # not waiting anymore → 409
    resp = await async_client.post(
        f"/v1/flows/{flow['id']}/runs/{run['id']}/approve", json={"approve": True}, headers=h
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_decline_cancel_retry(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    flow = await _flow(async_client, h, title="Decline flow")
    run = (await async_client.post(f"/v1/flows/{flow['id']}/run", json={}, headers=h)).json()
    resp = await async_client.post(
        f"/v1/flows/{flow['id']}/runs/{run['id']}/approve", json={"approve": False}, headers=h
    )
    assert resp.json()["status"] == "declined"

    run2 = (await async_client.post(f"/v1/flows/{flow['id']}/run", json={}, headers=h)).json()
    resp = await async_client.post(f"/v1/flows/{flow['id']}/runs/{run2['id']}/cancel", headers=h)
    assert resp.json()["status"] == "cancelled"

    resp = await async_client.post(f"/v1/flows/{flow['id']}/runs/{run2['id']}/retry", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] != run2["id"]
    assert resp.json()["trigger_summary"] == f"retry of {run2['id']}"


@pytest.mark.asyncio
async def test_versions_and_restore(async_client, tenant_a):
    company_id, _, h = await _auth(async_client, tenant_a)
    flow = await _flow(async_client, h, title="Versioned")
    resp = await async_client.patch(
        f"/v1/flows/{flow['id']}", json={"nodes": _GRAPH_NODES[:2], "edges": _GRAPH_EDGES[:1]}, headers=h
    )
    assert resp.json()["version"] == 2
    await async_client.post(f"/v1/flows/{flow['id']}/publish", headers=h)
    versions = (await async_client.get(f"/v1/flows/{flow['id']}/versions", headers=h)).json()
    assert [v["version"] for v in versions] == [2, 1]
    resp = await async_client.post(f"/v1/flows/{flow['id']}/versions/1/restore", headers=h)
    assert resp.status_code == 200, resp.text
    restored = resp.json()
    assert len(restored["nodes"]) == 4
    assert restored["version"] == 3
    resp = await async_client.post(f"/v1/flows/{flow['id']}/versions/99/restore", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_suggestions_from_connectors(async_client, tenant_b):
    company_id, _, h = await _auth(async_client, tenant_b)
    resp = await async_client.get("/v1/flows/suggestions", headers=h)
    assert resp.status_code == 200, resp.text
    with _tenant_session(company_id) as db:
        db.add(Connector(
            id=prefixed_id("con"), company_id=company_id, source="piece", slug="github",
            label="GitHub", kind="mcp",
        ))
    resp = await async_client.get("/v1/flows/suggestions", headers=h)
    sugg = resp.json()
    gh = next(s for s in sugg if s["id"] == "sg-github-deploy-triage")
    assert gh["draft"]["nodes"][0]["kind"] == "trigger"
    # Creating it removes the suggestion
    await async_client.post(
        "/v1/flows",
        json={k: gh["draft"][k] for k in ("title", "trigger", "nodes", "edges")},
        headers=h,
    )
    sugg = (await async_client.get("/v1/flows/suggestions", headers=h)).json()
    assert all(s["id"] != "sg-github-deploy-triage" for s in sugg)


@pytest.mark.asyncio
async def test_tenancy_on_new_endpoints(async_client, tenant_a, tenant_b):
    _, _, ha = await _auth(async_client, tenant_a)
    _, _, hb = await _auth(async_client, tenant_b)
    flow = await _flow(async_client, ha, title="Private")
    run = (await async_client.post(f"/v1/flows/{flow['id']}/run", json={}, headers=ha)).json()
    assert (await async_client.get(f"/v1/flows/{flow['id']}/runs/{run['id']}", headers=hb)).status_code == 404
    assert (await async_client.get(f"/v1/flows/{flow['id']}/versions", headers=hb)).status_code == 404


# ── Budget & limits enforcement (sweep merge) ───────────────────────────────


def test_flow_limits_read_tokens():
    from omilo.flows.engine import flow_limits

    class F:  # minimal stand-in for the ORM object
        settings: dict = {}

    f = F()
    f.settings = {"monthlyBudgetTokens": "5M", "tokenCapPerRun": "200k", "maxSteps": "12"}
    assert flow_limits(f) == {"monthly_budget_tokens": 5_000_000, "token_cap_per_run": 200_000, "max_steps": 12}
    f.settings = {"monthlyBudgetTokens": 1_000_000, "tokenCapPerRun": ""}
    assert flow_limits(f) == {"monthly_budget_tokens": 1_000_000, "token_cap_per_run": None, "max_steps": None}
    f.settings = {"monthlyBudgetRp": "1.000.000", "costCapRp": "5000"}  # old Rupiah limits no longer apply
    assert flow_limits(f) == {"monthly_budget_tokens": None, "token_cap_per_run": None, "max_steps": None}


@pytest.mark.asyncio
async def test_run_blocked_when_monthly_budget_spent(async_client, tenant_a):
    from omilo.models.execution import Job
    from omilo.models.flows import FlowRun

    company_id, _, h = await _auth(async_client, tenant_a)
    flow = await _flow(async_client, h, title="Budget flow")
    resp = await async_client.patch(
        f"/v1/flows/{flow['id']}", json={"settings": {"monthlyBudgetTokens": "5k"}}, headers=h
    )
    assert resp.status_code == 200, resp.text
    with _tenant_session(company_id) as db:  # an earlier run already used 6k tokens
        run_id = prefixed_id("frn")
        db.add(FlowRun(
            id=run_id, company_id=company_id, flow_id=flow["id"], status="done",
            trigger_summary="earlier", started_by="test", job_ids=[], steps=[],
            started_at=datetime.now(timezone.utc), cost_credits=0,
        ))
        db.add(Job(
            id=prefixed_id("job"), company_id=company_id, helper_id="hlp_x", origin="flow", brief="earlier",
            status="done", flow_run_id=run_id, tokens_in=4_000, tokens_out=2_000, attempts=1, checkpoint={},
        ))
    resp = await async_client.post(f"/v1/flows/{flow['id']}/run", json={}, headers=h)
    assert resp.status_code == 200, resp.text
    run = resp.json()
    assert run["status"] == "failed"
    assert "budget" in str(run).lower()
    # A test run is never blocked by the budget.
    resp = await async_client.post(f"/v1/flows/{flow['id']}/test-run", json={}, headers=h)
    assert resp.status_code == 200 and resp.json()["status"] != "failed"
