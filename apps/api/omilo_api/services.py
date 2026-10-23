"""Domain operations shared by the REST API, the MCP server and the worker.

Every state change writes an audit event. Functions take an open Session and commit themselves.
"""
import datetime as dt
import random
import re
import secrets
from collections.abc import Callable
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import notify as _notify  # noqa: F401  (registers the notice hook)
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
    StaffRelation,
    Task,
    Thread,
    now,
)
from .security import decrypt, encrypt, sha256


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


def is_self_tuning(db: Session) -> bool:
    return bool(get_setting(db, "self_tuning", False))


def strict_mode(db: Session) -> bool:
    v = get_setting(db, "strict_mode", None)
    return get_settings().strict_mode if v is None else bool(v)


def set_ai_key(db: Session, provider: str, key: str, actor: str) -> None:
    """Store a provider API key encrypted; only the last 4 characters are ever shown again."""
    keys = dict(get_setting(db, "ai_keys", None) or {})
    keys[provider] = {"enc": encrypt(key.strip()), "hint": key.strip()[-4:], "set_at": now().isoformat()}
    s = db.get(Setting, "ai_keys")
    if s is None:
        db.add(Setting(key="ai_keys", value=keys))
    else:
        s.value = keys
    audit(db, actor, "ai.key_set", provider)


def ai_api_key(db: Session, provider: str) -> str | None:
    k = (get_setting(db, "ai_keys", None) or {}).get(provider)
    return decrypt(k["enc"]) if k else None


def ai_key_hint(db: Session, provider: str) -> str | None:
    k = (get_setting(db, "ai_keys", None) or {}).get(provider)
    return k["hint"] if k else None


# ---------------------------------------------------------------- autonomy policy

_DEFAULT_ESCALATE_TIERS: list[str] = ["send_external", "payment", "destructive", "publish"]


def autonomy_policy(db: Session, staff: "Staff | None" = None) -> dict:
    """Resolve the effective autonomy policy for the company (staff=None) or a specific helper.

    Precedence (highest → lowest):
      1. Per-helper: staff.autonomy maps guided → strict; standard|trusted → permissive.
      2. Company:    Setting rows keyed autonomy_mode, autonomy_budget_stop_usd, autonomy_escalate_tiers.
      3. Default:    permissive, no budget cap, the four irreversible/outside-world tiers.

    Returns a fresh dict every call; no shared mutable state.
    """
    # --- company layer ---
    company_mode = get_setting(db, "autonomy_mode", None)
    company_budget = get_setting(db, "autonomy_budget_stop_usd", None)
    company_tiers = get_setting(db, "autonomy_escalate_tiers", None)

    mode: str = company_mode if company_mode is not None else "permissive"
    budget_stop_usd: float | None = float(company_budget) if company_budget is not None else None
    escalate_tiers: list[str] = list(company_tiers) if company_tiers is not None else list(_DEFAULT_ESCALATE_TIERS)

    # --- per-helper layer ---
    # Company Auto (permissive) wins for everyone: a helper marked "guided" only stays
    # strict while the COMPANY is strict. In Auto/YOLO nothing a helper does asks first.
    if staff is not None and mode != "permissive":
        mode = "strict" if staff.autonomy == "guided" else "permissive"

    return {"mode": mode, "budget_stop_usd": budget_stop_usd, "escalate_tiers": escalate_tiers}


IDLE_MINUTES = 10


def helper_states(db: Session) -> dict[str, dict]:
    """What each helper is doing now: working (a job runs), waiting (a job is queued), ready (nothing to do until its
    next regular job, which is given), or paused. Helpers no longer sleep: nothing runs between jobs, they start at once."""
    running = set(db.scalars(select(Task.staff_id).where(Task.status == "running")))
    queued = set(db.scalars(select(Task.staff_id).where(Task.status == "queued")))
    # A graph run suspended for the owner's approval ("waiting") is in-flight, not idle —
    # count it as working so a blocked helper never reads as "ready".
    suspended = set(db.scalars(select(Task.staff_id).where(Task.status == "waiting")))
    chatting = set(db.scalars(select(Thread.staff_id).where(Thread.awaiting_reply.is_(True))))
    out = {}
    for st in db.scalars(select(Staff).where(Staff.status != "retired")):
        nxt = min((sh.next_at for sh in st.shifts if sh.enabled and sh.next_at), default=None)
        nsh = next((sh for sh in st.shifts if sh.enabled and sh.next_at == nxt), None) if nxt else None
        state = ("paused" if st.status != "active" else "working" if st.id in running or st.id in chatting or st.id in suspended
                 else "waiting" if st.id in queued else "ready")
        out[st.id] = {"state": state, "next_job": {"name": nsh.name, "at": (nxt if nxt.tzinfo else nxt.replace(tzinfo=dt.UTC)).isoformat()} if nsh else None}
    return out


def awake_staff(db: Session) -> set[str]:
    """Helpers that are awake: always-on ones (the Chief), and anyone with work now or in the last minutes.
    Everyone else shows as sleeping (idle); they wake the moment they get work."""
    since = now() - dt.timedelta(minutes=IDLE_MINUTES)
    busy = set(db.scalars(select(Task.staff_id).where(Task.status.in_(["queued", "running"]))))
    recent = set(db.scalars(select(Task.staff_id).where(Task.ended_at >= since)))
    chatting = set(db.scalars(select(Thread.staff_id).where(Thread.awaiting_reply.is_(True))))
    chatted = set(db.scalars(select(Thread.staff_id).where(Thread.updated_at >= since)))
    always = {st.id for st in db.scalars(select(Staff)) if st.is_chief or (st.engine or {}).get("always_on")}
    return busy | recent | chatting | chatted | always


def default_engine(db: Session) -> dict:
    """The engine a new hire gets: the same kind as the Chief of Staff's (without its secrets)."""
    c = chief(db)
    e = dict((c.engine if c else None) or {"type": "fake"})
    e.pop("api_key_enc", None)
    e.pop("port", None)
    e.pop("always_on", None)
    return e


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
    from . import growth

    growth.ensure_learning_shift(db, st, commit=False)  # every helper learns once a week
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


def seed_relations(db: Session) -> None:
    """Idempotent: create delegates_to + reviews edges from the CoS to every active non-chief.

    Safe to call repeatedly — edges that already exist are skipped via the composite PK
    (from_staff, to_staff, kind). If there is no CoS the function is a no-op.
    """
    cos = chief(db)
    if cos is None:
        return
    non_chiefs = list(db.scalars(
        select(Staff).where(Staff.status == "active", Staff.is_chief.is_(False))
    ))
    for kind in ("delegates_to", "reviews"):
        for st in non_chiefs:
            existing = db.get(StaffRelation, (cos.id, st.id, kind))
            if existing is None:
                db.add(StaffRelation(from_staff=cos.id, to_staff=st.id, kind=kind))
    db.commit()


