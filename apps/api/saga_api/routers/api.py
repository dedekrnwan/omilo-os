"""The owner's REST API (used by the web app and the CLI)."""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import catalog, policy
from .. import serialize as X
from .. import services as S
from ..config import get_settings
from ..db import get_db
from ..engines import get_engine
from ..importer import import_prototype
from ..models import (
    AuditEvent,
    Checkpoint,
    InboxItem,
    Proposal,
    Report,
    Shift,
    Staff,
    Task,
    Thread,
    ToolCall,
    User,
    now,
)
from ..security import current_user

router = APIRouter(prefix="/api", tags=["api"])


def _404(obj, what="not found"):
    if obj is None:
        raise HTTPException(404, what)
    return obj


def _run(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except S.DomainError as e:
        raise HTTPException(e.code, str(e)) from e


# ------------------------------------------------------------------ overview
@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(current_user)):
    since = now() - dt.timedelta(hours=24)
    count = lambda q: db.scalar(select(func.count()).select_from(q.subquery()))  # noqa: E731
    open_items = list(db.scalars(select(InboxItem).where(InboxItem.status == "open")))
    return {
        "company_name": S.get_setting(db, "company_name", ""),
        "paused": S.is_paused(db),
        "strict_mode": S.strict_mode(db),
        "max_concurrent_tasks": S.max_concurrent(db),
        "inbox": {"open": len(open_items), "critical": sum(i.level == "critical" for i in open_items),
                  "blocking": sum(i.blocking for i in open_items)},
        "tasks": {"running": count(select(Task).where(Task.status == "running")),
                  "queued": count(select(Task).where(Task.status == "queued")),
                  "done_24h": count(select(Task).where(Task.status == "done", Task.ended_at >= since)),
                  "failed_24h": count(select(Task).where(Task.status == "failed", Task.ended_at >= since))},
        "staff": [{"id": s.id, "name": s.name, "status": s.status, "is_chief": s.is_chief,
                   "running": count(select(Task).where(Task.staff_id == s.id, Task.status == "running"))}
                  for s in db.scalars(select(Staff).order_by(Staff.is_chief.desc(), Staff.name))],
        "kpis": S.latest_kpis(db),
        "cost_7d_usd": round(db.scalar(select(func.coalesce(func.sum(Task.cost_usd), 0)).where(
            Task.created_at >= now() - dt.timedelta(days=7))) or 0, 2),
    }


# ------------------------------------------------------------------ system & settings
class SystemIn(BaseModel):
    paused: bool | None = None
    strict_mode: bool | None = None
    max_concurrent_tasks: int | None = Field(None, ge=1, le=100)
    company_name: str | None = None


