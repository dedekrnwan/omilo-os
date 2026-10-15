"""Domain operations shared by the REST API, the MCP server and the worker.

Every state change writes an audit event. Functions take an open Session and commit themselves.
"""
import datetime as dt
import re
import secrets
from pathlib import Path
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import policy
from .config import get_settings
from .models import (
    AuditEvent,
    Checkpoint,
    InboxItem,
    KpiValue,
    Message,
    Proposal,
    ProposalRevision,
    Report,
    Setting,
    Shift,
    Staff,
    Task,
    Thread,
    now,
)
from .security import encrypt, sha256


class DomainError(Exception):
    def __init__(self, message: str, code: int = 400):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- audit & settings
def audit(db: Session, actor: str, action: str, ref: str = "", **detail) -> None:
    db.add(AuditEvent(actor=actor, action=action, ref=ref, detail=detail))


def get_setting(db: Session, key: str, default=None):
    s = db.get(Setting, key)
    return default if s is None else s.value


def set_setting(db: Session, key: str, value, actor: str = "system") -> None:
    s = db.get(Setting, key)
    if s is None:
        db.add(Setting(key=key, value=value))
    else:
        s.value = value
    audit(db, actor, "setting.set", key, value=value)
    db.commit()


def is_paused(db: Session) -> bool:
    return bool(get_setting(db, "paused", False))


def strict_mode(db: Session) -> bool:
    v = get_setting(db, "strict_mode", None)
    return get_settings().strict_mode if v is None else bool(v)


def max_concurrent(db: Session) -> int:
    return int(get_setting(db, "max_concurrent_tasks", None) or get_settings().max_concurrent_tasks)


# ---------------------------------------------------------------- staff
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


def create_staff(db: Session, data: dict, actor: str) -> Staff:
    sid = data["id"]
    if not SLUG.match(sid):
        raise DomainError("staff id must be lowercase letters, digits and dashes")
    if db.get(Staff, sid):
        raise DomainError(f"staff '{sid}' already exists", 409)
    shifts = data.pop("shifts", []) or []
    st = Staff(**{k: v for k, v in data.items() if hasattr(Staff, k)})
    if st.is_chief and db.scalar(select(Staff).where(Staff.is_chief.is_(True))):
        raise DomainError("there is already a Chief of Staff", 409)
    db.add(st)
    db.flush()
    for sh in shifts:
        add_shift(db, st, sh["name"], sh["cron"], sh.get("brief", ""), commit=False)
    audit(db, actor, "staff.create", sid, name=st.name)
    db.commit()
    return st


def update_staff(db: Session, st: Staff, data: dict, actor: str) -> Staff:
    for k in ("name", "job", "engine", "permissions", "budget_usd_month", "max_task_minutes", "status", "role"):
        if k in data and data[k] is not None:
            setattr(st, k, data[k])
    audit(db, actor, "staff.update", st.id, fields=sorted(k for k in data if data[k] is not None))
    db.commit()
    return st


def rotate_mcp_token(db: Session, st: Staff, actor: str) -> str:
    raw = f"sgm_{st.id}_{secrets.token_urlsafe(24)}"
    st.mcp_token_hash = sha256(raw)
    st.mcp_token_enc = encrypt(raw)
    audit(db, actor, "staff.mcp_token.rotate", st.id)
    db.commit()
    return raw


def chief(db: Session) -> Staff | None:
    return db.scalar(select(Staff).where(Staff.is_chief.is_(True)))


# ---------------------------------------------------------------- shifts
def timezone_name(db: Session | None = None) -> str:
    """The owner's timezone: chosen in onboarding/Settings, else SAGA_TIMEZONE."""
    return (get_setting(db, "timezone", None) if db is not None else None) or get_settings().timezone


def _tz(db: Session | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name(db))
    except Exception:
        return ZoneInfo("UTC")


def next_run(cron: str, after: dt.datetime | None = None, db: Session | None = None) -> dt.datetime:
    base = (after or now()).astimezone(_tz(db))
    return croniter(cron, base).get_next(dt.datetime).astimezone(dt.UTC)


def add_shift(db: Session, st: Staff, name: str, cron: str, brief: str, commit: bool = True) -> Shift:
    if not croniter.is_valid(cron):
        raise DomainError(f"invalid cron expression: {cron}")
    sh = Shift(staff_id=st.id, name=name, cron=cron, brief=brief, next_at=next_run(cron, db=db))
    db.add(sh)
    if commit:
        db.commit()
    return sh


