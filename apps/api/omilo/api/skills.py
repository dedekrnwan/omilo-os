"""Skill CRUD + publish endpoints (§10 of 02-api-contracts.md).

Endpoints:
  GET  /v1/skills                    → SkillCard[]
  POST /v1/skills {helper_id,name,body_md}
                                     → Skill (status=draft)
  GET  /v1/skills/{id}               → Skill
  POST /v1/skills/{id}/publish       → Proposal (type=skill_publish, pending)

Publish creates a ``skill_publish`` Proposal (risk=medium) + a ``decision``
InboxItem.  The Skill stays ``draft`` until the Proposal is approved (wired
in a later task).  The skill body is KB-indexed (kind="skill") on publish
request so it becomes recall-able.

All routes are company-scoped via get_tenant_db (FORCE RLS).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.approvals import Proposal, ProposalRevision
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.models.inbox import InboxItem
from omilo.models.skills import Skill
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["skills"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class CreateSkillBody(BaseModel):
    helper_id: str
    name: str
    body_md: str


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------


def _skill_to_dict(skill: Skill) -> dict[str, Any]:
    return {
        "id": skill.id,
        "companyId": skill.company_id,
        "helperId": skill.helper_id,
        "name": skill.name,
        "bodyMd": skill.body_md,
        "status": skill.status,
        "version": skill.version,
        "usageCount": skill.usage_count,
        "createdBy": skill.created_by,
        "createdAt": skill.created_at.isoformat() if skill.created_at else None,
    }


def _skill_card(skill: Skill) -> dict[str, Any]:
    return {
        "id": skill.id,
        "name": skill.name,
        "status": skill.status,
        "version": skill.version,
        "helperId": skill.helper_id,
        "usageCount": skill.usage_count,
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
# GET /v1/skills
# ---------------------------------------------------------------------------


@router.get("/skills", status_code=status.HTTP_200_OK)
def list_skills(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """List all Skills for this company (RLS scoped). Returns SkillCard[]."""
    skills = db.query(Skill).order_by(Skill.created_at.desc()).all()
    return [_skill_card(s) for s in skills]


# ---------------------------------------------------------------------------
# POST /v1/skills
# ---------------------------------------------------------------------------


@router.post("/skills", status_code=status.HTTP_200_OK)
def create_skill(
    body: CreateSkillBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Skill in status=draft, version=1, created_by='operator'."""
    from omilo.billing.storage import check_upload

    check_upload(ctx.company_id, len((body.body_md or "").encode()))
    skill = Skill(
        id=prefixed_id("skl"),
        company_id=ctx.company_id,
        helper_id=body.helper_id,
        name=body.name,
        body_md=body.body_md,
        status="draft",
        version=1,
        usage_count=0,
        created_by="operator",
    )
    db.add(skill)
    db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="skills", action="wrote", target=skill.name)
    return _skill_to_dict(skill)


# ---------------------------------------------------------------------------
# GET /v1/skills/{id}
# ---------------------------------------------------------------------------


@router.get("/skills/{skill_id}", status_code=status.HTTP_200_OK)
def get_skill(
    skill_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return the full Skill. 404 for other-tenant (RLS hides it)."""
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
    return _skill_to_dict(skill)


# ---------------------------------------------------------------------------
# POST /v1/skills/{id}/publish
# ---------------------------------------------------------------------------


@router.post("/skills/{skill_id}/publish", status_code=status.HTTP_200_OK)
def publish_skill(
    skill_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a skill_publish Proposal (pending, risk=medium) + decision InboxItem.

    The Skill remains status=draft until the Proposal is approved. The skill
    body is KB-indexed (kind="skill") so it is recall-able immediately.
    Returns the Proposal.

    Requires a job_id (not nullable on the model). A lightweight Chief Job
    (origin="skill") is created and attached to the Proposal — same pattern
    as publish_flow in flows_write.py.
    """
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")

    # Find the Chief helper for this company to act as the proposer.
    chief = (
        db.query(Helper)
        .filter_by(company_id=ctx.company_id, is_chief=True)
        .first()
    )
    if chief is None:
        chief = db.query(Helper).filter_by(company_id=ctx.company_id).first()
    if chief is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No Helper found for this company; cannot create a skill_publish proposal.",
        )

    # Lightweight Job for the publish action (Proposal.job_id is NOT nullable).
    job = Job(
        id=prefixed_id("job"),
        company_id=ctx.company_id,
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
        company_id=ctx.company_id,
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
        company_id=ctx.company_id,
        proposal_id=proposal.id,
        n=1,
        body_md=body_md,
        author="operator",
        summary="Publish request from operator",
    )
    db.add(revision)
    db.flush()

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
        proposals={"proposal_id": proposal.id, "type": "skill_publish", "risk": "medium"},
        actions=[
            {"label": "Approve", "primary": True},
            {"label": "Reject"},
        ],
    )
    db.add(inbox_item)
    db.flush()

    # KB-index the skill body (kind="skill") so it is recall-able immediately.
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
        pass  # KB-index failure must not block the publish proposal

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



# ── sweep/control ────────────────────────────────────────────────────────────
# PATCH /v1/skills/{id} {status?, name?, body_md?, helper_id?}
#   status: "disabled" turns a live skill off (helpers stop seeing it);
#           "active" turns a disabled skill back on.  A draft still goes live
#           only through POST /publish (review).
# ─────────────────────────────────────────────────────────────────────────────


class PatchSkillBody(BaseModel):
    status: str | None = None
    name: str | None = None
    body_md: str | None = None
    helper_id: str | None = None


@router.patch("/skills/{skill_id}", status_code=status.HTTP_200_OK)
def patch_skill(
    skill_id: str,
    body: PatchSkillBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    skill = db.query(Skill).filter(Skill.id == skill_id).first()
    if skill is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill not found.")
    from omilo import audit

    if body.status is not None and body.status != skill.status:
        if body.status not in ("active", "disabled", "draft"):
            raise HTTPException(status_code=422, detail="status must be active, disabled or draft.")
        if body.status == "active" and skill.status == "draft":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Drafts go live through publish review. Publish it instead.",
            )
        skill.status = body.status
        audit.record_ctx(
            ctx, type="skills",
            action="turned on" if body.status == "active" else "turned off" if body.status == "disabled" else "moved to draft",
            target=skill.name,
        )
    edited = False
    if body.name is not None and body.name.strip():
        skill.name = body.name.strip()
        edited = True
    if body.body_md is not None:
        skill.body_md = body.body_md
        edited = True
    if body.helper_id is not None:
        skill.helper_id = body.helper_id
        edited = True
    if edited:
        audit.record_ctx(ctx, type="skills", action="edited", target=skill.name)
    db.flush()
    return _skill_to_dict(skill)
