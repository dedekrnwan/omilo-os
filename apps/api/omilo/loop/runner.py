"""omilo.loop.runner — Agent loop runtime (supervisor→worker→gate→review).

Public API:
    start_job(db, *, company_id, helper_id, origin, brief, ...) -> Job
    run_job(db, job, publish=None) -> Job

Design decisions (P1):
- Single-pass: one worker turn + gate + (optionally) review.  No re-loop.
  MAX_STEPS = 12 is defined but not exercised until the full LangGraph port.
- Inline: start_job calls run_job synchronously.  Task 5/6 wrap this in
  a FastAPI background task or WS handler respectively.
- Company-scoped: the caller opens a company-scoped DB session (SET LOCAL
  ROLE omilo_app + app.company_id GUC).  All writes use that session.
- publish hook: optional (str, dict) -> None for SSE/WS fan-out (Task 8).
"""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from omilo.engine import EngineResult, TaskContext, get_engine
from omilo.engine.autonomy import (
    approves_on_behalf,
    decide,
    effective_autonomy,
)
from omilo.loop.emit import make_emitter
from omilo.models.approvals import Proposal, ProposalRevision, SafetyLimit
from omilo.models.base import prefixed_id
from omilo.models.execution import Job, Report, RunEvent
from omilo.models.inbox import InboxItem

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_STEPS: int = 12  # bounds re-loop; single pass in P1


# ---------------------------------------------------------------------------
# start_job — create a queued Job and run it inline
# ---------------------------------------------------------------------------

def start_job(
    db: Session,
    *,
    company_id: str,
    helper_id: str,
    origin: str,
    brief: str,
    session_id: str | None = None,
    goal_id: str | None = None,
    operator_note: str | None = None,
) -> Job:
    """Create a queued Job, run it inline, and return the finished Job.

    This is the P1 inline entry-point.  Task 5 (HTTP) wraps this in a
    FastAPI BackgroundTask; Task 6 (WS) calls run_job directly.

    Args:
        db:            Company-scoped SQLAlchemy session (caller owns txn).
        company_id:    Tenant identifier.
        helper_id:     The Helper that will execute the job.
        origin:        JobOrigin string (chat|goal|routine|flow|delegation|…).
        brief:         The task description / prompt.
        session_id:    Optional chat session reference.
        goal_id:       Optional Goal reference.
        operator_note: Optional operator-authored context note.

    Returns:
        The Job after run_job has finished (status: done|waiting|failed).
    """
    job = Job(
        id=prefixed_id("job"),
        company_id=company_id,
        helper_id=helper_id,
        origin=origin,
        brief=brief,
        session_id=session_id,
        goal_id=goal_id,
        operator_note=operator_note,
        status="queued",
        cost_credits=0,
        tokens_in=0,
        tokens_out=0,
        attempts=0,
        checkpoint={},
    )
    db.add(job)
    db.flush()

    return run_job(db, job)


# ---------------------------------------------------------------------------
# run_job — the core loop (single pass for P1)
# ---------------------------------------------------------------------------