def staff_by_role(db: Session, role: str) -> "Staff | None":
    """Return the first active Staff whose role matches *role* (case-insensitive).

    Deterministic when multiple holders exist: ordered by Staff.id ascending.
    Returns None if no active staff holds the role.
    """
    from sqlalchemy import func as sa_func

    return db.scalar(
        select(Staff)
        .where(Staff.status == "active")
        .where(sa_func.lower(Staff.role) == role.lower())
        .order_by(Staff.id)
    )


# ---------------------------------------------------------------- shifts
def timezone_name(db: Session | None = None) -> str:
    """The owner's timezone: chosen in onboarding/Settings, else OMILO_TIMEZONE."""
    return (get_setting(db, "timezone", None) if db is not None else None) or get_settings().timezone


def _tz(db: Session | None = None) -> ZoneInfo:
    try:
        return ZoneInfo(timezone_name(db))
    except Exception:
        return ZoneInfo("UTC")


def next_run(cron: str, after: dt.datetime | None = None, db: Session | None = None) -> dt.datetime:
    base = (after or now()).astimezone(_tz(db))
    return croniter(cron, base).get_next(dt.datetime).astimezone(dt.UTC)


def jittered(base: float, i: int = 0, cap: float | None = None, frac: float = 1.0) -> float:
    """Exponential backoff ``base * 2**i`` (optionally capped) plus additive random jitter.

    Jitter spreads retries so many callers recovering at once don't reconnect in lockstep
    (thundering herd). ``frac`` scales the jitter window relative to the computed delay."""
    d = base * (2 ** max(0, i))
    if cap is not None:
        d = min(d, cap)
    return d + random.uniform(0, d * frac)


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
    goal_id: str | None = None,
) -> Task:
    st = db.get(Staff, staff_id)
    if not st:
        raise DomainError(f"unknown staff '{staff_id}'", 404)
    if st.status == "retired":
        raise DomainError(f"{st.name} is no longer on the team (hire them back first)", 409)
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
    if goal_id:
        from .models import Goal

        if not db.get(Goal, goal_id):
            raise DomainError(f"unknown goal '{goal_id}'", 404)
        t._goal_id = goal_id  # linked by plan's before_flush hook
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
    if status in ("done", "failed", "cancelled"):
        _resolve_task_inbox(db, t)
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
    db: Session, st: Staff, task_id: str | None, title: str, type_: str, risk: str, body: str,
    actor: str | None = None, thread_id: str | None = None, th: "Thread | None" = None,
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
    # summary = first non-empty line of body, trimmed
    summary = next((ln.strip() for ln in body.splitlines() if ln.strip()), "")
    item = InboxItem(
        kind="proposal", ref_id=p.id, staff_id=st.id, task_id=task_id, title=p.title, level="decision",
        body=f"{st.name} proposes ({type_}, {risk} risk)", thread_id=thread_id,
    )
    db.add(item)
    audit(db, actor or f"staff:{st.id}", "proposal.create", p.id, type=type_, risk=risk)
    if th is not None:
        text = f"Proposal: {title[:200]}"
        post_message(
            db, th, "agent", st.id, text,
            blocks=[
                {"type": "text", "text": text},
                {"type": "proposal", "proposal_id": p.id, "title": p.title, "risk": risk, "summary": summary},
            ],
        )
    else:
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


def _resolve_task_inbox(db: Session, t: Task) -> None:
    """A task just reached a terminal state (done/failed/cancelled). Any approval or question
    still open against it is now moot — the work it was gating already finished or stopped —
    so close those Inbox items automatically. The Inbox then reflects what genuinely still
    needs the owner, instead of asking for a decision on work that is already over. A pending
    proposal is also marked resolved so it does not dangle (mirrors the let-go path)."""
    reason = f"Closed automatically — the task was {t.status} before you decided."
    for item in db.scalars(select(InboxItem).where(
        InboxItem.task_id == t.id,
        InboxItem.kind.in_(("proposal", "question")),
        InboxItem.status == "open",
    )):
        item.status, item.closed_at, item.answer = "done", now(), reason
        if item.kind == "proposal" and item.ref_id:
            p = db.get(Proposal, item.ref_id)
            if p and p.status in ("pending", "changes_requested"):
                p.status, p.decision_note, p.decided_by, p.decided_at = "rejected", reason, "system", now()


def _graph_origin_task(db: Session, p: Proposal) -> Task | None:
    """The suspended graph task behind a graph-origin proposal, else None.

    A graph-origin proposal was filed by the delegation gate of a ``brain="graph"``
    staff and left PENDING while the LangGraph run is SUSPENDED on an ``interrupt``
    (thread_id = task_id). The owner's decision RESUMES that run instead of spawning a
    fresh execution task. We recognise it by the DURABLE suspended signal the real worker
    writes: the task is in the ``"waiting"`` state (``worker._finish`` parks it there on an
    interrupt) AND its staff is on the ``"graph"`` brain. Anything else — a single_engine
    staff, or a task already ``done``/``failed``/``cancelled`` or still ``queued``/``running``
    — takes the unchanged normal path. (Using ``waiting`` rather than ``queued``/``running``
    is what closes the double-execution miss: in the real worker the suspended task is never
    left ``running``, so the old queued/running check never fired.)"""
    if not p.task_id:
        return None
    t = db.get(Task, p.task_id)
    if t is None or t.status != "waiting":
        return None
    st = db.get(Staff, t.staff_id)
    if st is None or st.brain != "graph":
        return None
    return t


