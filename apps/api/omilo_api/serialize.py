import datetime as dt
from typing import TYPE_CHECKING

from .models import (
    Checkpoint,
    InboxItem,
    KbSource,
    Message,
    Proposal,
    Report,
    Shift,
    Staff,
    Task,
    Thread,
)
from .services import current_body

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def iso(v: dt.datetime | None) -> str | None:
    if v is None:
        return None
    if v.tzinfo is None:
        v = v.replace(tzinfo=dt.UTC)
    return v.isoformat()


def staff(s: Staff) -> dict:
    eng = dict(s.engine or {})
    eng.pop("api_key", None)
    eng.pop("api_key_enc", None)  # secrets never leave the gateway
    from .catalog import role as _role

    r = _role(s.role) or {}
    return {"id": s.id, "name": s.name, "role": s.role, "is_chief": s.is_chief, "job": s.job, "engine": eng,
            "tagline": r.get("tagline", ""), "summary": r.get("summary", ""),
            "permissions": s.permissions or {}, "budget_usd_month": s.budget_usd_month, "max_task_minutes": s.max_task_minutes,
            "status": s.status, "has_mcp_token": bool(s.mcp_token_hash), "shifts": [shift(x) for x in s.shifts],
            "created_at": iso(s.created_at), "updated_at": iso(s.updated_at)}


def shift(s: Shift) -> dict:
    from .onboarding import describe_cron

    return {"id": s.id, "staff_id": s.staff_id, "name": s.name, "cron": s.cron, "when": describe_cron(s.cron),
            "brief": s.brief, "enabled": s.enabled,
            "next_at": iso(s.next_at), "last_at": iso(s.last_at)}


def task(t: Task, report: Report | None = None) -> dict:
    d = {"id": t.id, "staff_id": t.staff_id, "origin": t.origin, "brief": t.brief, "founder_note": t.founder_note,
         "status": t.status, "parent_task_id": t.parent_task_id, "proposal_id": t.proposal_id, "created_by": t.created_by,
         "created_at": iso(t.created_at), "started_at": iso(t.started_at), "ended_at": iso(t.ended_at),
         "cost_usd": round(t.cost_usd, 4), "tokens": t.tokens, "attempts": t.attempts, "error": t.error, "engine_type": t.engine_type}
    if report is not None:
        d["report"] = {"headline": report.headline, "body_md": report.body_md, "kpis": report.kpis, "at": iso(report.at)}
    return d


def checkpoint(c: Checkpoint) -> dict:
    return {"id": c.id, "plan": c.plan, "done": c.done, "next": c.next, "notes": c.notes, "at": iso(c.at)}


def proposal(p: Proposal, full: bool = False) -> dict:
    d = {"id": p.id, "task_id": p.task_id, "staff_id": p.staff_id, "type": p.type, "risk": p.risk, "title": p.title,
         "status": p.status, "current_revision": p.current_revision, "decision_note": p.decision_note,
         "decided_by": p.decided_by, "decided_at": iso(p.decided_at), "execution_task_id": p.execution_task_id,
         "result": p.result, "created_at": iso(p.created_at), "body_md": current_body(p)}
    if full:
        d["revisions"] = [{"n": r.n, "body_md": r.body_md, "author": r.author, "summary": r.summary, "at": iso(r.at)} for r in p.revisions]
    return d


def inbox(i: InboxItem) -> dict:
    return {"id": i.id, "kind": i.kind, "ref_id": i.ref_id, "staff_id": i.staff_id, "task_id": i.task_id, "title": i.title,
            "body": i.body, "level": i.level, "blocking": i.blocking, "status": i.status, "answer": i.answer,
            "snooze_until": iso(i.snooze_until), "created_at": iso(i.created_at), "closed_at": iso(i.closed_at)}


def thread(t: Thread) -> dict:
    return {"id": t.id, "scope": t.scope, "ref_id": t.ref_id, "staff_id": t.staff_id, "title": t.title,
            "awaiting_reply": t.awaiting_reply, "pending": list(t.pending or []) if t.awaiting_reply else [], "updated_at": iso(t.updated_at)}


def message(m: Message) -> dict:
    return {"id": m.id, "role": m.role, "author": m.author, "text": m.text, "blocks": m.blocks, "channel": m.channel, "at": iso(m.at)}


