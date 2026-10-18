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


IDLE_MINUTES = 10


def helper_states(db: Session) -> dict[str, dict]:
    """What each helper is doing now: working (a job runs), waiting (a job is queued), ready (nothing to do until its
    next regular job, which is given), or paused. Helpers no longer sleep: nothing runs between jobs, they start at once."""
    running = set(db.scalars(select(Task.staff_id).where(Task.status == "running")))
    queued = set(db.scalars(select(Task.staff_id).where(Task.status == "queued")))
    chatting = set(db.scalars(select(Thread.staff_id).where(Thread.awaiting_reply.is_(True))))
    out = {}
    for st in db.scalars(select(Staff).where(Staff.status != "retired")):
        nxt = min((sh.next_at for sh in st.shifts if sh.enabled and sh.next_at), default=None)
        nsh = next((sh for sh in st.shifts if sh.enabled and sh.next_at == nxt), None) if nxt else None
        state = ("paused" if st.status != "active" else "working" if st.id in running or st.id in chatting
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
    if decision == "approve" and p.type == "docs.write":
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
    try:  # your note becomes a lesson the helper reads before every run
        from . import memory

        memory.lesson_from_decision(db, p, decision, note)
    except Exception:  # noqa: BLE001 - learning must never block a decision
        import logging

        logging.getLogger("omilo.memory").exception("could not record a lesson")
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
        body=_json.dumps({"kind": kind, "target": target, "reason": reason}),
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

    scope: "once" | "always"
    - folder/always : create or update a Folder row (default_on=True)
    - folder/once   : ensure a Folder row exists (default_on=False) and add its id to ThreadTools.folders
    - connector/always : set Connector.approval="auto" and enabled=True
    - connector/once   : add connector id to ThreadTools.connectors
    - skill/always  : set the skill's frontmatter default_on=True (via capabilities.save_skill)
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
            row.access = access
            row.commands = commands
            row.default_on = True
            row.label = row.label or label
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

    # Resolve thread_id from the card Message that contains this request's block.
    # blocks is a JSON column (not JSONB), so we filter in Python after a bounded query.
    card_msg = None
    candidate_msgs = db.scalars(
        select(Message).where(Message.role == "agent", Message.author == (item.staff_id or ""))
        .order_by(Message.at.desc()).limit(500)
    )
    for m in candidate_msgs:
        for blk in (m.blocks or []):
            if blk.get("type") == "access_request" and blk.get("request_id") == item.id:
                card_msg = m
                break
        if card_msg:
            break
    thread_id = card_msg.thread_id if card_msg else None

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
    for t in list(db.scalars(select(Task).where(Task.staff_id == st.id, Task.status.in_(["queued", "running"])))):
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