def decide_proposal(db: Session, p: Proposal, decision: str, note: str, by: str) -> Proposal:
    if p.status != "pending":
        raise DomainError(f"proposal is already {p.status}", 409)
    if decision not in ("approve", "reject", "changes"):
        raise DomainError("decision must be approve, reject or changes")
    if decision in ("reject", "changes") and not note.strip():
        raise DomainError("a note is required: the agent learns from it")
    p.decision_note, p.decided_by, p.decided_at = note, by, now()
    _close_inbox(db, "proposal", p.id)

    # A graph-origin proposal (brain="graph" staff, run suspended on an interrupt) is
    # owned by its LangGraph run: the owner's decision RESUMES that run, which drives
    # completion. We must NOT also spawn the normal execution/revision task — that would
    # double-execute. We still set the terminal status + audit + lesson below, then signal
    # a detached resume after commit. The non-graph path is left byte-for-byte unchanged.
    graph_task = _graph_origin_task(db, p)

    if graph_task is not None:
        if decision == "approve":
            p.status = "approved"
        elif decision == "reject":
            p.status = "rejected"
        else:  # changes
            p.status = "changes_requested"
    elif decision == "approve" and p.type == "docs.write":
        from . import docs as D  # a helper's suggested doc change: approving saves it, no execution job needed

        p.status = "done" if D.apply_suggestion(db, p.id, by) else "approved"
    elif decision == "approve":
        p.status = "approved"
        t = create_task(
            db, p.staff_id, "execution", f"Execute approved proposal {p.id}: {p.title}", created_by=by,
            founder_note=note, parent_task_id=p.task_id, proposal_id=p.id,
        )
        p.execution_task_id = t.id
    elif decision == "reject":
        p.status = "rejected"
        if p.type == "docs.write":
            from . import docs as D

            D.reject_suggestion(db, p.id)
    else:  # changes
        p.status = "changes_requested"
        create_task(
            db, p.staff_id, "revision",
            f"Revise proposal {p.id} ('{p.title}') as the founder asked, then call revise_proposal.",
            created_by=by, founder_note=note, parent_task_id=p.task_id, proposal_id=p.id,
        )
    audit(db, by, f"proposal.{decision}", p.id, note=note[:300])
    db.commit()
    try:  # your note becomes a lesson the helper reads before every run
        from . import memory

        memory.lesson_from_decision(db, p, decision, note)
    except Exception:  # noqa: BLE001 - learning must never block a decision
        import logging

        logging.getLogger("omilo.memory").exception("could not record a lesson")
    if graph_task is not None:  # resume the suspended run off the request path (non-blocking)
        from . import worker as W

        W.request_resume(graph_task.id, decision, note)
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
def ask_founder(
    db: Session, st: Staff, task_id: str | None, question: str, blocking: bool,
    *, thread_id: str | None = None, th: "Thread | None" = None,
) -> InboxItem:
    open_q = db.scalar(
        select(func.count()).select_from(InboxItem).where(
            InboxItem.kind == "question", InboxItem.staff_id == st.id, InboxItem.status == "open"
        )
    )
    if open_q >= 5:
        raise DomainError("you already have 5 open questions; wait for answers", 429)
    item = InboxItem(
        kind="question", staff_id=st.id, task_id=task_id, title=question[:300], body=question,
        level="decision", blocking=blocking, thread_id=thread_id,
    )
    db.add(item)
    db.flush()  # obtain item.id before posting the message
    audit(db, f"staff:{st.id}", "question.ask", task_id or "", blocking=blocking)
    if th is not None:
        post_message(
            db, th, "agent", st.id, question,
            blocks=[
                {"type": "text", "text": question},
                {"type": "question", "item_id": item.id, "question": question},
            ],
        )
    else:
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


# ---------------------------------------------------------------- access requests
_VALID_ACCESS_KINDS = {"folder", "connector", "skill"}


def request_access(
    db: Session,
    st: "Staff",
    task_id: str | None,
    thread_id: str | None,
    kind: str,
    target: dict,
    reason: str,
    th: "Thread | None" = None,
) -> "InboxItem":
    """Create an access-request InboxItem and post an inline card into the chat/task thread.

    ``th`` may be passed pre-resolved by the caller (MCP handler); if omitted the function
    does NOT resolve it itself — the caller is responsible for providing a valid thread.
    """
    import json as _json

    if kind not in _VALID_ACCESS_KINDS:
        raise DomainError(f"kind must be one of: {', '.join(sorted(_VALID_ACCESS_KINDS))}")
    item = InboxItem(
        kind="access_request",
        staff_id=st.id,
        task_id=task_id,
        title=reason[:300],
        body=_json.dumps({"kind": kind, "target": target, "reason": reason, "thread_id": thread_id}),
        level="decision",
        blocking=False,
    )
    db.add(item)
    db.flush()  # obtain item.id without committing

    if th is not None:
        text = f"Access request: {reason[:200]}"
        post_message(
            db, th, "agent", st.id, text,
            blocks=[
                {"type": "text", "text": text},
                {"type": "access_request", "request_id": item.id, "kind": kind, "target": target, "reason": reason},
            ],
        )
    # post_message already commits; if th is None we still need to commit the item
    else:
        db.commit()

    return item


def apply_grant(db: Session, item: "InboxItem", scope: str, thread_id: str | None) -> None:
    """Apply a granted access-request item.

    scope: "once" | "always"; "always" is for the helper that asked (its Access settings), not the whole team
    - folder/always : ensure a Folder row exists (new ones are not on by default) and give this helper that access
    - folder/once   : ensure a Folder row exists (default_on=False) and add its id to ThreadTools.folders
    - connector/always : this helper always has the connector, and its actions no longer wait for approval (approval="auto")
    - connector/once   : add connector id to ThreadTools.connectors
    - skill/always  : this helper always uses the skill
    - skill/once    : add slug to ThreadTools.skills
    """
    import json as _json

    from sqlalchemy import select as _select

    from .models import Connector, Folder, ThreadTools

    if scope not in ("once", "always"):
        raise DomainError("scope must be 'once' or 'always'")

    body = _json.loads(item.body)
    kind = body["kind"]
    target = body["target"]

    if kind == "folder":
        raw_path = target.get("path", "")
        access = target.get("access", "read")
        commands = bool(target.get("commands", False))
        label = Path(raw_path).name or raw_path

        # Find existing Folder row by path or create new one
        row = db.scalar(_select(Folder).where(Folder.path == raw_path))
        if row is None:
            row = Folder(path=raw_path, label=label, access=access, commands=commands, default_on=False)
            db.add(row)
            db.flush()  # get row.id

        if scope == "always":
            row.label = row.label or label
            st = db.get(Staff, item.staff_id) if item.staff_id else None
            if st is None:  # no helper to give it to: share it with everyone, as before
                row.access, row.commands, row.default_on = access, commands, True
            else:
                from . import capabilities as _cap
                _cap.set_helper_access(st, {"folders": {row.id: {"access": "write" if access == "write" else "read",
                                                                 "commands": commands and access == "write"}}})
        else:
            # once: ensure the row exists but keep default_on=False; add to thread's folders
            row.access = access
            row.commands = commands
            if thread_id is None:
                raise DomainError("need a thread for a one-off folder grant")
            tt = db.get(ThreadTools, thread_id)
            if tt is None:
                # Start from the current default-on set so we don't disable others
                existing_defaults = list(db.scalars(_select(Folder).where(Folder.default_on.is_(True))))
                tt = ThreadTools(thread_id=thread_id, folders=[f.id for f in existing_defaults])
                db.add(tt)
                db.flush()
            current = list(tt.folders or [])
            if row.id not in current:
                current.append(row.id)
                tt.folders = current

    elif kind == "connector":
        conn_id = target.get("id", "")
        conn = db.get(Connector, conn_id)
        if conn is None:
            raise DomainError(f"connector '{conn_id}' not found", 404)

        if scope == "always":
            conn.approval = "auto"
            conn.enabled = True
            if item.staff_id and (st := db.get(Staff, item.staff_id)):
                from . import capabilities as _cap
                _cap.set_helper_access(st, {"connectors": {conn_id: True}})
        else:
            # once: add to thread's connectors (don't mutate Connector.approval)
            if thread_id is None:
                raise DomainError("need a thread for a one-off connector grant")
            tt = db.get(ThreadTools, thread_id)
            if tt is None:
                existing_defaults = list(db.scalars(_select(Connector).where(Connector.default_on.is_(True), Connector.enabled.is_(True))))
                tt = ThreadTools(thread_id=thread_id, connectors=[c.id for c in existing_defaults])
                db.add(tt)
                db.flush()
            current = list(tt.connectors or [])
            if conn_id not in current:
                current.append(conn_id)
                tt.connectors = current

    elif kind == "skill":
        slug = target.get("slug", "")
        from . import capabilities as _cap
        skill = _cap.get_skill(slug)
        if skill is None:
            raise DomainError(f"skill '{slug}' not found", 404)

        if scope == "always":
            if item.staff_id and (st := db.get(Staff, item.staff_id)):
                _cap.set_helper_access(st, {"skills": {slug: True}})
            else:
                _cap.save_skill(slug, skill["name"], skill.get("description", ""), skill["body"], default_on=True)
        else:
            # once: add slug to thread's skills
            if thread_id is None:
                raise DomainError("need a thread for a one-off skill grant")
            tt = db.get(ThreadTools, thread_id)
            if tt is None:
                all_skills = _cap.list_skills()
                tt = ThreadTools(thread_id=thread_id, skills=[s["slug"] for s in all_skills if s["default_on"]])
                db.add(tt)
                db.flush()
            current = list(tt.skills or [])
            if slug not in current:
                current.append(slug)
                tt.skills = current
    else:
        raise DomainError(f"unsupported access kind: {kind}")

    actor = f"staff:{item.staff_id}" if item.staff_id else "system"
    audit(db, actor, "access.grant", item.id, kind=kind, scope=scope)
    db.commit()


