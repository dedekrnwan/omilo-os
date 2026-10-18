"""The Chief-of-Staff delegation gate — the safety core of the graph brain.

Where this sits
---------------
The gate is a LangGraph node placed immediately AFTER the worker:

    supervisor → worker → gate → review → …

The worker produces a ``pending_action`` (the outward/internal thing it wants to
do). The gate decides, on the owner's behalf, who gets to approve it:

- **low / medium** — the Chief of Staff (CoS) can auto-handle it. The gate files a
  ``Proposal`` and immediately approves it AS THE COS through the existing
  ``services.decide_proposal`` so the whole downstream machinery is reused: the
  approval is audited with the CoS as actor, the owner's note becomes a lesson, and
  an execution task is spawned exactly as if the owner had clicked Approve. The graph
  then continues to finish normally.
- **high** — only the owner may decide. The gate files a ``Proposal`` and leaves it
  PENDING, then calls LangGraph's ``interrupt`` to CHECKPOINT and SUSPEND the run,
  executing nothing. ``GraphEngine.run_task`` reports a waiting result; the owner's
  later ``POST /proposals/{id}/decide`` resumes the graph from its checkpoint
  (thread_id = task_id) — that resume is Task 5.

Risk is re-derived, never trusted
---------------------------------
The worker's self-reported ``risk`` label is a HINT, not authority. The gate runs
``graph.risk.classify_risk`` over the structured ``action_type`` + ``summary``; the
hard-rule categories (send / spend / merge / deploy / production / any outward
action) escalate regardless of what the worker labelled the action. A worker that
tags a ``payment.charge`` "low" to dodge escalation still gets escalated.

Resume safety
-------------
``interrupt`` re-executes its node from the start when the graph resumes, so the
gate must be idempotent: if a PENDING proposal for this task already exists (filed on
the first pass), the gate reuses it instead of filing a duplicate before suspending
again. The auto-approve branch is only reached for low/medium, which never interrupt,
so it runs exactly once.

No live connection is held
--------------------------
Escalation is file-proposal → checkpoint → suspend → end. The HTTP request that
later decides the proposal drives the resume; the graph never blocks a socket while
waiting for a human.
"""
from __future__ import annotations

from langgraph.types import interrupt
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import services as S
from ..models import Proposal, Staff
from .risk import classify_risk

# Note put on the auto-approved proposal so the lesson/audit trail is unambiguous.
AUTO_APPROVE_NOTE = "Auto-approved by the Chief of Staff."

# Fallbacks when the worker's pending_action omits fields.
_DEFAULT_ACTION_TYPE = "other"
_DEFAULT_TITLE = "Proposed action"


# ---------------------------------------------------------------------------
# CoS lookup
# ---------------------------------------------------------------------------

def cos_id(db: Session) -> str | None:
    """The Chief of Staff's staff id (the auto-approval actor), or None if unset."""
    c = S.chief(db)
    return c.id if c else None


# ---------------------------------------------------------------------------
# Proposal shaping
# ---------------------------------------------------------------------------

def build_proposal_fields(pending_action: dict) -> tuple[str, str, str]:
    """Derive ``(title, type_, body)`` for a Proposal from a worker's pending_action.

    ``pending_action`` keys (all optional except it is a dict):
      - ``action_type`` — the structured capability type (authoritative for risk).
      - ``summary``     — a one-line human-readable description.
      - ``title``       — an explicit title; defaults to the summary, then a constant.
      - ``body``        — the full proposal body; defaults to the summary.
    """
    action_type = (pending_action.get("action_type") or _DEFAULT_ACTION_TYPE).strip() or _DEFAULT_ACTION_TYPE
    summary = (pending_action.get("summary") or "").strip()
    title = (pending_action.get("title") or summary or _DEFAULT_TITLE).strip() or _DEFAULT_TITLE
    body = (pending_action.get("body") or summary or title).strip()
    return title, action_type, body


def _find_pending_proposal(db: Session, task_id: str, staff_id: str) -> Proposal | None:
    """An already-filed, still-pending proposal for this task+staff (resume safety)."""
    return db.scalar(
        select(Proposal)
        .where(
            Proposal.task_id == task_id,
            Proposal.staff_id == staff_id,
            Proposal.status == "pending",
        )
        .order_by(Proposal.created_at.desc())
    )


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