def run_job(
    db: Session,
    job: Job,
    publish: Callable[[str, dict], None] | None = None,
) -> Job:
    """Execute one Helper turn and persist all outcomes.

    Phases:
      a. Set status=running, load Helper + Company.
      b. Compute effective autonomy.
      c. Build TaskContext + get engine.
      d. Call engine.run(ctx).
      e. Gate: evaluate pending_action if any.
         - allowed   → execute (fake), emit tool event; update InboxItem if
                       chief auto-approved; set done.
         - needs_owner → create Proposal + ProposalRevision + InboxItem
                         (kind=decision, blocking); set status=waiting; RETURN.
         - refused   → emit approval event; create InboxItem (kind=failure);
                       set status=failed; RETURN.
      f. No pending_action → write Report, set status=done.

    Args:
        db:      Company-scoped session.  Caller owns the transaction.
        job:     The Job ORM object (already flushed/persisted).
        publish: Optional SSE/WS hook — ``(company_id, event) -> None``.

    Returns:
        The mutated Job (status set by end of this call).
    """
    from omilo.models.agents import Helper
    from omilo.models.tenancy import Company

    # ── a. Mark running ──────────────────────────────────────────────────────
    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    job.attempts = (job.attempts or 0) + 1
    db.flush()

    # Publish job.started to SSE broker (best-effort; never breaks the job)
    _broker_publish(job.company_id, {
        "type": "job.started",
        "id": job.id,
        "data": {"job_id": job.id, "helper_id": job.helper_id, "origin": job.origin},
    })

    # Load Helper and Company (both visible because Company is global and
    # Helper is tenant-scoped — the db session is already company-scoped).
    helper = db.get(Helper, job.helper_id)
    if helper is None:
        job.status = "failed"
        job.error = f"Helper {job.helper_id!r} not found"
        job.ended_at = datetime.now(timezone.utc)
        db.flush()
        _broker_publish(job.company_id, {
            "type": "job.failed",
            "id": job.id,
            "data": {"job_id": job.id, "error": job.error},
        })
        return job

    # Company is a global table — query without RLS filter.
    company = db.get(Company, job.company_id)
    if company is None:
        job.status = "failed"
        job.error = f"Company {job.company_id!r} not found"
        job.ended_at = datetime.now(timezone.utc)
        db.flush()
        _broker_publish(job.company_id, {
            "type": "job.failed",
            "id": job.id,
            "data": {"job_id": job.id, "error": job.error},
        })
        return job

    # ── b. Effective autonomy ─────────────────────────────────────────────────
    # goal_override: load goal if goal_id is set (Goal carries autonomy_override
    # per spec; for P1 Goal model lacks this column → None).
    goal_override: str | None = None
    if job.goal_id:
        from omilo.models.workspace import Goal
        goal = db.get(Goal, job.goal_id)
        # Goal.autonomy_override not yet on the model (P2); use None.
        goal_override = getattr(goal, "autonomy_override", None) if goal else None

    effective = effective_autonomy(
        workspace=company.autonomy_default,
        goal_override=goal_override,
        helper_cap=helper.autonomy_cap,
    )

    # ── c. Build TaskContext ──────────────────────────────────────────────────
    emitter = make_emitter(db, job, job.session_id, publish)

    ctx = TaskContext(
        company_id=job.company_id,
        helper_id=job.helper_id,
        helper_name=helper.name,
        is_chief=helper.is_chief,
        job_id=job.id,
        origin=job.origin,
        brief=job.brief,
        operator_note=job.operator_note,
        autonomy=effective,
        goal_delivery=bool(job.goal_id),
        memory=_assemble_memory(db, job.brief),
        emit=emitter,
    )

    engine_cfg = helper.engine if helper.engine else {"type": "fake"}
    engine = get_engine(engine_cfg)

    # ── d. Run the engine ─────────────────────────────────────────────────────
    result: EngineResult = engine.run(ctx)

    # Record usage
    job.tokens_in = (job.tokens_in or 0) + result.tokens_in
    job.tokens_out = (job.tokens_out or 0) + result.tokens_out
    job.cost_credits = (job.cost_credits or 0) + result.cost_credits
    job.result_text = result.text
    db.flush()

    # ── e. Gate: handle pending_action ────────────────────────────────────────
    if result.pending_action:
        action = result.pending_action
        action_type = action.get("type", "unknown")
        risk = action.get("risk", "low")

        # Load safety limits for this company
        safety_limits = (
            db.query(SafetyLimit)
            .filter_by(company_id=job.company_id)
            .all()
        )

        # Usage counters (P1: empty; counted limits need today's event counts)
        usage: dict = {}

        verdict = decide(effective, risk, action_type, safety_limits, usage)

        if verdict == "allowed":
            # ── execute (fake: record the action as a tool RunEvent) ──────────
            emitter({
                "kind": "tool",
                "data": {"executed": action},
            })

            # If Chief auto-approved on operator's behalf, log an update item.
            behalf = approves_on_behalf(effective, risk)
            if behalf == "chief":
                _create_inbox_item(
                    db=db,
                    company_id=job.company_id,
                    job=job,
                    helper=helper,
                    kind="update",
                    title=f"Auto-approved: {action_type} by Chief",
                    summary=(
                        f"Chief auto-approved '{action_type}' (risk={risk}) "
                        f"under autonomy '{effective}'."
                    ),
                    needs_you=False,
                )

            job.status = "done"
            job.ended_at = datetime.now(timezone.utc)
            db.flush()
            _broker_publish(job.company_id, {
                "type": "job.done",
                "id": job.id,
                "data": {"job_id": job.id},
            })
            _meter_job_best_effort(db, job)

        elif verdict == "needs_owner":
            # ── create Proposal + ProposalRevision + InboxItem(decision) ──────
            proposal = Proposal(
                id=prefixed_id("prp"),
                company_id=job.company_id,
                job_id=job.id,
                helper_id=job.helper_id,
                type=action_type,
                risk=risk,
                title=f"Approve: {action_type}",
                body_md=_action_body_md(action),
                status="pending",
                current_revision=1,
            )
            db.add(proposal)
            db.flush()

            revision = ProposalRevision(
                id=prefixed_id("prv"),
                company_id=job.company_id,
                proposal_id=proposal.id,
                n=1,
                body_md=proposal.body_md,
                author="agent",
                summary="Initial revision",
            )
            db.add(revision)

            _create_inbox_item(
                db=db,
                company_id=job.company_id,
                job=job,
                helper=helper,
                kind="decision",
                title=proposal.title,
                summary=proposal.body_md,
                needs_you=True,
                proposals={"proposal_id": proposal.id, "type": action_type, "risk": risk},
                actions=[
                    {"label": "Approve", "primary": True},
                    {"label": "Reject"},
                ],
            )

            emitter({
                "kind": "approval",
                "data": {
                    "needs_owner": True,
                    "proposal_id": proposal.id,
                    "action_type": action_type,
                    "risk": risk,
                },
            })

            job.status = "waiting"
            job.proposal_id = proposal.id
            db.flush()
            _broker_publish(job.company_id, {
                "type": "job.done",
                "id": job.id,
                "data": {"job_id": job.id, "status": "waiting", "proposal_id": proposal.id},
            })
            return job

        elif verdict == "refused":
            # ── SafetyLimit hard-refused ──────────────────────────────────────
            emitter({
                "kind": "approval",
                "data": {
                    "refused": True,
                    "action_type": action_type,
                    "risk": risk,
                    "reason": "SafetyLimit block",
                },
            })

            _create_inbox_item(
                db=db,
                company_id=job.company_id,
                job=job,
                helper=helper,
                kind="failure",
                title=f"Refused: {action_type} blocked by SafetyLimit",
                summary=(
                    f"Action '{action_type}' (risk={risk}) was refused by a "
                    f"hard SafetyLimit. No action was taken."
                ),
                needs_you=True,
            )

            job.status = "failed"
            job.error = "refused by SafetyLimit"
            job.ended_at = datetime.now(timezone.utc)
            db.flush()
            _broker_publish(job.company_id, {
                "type": "job.failed",
                "id": job.id,
                "data": {"job_id": job.id, "error": job.error},
            })
            _meter_job_best_effort(db, job)
            return job

    # ── f. No pending_action — write Report, mark done ────────────────────────
    headline = result.text[:80] if result.text else "(no output)"
    report = Report(
        id=prefixed_id("rpt"),
        company_id=job.company_id,
        job_id=job.id,
        helper_id=job.helper_id,
        headline=headline,
        body_md=result.text,
        kpis=[],
        sources=[],
    )
    db.add(report)

    job.status = "done"
    job.ended_at = datetime.now(timezone.utc)
    db.flush()
    _broker_publish(job.company_id, {
        "type": "job.done",
        "id": job.id,
        "data": {"job_id": job.id},
    })

    # ── g. Meter the job (best-effort — never breaks a completed job) ─────────
    _meter_job_best_effort(db, job)

    return job


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _assemble_memory(db: Session, brief: str, k: int = 3) -> str:
    """Build TaskContext.memory from recall results for the given brief.

    Returns a short, bounded string of the top-k relevant KB snippets.
    Safe: on any error (empty KB, recall failure, etc.) returns "".
    """
    if not brief or not brief.strip():
        return ""
    try:
        from omilo.kb.retrieve import recall

        results = recall(db, brief, k=k)
        if not results:
            return ""

        parts: list[str] = []
        for r in results:
            heading = r.get("heading", "")
            text = r.get("text", "")
            snippet = f"[{heading}] {text}" if heading else text
            # Keep each snippet bounded to avoid bloating ctx.memory
            parts.append(snippet[:500])

        return "\n\n---\n\n".join(parts)
    except Exception:
        return ""