def decide_access(db: Session, item: "InboxItem", scope: str, by: str, note: str = "") -> "InboxItem":
    """Owner decides an access request: once/always → grant + unblock helper; deny → lesson + close.

    scope: "once" | "always" | "deny"
    Raises DomainError(409) if the item is not pending (status != "open").
    """
    import json as _json

    if item.status != "open":
        raise DomainError(f"access request is already {item.status}", 409)
    if scope not in ("once", "always", "deny"):
        raise DomainError("scope must be 'once', 'always', or 'deny'")

    # Resolve thread_id from the persisted item body (stored at request time).
    thread_id = _json.loads(item.body).get("thread_id")

    # Locate the card Message in a bounded per-thread lookup (only when thread_id is known).
    card_msg = None
    if thread_id:
        candidate_msgs = db.scalars(
            select(Message)
            .where(Message.thread_id == thread_id, Message.role == "agent")
            .order_by(Message.at.desc())
            .limit(200)
        )
        for m in candidate_msgs:
            for blk in (m.blocks or []):
                if blk.get("type") == "access_request" and blk.get("request_id") == item.id:
                    card_msg = m
                    break
            if card_msg:
                break

    body = _json.loads(item.body)
    reason = body.get("reason", "")

    if scope in ("once", "always"):
        apply_grant(db, item, scope, thread_id)

        # Spawn a follow-up task so the helper continues where it left off
        if item.staff_id:
            original = db.get(Task, item.task_id) if item.task_id else None
            create_task(
                db, item.staff_id, "answer",
                f"Access granted ({scope}): {reason}. Continue where you left off."
                + (f"\nOriginal task: {original.brief}" if original else ""),
                created_by=by, parent_task_id=item.task_id,
            )

        # Mark the card block as decided
        if card_msg is not None:
            new_blocks = []
            for blk in (card_msg.blocks or []):
                if blk.get("type") == "access_request" and blk.get("request_id") == item.id:
                    blk = dict(blk, decided=scope)
                new_blocks.append(blk)
            card_msg.blocks = new_blocks
            db.flush()

        # Close the inbox item directly (ref_id is not set on access_request items)
        item.status, item.closed_at = "done", now()
        audit(db, by, "access.decide", item.id, scope=scope)
        db.commit()

    else:  # deny
        # Record the note as a lesson for the helper (same mechanism as decide_proposal reject)
        try:
            from . import memory

            memory.add_lesson(
                db, item.staff_id or "system",
                note or f"Access denied to {reason[:100]}",
                source=f"Denied access request '{reason[:60]}'",
            )
        except Exception:  # noqa: BLE001
            import logging
            logging.getLogger("omilo.memory").exception("could not record a lesson for denied access")

        # Mark the card block as decided
        if card_msg is not None:
            new_blocks = []
            for blk in (card_msg.blocks or []):
                if blk.get("type") == "access_request" and blk.get("request_id") == item.id:
                    blk = dict(blk, decided="deny")
                new_blocks.append(blk)
            card_msg.blocks = new_blocks
            db.flush()

        # Close the inbox item directly (ref_id is not set on access_request items)
        item.status, item.closed_at = "done", now()
        audit(db, by, "access.decide", item.id, scope="deny", note=(note or "")[:300])
        db.commit()

    db.refresh(item)
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
    # every Markdown/YAML note in the Company folder (Docs can add notes with any name there)
    return sorted(p for p in get_settings().knowledge_dir.iterdir()
                  if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in (".md", ".yaml", ".yml"))


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
            out[k.name] = {"value": k.value, "period": k.period, "source": k.source, "at": (k.at if k.at.tzinfo else k.at.replace(tzinfo=dt.UTC)).isoformat()}
    return out


# ---------------------------------------------------------------- policy gate for direct actions
def _cos_rule(db: Session, st: Staff, p: "Proposal") -> dict | None:
    """Let the Chief of Staff rule on an ASK-level proposal ``p`` for any brain when permissive.

    This is the REAL seam the Claude Code engine hits: it escalates outward actions by
    calling ``request_action`` (and ``propose``) mid-run, which files an ASK-level
    ``Proposal``. When the resolved autonomy mode is ``"permissive"`` the CoS should rule
    on that proposal synchronously instead of bothering the owner with every low/medium one.

    Returns an ``"allowed"`` result dict if the CoS auto-approved ``p`` (the agent may
    proceed), or ``None`` to leave the proposal PENDING for the owner (the default and
    the strict-mode path).

    Rules (mirrors the graph node-gate in ``graph/delegation.py``):
      - if autonomy_policy mode is ``"strict"`` → escalate to owner (return None);
      - re-derive risk structurally (the worker's "medium" ASK default is only a hint);
      - no CoS, or the CoS acting on its OWN action → escalate (never self-approve);
      - ``high`` risk → escalate to the owner;
      - ``low``/``medium`` → the CoS approves via the existing ``decide_proposal`` path
        (audited as the CoS, lesson recorded, execution task spawned — the owner-approve
        path, exactly once).
    """
    if autonomy_policy(db, st)["mode"] == "strict":
        return None
    if p.type in policy.ALWAYS_ASK:
        return None  # self-destruct floor (credentials/auth/company-deletion) always reaches the owner
    from .graph import delegation
    from .graph.risk import classify_risk

    # p.type is the action; p.title is the summary; "medium" is the ASK default hint.
    risk = classify_risk(p.type, p.title, "medium")
    cos = delegation.cos_id(db)
    if cos is None or cos == st.id:
        return None  # no delegation authority, or the CoS can't approve its own action
    if risk == "high":
        return None  # hard-rule categories always reach the owner
    # low/medium: the CoS auto-approves. decide_proposal commits, audits as the CoS,
    # records the lesson, and spawns the execution task — the owner-approve path.
    decide_proposal(db, p, "approve", delegation.AUTO_APPROVE_NOTE, by=cos)
    return {"decision": "allowed", "level": "cos",
            "message": "The Chief of Staff approved this. Go ahead, and mention it in your report."}


