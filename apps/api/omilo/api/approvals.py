"""GET + write endpoints for Proposals (inbox approval write path).

Endpoints (§6 of 02-api-contracts.md):
  GET  /v1/proposals/{id}                     → {proposal, revisions[]}
  POST /v1/proposals/{id}/approve  {note?}    → {proposal, execution_job_id}
  POST /v1/proposals/{id}/reject   {note}     → {proposal}
  POST /v1/proposals/{id}/request-changes {note} → {proposal, revisions[]}

All are company-scoped via get_tenant_db (FORCE RLS — company B cannot see
company A's proposals).

Idempotency (approve):
  State is the single source of truth.  If the proposal is already
  approved/executing/done and has an execution_job_id, we return the existing
  id immediately without creating a second execution Job.  The optional
  Idempotency-Key header is belt-and-braces; state is authoritative.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.loop.emit import make_emitter
from omilo.models.approvals import Proposal, ProposalRevision
from omilo.models.base import prefixed_id
from omilo.models.execution import Job
from omilo.models.inbox import InboxItem
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["approvals"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ApproveBody(BaseModel):
    note: str | None = None


class RejectBody(BaseModel):
    note: str


class RequestChangesBody(BaseModel):
    note: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _revision_to_dict(rev: ProposalRevision) -> dict[str, Any]:
    return {
        "id": rev.id,
        "proposal_id": rev.proposal_id,
        "n": rev.n,
        "body_md": rev.body_md,
        "author": rev.author,
        "summary": rev.summary,
        "at": rev.at.isoformat() if rev.at else None,
    }


def _get_proposal_or_404(db: Session, proposal_id: str) -> Proposal:
    """Load proposal; RLS enforces company scope. 404 if missing."""
    proposal = db.query(Proposal).filter_by(id=proposal_id).first()
    if proposal is None:
        raise _404
    return proposal


def _get_revisions(db: Session, proposal_id: str) -> list[ProposalRevision]:
    return (
        db.query(ProposalRevision)
        .filter_by(proposal_id=proposal_id)
        .order_by(ProposalRevision.n)
        .all()
    )


def _resolve_original_job(db: Session, proposal: Proposal) -> None:
    """Find the waiting Job whose proposal_id == proposal.id and mark it done."""
    orig_job = (
        db.query(Job)
        .filter_by(proposal_id=proposal.id, status="waiting")
        .first()
    )
    if orig_job is not None:
        orig_job.status = "done"
        orig_job.ended_at = datetime.now(timezone.utc)
        db.flush()


def _resolve_decision_inbox_item(db: Session, proposal: Proposal) -> None:
    """Find the linked decision InboxItem and mark it done."""
    # The InboxItem created by the runner stores proposals JSONB with proposal_id
    # We find it by company scope + kind=decision, matching proposal_id in the
    # proposals JSONB column.  Simpler: the item was created for the same job.
    orig_job = (
        db.query(Job)
        .filter_by(id=proposal.job_id)
        .first()
    )
    if orig_job is None:
        return
    # Find the decision inbox item linked to this job (company-scoped via RLS)
    item = (
        db.query(InboxItem)
        .filter_by(company_id=proposal.company_id, kind="decision")
        .filter(InboxItem.status != "done")
        .filter(
            # proposals column is JSONB — filter by the stored proposal_id
            InboxItem.proposals["proposal_id"].as_string() == proposal.id
        )
        .first()
    )
    if item is not None:
        item.status = "done"
        db.flush()


def _create_execution_job(
    db: Session, proposal: Proposal, ctx: RequestContext
) -> Job:
    """Create the execution Job that carries out the approved action (fake for P1)."""
    from omilo.models.agents import Helper

    helper = db.get(Helper, proposal.helper_id)

    exec_job = Job(
        id=prefixed_id("job"),
        company_id=proposal.company_id,
        helper_id=proposal.helper_id,
        origin="execution",
        brief=proposal.title,
        proposal_id=proposal.id,
        status="running",
        cost_credits=0,
        tokens_in=0,
        tokens_out=0,
        attempts=1,
        checkpoint={},
        started_at=datetime.now(timezone.utc),
    )
    db.add(exec_job)
    db.flush()

    # P1 fake execution: emit a tool RunEvent and mark done
    emitter = make_emitter(db, exec_job, None, None)
    emitter({
        "kind": "tool",
        "data": {"executed": True, "proposal_id": proposal.id},
    })

    exec_job.status = "done"
    exec_job.ended_at = datetime.now(timezone.utc)
    db.flush()

    return exec_job


# ---------------------------------------------------------------------------
# GET /v1/proposals/{id}
# ---------------------------------------------------------------------------

@router.get("/proposals/{proposal_id}")
def get_proposal(
    proposal_id: str,
    db: Session = Depends(get_tenant_db),
) -> dict:
    """Return {proposal, revisions[]} for the given proposal.

    404 if the proposal does not exist or belongs to another tenant (RLS).
    """
    proposal = _get_proposal_or_404(db, proposal_id)
    revisions = _get_revisions(db, proposal_id)
    return {
        "proposal": _proposal_to_dict(proposal),
        "revisions": [_revision_to_dict(r) for r in revisions],
    }


# ---------------------------------------------------------------------------
# POST /v1/proposals/{id}/approve
# ---------------------------------------------------------------------------

@router.post("/proposals/{proposal_id}/approve")
def approve_proposal(
    proposal_id: str,
    body: ApproveBody = ApproveBody(),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict:
    """Approve a proposal.

    Idempotency: if the proposal is already approved/executing/done and has an
    execution_job_id, return the existing result immediately — no second Job.
    State is authoritative; the Idempotency-Key header is belt-and-braces.
    """
    proposal = _get_proposal_or_404(db, proposal_id)

    # ── Idempotency gate ────────────────────────────────────────────────────
    if proposal.status in ("approved", "executing", "done", "failed") and proposal.execution_job_id:
        return {
            "proposal": _proposal_to_dict(proposal),
            "execution_job_id": proposal.execution_job_id,
        }

    # ── Approve ─────────────────────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    proposal.status = "approved"
    proposal.decided_by = f"operator:{ctx.user_id}"
    proposal.decided_at = now
    proposal.decision_note = body.note
    db.flush()

    # Create execution Job (fake P1)
    exec_job = _create_execution_job(db, proposal, ctx)

    # Mark proposal done with result
    proposal.status = "done"
    proposal.execution_job_id = exec_job.id
    proposal.result = {"executed": True}
    db.flush()

    # Resolve original waiting Job → done
    _resolve_original_job(db, proposal)

    # Resolve linked decision InboxItem → done
    _resolve_decision_inbox_item(db, proposal)

    return {
        "proposal": _proposal_to_dict(proposal),
        "execution_job_id": exec_job.id,
    }


# ---------------------------------------------------------------------------
# POST /v1/proposals/{id}/reject
# ---------------------------------------------------------------------------

@router.post("/proposals/{proposal_id}/reject")
def reject_proposal(
    proposal_id: str,
    body: RejectBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Reject a proposal.

    Idempotent: already-rejected → return as-is.
    No execution Job is created.
    Original waiting Job → done; decision InboxItem → done.
    """
    proposal = _get_proposal_or_404(db, proposal_id)

    # Idempotent: already rejected
    if proposal.status == "rejected":
        return {"proposal": _proposal_to_dict(proposal)}

    now = datetime.now(timezone.utc)
    proposal.status = "rejected"
    proposal.decided_by = f"operator:{ctx.user_id}"
    proposal.decided_at = now
    proposal.decision_note = body.note
    db.flush()

    # Resolve original waiting Job → done (concluded without the action)
    _resolve_original_job(db, proposal)

    # Resolve linked decision InboxItem → done
    _resolve_decision_inbox_item(db, proposal)

    return {"proposal": _proposal_to_dict(proposal)}


# ---------------------------------------------------------------------------
# POST /v1/proposals/{id}/request-changes
# ---------------------------------------------------------------------------

@router.post("/proposals/{proposal_id}/request-changes")
def request_changes(
    proposal_id: str,
    body: RequestChangesBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Create a new ProposalRevision (operator note) and set status=changes_requested.

    Bumps proposal.current_revision.  The proposal stays actionable —
    operator can later approve or reject.
    """
    proposal = _get_proposal_or_404(db, proposal_id)

    new_n = proposal.current_revision + 1

    revision = ProposalRevision(
        id=prefixed_id("prv"),
        company_id=proposal.company_id,
        proposal_id=proposal.id,
        n=new_n,
        body_md=body.note,
        author="operator",
        summary=body.note,
    )
    db.add(revision)
    db.flush()

    proposal.current_revision = new_n
    proposal.status = "changes_requested"
    db.flush()

    revisions = _get_revisions(db, proposal_id)

    return {
        "proposal": _proposal_to_dict(proposal),
        "revisions": [_revision_to_dict(r) for r in revisions],
    }
