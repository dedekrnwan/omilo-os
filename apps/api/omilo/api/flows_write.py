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

from omilo.loop.runner import start_job
from omilo.models.approvals import Proposal, ProposalRevision
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow, FlowRun
from omilo.models.inbox import InboxItem
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["flows"])

# ---------------------------------------------------------------------------
# Allowed trigger kinds (from docs/business/flows.md §2)
# ---------------------------------------------------------------------------

_ALLOWED_TRIGGER_KINDS = frozenset({"schedule", "manual", "internal_event", "connector_poll"})
_REJECTED_TRIGGER_KINDS = frozenset({"webhook", "connector_webhook"})

_ALLOWED_NODE_KINDS = frozenset({"trigger", "ai_step", "connector", "approval", "condition"})


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
        "duration": run.duration,
        "waiting_for": run.waiting_for,
        "job_ids": run.job_ids,
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
    return [_flow_card(f) for f in flows]


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
    return _flow_to_dict(flow)


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

    db.flush()
    return _flow_to_dict(flow)


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
        proposals={"proposal_id": proposal.id, "type": "flow_publish", "risk": "medium"},
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