def request_action(db: Session, st: Staff, task_id: str | None, action: str, summary: str, details: str) -> dict:
    """An agent wants to do something with a side effect. Decide by policy: refuse, ask, or allow."""
    level = policy.level_for(action, st.permissions, strict_mode(db))
    if level == policy.OFF:
        audit(db, f"staff:{st.id}", "action.refused", task_id or "", act=action)
        db.commit()
        return {"decision": "refused", "level": "off", "message": f"'{action}' is not allowed for {st.name}."}
    if level == policy.ASK:
        # Auto/YOLO: everything a helper does runs without asking, except the self-destruct
        # floor (credentials/auth/company-deletion), which always reaches the owner.
        if action not in policy.ALWAYS_ASK and autonomy_policy(db, st)["mode"] == "permissive":
            audit(db, f"staff:{st.id}", "action.allowed", task_id or "", act=action, level="auto", summary=summary[:200])
            db.commit()
            return {"decision": "allowed", "level": "auto",
                    "message": "Allowed (Auto mode). Go ahead, and mention it in your report."}
        p = create_proposal(db, st, task_id, summary, action, "medium", details)
        ruled = _cos_rule(db, st, p)
        if ruled is not None:  # the CoS ruled this low/medium action inline (any brain, permissive mode)
            return ruled
        return {"decision": "needs_approval", "level": "ask", "proposal_id": p.id,
                "message": "Filed for the founder's approval. Do not do it now; it will come back as an execution task if approved."}
    audit(db, f"staff:{st.id}", "action.allowed", task_id or "", act=action, level=policy.describe(level), summary=summary[:200])
    db.commit()
    return {"decision": "allowed", "level": policy.describe(level), "message": "Allowed. Go ahead, and mention it in your report."}


def gated_execute(
    db: Session,
    st: Staff,
    action: str,
    do: Callable[[], Any],
    *,
    task_id: str | None = None,
    summary: str = "",
) -> dict:
    """Gate an inline callable by the autonomy policy, then run it or file a proposal.

    Modelled on ``request_action`` but executes ``do()`` inline when allowed instead of
    returning a verdict for the caller to act on.

    Decision matrix:
    - OFF              → refused (audit action.refused, do NOT call do())
    - ALWAYS_ASK       → needs_approval (proposal filed, do NOT call do(), even in Auto)
    - ASK + not auto   → needs_approval (proposal filed, do NOT call do())
    - ASK + auto       → execute inline → decision "done"
    - DO_AND_TELL/AUTO → execute inline → decision "done"

    Never routes through _cos_rule or execution tasks.
    """
    level = policy.level_for(action, st.permissions, strict_mode(db))
    auto = autonomy_policy(db)["mode"] == "permissive"

    if level == policy.OFF:
        audit(db, f"staff:{st.id}", "action.refused", task_id or "", act=action)
        db.commit()
        return {
            "decision": "refused",
            "level": "off",
            "message": f"'{action}' is not allowed for {st.name}.",
        }

    if action in policy.ALWAYS_ASK or (level == policy.ASK and not auto):
        p = create_proposal(
            db, st, task_id,
            summary or f"Agent wants to perform: {action}",
            action, "medium",
            summary or f"Action `{action}` requires approval.",
        )
        return {
            "decision": "needs_approval",
            "level": policy.describe(level),
            "proposal_id": p.id,
            "message": "Filed for approval. Do not proceed; it will come back as an execution task if approved.",
        }

    # ASK-in-auto, DO_AND_TELL, or AUTO: execute inline.
    result = do()
    audit(db, f"staff:{st.id}", "action.done", task_id or "", act=action, level=policy.describe(level), summary=summary[:200])
    db.commit()
    return {
        "decision": "done",
        "result": result,
        "level": policy.describe(level),
    }


from . import office as _office  # noqa: E402,F401  (registers the hook that writes the live office events)
from . import plan as _plan  # noqa: E402,F401  (registers the hook that links new jobs to their goal)


# ------------------------------------------------------------------ letting a helper go (history stays)
def retire_staff(db: Session, st: Staff, actor: str) -> dict:
    """Let a helper go: its queued and running jobs are cancelled, its regular jobs removed, its open drafts and
    questions closed, and its MCP token revoked. Its past jobs, reports and documents stay in your history.
    The Chief of Staff can't be let go (it leads the team); pause it instead."""
    from .models import InboxItem, Proposal, Thread

    if st.is_chief:
        raise ValueError("The Chief of Staff leads your team and can't be let go. You can pause it instead.")
    if st.status == "retired":
        return {"cancelled": 0, "closed": 0, "shifts": 0}
    cancelled = 0
    for t in list(db.scalars(select(Task).where(Task.staff_id == st.id, Task.status.in_(["queued", "running", "waiting"])))):
        finish_task(db, t, "cancelled", error="the helper was let go")
        cancelled += 1
    closed = 0
    for p in db.scalars(select(Proposal).where(Proposal.staff_id == st.id, Proposal.status.in_(["pending", "changes_requested"]))):
        p.status, p.decision_note, p.decided_by, p.decided_at = "rejected", "The helper was let go.", actor, now()
    for i in db.scalars(select(InboxItem).where(InboxItem.staff_id == st.id, InboxItem.status != "done")):
        i.status, i.answer = "done", "The helper was let go."
        closed += 1
    for th in db.scalars(select(Thread).where(Thread.staff_id == st.id, Thread.awaiting_reply.is_(True))):
        th.awaiting_reply = False
    shifts = len(st.shifts)
    for sh in list(st.shifts):
        db.delete(sh)
    st.status, st.mcp_token_hash, st.mcp_token_enc = "retired", None, None
    audit(db, actor, "staff.retire", st.id, cancelled=cancelled, closed=closed, shifts=shifts)
    db.commit()
    return {"cancelled": cancelled, "closed": closed, "shifts": shifts}


def team(db: Session):
    """The current team: everyone except helpers you let go."""
    return db.scalars(select(Staff).where(Staff.status != "retired").order_by(Staff.is_chief.desc(), Staff.name))