# ---------------------------------------------------------------- tasks
def create_task(
    db: Session,
    staff_id: str,
    origin: str,
    brief: str,
    created_by: str,
    founder_note: str = "",
    parent_task_id: str | None = None,
    proposal_id: str | None = None,
    shift_id: str | None = None,
) -> Task:
    st = db.get(Staff, staff_id)
    if not st:
        raise DomainError(f"unknown staff '{staff_id}'", 404)
    t = Task(
        staff_id=staff_id,
        origin=origin,
        brief=brief,
        founder_note=founder_note,
        created_by=created_by,
        parent_task_id=parent_task_id,
        proposal_id=proposal_id,
        shift_id=shift_id,
    )
    db.add(t)
    db.flush()
    audit(db, created_by, "task.create", t.id, staff=staff_id, origin=origin)
    db.commit()
    return t


def task_for_staff(db: Session, st: Staff, task_id: str, running_only: bool = False) -> Task:
    t = db.get(Task, task_id)
    if not t or t.staff_id != st.id:
        raise DomainError(f"task {task_id} is not yours", 403)
    if running_only and t.status != "running":
        raise DomainError(f"task {task_id} is {t.status}, not running", 409)
    return t


def finish_task(db: Session, t: Task, status: str, error: str = "", result_text: str = "") -> None:
    t.status = status
    t.ended_at = now()
    t.error = error[:4000]
    if result_text:
        t.result_text = result_text[:20000]
    audit(db, "system", f"task.{status}", t.id, error=error[:300])
    db.commit()


def write_checkpoint(db: Session, st: Staff, task_id: str, plan, done: str, next_step: str, notes: str) -> Checkpoint:
    task_for_staff(db, st, task_id, running_only=True)
    c = Checkpoint(task_id=task_id, plan=plan or [], done=done, next=next_step, notes=notes)
    db.add(c)
    db.commit()
    return c


def latest_checkpoint(db: Session, task_id: str) -> Checkpoint | None:
    return db.scalar(select(Checkpoint).where(Checkpoint.task_id == task_id).order_by(Checkpoint.at.desc()))


def write_report(db: Session, st: Staff, task_id: str, headline: str, body: str, kpis: dict | None = None) -> Report:
    task_for_staff(db, st, task_id)
    r = db.scalar(select(Report).where(Report.task_id == task_id))
    if r is None:
        r = Report(task_id=task_id, staff_id=st.id, headline=headline[:300], body_md=body, kpis=kpis or {})
        db.add(r)
    else:
        r.headline, r.body_md, r.kpis = headline[:300], body, kpis or {}
    audit(db, f"staff:{st.id}", "report.write", task_id, headline=headline[:120])
    db.commit()
    return r


# ---------------------------------------------------------------- proposals
MAX_OPEN_PROPOSALS = 10

def create_proposal(
    db: Session, st: Staff, task_id: str | None, title: str, type_: str, risk: str, body: str, actor: str | None = None
) -> Proposal:
    if risk not in ("low", "medium", "high"):
        risk = "medium"
    if actor is None:  # an agent: keep the Inbox from flooding
        open_count = db.scalar(select(func.count()).select_from(Proposal).where(
            Proposal.staff_id == st.id, Proposal.status.in_(["pending", "changes_requested"])))
        if open_count >= MAX_OPEN_PROPOSALS:
            raise DomainError(f"you already have {open_count} proposals waiting; wait for decisions before proposing more", 429)
    p = Proposal(task_id=task_id, staff_id=st.id, type=type_, risk=risk, title=title[:300])
    db.add(p)
    db.flush()
    db.add(ProposalRevision(proposal_id=p.id, n=1, body_md=body, author=actor or f"staff:{st.id}", summary="first draft"))
    db.add(
        InboxItem(
            kind="proposal", ref_id=p.id, staff_id=st.id, task_id=task_id, title=p.title, level="decision",
            body=f"{st.name} proposes ({type_}, {risk} risk)",
        )
    )
    audit(db, actor or f"staff:{st.id}", "proposal.create", p.id, type=type_, risk=risk)
    db.commit()
    return p


def current_body(p: Proposal) -> str:
    for r in p.revisions:
        if r.n == p.current_revision:
            return r.body_md
    return p.revisions[-1].body_md if p.revisions else ""


def revise_proposal(db: Session, p: Proposal, body: str, author: str, summary: str = "") -> Proposal:
    if p.status not in ("pending", "changes_requested"):
        raise DomainError(f"proposal is {p.status}; only pending proposals can be revised", 409)
    n = max((r.n for r in p.revisions), default=0) + 1
    db.add(ProposalRevision(proposal_id=p.id, n=n, body_md=body, author=author, summary=summary))
    p.current_revision = n
    p.status = "pending"
    item = db.scalar(select(InboxItem).where(InboxItem.kind == "proposal", InboxItem.ref_id == p.id))
    if item and item.status != "open":
        item.status, item.closed_at = "open", None
    audit(db, author, "proposal.revise", p.id, revision=n, summary=summary[:200])
    db.commit()
    db.refresh(p)
    return p


