"""Flow CRUD + publish endpoints (§8 of 02-api-contracts.md).

Endpoints:
  GET  /v1/flows                       → FlowCard[]
  POST /v1/flows {title,trigger,nodes,edges,channel_ids?,areas?}
                                       → Flow (status=draft)
  GET  /v1/flows/{id}                  → Flow (with nodes/edges/trigger)
  PATCH /v1/flows/{id} {title?,nodes?,edges?,trigger?,enabled?,areas?}
                                       → Flow
  POST /v1/flows/{id}/publish          → Proposal (type=flow_publish, pending)
  GET  /v1/flows/{id}/runs             → FlowRun[]

Trigger-kind validation:
  Allowed: schedule | manual | internal_event | connector_poll
  Rejected with 422: webhook, connector_webhook, or anything else.

Publish creates a ``flow_publish`` Proposal (risk=medium) + a ``decision``
InboxItem.  The Flow stays ``draft`` until the Proposal is approved (wired
in a later task).

All routes are company-scoped via get_tenant_db (FORCE RLS).
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.models.approvals import Proposal, ProposalRevision
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow, FlowRun, FlowVersion
from omilo.models.inbox import InboxItem
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["flows"])

# ---------------------------------------------------------------------------
# Allowed trigger kinds (from docs/business/flows.md §2)
# ---------------------------------------------------------------------------

_ALLOWED_TRIGGER_KINDS = frozenset({"schedule", "manual", "internal_event", "connector_poll"})
_REJECTED_TRIGGER_KINDS = frozenset({"webhook", "connector_webhook"})


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class TriggerBody(BaseModel):
    kind: str
    spec: dict = {}


class CreateFlowBody(BaseModel):
    title: Optional[str] = "Untitled flow"
    trigger: TriggerBody
    nodes: list[Any] = []
    edges: list[Any] = []
    channel_ids: Optional[list[str]] = None
    areas: Optional[list[str]] = None


class PatchFlowBody(BaseModel):
    title: Optional[str] = None
    trigger: Optional[TriggerBody] = None
    nodes: Optional[list[Any]] = None
    edges: Optional[list[Any]] = None
    enabled: Optional[bool] = None
    areas: Optional[list[str]] = None
    # settings: partial flow-editor settings, deep-merged into the stored object.
    settings: Optional[dict[str, Any]] = None


class TestRunBody(BaseModel):
    sample: dict = {}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------


def _validate_trigger_kind(kind: str) -> None:
    """Raise 422 if trigger.kind is not an allowed inbound-webhook-free kind."""
    if kind in _ALLOWED_TRIGGER_KINDS:
        return
    if kind in _REJECTED_TRIGGER_KINDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Trigger kind {kind!r} is not supported: inbound webhooks are not "
                "supported; use schedule/manual/internal_event/connector_poll."
            ),
        )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=(
            f"Unknown trigger kind {kind!r}. "
            "Allowed: schedule, manual, internal_event, connector_poll."
        ),
    )


# ---------------------------------------------------------------------------
# Deep-merge (mirrors company.settings behavior)
# ---------------------------------------------------------------------------


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge ``patch`` into ``base`` and return a new dict.

    Nested dicts are merged key-by-key (a partial PATCH to one nested key does
    not clobber its siblings); non-dict values overwrite.
    """
    result = dict(base)
    for key, value in patch.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------


def _flow_to_dict(flow: Flow) -> dict[str, Any]:
    return {
        "id": flow.id,
        "company_id": flow.company_id,
        "title": flow.title,
        "status": flow.status,
        "enabled": flow.enabled,
        "version": flow.version,
        "created_by": flow.created_by,
        "proposed_from_pattern": flow.proposed_from_pattern,
        "trigger": flow.trigger,
        "nodes": flow.nodes,
        "edges": flow.edges,
        "channel_ids": flow.channel_ids,
        "areas": flow.areas,
        "settings": flow.settings or {},
        "poll_cursor": flow.poll_cursor,
        "created_at": flow.created_at.isoformat() if flow.created_at else None,
    }


