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
from omilo.models.execution import Job
from omilo.models.flows import Flow
from omilo.models.inbox import InboxItem
from omilo.models.routines import Routine
from omilo.models.skills import Skill
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
    {
        "name": "remember",
        "description": (
            "Persist a note to the helper's Notes.md memory doc. "
            "Use for things the helper wants to remember across runs."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The note to remember"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "skill_save",
        "description": "Create or update a draft Skill for this helper.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "body_md": {"type": "string"},
                "skill_id": {
                    "type": "string",
                    "description": "If provided, update that existing skill.",
                },
            },
            "required": ["name", "body_md"],
        },
    },
    {
        "name": "skill_publish",
        "description": "Create a skill_publish Proposal for a Skill (pending operator approval).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill_id": {"type": "string"},
            },
            "required": ["skill_id"],
        },
    },
    {
        "name": "skills_list",
        "description": "List all skills for this company.",
        "inputSchema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "skill_read",
        "description": "Read the full body of a Skill.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "skill_id": {"type": "string"},
            },
            "required": ["skill_id"],
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


def tool_remember(db: Session, helper: Helper, arguments: dict) -> dict:
    """Persist a note to the helper's Notes.md memory doc (company-scoped via RLS).

    The ToolCall is logged by the dispatcher in server.py (standard flow).
    """
    from omilo.memory.store import remember as _remember

    text_arg = arguments.get("text", "")
    if not text_arg:
        return {"status": "error", "detail": "text argument is required"}

    _remember(db, helper.id, text_arg)
    return {"status": "ok", "helper_id": helper.id}


def tool_skill_save(db: Session, helper: Helper, arguments: dict) -> dict:
    """Create or update a draft Skill for the authenticated helper.

    If skill_id is provided and the skill exists in this company, update it.
    Otherwise create a new draft Skill.
    Returns {skill_id}.
    """
    skill_id = arguments.get("skill_id")
    name = arguments.get("name", "Untitled Skill")
    body_md = arguments.get("body_md", "")

    if skill_id:
        skill = db.query(Skill).filter_by(id=skill_id, helper_id=helper.id).first()
        if skill is None:
            return {"status": "error", "detail": "Skill not found"}
        skill.name = name
        skill.body_md = body_md
        skill.version = (skill.version or 1) + 1
        db.flush()
        return {"skill_id": skill.id}

    skill = Skill(
        id=prefixed_id("skl"),
        company_id=helper.company_id,
        helper_id=helper.id,
        name=name,
        body_md=body_md,
        status="draft",
        version=1,
        usage_count=0,
        created_by="agent",
    )
    db.add(skill)
    db.flush()
    return {"skill_id": skill.id}


def tool_skill_publish(db: Session, helper: Helper, arguments: dict) -> dict:
    """Create a skill_publish Proposal (pending) for the given skill.

    Reuses the same Job + Proposal + ProposalRevision + InboxItem pattern as
    the REST publish_skill endpoint. Also KB-indexes the skill body.
    Returns {status: "proposed", proposal_id: ...}.
    """
    skill_id = arguments.get("skill_id", "")
    skill = db.query(Skill).filter_by(id=skill_id, helper_id=helper.id).first()
    if skill is None:
        return {"status": "error", "detail": "Skill not found"}

    # Find Chief helper for this company
    chief = (
        db.query(Helper)
        .filter_by(company_id=helper.company_id, is_chief=True)
        .first()
    )
    if chief is None:
        chief = db.query(Helper).filter_by(company_id=helper.company_id).first()
    if chief is None:
        return {"status": "error", "detail": "No helper found for this company"}

    job = Job(
        id=prefixed_id("job"),
        company_id=helper.company_id,
        helper_id=chief.id,
        origin="skill",
        brief=f"Publish skill {skill.id}: {skill.name}",
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

    body_md = (
        f"**Skill:** {skill.name}  \n"
        f"**Helper:** {skill.helper_id}  \n\n"
        "Approving will publish the skill and make it available for recall and context loading."
    )

    proposal = Proposal(
        id=prefixed_id("prp"),
        company_id=helper.company_id,
        job_id=job.id,
        helper_id=chief.id,
        type="skill_publish",
        risk="medium",
        title=f"Publish skill: {skill.name}",
        body_md=body_md,
        status="pending",
        current_revision=1,
    )
    db.add(proposal)
    db.flush()

    job.proposal_id = proposal.id
    db.flush()

    revision = ProposalRevision(
        id=prefixed_id("prv"),
        company_id=helper.company_id,
        proposal_id=proposal.id,
        n=1,
        body_md=body_md,
        author="agent",
        summary="MCP skill_publish request",
    )
    db.add(revision)

    inbox_item = InboxItem(
        id=prefixed_id("inb"),
        company_id=helper.company_id,
        title=proposal.title,
        summary=body_md,
        session_id="mcp_direct",
        channel_id="mcp_direct",
        kind="decision",
        status="pending",
        asker=chief.name,
        asker_area=chief.area,
        needs_you=True,
        proposals={"proposal_id": proposal.id, "type": "skill_publish", "risk": "medium"},
        actions=[
            {"label": "Approve", "primary": True},
            {"label": "Reject"},
        ],
    )
    db.add(inbox_item)
    db.flush()

    # KB-index the skill body
    try:
        from omilo.kb.index import index_source
        index_source(
            db,
            kind="skill",
            ref=f"skill:{skill.id}",
            title=skill.name,
            body=skill.body_md,
            helper_id=skill.helper_id,
        )
    except Exception:
        pass

    return {"status": "proposed", "proposal_id": proposal.id}


def tool_skills_list(db: Session, helper: Helper, arguments: dict) -> list[dict]:
    """List all skills for this company (RLS-scoped)."""
    skills = db.query(Skill).all()
    return [
        {
            "id": s.id,
            "name": s.name,
            "status": s.status,
            "version": s.version,
            "helper_id": s.helper_id,
        }
        for s in skills
    ]


def tool_skill_read(db: Session, helper: Helper, arguments: dict) -> dict:
    """Return the full body of a Skill. Returns error dict if not found."""
    skill_id = arguments.get("skill_id", "")
    skill = db.query(Skill).filter_by(id=skill_id, helper_id=helper.id).first()
    if skill is None:
        return {"status": "error", "detail": "Skill not found"}
    return {
        "id": skill.id,
        "name": skill.name,
        "body_md": skill.body_md,
        "status": skill.status,
        "version": skill.version,
        "helper_id": skill.helper_id,
    }


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
    "remember": tool_remember,
    "skill_save": tool_skill_save,
    "skill_publish": tool_skill_publish,
    "skills_list": tool_skills_list,
    "skill_read": tool_skill_read,
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
