import datetime as dt

from .models import (
    Checkpoint,
    InboxItem,
    Message,
    Proposal,
    Report,
    Shift,
    Staff,
    Task,
    Thread,
)
from .services import current_body


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
    return {"id": s.id, "name": s.name, "role": s.role, "is_chief": s.is_chief, "job": s.job, "engine": eng,
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