def _close_inbox(db: Session, kind: str, ref_id: str) -> None:
    for item in db.scalars(select(InboxItem).where(InboxItem.kind == kind, InboxItem.ref_id == ref_id, InboxItem.status != "done")):
        item.status, item.closed_at = "done", now()


def decide_proposal(db: Session, p: Proposal, decision: str, note: str, by: str) -> Proposal:
    if p.status != "pending":
        raise DomainError(f"proposal is already {p.status}", 409)
    if decision in ("reject", "changes") and not note.strip():
        raise DomainError("a note is required: the agent learns from it")
    p.decision_note, p.decided_by, p.decided_at = note, by, now()
    _close_inbox(db, "proposal", p.id)
    if decision == "approve":
        p.status = "approved"
        t = create_task(
            db, p.staff_id, "execution", f"Execute approved proposal {p.id}: {p.title}", created_by=by,
            founder_note=note, parent_task_id=p.task_id, proposal_id=p.id,
        )
        p.execution_task_id = t.id
    elif decision == "reject":
        p.status = "rejected"
    elif decision == "changes":
        p.status = "changes_requested"
        create_task(
            db, p.staff_id, "revision",
            f"Revise proposal {p.id} ('{p.title}') as the founder asked, then call revise_proposal.",
            created_by=by, founder_note=note, parent_task_id=p.task_id, proposal_id=p.id,
        )
    else:
        raise DomainError("decision must be approve, reject or changes")
    audit(db, by, f"proposal.{decision}", p.id, note=note[:300])
    db.commit()
    return p


def mark_executed(db: Session, st: Staff, proposal_id: str, ok: bool, result: str) -> Proposal:
    p = db.get(Proposal, proposal_id)
    if not p or p.staff_id != st.id:
        raise DomainError("not your proposal", 403)
    if p.status not in ("approved", "executing"):
        raise DomainError(f"proposal is {p.status}; only approved proposals can be executed", 409)
    p.status = "done" if ok else "failed"
    p.result = result[:4000]
    audit(db, f"staff:{st.id}", "proposal.executed", p.id, ok=ok)
    if not ok:
        alert(db, f"Execution failed: {p.title}", result, st.id, p.execution_task_id, commit=False)
    db.commit()
    return p


# ---------------------------------------------------------------- inbox: questions & alerts
def ask_founder(db: Session, st: Staff, task_id: str | None, question: str, blocking: bool) -> InboxItem:
    open_q = db.scalar(
        select(func.count()).select_from(InboxItem).where(
            InboxItem.kind == "question", InboxItem.staff_id == st.id, InboxItem.status == "open"
        )
    )
    if open_q >= 5:
        raise DomainError("you already have 5 open questions; wait for answers", 429)
    item = InboxItem(
        kind="question", staff_id=st.id, task_id=task_id, title=question[:300], body=question,
        level="decision", blocking=blocking,
    )
    db.add(item)
    audit(db, f"staff:{st.id}", "question.ask", task_id or "", blocking=blocking)
    db.commit()
    return item


def answer_question(db: Session, item: InboxItem, answer: str, by: str) -> InboxItem:
    if item.kind != "question" or item.status == "done":
        raise DomainError("not an open question", 409)
    item.answer, item.status, item.closed_at = answer, "done", now()
    if item.staff_id:
        original = db.get(Task, item.task_id) if item.task_id else None
        create_task(
            db, item.staff_id, "answer",
            f"The founder answered your question.\nQuestion: {item.body}\nAnswer: {answer}\n"
            + (f"Continue the original task: {original.brief}" if original else "Act on the answer."),
            created_by=by, parent_task_id=item.task_id,
        )
    audit(db, by, "question.answer", item.id)
    db.commit()
    return item


def alert(db: Session, title: str, body: str, staff_id: str | None, task_id: str | None, level: str = "decision", commit: bool = True) -> InboxItem:
    item = InboxItem(kind="alert", staff_id=staff_id, task_id=task_id, title=title[:300], body=body[:4000], level=level)
    db.add(item)
    if commit:
        db.commit()
    return item


# ---------------------------------------------------------------- threads & messages
def get_or_create_thread(db: Session, scope: str, ref_id: str | None, staff_id: str, title: str = "") -> Thread:
    q = select(Thread).where(Thread.scope == scope, Thread.staff_id == staff_id)
    q = q.where(Thread.ref_id == ref_id) if ref_id else q.where(Thread.ref_id.is_(None))
    th = db.scalar(q)
    if th is None:
        th = Thread(scope=scope, ref_id=ref_id, staff_id=staff_id, title=title)
        db.add(th)
        db.commit()
    return th