class GateContext:
    """Minimal context the gate needs. Mirrors the fields the graph passes down."""

    __slots__ = ("task_id", "staff_id")

    def __init__(self, task_id: str, staff_id: str):
        self.task_id = task_id
        self.staff_id = staff_id


def gate(state: dict, ctx: GateContext) -> dict:
    """Decide the fate of the worker's ``pending_action``.

    Returns a partial ``GraphState`` update:
      - no pending_action → ``{}`` (pure internal task; nothing to gate).
      - low/medium       → files + CoS-approves a Proposal; sets ``risk``.
      - high             → files a PENDING Proposal, then ``interrupt(...)`` to
                           checkpoint+suspend (this call does not return on the
                           suspending pass; the graph ends WAITING).
    """
    pending_action = state.get("pending_action")
    if not pending_action:
        # Pure internal task: the worker changed nothing outward. Nothing to gate.
        return {}

    action_type = pending_action.get("action_type", "")
    summary = pending_action.get("summary", "")
    worker_label = pending_action.get("risk")

    # Risk is re-derived structurally — the worker's label is only a hint.
    risk = classify_risk(action_type, summary, worker_label)

    if risk == "high":
        return _escalate(ctx, pending_action, risk)
    # low/medium may be auto-handled — but ONLY by the Chief of Staff. With no CoS there is
    # no delegation authority, so escalate to the owner rather than let a worker approve its
    # own proposal (which would break the "CoS is the approver" invariant).
    with _session() as db:
        cos = cos_id(db)
    if cos is None:
        return _escalate(ctx, pending_action, risk)
    return _auto_approve(ctx, pending_action, risk, cos)


def _auto_approve(ctx: GateContext, pending_action: dict, risk: str, cos: str) -> dict:
    """low/medium: file a Proposal and approve it as the Chief of Staff (cos is never None here)."""
    title, type_, body = build_proposal_fields(pending_action)
    with _session() as db:
        st = db.get(Staff, ctx.staff_id)
        p = S.create_proposal(db, st, ctx.task_id, title, type_, risk, body, actor=cos)
        # decide_proposal commits; audits with `by` as actor; records the lesson;
        # spawns the execution task — exactly the owner-approval path, as the CoS.
        S.decide_proposal(db, p, "approve", AUTO_APPROVE_NOTE, by=cos)
    return {"risk": risk, "done": True, "pending_action": None}


def _escalate(ctx: GateContext, pending_action: dict, risk: str) -> dict:
    """high: file a PENDING Proposal, then checkpoint + suspend. Executes nothing."""
    title, type_, body = build_proposal_fields(pending_action)
    with _session() as db:
        # Resume safety: interrupt re-executes this node from the top, so don't
        # file a duplicate — reuse the pending proposal if one already exists.
        existing = _find_pending_proposal(db, ctx.task_id, ctx.staff_id)
        if existing is not None:
            proposal_id = existing.id
            proposal_title = existing.title
        else:
            st = db.get(Staff, ctx.staff_id)
            p = S.create_proposal(db, st, ctx.task_id, title, type_, risk, body, actor=f"staff:{ctx.staff_id}")
            proposal_id = p.id
            proposal_title = p.title

    # Checkpoint + suspend. On the suspending pass this raises GraphInterrupt and does
    # NOT return; on resume it returns the owner's decision value (handled in Task 5).
    interrupt(
        {
            "kind": "approval",
            "proposal_id": proposal_id,
            "title": proposal_title,
            "risk": risk,
            "task_id": ctx.task_id,
        }
    )
    # Reached only on resume (Task 5 continues from here).
    return {"risk": risk, "pending_action": None}


def _session():
    """Open a session on the CURRENT company (set by the worker around run_task).

    Kept as a thin indirection so the gate stays a plain callable and tests that set
    the company context (the default "main" in the test harness) resolve the right
    schema without the gate importing ``db`` at module top (avoids an import cycle
    with the engines package during graph construction).
    """
    from ..db import session_scope

    return session_scope()