def _flow_card(flow: Flow) -> dict[str, Any]:
    """FlowCard DTO: id, title, status, enabled, count (len nodes), areas."""
    return {
        "id": flow.id,
        "title": flow.title,
        "status": flow.status,
        "enabled": flow.enabled,
        "count": len(flow.nodes) if isinstance(flow.nodes, list) else 0,
        "areas": flow.areas,
        "created_at": flow.created_at.isoformat() if flow.created_at else None,
    }


def _run_to_dict(run: FlowRun) -> dict[str, Any]:
    return {
        "id": run.id,
        "flow_id": run.flow_id,
        "status": run.status,
        "trigger_summary": run.trigger_summary,
        "started_by": run.started_by,
        "cost_credits": run.cost_credits,
        "tokens": int(run.tokens or 0),
        "duration": run.duration,
        "waiting_for": run.waiting_for,
        "job_ids": run.job_ids,
        "steps": run.steps or [],
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "ended_at": run.ended_at.isoformat() if run.ended_at else None,
    }


def _proposal_to_dict(proposal: Proposal) -> dict[str, Any]:
    return {
        "id": proposal.id,
        "company_id": proposal.company_id,
        "job_id": proposal.job_id,
        "helper_id": proposal.helper_id,
        "type": proposal.type,
        "risk": proposal.risk,
        "title": proposal.title,
        "body_md": proposal.body_md,
        "status": proposal.status,
        "current_revision": proposal.current_revision,
        "decided_by": proposal.decided_by,
        "decision_note": proposal.decision_note,
        "decided_at": proposal.decided_at.isoformat() if proposal.decided_at else None,
        "execution_job_id": proposal.execution_job_id,
        "result": proposal.result,
        "created_at": proposal.created_at.isoformat() if proposal.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/flows
# ---------------------------------------------------------------------------


@router.get("/flows", status_code=status.HTTP_200_OK)
def list_flows(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """List all Flows for this company (RLS scoped). Returns FlowCard[]."""
    flows = db.query(Flow).order_by(Flow.created_at.desc()).all()
    stats = _run_stats(db, [f.id for f in flows])
    return [{**_flow_card(f), **_card_extras(f, stats.get(f.id))} for f in flows]


# ── sweep/inbox-flows: GET /v1/flows/suggestions (before /flows/{id}) ─────────


@router.get("/flows/suggestions", status_code=status.HTTP_200_OK)
def flow_suggestions(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Deterministic flow suggestions from installed connectors + routines.

    Each installed connector whose slug matches the catalog yields its
    suggestion; each enabled routine yields "Turn <routine> into a flow".
    Suggestions whose title already exists as a flow are dropped.
    """
    from omilo.flows.suggestions import build_suggestions

    return build_suggestions(db)


# ---------------------------------------------------------------------------
# POST /v1/flows
# ---------------------------------------------------------------------------


@router.post("/flows", status_code=status.HTTP_200_OK)
def create_flow(
    body: CreateFlowBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Flow in status=draft, version=1, enabled=False.

    Validates trigger.kind ∈ {schedule,manual,internal_event,connector_poll}.
    Rejects webhook / connector_webhook with 422.
    """
    _validate_trigger_kind(body.trigger.kind)

    flow = Flow(
        id=prefixed_id("flw"),
        company_id=ctx.company_id,
        title=body.title or "Untitled flow",
        enabled=False,
        channel_ids=body.channel_ids or [],
        areas=body.areas or [],
        trigger={"kind": body.trigger.kind, "spec": body.trigger.spec},
        nodes=body.nodes,
        edges=body.edges,
        version=1,
        status="draft",
        created_by="operator",
        proposed_from_pattern=False,
    )
    db.add(flow)
    db.flush()
    _snapshot(db, flow, note="First version", created_by="operator")
    return _flow_to_dict(flow)


# ---------------------------------------------------------------------------
# GET /v1/flows/{id}
# ---------------------------------------------------------------------------


@router.get("/flows/{flow_id}", status_code=status.HTTP_200_OK)
def get_flow(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the full Flow (nodes/edges/trigger). 404 for other-tenant."""
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")
    stats = _run_stats(db, [flow.id]).get(flow.id)
    return {**_flow_to_dict(flow), **_card_extras(flow, stats), **_detail_extras(db, flow)}


# ---------------------------------------------------------------------------
# PATCH /v1/flows/{id}
# ---------------------------------------------------------------------------


@router.patch("/flows/{flow_id}", status_code=status.HTTP_200_OK)
def patch_flow(
    flow_id: str,
    body: PatchFlowBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update Flow fields. Re-validates trigger.kind if trigger is changed."""
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    if body.title is not None:
        flow.title = body.title

    if body.trigger is not None:
        _validate_trigger_kind(body.trigger.kind)
        flow.trigger = {"kind": body.trigger.kind, "spec": body.trigger.spec}

    if body.nodes is not None:
        flow.nodes = body.nodes
        flow.version = (flow.version or 1) + 1

    if body.edges is not None:
        flow.edges = body.edges
        # only bump once even if both nodes and edges provided
        if body.nodes is None:
            flow.version = (flow.version or 1) + 1

    if body.enabled is not None:
        flow.enabled = body.enabled

    if body.areas is not None:
        flow.areas = body.areas

    if body.settings is not None:
        flow.settings = _deep_merge(dict(flow.settings or {}), body.settings)
        # JSONB mutation via reassignment is tracked, but flag to be safe.
        flag_modified(flow, "settings")

    db.flush()
    return _flow_to_dict(flow)


# ---------------------------------------------------------------------------
# DELETE /v1/flows/{id}
# ---------------------------------------------------------------------------


@router.delete("/flows/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flow(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Hard-delete a Flow and its FlowRuns. 404 for another tenant's flow (RLS).

    FlowRun.flow_id has no FK cascade, so we delete the run history explicitly
    in the same transaction to avoid orphaned rows.
    """
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    db.query(FlowRun).filter(FlowRun.flow_id == flow_id).delete(synchronize_session=False)
    db.query(FlowVersion).filter(FlowVersion.flow_id == flow_id).delete(synchronize_session=False)
    db.delete(flow)
    db.flush()


# ---------------------------------------------------------------------------
# POST /v1/flows/{id}/publish
# ---------------------------------------------------------------------------


@router.post("/flows/{flow_id}/publish", status_code=status.HTTP_200_OK)
def publish_flow(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a flow_publish Proposal (pending, risk=medium) + decision InboxItem.

    The Flow remains status=draft until the Proposal is approved. Returns the Proposal.

    The Proposal requires a job_id (not nullable on the model). We create a
    lightweight Chief Job (origin="flow", brief="Publish flow {id}") and attach
    the Proposal to it.
    """
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    # Find the Chief helper for this company to act as the proposer.
    from omilo.models.agents import Helper

    chief = (
        db.query(Helper)
        .filter_by(company_id=ctx.company_id, is_chief=True)
        .first()
    )
    if chief is None:
        # Fallback: use any helper
        chief = db.query(Helper).filter_by(company_id=ctx.company_id).first()
    if chief is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No Helper found for this company; cannot create a flow_publish proposal.",
        )

    # Create a lightweight Job for the publish action (Proposal.job_id is NOT nullable).
    from omilo.models.execution import Job
    from datetime import datetime, timezone

    job = Job(
        id=prefixed_id("job"),
        company_id=ctx.company_id,
        helper_id=chief.id,
        origin="flow",
        brief=f"Publish flow {flow.id}: {flow.title}",
        status="waiting",
        cost_credits=0,
        tokens_in=0,
        tokens_out=0,
        attempts=0,
        checkpoint={},
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    db.flush()

    # Create the flow_publish Proposal.
    body_md = (
        f"**Flow:** {flow.title}  \n"
        f"**Trigger:** {flow.trigger.get('kind', '?')}  \n"
        f"**Nodes:** {len(flow.nodes) if isinstance(flow.nodes, list) else '?'}  \n\n"
        "Approving will publish the flow and register its trigger. "
        "The flow will become live and start running."
    )

    proposal = Proposal(
        id=prefixed_id("prp"),
        company_id=ctx.company_id,
        job_id=job.id,
        helper_id=chief.id,
        type="flow_publish",
        risk="medium",
        title=f"Publish flow: {flow.title}",
        body_md=body_md,
        status="pending",
        current_revision=1,
    )
    db.add(proposal)
    db.flush()

    # sweep/inbox-flows: snapshot the graph being published; approval marks it live.
    snap = _snapshot(db, flow, note="Published", created_by="operator")
    proposal.params = {"flow_id": flow.id, "version": snap.version}

    # Attach proposal to the job for later resolution.
    job.proposal_id = proposal.id
    db.flush()

    # Initial revision (mirrors loop/runner.py pattern).
    revision = ProposalRevision(
        id=prefixed_id("prv"),
        company_id=ctx.company_id,
        proposal_id=proposal.id,
        n=1,
        body_md=body_md,
        author="operator",
        summary="Publish request from operator",
    )
    db.add(revision)
    db.flush()

    # Create a decision InboxItem (mirrors the runner._create_inbox_item pattern).
    inbox_item = InboxItem(
        id=prefixed_id("inb"),
        company_id=ctx.company_id,
        title=proposal.title,
        summary=body_md,
        session_id="",
        channel_id=(
            chief.channel_ids[0]
            if getattr(chief, "channel_ids", None)
            else ""
        ),
        kind="decision",
        status="pending",
        asker=chief.name,
        asker_area=chief.area,
        needs_you=True,
        proposals=[{"proposal_id": proposal.id, "type": "flow_publish", "risk": "medium"}],
        actions=[
            {"label": "Approve", "primary": True},
            {"label": "Reject"},
        ],
    )
    db.add(inbox_item)
    db.flush()

    # Best-effort SSE publish.
    try:
        from omilo.realtime.events import broker
        broker.publish(ctx.company_id, {
            "type": "inbox.created",
            "id": inbox_item.id,
            "data": {
                "inbox_id": inbox_item.id,
                "kind": "decision",
                "needs_you": True,
            },
        })
    except Exception:
        pass

    return _proposal_to_dict(proposal)


# ---------------------------------------------------------------------------
# GET /v1/flows/{id}/runs
# ---------------------------------------------------------------------------


@router.get("/flows/{flow_id}/runs", status_code=status.HTTP_200_OK)
def get_flow_runs(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return recent FlowRuns for this Flow. 404 if flow not found / other-tenant."""
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    runs = (
        db.query(FlowRun)
        .filter(FlowRun.flow_id == flow_id)
        .order_by(FlowRun.created_at.desc())
        .limit(50)
        .all()
    )
    return [_run_to_dict(r) for r in runs]


# ---------------------------------------------------------------------------
# POST /v1/flows/{id}/test-run
# ---------------------------------------------------------------------------


@router.post("/flows/{flow_id}/test-run", status_code=status.HTTP_200_OK)
def test_run_flow(
    flow_id: str,
    body: TestRunBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Simulate a flow run (test=True — no real side effects).

    Connector nodes are skipped; approval nodes log a note without parking.
    Returns the persisted FlowRun.
    """
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    from omilo.flows.engine import run_flow

    run = run_flow(db, flow, trigger_summary="test-run", started_by="operator", test=True)
    return _run_to_dict(run)


# ---------------------------------------------------------------------------
# POST /v1/flows/{id}/run
# ---------------------------------------------------------------------------


@router.post("/flows/{flow_id}/run", status_code=status.HTTP_200_OK)
def run_flow_now(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Manually trigger a flow run (test=False).

    Returns the persisted FlowRun. The run walks all nodes; an approval node
    parks the run (status=needs_you) and returns immediately.
    """
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")

    from omilo.flows.engine import run_flow

    run = run_flow(db, flow, trigger_summary="manual", started_by="operator", test=False)
    return _run_to_dict(run)



# ---------------------------------------------------------------------------
# ── sweep/inbox-flows ──
# ---------------------------------------------------------------------------


def _run_stats(db: Session, flow_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Per flow: last run + daily run counts for the last 7 days (oldest → today)."""
    from datetime import datetime, timedelta, timezone

    if not flow_ids:
        return {}
    now = datetime.now(timezone.utc)
    today = now.date()
    since = datetime.combine(today - timedelta(days=6), datetime.min.time(), tzinfo=timezone.utc)
    out: dict[str, dict[str, Any]] = {fid: {"last": None, "days": [0] * 7} for fid in flow_ids}
    runs = (
        db.query(FlowRun)
        .filter(FlowRun.flow_id.in_(flow_ids))
        .order_by(FlowRun.created_at.desc())
        .all()
    )
    for r in runs:
        st = out[r.flow_id]
        if st["last"] is None:
            st["last"] = r
        at = r.started_at or r.created_at
        if at and at >= since:
            idx = 6 - (today - at.astimezone(timezone.utc).date()).days
            if 0 <= idx < 7:
                st["days"][idx] += 1
    return out


def _node_app(node: dict[str, Any]) -> str:
    cfg = node.get("config") if isinstance(node.get("config"), dict) else {}
    ui = cfg.get("ui") if isinstance(cfg.get("ui"), dict) else {}
    for key in ("app", "source"):
        val = ui.get(key) or cfg.get(key)
        if val:
            return str(val).lower()
    return str(cfg.get("name") or node.get("kind") or "").lower()


def _card_extras(flow: Flow, stats: dict[str, Any] | None) -> dict[str, Any]:
    nodes = flow.nodes if isinstance(flow.nodes, list) else []
    apps = [
        _node_app(n) for n in nodes
        if isinstance(n, dict) and n.get("kind") in ("trigger", "connector", "approval")
    ]
    last = stats["last"] if stats else None
    return {
        "trigger_kind": (flow.trigger or {}).get("kind"),
        "apps": apps,
        "ai_steps": sum(1 for n in nodes if isinstance(n, dict) and n.get("kind") == "ai_step"),
        "runs_7d": stats["days"] if stats else [0] * 7,
        "last_run": _run_to_dict(last) if last is not None else None,
    }


def _detail_extras(db: Session, flow: Flow) -> dict[str, Any]:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spent = sum(
        int(r.tokens or 0)
        for r in db.query(FlowRun)
        .filter(FlowRun.flow_id == flow.id, FlowRun.created_at >= month_start)
        .all()
    )
    pending = (
        db.query(Proposal)
        .filter(Proposal.type == "flow_publish", Proposal.status.in_(("pending", "changes_requested")))
        .filter(Proposal.params["flow_id"].as_string() == flow.id)
        .order_by(Proposal.created_at.desc())
        .first()
    )
    live = (
        db.query(FlowVersion)
        .filter(FlowVersion.flow_id == flow.id, FlowVersion.status == "live")
        .order_by(FlowVersion.version.desc())
        .first()
    )
    if pending is not None:
        publish_state = "pending"
    elif live is not None and live.version == flow.version:
        publish_state = "live"
    else:
        publish_state = "draft"
    return {
        "tokens_this_month": spent,
        "publish_state": publish_state,
        "pending_proposal_id": pending.id if pending is not None else None,
        "published_version": live.version if live is not None else None,
    }


def _snapshot(db: Session, flow: Flow, *, note: str, created_by: str) -> FlowVersion:
    """Record the flow's current graph as FlowVersion ``flow.version`` (upsert)."""
    existing = (
        db.query(FlowVersion)
        .filter(FlowVersion.flow_id == flow.id, FlowVersion.version == flow.version)
        .first()
    )
    if existing is not None and existing.status != "live":
        existing.nodes = flow.nodes
        existing.edges = flow.edges
        existing.trigger = flow.trigger
        existing.title = flow.title
        existing.note = note
        db.flush()
        return existing
    if existing is not None:
        return existing
    snap = FlowVersion(
        id=prefixed_id("flv"),
        company_id=flow.company_id,
        flow_id=flow.id,
        version=flow.version or 1,
        title=flow.title,
        note=note,
        trigger=flow.trigger or {},
        nodes=flow.nodes or [],
        edges=flow.edges or [],
        status="pending",
        created_by=created_by,
    )
    db.add(snap)
    db.flush()
    return snap


def _version_to_dict(v: FlowVersion) -> dict[str, Any]:
    return {
        "id": v.id,
        "flow_id": v.flow_id,
        "version": v.version,
        "title": v.title,
        "note": v.note,
        "status": v.status,
        "created_by": v.created_by,
        "node_count": len(v.nodes) if isinstance(v.nodes, list) else 0,
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _flow_or_404(db: Session, flow_id: str) -> Flow:
    flow = db.query(Flow).filter(Flow.id == flow_id).first()
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found.")
    return flow


def _run_or_404(db: Session, flow_id: str, run_id: str) -> FlowRun:
    run = db.query(FlowRun).filter(FlowRun.id == run_id, FlowRun.flow_id == flow_id).first()
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")
    return run


@router.get("/flows/{flow_id}/runs/{run_id}", status_code=status.HTTP_200_OK)
def get_flow_run(
    flow_id: str,
    run_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """One FlowRun with its per-step log (``steps``)."""
    _flow_or_404(db, flow_id)
    return _run_to_dict(_run_or_404(db, flow_id, run_id))


class DecideRunBody(BaseModel):
    approve: bool = True
    note: Optional[str] = None


@router.post("/flows/{flow_id}/runs/{run_id}/approve", status_code=status.HTTP_200_OK)
def approve_flow_run(
    flow_id: str,
    run_id: str,
    body: DecideRunBody = DecideRunBody(),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Approve (or decline with approve=false) a run waiting at an approval step."""
    flow = _flow_or_404(db, flow_id)
    run = _run_or_404(db, flow_id, run_id)
    if run.status != "needs_you":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This run is not waiting for you.")
    from omilo.flows.engine import resume_run

    return _run_to_dict(resume_run(db, flow, run, approved=body.approve))


@router.post("/flows/{flow_id}/runs/{run_id}/retry", status_code=status.HTTP_200_OK)
def retry_flow_run(
    flow_id: str,
    run_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Start a fresh run of the flow (failed/cancelled runs only); returns the new run."""
    flow = _flow_or_404(db, flow_id)
    run = _run_or_404(db, flow_id, run_id)
    if run.status not in ("failed", "cancelled", "declined"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only failed runs can be retried.")
    from omilo.flows.engine import run_flow

    new = run_flow(db, flow, trigger_summary=f"retry of {run.id}", started_by="operator", test=False)
    return _run_to_dict(new)


@router.post("/flows/{flow_id}/runs/{run_id}/cancel", status_code=status.HTTP_200_OK)
def cancel_flow_run(
    flow_id: str,
    run_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Cancel a running / waiting run."""
    _flow_or_404(db, flow_id)
    run = _run_or_404(db, flow_id, run_id)
    if run.status not in ("running", "needs_you"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This run already ended.")
    from omilo.flows.engine import cancel_run

    return _run_to_dict(cancel_run(db, run))


@router.get("/flows/{flow_id}/versions", status_code=status.HTTP_200_OK)
def list_flow_versions(
    flow_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Version history (newest first)."""
    _flow_or_404(db, flow_id)
    rows = (
        db.query(FlowVersion)
        .filter(FlowVersion.flow_id == flow_id)
        .order_by(FlowVersion.version.desc(), FlowVersion.created_at.desc())
        .all()
    )
    return [_version_to_dict(v) for v in rows]


@router.post("/flows/{flow_id}/versions/{version}/restore", status_code=status.HTTP_200_OK)
def restore_flow_version(
    flow_id: str,
    version: int,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Put a past version's graph back on the canvas (as unpublished changes)."""
    flow = _flow_or_404(db, flow_id)
    snap = (
        db.query(FlowVersion)
        .filter(FlowVersion.flow_id == flow_id, FlowVersion.version == version)
        .first()
    )
    if snap is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found.")
    flow.nodes = snap.nodes
    flow.edges = snap.edges
    flow.trigger = snap.trigger or flow.trigger
    flow.version = (flow.version or 1) + 1
    db.flush()
    _snapshot(db, flow, note=f"Restored from v{version}", created_by="operator")
    return _flow_to_dict(flow)