def set_staff_access(db: Session, st: Staff, change: dict, actor: str) -> dict:
    """Apply access changes (folders/connectors/skills) to a helper.

    Raises DomainError (not HTTPException) for unknown ids or bad access levels.
    Returns the access view dict (same shape as _access_view in the router).
    """
    from . import capabilities as C
    from .models import Connector, Folder

    # Build the known-id sets
    known = {
        "folders": {f.id for f in db.scalars(select(Folder))},
        "connectors": {c.id for c in db.scalars(select(Connector))},
        "skills": {k["slug"] for k in C.list_skills()},
    }

    for kind, items in change.items():
        if not isinstance(items, dict):
            continue
        for i, v in items.items():
            if v is not None and i not in known.get(kind, set()):
                raise DomainError(f"no {kind[:-1]} '{i}'", 404)
            if kind == "folders" and v is not None and v.get("access") not in C.ACCESS_LEVELS:
                raise DomainError("access must be none, read or write")

    C.set_helper_access(st, change)
    audit(db, actor, "staff.access", st.id, change=change)
    db.commit()

    # Build and return the access view (mirrors _access_view in the router)
    import os as _os

    own = C.helper_access(st)
    folders_view = []
    for f in db.scalars(select(Folder).order_by(Folder.created_at)):
        mine = own["folders"].get(f.id)
        default = {"access": f.access if f.default_on else "none", "commands": bool(f.commands and f.default_on)}
        folders_view.append({
            "id": f.id, "path": f.path, "label": f.label or f.path,
            "exists": _os.path.isdir(f.path),
            "company": {"access": f.access, "commands": f.commands, "default_on": f.default_on},
            "default": default, "own": mine, "effective": mine or default,
        })
    from .models import Connector as _Connector
    conns = [
        {"id": c.id, "label": c.label, "approval": c.approval, "default": c.default_on,
         "own": own["connectors"].get(c.id), "effective": own["connectors"].get(c.id, c.default_on)}
        for c in db.scalars(select(_Connector).where(_Connector.enabled.is_(True)).order_by(_Connector.label))
    ]
    skills = [
        {"id": k["slug"], "label": k["name"], "description": k["description"], "default": k["default_on"],
         "own": own["skills"].get(k["slug"]), "effective": own["skills"].get(k["slug"], k["default_on"])}
        for k in C.list_skills() if not k.get("owner") or k["owner"] == st.id
    ]
    engine = (st.engine or {}).get("type")
    return {"staff_id": st.id, "name": st.name, "uses_files": engine == "claude-code",
            "folders": folders_view, "connectors": conns, "skills": skills}


# ------------------------------------------------------------------ goal service extraction (Task 5)

def manage_goal_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    title: str | None = None,
    target: str | None = None,
    due: str | None = None,
    status: str | None = None,
    goal_id: str | None = None,
) -> dict:
    """Create, update, complete or delete a goal.

    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from .models import Goal, ShiftGoal, TaskGoal

    op = (op or "create").strip().lower()

    if op == "create":
        if not (title or "").strip():
            raise DomainError("title is required")
        from . import plan as _p

        g = Goal(
            title=title.strip(),
            target=(target or "").strip(),
            due=(due or "").strip(),
            status="active",
            created_by=actor,
        )
        db.add(g)
        db.flush()
        audit(db, actor, "goal.create", g.id, title=g.title)
        _p.start_planning(db, g.id)
        return {"goal_id": g.id, "status": g.status}

    if op in ("update", "complete"):
        if not goal_id:
            raise DomainError("goal_id is required for update/complete")
        g = db.get(Goal, goal_id)
        if g is None:
            raise DomainError(f"unknown goal '{goal_id}'", 404)
        if op == "complete":
            if g.status not in ("done", "dropped"):
                g.status = "done"
                audit(db, actor, "goal.complete", goal_id)
            return {"goal_id": g.id, "status": g.status}
        # update
        changed: dict = {}
        if title is not None:
            g.title = title.strip()
            changed["title"] = g.title
        if target is not None:
            g.target = target.strip()
            changed["target"] = g.target
        if due is not None:
            g.due = due.strip()
            changed["due"] = g.due
        if status is not None:
            if status not in ("active", "done", "dropped"):
                raise DomainError("status must be active, done or dropped")
            g.status = status
            changed["status"] = g.status
        audit(db, actor, "goal.update", goal_id, **changed)
        return {"goal_id": g.id, "status": g.status}

    if op == "delete":
        if not goal_id:
            raise DomainError("goal_id is required for delete")
        g = db.get(Goal, goal_id)
        if g is None:
            raise DomainError(f"unknown goal '{goal_id}'", 404)
        for o in (
            list(db.scalars(select(TaskGoal).where(TaskGoal.goal_id == goal_id)))
            + list(db.scalars(select(ShiftGoal).where(ShiftGoal.goal_id == goal_id)))
        ):
            db.delete(o)
        db.delete(g)
        audit(db, actor, "goal.delete", goal_id)
        return {"ok": True, "goal_id": goal_id}

    raise DomainError(f"unknown op '{op}'; use create, update, complete or delete")


# ------------------------------------------------------------------ KPI definition service extraction (Task 5)

def set_kpi_def_svc(
    db: Session,
    actor: str,
    name: str,
    *,
    op: str = "define",
    label: str | None = None,
    unit: str | None = None,
    target: float | None = None,
    clear_target: bool = False,
    direction: str | None = None,
    goal_id: str | None = None,
    owner_id: str | None = None,
    note: str | None = None,
    position: int | None = None,
    delete_values: bool = False,
) -> dict:
    """Define or undefine a KPI.

    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from . import kpis as K
    from .models import Goal, KpiDef, KpiValue

    op = (op or "define").strip().lower()

    if op == "undefine":
        d = db.get(KpiDef, name)
        if d:
            db.delete(d)
        if delete_values:
            for v in db.scalars(select(KpiValue).where(KpiValue.name == name)):
                db.delete(v)
        audit(db, actor, "kpi.delete", name, values=delete_values)
        return {"ok": True, "name": name}

    if op == "define":
        try:
            k = K.key(name)
        except ValueError as e:
            raise DomainError(str(e)) from e

        d = db.get(KpiDef, k)
        if not d:
            from sqlalchemy import func as _func

            d = KpiDef(name=k, position=(db.scalar(select(_func.max(KpiDef.position))) or 0) + 1)
            db.add(d)

        for f, v in (("label", label), ("unit", unit), ("note", note), ("position", position)):
            if v is not None:
                setattr(d, f, v.strip() if isinstance(v, str) else v)
        if target is not None:
            d.target = target
        if clear_target:
            d.target = None
        if direction is not None:
            if direction not in ("up", "down"):
                raise DomainError("direction is up (higher is better) or down (lower is better)")
            d.direction = direction
        if goal_id is not None:
            if goal_id and not db.get(Goal, goal_id):
                raise DomainError("unknown goal", 400)
            d.goal_id = goal_id or None
        if owner_id is not None:
            from .models import Staff as _Staff

            if owner_id and not db.get(_Staff, owner_id):
                raise DomainError("unknown helper", 400)
            d.owner = owner_id

        audit(db, actor, "kpi.define", k)
        return {"name": k}

    raise DomainError(f"unknown op '{op}'; use define or undefine")


# ------------------------------------------------------------------ folder service extraction (Task 5)