# ------------------------------------------------------------------ v2 read-time block mapping
# Scope: action_card (open Proposal → replaces legacy 'proposal' block) and code (PR/diff
# KbSource → injected once as the last agent message's block).
# NOTE: streaming/reasoning/todos/usage-meter are NOT produced here — those are a separate
# harness pass for live-streaming v2 vocabulary. This mapping is intentionally narrow.

_OPEN_STATUSES = {"pending", "changes_requested"}


def _proposal_to_action_card(p: Proposal) -> dict:
    """Build an action_card block from an open Proposal, matching ActionCardBlock field names.

    ActionCardBlock reads:
      block.proposal_id   → onProposal callback (hits /proposals/{id}/decide)
      block.action_title || block.title  → card title
      block.action_target || block.summary → subtitle / target
      block.action_icon   → tile icon (defaults to ri-git-pull-request-line)
      block.detail_rows   → [{icon, text}] detail rows
    """
    return {
        "type": "action_card",
        "proposal_id": p.id,
        "title": p.title,
        "action_title": p.title,
        "action_target": f"{p.type} · {p.risk} risk",
        "action_icon": "ri-git-pull-request-line",
        "detail_rows": [],
    }


def _kb_to_code_block(kb: KbSource) -> dict:
    """Build a code block from a PR/diff KbSource, matching CodeBlock field names.

    CodeBlock reads:
      block.diff   → DiffLine[] — {n, sign, text} — when present, renders dark diff view
      block.name || block.title  → filename shown in the header
      block.lang   → language label (optional)
    """
    diff = (kb.meta or {}).get("diff") or []
    return {
        "type": "code",
        "title": kb.title or "PR diff",
        "name": kb.title or "PR diff",
        "lang": "",
        "diff": diff,
    }


def messages_v2(messages: list[Message], db: "Session", th: Thread) -> list[dict]:
    """Serialize messages with v2 read-time block mapping for task-scoped threads.

    For non-task threads the messages are returned unchanged (legacy path).
    For task-scoped threads:
      1. Open Proposals on the task → each legacy 'proposal' block matching an open
         Proposal is replaced by an 'action_card' block. Closed/terminal Proposals
         keep their legacy 'proposal' block untouched (already decided).
      2. PR/diff KbSources scoped to the task → a 'code' block is injected once
         (appended to the last agent message that exists, or left out if no agent
         message is present).
    """
    from sqlalchemy import select  # deferred to avoid module-load cost

    # Non-task threads: pass through unchanged
    if th.scope != "task" or not th.ref_id:
        return [message(m) for m in messages]

    task_id = th.ref_id

    # Load open Proposals for this task (indexed by id for fast lookup)
    open_proposals: dict[str, Proposal] = {}
    for p in db.scalars(
        select(Proposal).where(Proposal.task_id == task_id, Proposal.status.in_(_OPEN_STATUSES))
    ):
        open_proposals[p.id] = p

    # Load PR/diff KbSources scoped to this task
    pr_sources: list[KbSource] = list(db.scalars(
        select(KbSource).where(KbSource.kind == "pr", KbSource.ref == task_id)
    ))

    # Serialize messages with action_card substitution
    serialized: list[dict] = []
    last_agent_idx: int = -1
    for _, m in enumerate(messages):
        raw = message(m)
        if m.role == "agent":
            # Replace legacy 'proposal' blocks for open Proposals; leave terminal ones
            new_blocks: list[dict] = []
            for blk in (raw.get("blocks") or []):
                if (
                    isinstance(blk, dict)
                    and blk.get("type") == "proposal"
                    and blk.get("proposal_id") in open_proposals
                ):
                    # Open proposal → replace with action_card (no double-render)
                    new_blocks.append(_proposal_to_action_card(open_proposals[blk["proposal_id"]]))
                else:
                    new_blocks.append(blk)
            raw = {**raw, "blocks": new_blocks}
            last_agent_idx = len(serialized)
        serialized.append(raw)

    # Inject code blocks from PR/diff KbSources into the last agent message
    if pr_sources and last_agent_idx >= 0:
        target = serialized[last_agent_idx]
        extra_code_blocks = [_kb_to_code_block(kb) for kb in pr_sources if (kb.meta or {}).get("diff")]
        if extra_code_blocks:
            target = {**target, "blocks": list(target.get("blocks") or []) + extra_code_blocks}
            serialized[last_agent_idx] = target

    return serialized