@router.post("/system")
def update_system(body: SystemIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    for k, v in body.model_dump(exclude_none=True).items():
        S.set_setting(db, k, v, actor=user.id)
    return overview(db, user)


@router.get("/policy")
def get_policy(user: User = Depends(current_user)):
    return {"levels": policy.LEVEL_NAMES, "defaults": policy.DEFAULTS, "external": sorted(policy.EXTERNAL)}


@router.get("/health/engines")
async def engines_health(db: Session = Depends(get_db), user: User = Depends(current_user)):
    out = {}
    for st in db.scalars(select(Staff)):
        try:
            out[st.id] = await get_engine(st.engine).health(st.engine or {})
        except Exception as e:
            out[st.id] = {"ok": False, "detail": str(e)}
    return out


# ------------------------------------------------------------------ team: templates, presets, staff
@router.get("/templates")
def templates(user: User = Depends(current_user)):
    c = catalog.catalog()
    return {"roles": {k: {"name": v["name"], "job": v["job"], "shifts": v.get("shifts", []), "permissions": v.get("permissions", {})}
                      for k, v in c["roles"].items()},
            "presets": c["presets"], "knowledge_files": c["knowledge_files"]}


class TeamIn(BaseModel):
    preset: str | None = None
    roles: list[str] | None = None
    engine: dict = Field(default_factory=lambda: {"type": "fake"})
    max_concurrent_tasks: int | None = None


@router.post("/team/apply")
def apply_team(body: TeamIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = catalog.catalog()
    roles = body.roles or (c["presets"].get(body.preset or "", {}).get("roles"))
    if not roles:
        raise HTTPException(400, "give a preset (solo, small, growing) or a list of roles")
    company = S.get_setting(db, "company_name", "") or "the company"
    created, tokens = [], {}
    for rid in roles:
        if db.get(Staff, rid):
            continue
        data = _run(catalog.staff_from_role, rid, company, body.engine) if catalog.role(rid) else None
        if data is None:
            raise HTTPException(400, f"unknown role {rid}")
        if data["is_chief"] and S.chief(db):
            data["is_chief"] = False
        st = _run(S.create_staff, db, data, user.id)
        tokens[st.id] = S.rotate_mcp_token(db, st, user.id)
        created.append(st.id)
    conc = body.max_concurrent_tasks or c["presets"].get(body.preset or "", {}).get("concurrent")
    if conc:
        S.set_setting(db, "max_concurrent_tasks", conc, actor=user.id)
    return {"created": created, "mcp_tokens": tokens,
            "note": "MCP tokens are shown once. Put each in its Hermes profile's MCP config (see Staff -> Connect engine)."}


class StaffIn(BaseModel):
    id: str
    name: str
    role: str = ""
    is_chief: bool = False
    job: str = ""
    engine: dict = Field(default_factory=lambda: {"type": "fake"})
    permissions: dict = Field(default_factory=dict)
    budget_usd_month: float = 0
    max_task_minutes: int = 30
    shifts: list[dict] = Field(default_factory=list)


class StaffPatch(BaseModel):
    name: str | None = None
    job: str | None = None
    engine: dict | None = None
    permissions: dict | None = None
    budget_usd_month: float | None = None
    max_task_minutes: int | None = None
    status: str | None = None
    role: str | None = None


@router.get("/staff")
def list_staff(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [X.staff(s) for s in db.scalars(select(Staff).order_by(Staff.is_chief.desc(), Staff.name))]


@router.post("/staff")
def create_staff(body: StaffIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _run(S.create_staff, db, body.model_dump(), user.id)
    token = S.rotate_mcp_token(db, st, user.id)
    return {**X.staff(st), "mcp_token": token}


@router.get("/staff/{sid}")
def get_staff(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    levels = {a: policy.describe(policy.level_for(a, st.permissions, S.strict_mode(db))) for a in sorted(policy.DEFAULTS)}
    recent = db.scalars(select(Task).where(Task.staff_id == sid).order_by(Task.created_at.desc()).limit(20))
    return {**X.staff(st), "effective_permissions": levels, "recent_tasks": [X.task(t) for t in recent],
            "mcp": {"url": get_settings().mcp_url(), "auth": "Bearer <staff MCP token>"}}


@router.patch("/staff/{sid}")
def patch_staff(sid: str, body: StaffPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    if body.status and body.status not in ("active", "paused"):
        raise HTTPException(400, "status must be active or paused")
    return X.staff(S.update_staff(db, st, body.model_dump(), user.id))


@router.delete("/staff/{sid}")
def delete_staff(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    db.delete(st)
    S.audit(db, user.id, "staff.delete", sid)
    db.commit()
    return {"ok": True}


@router.post("/staff/{sid}/mcp-token")
def rotate_token(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    token = S.rotate_mcp_token(db, st, user.id)
    url = get_settings().mcp_url()
    return {"mcp_token": token, "url": url,
            "hermes_config": {"mcp_servers": {"saga-os": {"url": url, "headers": {"Authorization": f"Bearer {token}"}}}},
            "claude_code_config": {"mcpServers": {"saga-os": {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}}}}


class ShiftIn(BaseModel):
    name: str
    cron: str
    brief: str = ""
    enabled: bool = True


@router.post("/staff/{sid}/shifts")
def add_shift(sid: str, body: ShiftIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    sh = _run(S.add_shift, db, st, body.name, body.cron, body.brief)
    sh.enabled = body.enabled
    S.audit(db, user.id, "shift.create", sh.id, staff=sid)
    db.commit()
    return X.shift(sh)


class ShiftPatch(BaseModel):
    cron: str | None = None
    brief: str | None = None
    enabled: bool | None = None


@router.patch("/shifts/{shid}")
def patch_shift(shid: str, body: ShiftPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    sh = _404(db.get(Shift, shid))
    if body.cron:
        from croniter import croniter

        if not croniter.is_valid(body.cron):
            raise HTTPException(400, "invalid cron")
        sh.cron, sh.next_at = body.cron, S.next_run(body.cron)
    if body.brief is not None:
        sh.brief = body.brief
    if body.enabled is not None:
        sh.enabled = body.enabled
    S.audit(db, user.id, "shift.update", shid)
    db.commit()
    return X.shift(sh)


@router.delete("/shifts/{shid}")
def delete_shift(shid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    sh = _404(db.get(Shift, shid))
    db.delete(sh)
    S.audit(db, user.id, "shift.delete", shid)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ tasks
class TaskIn(BaseModel):
    staff_id: str
    brief: str
    founder_note: str = ""


@router.get("/tasks")
def list_tasks(staff_id: str | None = None, status: str | None = None, limit: int = 100,
               db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Task).order_by(Task.created_at.desc()).limit(min(limit, 500))
    if staff_id:
        q = q.where(Task.staff_id == staff_id)
    if status:
        q = q.where(Task.status == status)
    tasks = list(db.scalars(q))
    reports = {r.task_id: r for r in db.scalars(select(Report).where(Report.task_id.in_([t.id for t in tasks])))}
    return [X.task(t, reports.get(t.id)) for t in tasks]


@router.post("/tasks")
def create_task(body: TaskIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _run(S.create_task, db, body.staff_id, "manual", body.brief, user.id, founder_note=body.founder_note)
    return X.task(t)


@router.get("/tasks/{tid}")
def get_task(tid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _404(db.get(Task, tid))
    rep = db.scalar(select(Report).where(Report.task_id == tid))
    cks = db.scalars(select(Checkpoint).where(Checkpoint.task_id == tid).order_by(Checkpoint.at))
    props = db.scalars(select(Proposal).where(Proposal.task_id == tid))
    children = db.scalars(select(Task).where(Task.parent_task_id == tid))
    calls = db.scalars(select(ToolCall).where(ToolCall.task_id == tid).order_by(ToolCall.at))
    return {**X.task(t, rep), "checkpoints": [X.checkpoint(c) for c in cks], "proposals": [X.proposal(p) for p in props],
            "children": [X.task(c) for c in children],
            "tool_calls": [{"at": X.iso(c.at), "tool": c.tool, "decision": c.decision, "ms": c.duration_ms} for c in calls]}


class RerunIn(BaseModel):
    founder_note: str = ""


@router.post("/tasks/{tid}/rerun")
def rerun_task(tid: str, body: RerunIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _404(db.get(Task, tid))
    n = _run(S.create_task, db, t.staff_id, "manual", t.brief, user.id, founder_note=body.founder_note, parent_task_id=t.id)
    return X.task(n)


@router.post("/tasks/{tid}/cancel")
def cancel_task(tid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _404(db.get(Task, tid))
    if t.status not in ("queued", "running"):
        raise HTTPException(409, f"task is {t.status}")
    S.finish_task(db, t, "cancelled", error=f"cancelled by {user.email}")
    return X.task(t)


# ------------------------------------------------------------------ proposals
@router.get("/proposals")
def list_proposals(status: str | None = None, staff_id: str | None = None, limit: int = 200,
                   db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(Proposal).order_by(Proposal.created_at.desc()).limit(min(limit, 500))
    if status:
        q = q.where(Proposal.status == status)
    if staff_id:
        q = q.where(Proposal.staff_id == staff_id)
    return [X.proposal(p) for p in db.scalars(q)]


@router.get("/proposals/{pid}")
def get_proposal(pid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return X.proposal(_404(db.get(Proposal, pid)), full=True)


class DecisionIn(BaseModel):
    decision: str  # approve | reject | changes
    note: str = ""


@router.post("/proposals/{pid}/decide")
def decide(pid: str, body: DecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _404(db.get(Proposal, pid))
    return X.proposal(_run(S.decide_proposal, db, p, body.decision, body.note, user.id), full=True)


class ReviseIn(BaseModel):
    body_md: str
    summary: str = ""


@router.post("/proposals/{pid}/revise")
def revise(pid: str, body: ReviseIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    p = _404(db.get(Proposal, pid))
    return X.proposal(_run(S.revise_proposal, db, p, body.body_md, user.id, body.summary or "edited by the founder"), full=True)


# ------------------------------------------------------------------ inbox
@router.get("/inbox")
def list_inbox(status: str = "open", db: Session = Depends(get_db), user: User = Depends(current_user)):
    q = select(InboxItem).order_by(InboxItem.blocking.desc(), InboxItem.created_at.desc()).limit(300)
    if status != "all":
        q = q.where(InboxItem.status == status)
    items = list(db.scalars(q))
    order = {"critical": 0, "decision": 1, "fyi": 2}
    items.sort(key=lambda i: (order.get(i.level, 3), not i.blocking))
    out = []
    for i in items:
        d = X.inbox(i)
        if i.kind == "proposal" and (p := db.get(Proposal, i.ref_id)):
            d["proposal"] = X.proposal(p)
        out.append(d)
    return out


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1)


@router.post("/inbox/{iid}/answer")
def answer(iid: str, body: AnswerIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, iid))
    return X.inbox(_run(S.answer_question, db, item, body.answer, user.id))


class SnoozeIn(BaseModel):
    hours: float = Field(1, gt=0, le=24 * 14)


@router.post("/inbox/{iid}/snooze")
def snooze(iid: str, body: SnoozeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, iid))
    item.status, item.snooze_until = "snoozed", now() + dt.timedelta(hours=body.hours)
    S.audit(db, user.id, "inbox.snooze", iid, hours=body.hours)
    db.commit()
    return X.inbox(item)


@router.post("/inbox/{iid}/dismiss")
def dismiss(iid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, iid))
    if item.kind == "proposal":
        raise HTTPException(409, "decide the proposal instead")
    item.status, item.closed_at = "done", now()
    S.audit(db, user.id, "inbox.dismiss", iid)
    db.commit()
    return X.inbox(item)


# ------------------------------------------------------------------ threads (chat)
class ThreadIn(BaseModel):
    scope: str = "master"  # master | staff | task | proposal
    ref_id: str | None = None
    staff_id: str | None = None


@router.get("/threads")
def list_threads(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return [X.thread(t) for t in db.scalars(select(Thread).order_by(Thread.updated_at.desc()).limit(200))]


@router.post("/threads")
def open_thread(body: ThreadIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.scope == "master":
        ch = S.chief(db)
        if not ch:
            raise HTTPException(409, "no Chief of Staff yet: create the team first")
        th = S.get_or_create_thread(db, "master", None, ch.id, "Chief of Staff")
    elif body.scope == "staff":
        st = _404(db.get(Staff, body.staff_id or ""), "unknown staff")
        th = S.get_or_create_thread(db, "staff", None, st.id, st.name)
    elif body.scope == "task":
        t = _404(db.get(Task, body.ref_id or ""), "unknown task")
        th = S.get_or_create_thread(db, "task", t.id, t.staff_id, t.brief[:120])
    elif body.scope == "proposal":
        p = _404(db.get(Proposal, body.ref_id or ""), "unknown proposal")
        th = S.get_or_create_thread(db, "proposal", p.id, p.staff_id, p.title)
    else:
        raise HTTPException(400, "scope must be master, staff, task or proposal")
    return thread_detail(th.id, db, user)


@router.get("/threads/{thid}")
def thread_detail(thid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    th = _404(db.get(Thread, thid))
    return {**X.thread(th), "messages": [X.message(m) for m in S.thread_messages(db, th)]}


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    blocks: list[dict] | None = None


@router.post("/threads/{thid}/messages")
def send_message(thid: str, body: MessageIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    th = _404(db.get(Thread, thid))
    S.post_message(db, th, "owner", user.id, body.text, body.blocks, awaiting_reply=True)
    return thread_detail(thid, db, user)


# ------------------------------------------------------------------ company knowledge & KPIs
@router.get("/knowledge")
def list_knowledge(user: User = Depends(current_user)):
    return [{"name": p.name, "bytes": p.stat().st_size, "updated_at": dt.datetime.fromtimestamp(p.stat().st_mtime, dt.UTC).isoformat()}
            for p in S.knowledge_files()]


@router.get("/knowledge/{name}")
def read_knowledge(name: str, user: User = Depends(current_user)):
    return {"name": name, "content": _run(S.read_knowledge, name)}


class KnowledgeIn(BaseModel):
    content: str


@router.put("/knowledge/{name}")
def write_knowledge(name: str, body: KnowledgeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _run(S.write_knowledge, db, name, body.content, user.id)
    return {"name": name, "bytes": len(body.content)}


class CompanyIn(BaseModel):
    company_name: str
    files: dict[str, str] = Field(default_factory=dict)  # name -> content; missing ones get the template


@router.post("/onboarding/company")
def onboarding_company(body: CompanyIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    S.set_setting(db, "company_name", body.company_name, actor=user.id)
    defaults = catalog.catalog()["knowledge_files"]
    written = []
    for name, tmpl in defaults.items():
        content = body.files.get(name)
        if content is None and (S.get_settings().knowledge_dir / name).exists():
            continue
        _run(S.write_knowledge, db, name, content if content is not None else tmpl, user.id)
        written.append(name)
    for name, content in body.files.items():
        if name not in defaults:
            _run(S.write_knowledge, db, name, content, user.id)
            written.append(name)
    S.set_setting(db, "onboarded", True, actor=user.id)
    return {"written": written}


@router.get("/kpis")
def kpis(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return S.latest_kpis(db)


# ------------------------------------------------------------------ audit & import
@router.get("/audit")
def audit_log(limit: int = 200, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(limit, 1000)))
    return [{"id": a.id, "at": X.iso(a.at), "actor": a.actor, "action": a.action, "ref": a.ref, "detail": a.detail} for a in rows]


class ImportIn(BaseModel):
    files: dict[str, str]


@router.post("/import/prototype")
def import_v0(body: ImportIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return import_prototype(db, body.files, user.id)