def post_message(db: Session, th: Thread, role: str, author: str, text: str, blocks: list | None = None,
                 channel: str = "web", awaiting_reply: bool | None = None) -> Message:
    m = Message(thread_id=th.id, role=role, author=author, text=text, blocks=blocks or [{"type": "text", "text": text}], channel=channel)
    db.add(m)
    th.updated_at = now()
    if awaiting_reply is not None:
        th.awaiting_reply = awaiting_reply
    db.commit()
    return m


def thread_messages(db: Session, th: Thread, limit: int = 200) -> list[Message]:
    rows = db.scalars(select(Message).where(Message.thread_id == th.id).order_by(Message.at.desc()).limit(limit))
    return list(reversed(list(rows)))


# ---------------------------------------------------------------- knowledge & KPIs
KNOWLEDGE_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}\.(md|yaml|yml)$")


def knowledge_files() -> list[Path]:
    return sorted(p for p in get_settings().knowledge_dir.iterdir() if p.is_file() and KNOWLEDGE_NAME.match(p.name))


def read_knowledge(name: str) -> str:
    if not KNOWLEDGE_NAME.match(name):
        raise DomainError("bad file name")
    p = get_settings().knowledge_dir / name
    if not p.exists():
        raise DomainError("not found", 404)
    return p.read_text()


def write_knowledge(db: Session, name: str, content: str, actor: str) -> None:
    if not KNOWLEDGE_NAME.match(name):
        raise DomainError("file names: lowercase letters, digits, - or _, ending in .md or .yaml")
    (get_settings().knowledge_dir / name).write_text(content)
    audit(db, actor, "knowledge.write", name, bytes=len(content))
    db.commit()


def company_context(db: Session, topics: list[str] | None = None, max_chars: int = 30000) -> str:
    parts, total = [], 0
    for p in knowledge_files():
        stem = p.stem
        if topics and not any(t.lower() in stem.lower() for t in topics):
            continue
        txt = p.read_text()
        chunk = f"## {p.name}\n{txt.strip()}\n"
        if total + len(chunk) > max_chars:
            parts.append(f"## {p.name}\n(truncated; ask for it alone)\n")
            continue
        parts.append(chunk)
        total += len(chunk)
    kpis = latest_kpis(db)
    if kpis and (not topics or any(t in ("kpi", "kpis", "goals") for t in topics)):
        parts.append("## Latest KPIs\n" + "\n".join(f"- {k}: {v['value']} ({v['period']}, source: {v['source']})" for k, v in kpis.items()))
    return "\n".join(parts) if parts else "(no company knowledge yet: the owner has not finished onboarding)"


def record_kpi(db: Session, st: Staff, name: str, value: float, period: str, source: str) -> KpiValue:
    k = KpiValue(name=name, value=float(value), period=period, source=source, staff_id=st.id)
    db.add(k)
    audit(db, f"staff:{st.id}", "kpi.write", name, value=value, period=period)
    db.commit()
    return k


def latest_kpis(db: Session) -> dict:
    out = {}
    for k in db.scalars(select(KpiValue).order_by(KpiValue.at.desc()).limit(500)):
        if k.name not in out:
            out[k.name] = {"value": k.value, "period": k.period, "source": k.source, "at": k.at.isoformat()}
    return out


# ---------------------------------------------------------------- policy gate for direct actions
def request_action(db: Session, st: Staff, task_id: str | None, action: str, summary: str, details: str) -> dict:
    """An agent wants to do something with a side effect. Decide by policy: refuse, ask, or allow."""
    level = policy.level_for(action, st.permissions, strict_mode(db))
    if level == policy.OFF:
        audit(db, f"staff:{st.id}", "action.refused", task_id or "", act=action)
        db.commit()
        return {"decision": "refused", "level": "off", "message": f"'{action}' is not allowed for {st.name}."}
    if level == policy.ASK:
        p = create_proposal(db, st, task_id, summary, action, "medium", details)
        return {"decision": "needs_approval", "level": "ask", "proposal_id": p.id,
                "message": "Filed for the founder's approval. Do not do it now; it will come back as an execution task if approved."}
    audit(db, f"staff:{st.id}", "action.allowed", task_id or "", act=action, level=policy.describe(level), summary=summary[:200])
    db.commit()
    return {"decision": "allowed", "level": policy.describe(level), "message": "Allowed. Go ahead, and mention it in your report."}