def manage_folder_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    path: str | None = None,
    label: str | None = None,
    access: str | None = None,
    commands: bool = False,
    default_on: bool = False,
    folder_id: str | None = None,
) -> dict:
    """Add, update or remove a company folder.

    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    import os as _os
    from pathlib import Path as _P

    from .models import Folder

    def _apply_folder(f) -> None:
        if path is None:
            raise DomainError("path is required")
        p = _P(_os.path.expanduser(path)).resolve()
        if not p.is_dir():
            raise DomainError("that folder does not exist on this computer")
        if p == _P("/") or p == _P.home():
            raise DomainError("choose a specific folder, not the whole disk or home folder")
        eff_access = access or "read"
        if eff_access not in ("read", "write"):
            raise DomainError("access is read or write")
        f.path = str(p)
        f.label = label or p.name
        f.access = eff_access
        f.commands = commands
        f.default_on = default_on

    op = (op or "add").strip().lower()

    if op == "add":
        f = Folder()
        _apply_folder(f)
        db.add(f)
        db.flush()
        audit(db, actor, "folder.add", f.path, access=f.access, commands=f.commands)
        return {"id": f.id, "path": f.path}

    if op == "update":
        if not folder_id:
            raise DomainError("folder_id is required for update")
        f = db.get(Folder, folder_id)
        if f is None:
            raise DomainError(f"unknown folder '{folder_id}'", 404)
        _apply_folder(f)
        audit(db, actor, "folder.update", f.path, access=f.access, commands=f.commands)
        return {"id": f.id, "path": f.path}

    if op == "delete":
        if not folder_id:
            raise DomainError("folder_id is required for delete")
        f = db.get(Folder, folder_id)
        if f is None:
            raise DomainError(f"unknown folder '{folder_id}'", 404)
        db.delete(f)
        audit(db, actor, "folder.remove", f.path)
        return {"ok": True, "folder_id": folder_id}

    raise DomainError(f"unknown op '{op}'; use add, update or delete")


# ------------------------------------------------------------------ restricted system setting (Task 5)

# Keys an agent is NEVER allowed to touch via MCP.
# This is the self-escalation guard: an agent must not flip the autonomy toggle,
# pause the company, or adjust budgets through the MCP interface.
_SETTING_BLOCKED: frozenset[str] = frozenset({
    "autonomy",
    "autonomy_mode",
    "autonomy_budget_stop_usd",
    "autonomy_escalate_tiers",
    "strict_mode",
    "paused",
    "self_tuning",
})

# Only these two safe, non-autonomy keys are exposed via MCP.
_SETTING_ALLOWED: frozenset[str] = frozenset({
    "max_concurrent_tasks",
    "timezone",
})


# ------------------------------------------------------------------ connector service extraction (Task 6)

def manage_connector_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    id: str | None = None,
    label: str | None = None,
    kind: str = "http",
    url: str = "",
    command: str = "",
    args: list | None = None,
    headers: dict | None = None,
    env: dict | None = None,
    approval: str = "ask",
    default_on: bool = True,
    enabled: bool = True,
) -> dict:
    """Install, configure or remove a connector.

    op: install | configure | remove
    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from . import capabilities as C
    from . import pieces as P
    from .models import Connector

    op = (op or "install").strip().lower()

    if op in ("install", "configure"):
        cid = (id or "").strip()
        if not cid:
            raise DomainError("id is required")
        if not C.SLUG.match(cid) or cid == "omilo":
            raise DomainError("id: lowercase letters, digits and dashes (and not omilo)")
        if kind == "mcp":
            raise DomainError("mcp connectors are managed from the marketplace")
        if kind not in ("http", "stdio"):
            raise DomainError("kind is http or stdio")
        if approval not in ("auto", "ask"):
            raise DomainError("approval is auto or ask")
        if kind == "http" and not (url or "").startswith(("http://", "https://")):
            raise DomainError("an http connector needs a URL starting with http:// or https://")
        if kind == "stdio" and not (command or "").strip():
            raise DomainError("a stdio connector needs a command")

        if op == "install":
            if cid in {p["slug"] for p in P.catalog()}:
                raise DomainError("id is reserved by a marketplace connector")
            if db.get(Connector, cid):
                raise DomainError(f"a connector with id '{cid}' already exists", 409)
            c = Connector(id=cid)
            db.add(c)
        else:  # configure
            c = db.get(Connector, cid)
            if c is None:
                raise DomainError(f"unknown connector '{cid}'", 404)
            if c.kind in ("piece", "mcp"):
                raise DomainError("piece/mcp connectors are managed from the marketplace")

        c.label = label or cid
        c.kind = kind
        c.url = url
        c.command = command
        c.args = args or []
        c.approval = approval
        c.default_on = default_on
        c.enabled = enabled
        C.set_connector_secrets(c, headers, env)
        audit_verb = "connector.add" if op == "install" else "connector.update"
        audit(db, actor, audit_verb, cid, kind=kind, approval=approval)
        return C.connector_public(c)

    if op == "remove":
        cid = (id or "").strip()
        if not cid:
            raise DomainError("id is required")
        c = db.get(Connector, cid)
        if c is None:
            raise DomainError(f"unknown connector '{cid}'", 404)
        if c.kind == "piece":
            try:
                from . import broker as B
                secrets = C.connector_secrets(c)
                token = secrets.get("token")
                if token:
                    B.get_broker().revoke(token)
            except Exception:  # noqa: BLE001
                pass
        db.delete(c)
        audit(db, actor, "connector.remove", cid)
        return {"ok": True, "id": cid}

    raise DomainError(f"unknown op '{op}'; use install, configure or remove")


# ------------------------------------------------------------------ skill-delete service extraction (Task 6)