def _action_body_md(action: dict) -> str:
    """Format a pending_action dict as a markdown body for a Proposal."""
    action_type = action.get("type", "unknown")
    risk = action.get("risk", "low")
    payload = action.get("payload", {})
    lines = [
        f"**Type:** {action_type}",
        f"**Risk:** {risk}",
        "",
        "**Payload:**",
        "",
    ]
    for k, v in payload.items():
        lines.append(f"- **{k}:** {v}")
    return "\n".join(lines)


def _create_inbox_item(
    *,
    db: Session,
    company_id: str,
    job: Job,
    helper: object,  # Helper ORM
    kind: str,
    title: str,
    summary: str,
    needs_you: bool = False,
    proposals: dict | None = None,
    actions: list | None = None,
) -> InboxItem:
    """Create and flush an InboxItem for the given job/helper."""
    item = InboxItem(
        id=prefixed_id("inb"),
        company_id=company_id,
        title=title,
        summary=summary,
        # session_id and channel_id are required by the model; use job.session_id
        # and helper's first channel or a sentinel when not set.
        session_id=job.session_id or "",
        channel_id=(
            helper.channel_ids[0]
            if getattr(helper, "channel_ids", None)
            else ""
        ),
        kind=kind,
        status="pending",
        asker=getattr(helper, "name", "agent"),
        asker_area=getattr(helper, "area", "ops"),
        needs_you=needs_you,
        proposals=proposals,
        actions=actions,
    )
    db.add(item)
    db.flush()

    # Publish inbox.created for decision items so SSE subscribers can update badges
    if kind == "decision":
        _broker_publish(company_id, {
            "type": "inbox.created",
            "id": item.id,
            "data": {"inbox_id": item.id, "kind": kind, "needs_you": needs_you},
        })

    return item


def _broker_publish(company_id: str, event: dict) -> None:
    """Publish *event* to the SSE broker singleton.  Always best-effort."""
    try:
        from omilo.realtime.events import broker  # lazy import — avoids circular dep
        broker.publish(company_id, event)
    except Exception:
        pass  # publish failures must never break a job


def _meter_job_best_effort(db: Session, job: Job) -> None:
    """Call meter_job inside a savepoint; silently swallow any error.

    Metering must NEVER break a job that has already reached a terminal state.
    A nested savepoint (SAVEPOINT … ROLLBACK TO SAVEPOINT) means a metering
    failure rolls back only the ledger write, leaving the outer transaction
    (job status, report, events) intact.
    """
    try:
        from omilo.billing.meter import meter_job

        # Use a savepoint so a meter failure does not roll back the job txn.
        with db.begin_nested():
            meter_job(db, job)
    except Exception:
        pass  # metering errors are never fatal
