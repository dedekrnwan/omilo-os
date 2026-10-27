"""MCP tool implementations — Role-2 native platform tools.

Each tool receives:
  - db: a tenant-scoped SQLAlchemy Session (RLS enforced via omilo_app role + GUC)
  - helper: the authenticated Helper ORM instance
  - arguments: dict of tool arguments from the JSON-RPC params

Returns a plain Python object (serializable to JSON) as the tool result.

Every tool call is logged to ToolCall (done by the dispatcher in server.py).

Spec: docs/technical/05-mcp-surfaces.md §2.
Propose-don't-act: docs/technical/05-mcp-surfaces.md §3.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.approvals import Proposal, ProposalRevision, SafetyLimit
from omilo.models.base import prefixed_id
from omilo.models.flows import Flow
from omilo.models.inbox import InboxItem
from omilo.models.routines import Routine
from omilo.models.workspace import Goal
from omilo.engine.autonomy import decide, effective_autonomy


# ---------------------------------------------------------------------------
# Tool catalog (for tools/list)
# ---------------------------------------------------------------------------

TOOL_CATALOG: list[dict[str, Any]] = [
    {
        "name": "whoami",
        "description": "Return helper identity, role, and company.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "goals_list",
        "description": "List all goals for this company.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "routines_list",
        "description": "List all routines for this company.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "flows_list",
        "description": "List all flows for this company.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "recall",
        "description": "Hybrid KB search (FTS + pgvector + RRF). Returns ranked chunks.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
    {
        "name": "propose",
        "description": (
            "File an approval item via the gate. "
            "The gate decides: allowed | proposed (pending) | refused. "
            "Never executes a real side effect directly."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "description": "ProposalType e.g. message, deploy"},
                "risk": {"type": "string", "enum": ["low", "medium", "high"]},
                "title": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["type", "risk", "title", "body"],
        },
    },
]


# ---------------------------------------------------------------------------
# Individual tool handlers
# ---------------------------------------------------------------------------

def tool_whoami(db: Session, helper: Helper, arguments: dict) -> dict:
    """Return helper identity."""
    return {
        "helper_id": helper.id,
        "name": helper.name,
        "is_chief": helper.is_chief,
        "company_id": helper.company_id,
        "area": helper.area,
        "autonomy_cap": helper.autonomy_cap,
    }


def tool_goals_list(db: Session, helper: Helper, arguments: dict) -> list[dict]:
    """List all goals for this company (RLS-scoped)."""
    goals = db.query(Goal).all()
    return [
        {
            "id": g.id,
            "title": g.title,
            "progress": g.progress,
            "status": g.status,
            "target": g.target,
            "channel_id": g.channel_id,
        }
        for g in goals
    ]


def tool_routines_list(db: Session, helper: Helper, arguments: dict) -> list[dict]:
    """List all routines for this company (RLS-scoped)."""
    routines = db.query(Routine).all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "freq": r.freq,
            "enabled": r.enabled,
            "helper_id": r.helper_id,
        }
        for r in routines
    ]


def tool_flows_list(db: Session, helper: Helper, arguments: dict) -> list[dict]:
    """List all flows for this company (RLS-scoped)."""
    flows = db.query(Flow).all()
    return [
        {
            "id": f.id,
            "title": f.title,
            "status": f.status,
            "enabled": f.enabled,
        }
        for f in flows
    ]


def tool_recall(db: Session, helper: Helper, arguments: dict) -> list:
    """Hybrid KB search — FTS + pgvector + RRF, company-scoped via RLS."""
    from omilo.kb.retrieve import recall as _recall

    query = arguments.get("query", "")
    try:
        return _recall(db, query)
    except Exception:
        return []


def tool_propose(db: Session, helper: Helper, arguments: dict) -> dict:
    """Run the gate; create a Proposal if needs_owner; never execute a real action.

    Gate logic:
      effective_autonomy = min(company.autonomy_default, helper.autonomy_cap)
      verdict = decide(effective, risk, type, safety, usage)
      - allowed   → return {status: "allowed"}  (log ToolCall — no real action)
      - needs_owner → create Proposal (pending) + Revision + InboxItem
                      → return {status: "proposed", proposal_id}
      - refused   → return {status: "refused"}
    """
    from omilo.models.tenancy import Company

    proposal_type = arguments.get("type", "message")
    risk = arguments.get("risk", "medium")
    title = arguments.get("title", f"Approve: {proposal_type}")
    body = arguments.get("body", "")

    # Resolve effective autonomy
    company = db.query(Company).filter_by(id=helper.company_id).first()
    workspace_autonomy = (company.autonomy_default if company else "ask") or "ask"
    eff = effective_autonomy(workspace_autonomy, None, helper.autonomy_cap)

    # Load safety limits for this company
    safety = db.query(SafetyLimit).filter_by(company_id=helper.company_id).all()

    # Run the gate
    verdict = decide(eff, risk, proposal_type, safety, {})

    if verdict == "allowed":
        # Act-and-log: record allowed, but do NOT execute any real connector action.
        return {"status": "allowed"}

    if verdict == "refused":
        return {"status": "refused"}

    # needs_owner: create Proposal + ProposalRevision + InboxItem (decision)
    # Use a sentinel job_id since MCP proposals are not attached to a running Job.
    sentinel_job_id = "mcp_direct"

    proposal = Proposal(
        id=prefixed_id("prp"),
        company_id=helper.company_id,
        job_id=sentinel_job_id,
        helper_id=helper.id,
        type=proposal_type,
        risk=risk,
        title=title,
        body_md=body,
        status="pending",
        current_revision=1,
    )
    db.add(proposal)
    db.flush()

    revision = ProposalRevision(
        id=prefixed_id("prv"),
        company_id=helper.company_id,
        proposal_id=proposal.id,
        n=1,
        body_md=body,
        author="agent",
        summary="MCP direct proposal",
    )
    db.add(revision)

    # Create a decision InboxItem so the operator sees it in the Inbox.
    # We need a valid session_id and channel_id — use sentinels for MCP proposals.
    inbox_item = InboxItem(
        id=prefixed_id("inb"),
        company_id=helper.company_id,
        title=title,
        summary=body,
        session_id="mcp_direct",
        channel_id="mcp_direct",
        kind="decision",
        status="pending",
        asker=helper.name,
        asker_area=helper.area,
        needs_you=True,
        proposals={"proposal_id": proposal.id, "type": proposal_type, "risk": risk},
        actions=[
            {"label": "Approve", "primary": True},
            {"label": "Reject"},
        ],
    )
    db.add(inbox_item)
    db.flush()

    return {"status": "proposed", "proposal_id": proposal.id}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

#: Maps tool name → handler function
TOOL_HANDLERS: dict[str, Any] = {
    "whoami": tool_whoami,
    "goals_list": tool_goals_list,
    "routines_list": tool_routines_list,
    "flows_list": tool_flows_list,
    "recall": tool_recall,
    "propose": tool_propose,
}


def dispatch(
    tool_name: str,
    arguments: dict,
    db: Session,
    helper: Helper,
) -> tuple[Any, str]:
    """Dispatch to the named tool handler.

    Returns (result, decision) where decision ∈ {allowed, proposal, refused, error}.

    Raises KeyError if the tool name is not in the catalog.
    """
    handler = TOOL_HANDLERS.get(tool_name)
    if handler is None:
        raise KeyError(f"Unknown tool: {tool_name!r}")

    result = handler(db, helper, arguments)

    # Derive decision from the result for logging
    if isinstance(result, dict) and "status" in result:
        status = result["status"]
        if status == "proposed":
            decision = "proposal"
        elif status == "refused":
            decision = "refused"
        else:
            decision = "allowed"
    else:
        decision = "allowed"

    return result, decision