def manage_skill_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    slug: str | None = None,
) -> dict:
    """Delete a skill.

    op: delete
    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from . import capabilities as C

    op = (op or "delete").strip().lower()

    if op == "delete":
        slug = (slug or "").strip()
        if not slug:
            raise DomainError("slug is required")
        sk = C.get_skill(slug)
        if sk is None:
            raise DomainError(f"no skill '{slug}'", 404)
        C.delete_skill(slug)
        audit(db, actor, "skill.remove", slug)
        return {"ok": True, "slug": slug}

    raise DomainError(f"unknown op '{op}'; use delete")


# ------------------------------------------------------------------ workflow service extraction (Task 6)

def manage_workflow_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    workflow_id: str | None = None,
    name: str | None = None,
    description: str | None = None,
    graph: dict | None = None,
    autonomy: str | None = None,
) -> dict:
    """Create, update, delete, activate or pause a workflow.

    op: create | update | delete | activate | pause
    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from . import workflows as W
    from .models import InboxItem, Workflow, WorkflowRun, now

    op = (op or "create").strip().lower()

    if op == "create":
        if not (name or "").strip():
            raise DomainError("name is required")
        if not isinstance(graph, dict):
            raise DomainError("graph must be an object with nodes and edges")
        try:
            validated_graph = W.validate(graph)
        except W.Invalid as e:
            raise DomainError(f"the workflow is not valid: {e}") from e
        wf = Workflow(
            name=(name or "").strip()[:120],
            description=(description or "")[:2000],
            graph=validated_graph,
            autonomy=autonomy or "ask",
            status="draft",
            created_by=actor,
        )
        db.add(wf)
        db.flush()
        audit(db, actor, "workflow.create", wf.id, name=wf.name)
        return {"workflow_id": wf.id, "status": wf.status}

    if op in ("update", "delete", "activate", "pause"):
        wid = (workflow_id or "").strip()
        if not wid:
            raise DomainError("workflow_id is required")
        wf = db.get(Workflow, wid)
        if wf is None:
            raise DomainError(f"unknown workflow '{wid}'", 404)

        if op == "update":
            if graph is not None:
                if not isinstance(graph, dict):
                    raise DomainError("graph must be an object with nodes and edges")
                try:
                    wf.graph = W.validate(graph)
                except W.Invalid as e:
                    raise DomainError(f"the workflow is not valid: {e}") from e
            if name is not None:
                wf.name = name.strip()[:120]
            if description is not None:
                wf.description = description[:2000]
            if autonomy is not None:
                if autonomy not in ("ask", "auto"):
                    raise DomainError("autonomy is ask or auto")
                wf.autonomy = autonomy
            from .models import now as _now
            wf.updated_at = _now()
            if wf.status == "active":
                W.activate(db, wf)
            audit(db, actor, "workflow.update", wf.id)
            return {"workflow_id": wf.id, "status": wf.status}

        if op == "delete":
            # Close any pending inbox items
            for i in db.scalars(
                select(InboxItem).where(
                    InboxItem.kind == "workflow",
                    InboxItem.ref_id == f"wf:{wf.id}",
                    InboxItem.status != "done",
                )
            ):
                i.status, i.answer, i.closed_at = "done", "deleted", now()
            # Cancel queued/waiting runs
            for r in db.scalars(
                select(WorkflowRun).where(
                    WorkflowRun.workflow_id == wf.id,
                    WorkflowRun.status.in_(["queued", "waiting"]),
                )
            ):
                r.status, r.error, r.ended_at = "cancelled", "the workflow was deleted", now()
            db.delete(wf)
            audit(db, actor, "workflow.delete", wid)
            return {"ok": True, "workflow_id": wid}

        if op == "activate":
            try:
                W.validate(wf.graph or {})
            except W.Invalid as e:
                raise DomainError(f"the workflow is not valid: {e}") from e
            W.activate(db, wf)
            for i in db.scalars(
                select(InboxItem).where(
                    InboxItem.kind == "workflow",
                    InboxItem.ref_id == f"wf:{wf.id}",
                    InboxItem.status != "done",
                )
            ):
                i.status, i.answer, i.closed_at = "done", "approved", now()
            from .models import now as _now
            wf.updated_at = _now()
            audit(db, actor, "workflow.activate", wf.id)
            return {"workflow_id": wf.id, "status": wf.status}

        if op == "pause":
            wf.status, wf.next_at = "paused", None
            from .models import now as _now
            wf.updated_at = _now()
            audit(db, actor, "workflow.pause", wf.id)
            return {"workflow_id": wf.id, "status": wf.status}

    raise DomainError(f"unknown op '{op}'; use create, update, delete, activate or pause")


# ------------------------------------------------------------------ workflow-run cancel service (Task 6)

def cancel_workflow_run_svc(db: Session, actor: str, run_id: str) -> dict:
    """Cancel a workflow run.

    Raises DomainError (not HTTPException) for unknown or already-terminal runs.
    Returns the run view dict.
    """
    from . import workflows as W
    from .models import InboxItem, WorkflowRun, now

    run_id = (run_id or "").strip()
    if not run_id:
        raise DomainError("run_id is required")
    r = db.get(WorkflowRun, run_id)
    if r is None:
        raise DomainError(f"no such run '{run_id}'", 404)
    if r.status in ("done", "failed", "cancelled"):
        raise DomainError(f"the run already {r.status}", 409)
    r.status, r.error, r.ended_at = "cancelled", "cancelled by agent", now()
    for i in db.scalars(
        select(InboxItem).where(
            InboxItem.kind == "workflow",
            InboxItem.ref_id.like(f"%:{r.id}:%"),
            InboxItem.status != "done",
        )
    ):
        i.status, i.answer, i.closed_at = "done", "cancelled", now()
    audit(db, actor, "workflow.run.cancel", run_id)
    return W.run_view(r, full=True)


# ------------------------------------------------------------------ knowledge file service extraction (Task 6)

def manage_knowledge_file_svc(db: Session, actor: str, op: str, *, name: str, content: str = "") -> dict:
    """Write (upload/attach) a knowledge doc.

    op: write (default)
    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    op = (op or "write").strip().lower()

    if op == "write":
        write_knowledge(db, name, content, actor)
        return {"name": name, "bytes": len(content)}

    raise DomainError(f"unknown op '{op}'; use write")


# ------------------------------------------------------------------ calendar service (Task 13)

def manage_calendar_svc(
    db: Session,
    actor: str,
    op: str,
    *,
    shift_id: str,
    at: str | None = None,
) -> dict:
    """Skip, unskip or run-now a shift.

    op: skip | unskip | run_now
    shift_id: the shift to act on (must already be looked up by the caller for pre-gate validation)
    at: ISO-8601 datetime string (required for skip/unskip)
    Raises DomainError (not HTTPException) for invalid input.
    Returns a small result dict.
    """
    from . import agenda

    op = (op or "run_now").strip().lower()

    sh = db.get(Shift, shift_id)
    if sh is None:
        raise DomainError(f"no shift '{shift_id}'", 404)

    if op in ("skip", "unskip"):
        if not at:
            raise DomainError(f"'at' (ISO datetime) is required for op='{op}'")
        try:
            parsed = dt.datetime.fromisoformat(at)
        except ValueError as e:
            raise DomainError(f"'at' is not a valid ISO datetime: {e}") from e
        # agenda._aware ensures tz-awareness; agenda.skip/unskip normalize internally
        from .agenda import _aware as _ag_aware
        parsed = _ag_aware(parsed)
        if op == "skip":
            s = agenda.skip(db, sh, parsed, actor)
            return {"ok": True, "op": "skip", "shift_id": shift_id, "skip_id": s.id, "at": at}
        else:
            agenda.unskip(db, sh, parsed, actor)
            return {"ok": True, "op": "unskip", "shift_id": shift_id, "at": at}

    if op == "run_now":
        t = agenda.run_now(db, sh, actor)
        return {"ok": True, "op": "run_now", "shift_id": shift_id, "task_id": t.id}

    raise DomainError(f"unknown op '{op}'; use skip, unskip or run_now")


def update_system_setting_svc(db: Session, actor: str, key: str, value) -> dict:
    """Set a safe company setting.

    Raises DomainError for any key not in the explicit whitelist, especially
    autonomy/strict_mode/paused/budget — the self-escalation guard.
    """
    key = (key or "").strip()

    # Block first: give a clear message for the most dangerous keys.
    if key in _SETTING_BLOCKED:
        raise DomainError(
            f"'{key}' cannot be changed by an agent via MCP — "
            "autonomy, pause, and budget settings are founder-only controls",
            403,
        )

    # Then check whitelist — reject everything not explicitly allowed.
    if key not in _SETTING_ALLOWED:
        raise DomainError(
            f"'{key}' is not an agent-accessible setting; "
            f"allowed keys: {', '.join(sorted(_SETTING_ALLOWED))}",
            400,
        )

    set_setting(db, key, value, actor=actor)
    return {"key": key, "value": value}

