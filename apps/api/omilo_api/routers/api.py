"""The owner's REST API (used by the web app and the CLI)."""
import datetime as dt
import json
import os
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import ask as ask_mod
from .. import budgets as _budgets
from .. import catalog, policy
from .. import onboarding as OB
from .. import serialize as X
from .. import services as S
from ..config import get_settings
from ..db import get_auth_db, get_db
from ..engines import get_engine
from ..engines import providers as _providers_reg
from ..importer import import_prototype
from ..models import (
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


# ------------------------------------------------------------------ ai_status helper (cheap, no subprocess)
def _harness_ai_status(db) -> dict:
    """Thin wrapper: defers the harness import to avoid circular imports at module load."""
    from .. import harness as H

    return H.ai_status(db)


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
        "autonomy": "strict" if S.get_setting(db, "autonomy_mode") == "strict" else "auto",
        "max_concurrent_tasks": S.max_concurrent(db),
        "budget_company": _budgets.company_status(db),
        "timezone": S.timezone_name(db),
        "inbox": {"open": len(open_items), "critical": sum(i.level == "critical" for i in open_items),
                  "blocking": sum(i.blocking for i in open_items)},
        "tasks": {"running": count(select(Task).where(Task.status == "running")),
                  "queued": count(select(Task).where(Task.status == "queued")),
                  "done_24h": count(select(Task).where(Task.status == "done", Task.ended_at >= since)),
                  "failed_24h": count(select(Task).where(Task.status == "failed", Task.ended_at >= since))},
        "staff": [{"id": s.id, "name": s.name, "status": s.status, "is_chief": s.is_chief,
                   "running": count(select(Task).where(Task.staff_id == s.id, Task.status == "running"))}
                  for s in S.team(db)],
        "kpis": S.latest_kpis(db),
        "cost_7d_usd": round(db.scalar(select(func.coalesce(func.sum(Task.cost_usd), 0)).where(
            Task.created_at >= now() - dt.timedelta(days=7))) or 0, 2),
        "self_tuning": S.is_self_tuning(db),
        "ai_status": _harness_ai_status(db),
    }


# ------------------------------------------------------------------ system & settings
@router.get("/system")
def get_system(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return overview(db, user)


class SystemIn(BaseModel):
    paused: bool | None = None
    strict_mode: bool | None = None
    max_concurrent_tasks: int | None = Field(None, ge=1, le=100)
    budget_company_usd: float | None = Field(None, ge=0, le=1_000_000)  # 0 = no company cap
    company_name: str | None = None
    timezone: str | None = None
    self_tuning: bool | None = None
    autonomy: Literal["strict", "auto"] | None = None


def _set_timezone(db: Session, tz: str, actor: str) -> None:
    from zoneinfo import ZoneInfo

    try:
        ZoneInfo(tz)
    except Exception as e:
        raise HTTPException(400, f"unknown timezone {tz}") from e
    S.set_setting(db, "timezone", tz, actor=actor)
    for sh in db.scalars(select(Shift)):
        sh.next_at = S.next_run(sh.cron, db=db)
    from .. import workflows as W
    from ..models import Workflow

    for wf in db.scalars(select(Workflow).where(Workflow.status == "active")):
        W.set_next(wf)  # scheduled workflows follow the new clock too
    db.commit()


@router.post("/system")
def update_system(body: SystemIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    for k, v in body.model_dump(exclude_none=True).items():
        if k == "timezone":
            _set_timezone(db, v, user.id)
        elif k == "budget_company_usd":
            S.set_setting(db, k, float(v), actor=user.id)
            S.audit(db, user.id, "budget.company", "company", usd=float(v))
        elif k == "autonomy":
            # Write both keys coherently: Auto → permissive/False, Strict → strict/True
            if v == "auto":
                S.set_setting(db, "strict_mode", False, actor=user.id)
                S.set_setting(db, "autonomy_mode", "permissive", actor=user.id)
            else:  # "strict"
                S.set_setting(db, "strict_mode", True, actor=user.id)
                S.set_setting(db, "autonomy_mode", "strict", actor=user.id)
        else:
            S.set_setting(db, k, v, actor=user.id)
    db.commit()
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


def _create_team(db: Session, user: User, roles: list[str], engine: dict) -> tuple[list[str], dict]:
    company = S.get_setting(db, "company_name", "") or "the company"
    created, tokens = [], {}
    for rid in roles:
        if not catalog.role(rid):
            raise HTTPException(400, f"unknown role {rid}")
        if db.get(Staff, rid):
            continue
        data = _run(catalog.staff_from_role, rid, company, engine)
        if data["is_chief"] and S.chief(db):
            data["is_chief"] = False
        st = _run(S.create_staff, db, data, user.id)
        tokens[st.id] = S.rotate_mcp_token(db, st, user.id)
        created.append(st.id)
    return created, tokens


@router.post("/team/apply")
def apply_team(body: TeamIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    c = catalog.catalog()
    roles = body.roles or (c["presets"].get(body.preset or "", {}).get("roles"))
    if not roles:
        raise HTTPException(400, "give a preset (solo, small, growing) or a list of roles")
    created, tokens = _create_team(db, user, roles, body.engine)
    conc = body.max_concurrent_tasks or c["presets"].get(body.preset or "", {}).get("concurrent")
    if conc:
        S.set_setting(db, "max_concurrent_tasks", conc, actor=user.id)
        db.commit()
    return {"created": created, "mcp_tokens": tokens,
            "note": "MCP tokens are shown once. Use them only to connect an outside agent to this helper (see Team → Connect)."}


@router.get("/team/board")
def team_board(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Per-helper work cards for the By-helper team board view."""
    from .. import team_board as TB

    return TB.board(db)


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
    budget_usd_month: float | None = Field(None, ge=0)
    budget_tokens_month: int | None = Field(None, ge=0)
    max_task_minutes: int | None = None
    status: str | None = None
    role: str | None = None


@router.get("/staff")
def list_staff(former: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The team. `former=true` lists the helpers you let go instead (their history is kept; you can hire them back)."""
    from .. import budgets

    states = S.helper_states(db)
    usage = budgets.month_usage(db)
    rows = db.scalars(select(Staff).where(Staff.status == "retired").order_by(Staff.name)) if former else S.team(db)
    return [{**X.staff(s), "awake": True, "cost_month": round(usage.get(s.id, {}).get("cost_usd", 0.0), 2), **states.get(s.id, {})} for s in rows]


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
    from .. import budgets

    return {**X.staff(st), "effective_permissions": levels, "recent_tasks": [X.task(t) for t in recent],
            "mcp": {"url": get_settings().mcp_url(), "auth": "Bearer <staff MCP token>"}, "budget": budgets.status(db, st)}


@router.patch("/staff/{sid}")
def patch_staff(sid: str, body: StaffPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    if body.status and body.status not in ("active", "paused"):
        raise HTTPException(400, "status must be active or paused")
    data = body.model_dump()
    if (tok := data.pop("budget_tokens_month", None)) is not None:
        from .. import budgets

        budgets.set_token_budget(db, sid, tok)
        S.audit(db, user.id, "staff.budget_tokens", sid, tokens=tok)
        db.commit()
    return X.staff(S.update_staff(db, st, data, user.id))


class AccessIn(BaseModel):
    """Changes to a helper's own access. A value sets it; null goes back to the company default."""
    folders: dict[str, dict | None] | None = None  # {fld_id: {"access": "none"|"read"|"write", "commands": bool} | null}
    connectors: dict[str, bool | None] | None = None
    skills: dict[str, bool | None] | None = None


def _access_view(db: Session, st: Staff) -> dict:
    """Everything shared with the team, and what this helper gets of each: its own setting or the company default."""
    from .. import capabilities as C
    from ..models import Connector, Folder

    own = C.helper_access(st)
    folders = []
    for f in db.scalars(select(Folder).order_by(Folder.created_at)):
        mine = own["folders"].get(f.id)
        default = {"access": f.access if f.default_on else "none", "commands": bool(f.commands and f.default_on)}
        folders.append({"id": f.id, "path": f.path, "label": f.label or f.path, "exists": os.path.isdir(f.path),
                        "company": {"access": f.access, "commands": f.commands, "default_on": f.default_on},
                        "default": default, "own": mine, "effective": mine or default})
    conns = [{"id": c.id, "label": c.label, "approval": c.approval, "default": c.default_on, "own": own["connectors"].get(c.id),
              "effective": own["connectors"].get(c.id, c.default_on)}
             for c in db.scalars(select(Connector).where(Connector.enabled.is_(True)).order_by(Connector.label))]
    skills = [{"id": k["slug"], "label": k["name"], "description": k["description"], "default": k["default_on"],
               "own": own["skills"].get(k["slug"]), "effective": own["skills"].get(k["slug"], k["default_on"])}
              for k in C.list_skills() if not k.get("owner") or k["owner"] == st.id]
    engine = (st.engine or {}).get("type")
    return {"staff_id": st.id, "name": st.name, "uses_files": engine == "claude-code",
            "folders": folders, "connectors": conns, "skills": skills}


@router.get("/staff/{sid}/access")
def staff_access(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _access_view(db, _404(db.get(Staff, sid)))


@router.put("/staff/{sid}/access")
def staff_access_set(sid: str, body: AccessIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    change = {k: v for k, v in body.model_dump().items() if v is not None}  # null inside: back to the company default
    return _run(S.set_staff_access, db, st, change, user.id)


@router.delete("/staff/{sid}")
def delete_staff(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Let a helper go. Its past work stays in your history (deleting the row would erase every job it did)."""
    st = _404(db.get(Staff, sid))
    try:
        r = S.retire_staff(db, st, user.id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True, **r}


@router.post("/staff/{sid}/rehire")
def rehire_staff(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Hire back a helper you let go: same name, look, job and history, a new MCP token."""
    st = _404(db.get(Staff, sid))
    if st.status != "retired":
        raise HTTPException(409, "this helper is on the team")
    st.status = "active"
    token = S.rotate_mcp_token(db, st, user.id)
    S.audit(db, user.id, "staff.rehire", sid)
    db.commit()
    return {**X.staff(st), "mcp_token": token}


@router.post("/staff/{sid}/mcp-token")
def rotate_token(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    st = _404(db.get(Staff, sid))
    token = S.rotate_mcp_token(db, st, user.id)
    url = get_settings().mcp_url()
    return {"mcp_token": token, "url": url,
            "mcp_config": {"mcpServers": {"omilo": {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}}},
            "claude_code_config": {"mcpServers": {"omilo": {"type": "http", "url": url, "headers": {"Authorization": f"Bearer {token}"}}}}}


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
        sh.cron, sh.next_at = body.cron, S.next_run(body.cron, db=db)
    if body.brief is not None:
        sh.brief = body.brief
    if body.enabled is not None:
        if body.enabled and not sh.enabled:  # resuming: the next run is the next one on the schedule, not a missed one
            sh.next_at = S.next_run(sh.cron, db=db)
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


# ------------------------------------------------------------------ calendar: what the helpers will do and did
def _when(v: str, name: str) -> dt.datetime:
    try:
        d = dt.datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(400, f"{name} must be an ISO date-time") from e
    return d if d.tzinfo else d.replace(tzinfo=dt.UTC)


@router.get("/calendar")
def calendar(start: str, end: str, staff_id: str | None = None, kinds: str | None = None,
             db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Shift runs (from their schedules), jobs, scheduled workflows and workflow runs between start and end (at most 62 days)."""
    from .. import agenda

    a, b = _when(start, "start"), _when(end, "end")
    if b <= a or b - a > dt.timedelta(days=62):
        raise HTTPException(400, "end must be after start, at most 62 days later")
    return {"events": agenda.events(db, a, b, staff_id, set(kinds.split(",")) if kinds else None),
            "timezone": S.timezone_name(db), "now": agenda.iso(now())}


@router.get("/calendar/upcoming")
def calendar_upcoming(after: str | None = None, after_id: str = "", limit: int = 20, staff_id: str | None = None,
                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    """What comes next, oldest first: jobs queued or running now, then every scheduled run. Page with `next`."""
    from .. import agenda

    return agenda.upcoming(db, _when(after, "after") if after else None, after_id, max(1, min(limit, 100)), staff_id)


@router.post("/shifts/{shid}/run")
def run_shift_now(shid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import agenda

    return X.task(_run(agenda.run_now, db, _404(db.get(Shift, shid)), user.id))


class SkipIn(BaseModel):
    at: str


@router.post("/shifts/{shid}/skip")
def skip_shift_run(shid: str, body: SkipIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Skip one run of a regular job (the schedule stays)."""
    from .. import agenda

    s = _run(agenda.skip, db, _404(db.get(Shift, shid)), _when(body.at, "at"), user.id)
    return {"shift_id": s.shift_id, "at": agenda.iso(s.at)}


@router.delete("/shifts/{shid}/skip")
def unskip_shift_run(shid: str, at: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import agenda

    agenda.unskip(db, _404(db.get(Shift, shid)), _when(at, "at"), user.id)
    return {"ok": True}


# ------------------------------------------------------------------ tasks
class TaskIn(BaseModel):
    staff_id: str
    brief: str
    founder_note: str = ""
    goal_id: str | None = None


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
    from ..plan import lineage

    lin = lineage(db, [t.id for t in tasks])
    return [{**X.task(t, reports.get(t.id)), "lineage": lin.get(t.id)} for t in tasks]


@router.post("/tasks")
def create_task(body: TaskIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _run(S.create_task, db, body.staff_id, "manual", body.brief, user.id, founder_note=body.founder_note, goal_id=body.goal_id or None)
    return X.task(t)


@router.get("/tasks/{tid}")
def get_task(tid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    t = _404(db.get(Task, tid))
    rep = db.scalar(select(Report).where(Report.task_id == tid))
    cks = db.scalars(select(Checkpoint).where(Checkpoint.task_id == tid).order_by(Checkpoint.at))
    props = db.scalars(select(Proposal).where(Proposal.task_id == tid))
    children = db.scalars(select(Task).where(Task.parent_task_id == tid))
    calls = db.scalars(select(ToolCall).where(ToolCall.task_id == tid).order_by(ToolCall.at))
    from ..plan import lineage

    lin = lineage(db, [tid]).get(tid) or {"goal": None, "parents": []}
    return {**X.task(t, rep), "checkpoints": [X.checkpoint(c) for c in cks], "proposals": [X.proposal(p) for p in props],
            "children": [X.task(c) for c in children], "goal": lin["goal"], "lineage": lin,
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
    # "waiting" = a graph run suspended for the owner's approval; the owner must be able to
    # cancel it (the escape hatch for an escalation they don't want to decide).
    if t.status not in ("queued", "running", "waiting"):
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
    from .. import notify as N
    from .. import nudge

    prefs = N.prefs(db, user.id)
    out = []
    for i in items:
        d = X.inbox(i)
        if i.status == "open":
            d["nudge"] = nudge.info(db, i, prefs)
        if i.kind == "proposal" and (p := db.get(Proposal, i.ref_id)):
            d["proposal"] = X.proposal(p)
        elif i.kind == "workflow":
            from .. import workflows as W

            d["workflow"] = W.inbox_info(db, i)
        out.append(d)
    from ..plan import lineage

    lin = lineage(db, [i.task_id for i in items if i.task_id])
    for d in out:
        if d.get("task_id") and d["task_id"] in lin:
            t = db.get(Task, d["task_id"])
            me = {"id": t.id, "title": ((t.brief or "").strip().splitlines() or [t.origin])[0][:120], "staff_id": t.staff_id, "staff": t.staff_id, "status": t.status}
            d["lineage"] = {**lin[d["task_id"]], "parents": lin[d["task_id"]]["parents"] + [me]}
    return out


class AnswerIn(BaseModel):
    answer: str = Field(min_length=1)


@router.post("/inbox/{iid}/answer")
def answer(iid: str, body: AnswerIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, iid))
    return X.inbox(_run(S.answer_question, db, item, body.answer, user.id))


class BulkDecideIn(BaseModel):
    ids: list[str]
    decision: Literal["approve", "deny"]
    note: str = ""
    confirm_high_risk: bool = False


@router.post("/inbox/bulk")
def bulk_decide(body: BulkDecideIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve or deny many Inbox items at once.

    Returns:
      approved       — ids of items successfully acted on (approve path)
      denied         — ids of items successfully acted on (deny path)
      skipped        — ids that were missing, already decided, or ineligible kind
      needs_confirm  — high-risk proposals blocking the batch when confirm_high_risk=False
    """
    _ELIGIBLE_KINDS = {"proposal", "access_request"}

    # 1. Load items; partition into eligible / skipped
    eligible: list[InboxItem] = []
    skipped: list[dict] = []
    for iid in body.ids:
        item = db.get(InboxItem, iid)
        if item is None:
            skipped.append({"id": iid, "reason": "not found"})
        elif item.status != "open":
            skipped.append({"id": iid, "reason": f"already decided (status={item.status})"})
        elif item.kind not in _ELIGIBLE_KINDS:
            skipped.append({"id": iid, "reason": f"kind '{item.kind}' is not bulk-eligible"})
        else:
            eligible.append(item)

    # 2. Deny requires a note — check before touching anything
    if body.decision == "deny" and not body.note.strip():
        raise HTTPException(400, "a note is required to deny")

    # 3. High-risk gate (approve only)
    needs_confirm: list[dict] = []
    if body.decision == "approve" and not body.confirm_high_risk:
        for item in eligible:
            if item.kind == "proposal":
                p = db.get(Proposal, item.ref_id)
                if p and p.risk == "high":
                    needs_confirm.append({
                        "id": item.id,
                        "risk": "high",
                        "why": p.title or "spends money or sends externally",
                    })
        if needs_confirm:
            return {"approved": [], "denied": [], "skipped": skipped, "needs_confirm": needs_confirm}

    # 4. Apply decisions
    approved: list[str] = []
    denied: list[str] = []
    approve = body.decision == "approve"

    for item in eligible:
        try:
            if item.kind == "proposal":
                p = db.get(Proposal, item.ref_id)
                if p is None:
                    skipped.append({"id": item.id, "reason": "proposal not found"})
                    continue
                S.decide_proposal(
                    db, p,
                    "approve" if approve else "reject",
                    body.note,
                    by=user.id,
                )
            else:  # access_request
                S.decide_access(
                    db, item,
                    "once" if approve else "deny",
                    by=user.id,
                    note=body.note,
                )
            if approve:
                approved.append(item.id)
            else:
                denied.append(item.id)
        except S.DomainError as e:
            skipped.append({"id": item.id, "reason": str(e)})

    # 5. Summary audit
    S.audit(
        db, user.id, "inbox.bulk", "",
        decision=body.decision,
        count=len(approved) + len(denied),
        high_risk_confirmed=body.confirm_high_risk,
    )
    db.commit()

    return {"approved": approved, "denied": denied, "skipped": skipped, "needs_confirm": needs_confirm}


class AccessDecisionIn(BaseModel):
    scope: Literal["once", "always", "deny"]
    note: str = ""


@router.post("/access/{item_id}/decide")
def decide_access(item_id: str, body: AccessDecisionIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, item_id))
    if item.kind != "access_request":
        raise HTTPException(400, "not an access request")
    return X.inbox(_run(S.decide_access, db, item, body.scope, user.id, body.note))


class SnoozeIn(BaseModel):
    hours: float | None = Field(None, gt=0, le=24 * 14)
    until: str | None = None  # tomorrow | monday (08:00 in the company's time zone)


@router.post("/inbox/{iid}/snooze")
def snooze(iid: str, body: SnoozeIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import nudge

    item = _404(db.get(InboxItem, iid))
    try:
        return X.inbox(_run(nudge.snooze, db, item, user.id, body.hours, body.until))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/inbox/{iid}/ask-cos")
def ask_cos(iid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Delegate: the Chief of Staff explains the item in the main chat (and the reminders for it stop)."""
    from .. import nudge

    item = _404(db.get(InboxItem, iid))
    return X.thread(_run(nudge.ask_cos, db, item, user.id))


@router.get("/proposals/{pid}/similar")
def similar_proposals(pid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import nudge

    return [X.proposal(p) for p in nudge.similar(db, _404(db.get(Proposal, pid)))]


class SimilarIn(BaseModel):
    decision: str = "approve"  # approve | reject
    note: str = ""
    ids: list[str] | None = None  # which of the similar ones (default: all)


@router.post("/proposals/{pid}/decide-similar")
def decide_similar(pid: str, body: SimilarIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Decide a low-risk proposal and the similar ones waiting with it (same helper, same type) in one go."""
    from .. import nudge

    p = _404(db.get(Proposal, pid))
    if p.risk != "low":
        raise HTTPException(409, "only low-risk proposals can be decided together")
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision must be approve or reject")
    others = nudge.similar(db, p)
    if body.ids is not None:
        others = [o for o in others if o.id in set(body.ids)]
    done = []
    for q in [p, *others]:
        if q.status == "pending":
            _run(S.decide_proposal, db, q, body.decision, body.note, user.id)
            done.append(q.id)
    S.audit(db, user.id, "proposal.decide_similar", pid, decision=body.decision, count=len(done))
    db.commit()
    return {"decided": done}


@router.post("/inbox/{iid}/dismiss")
def dismiss(iid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    item = _404(db.get(InboxItem, iid))
    if item.kind == "proposal":
        raise HTTPException(409, "decide the proposal instead")
    if item.kind == "workflow":
        raise HTTPException(409, "approve or reject it instead")
    item.status, item.closed_at = "done", now()
    S.audit(db, user.id, "inbox.dismiss", iid)
    db.commit()
    return X.inbox(item)


# ------------------------------------------------------------------ threads (chat)
class ThreadIn(BaseModel):
    scope: str = "master"  # master | staff | task | proposal | group (a team chat: ref_id "general", or a new one with a title)
    ref_id: str | None = None
    staff_id: str | None = None
    title: str | None = None


@router.get("/threads")
def list_threads(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import thread_extras as TE

    rows = list(db.scalars(select(Thread).order_by(Thread.updated_at.desc()).limit(200)))
    return [{**X.thread(t), **TE.enrich(db, t)} for t in rows]


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
        # Bug #3: seed proposal context as an initial system message so the thread is never empty.
        from ..models import Message as _Msg
        has_msgs = db.scalar(select(func.count(_Msg.id)).where(_Msg.thread_id == th.id))
        if not has_msgs:
            body_text = S.current_body(p)
            seed_text = (
                f"**Proposal: {p.title}**\n\n"
                + (f"{body_text}\n\n" if body_text else "")
                + f"*Type:* {p.type} · *Risk:* {p.risk} · *Status:* {p.status}"
            )
            S.post_message(db, th, "system", p.staff_id, seed_text,
                           blocks=[{"type": "markdown", "text": seed_text}])
    elif body.scope == "goal":
        from .. import thread_extras as TE
        from ..models import Goal, Message

        goal = _404(db.get(Goal, body.ref_id or ""), "unknown goal")
        ch = S.chief(db)
        if not ch:
            raise HTTPException(409, "no Chief of Staff yet: create the team first")
        th = S.get_or_create_thread(db, "goal", goal.id, ch.id, goal.title)
        # First open: seed the Chief's summary so the thread isn't empty (idempotent — only when no messages).
        if not db.scalar(select(Message.id).where(Message.thread_id == th.id).limit(1)):
            intro = TE.goal_intro(db, goal)
            S.post_message(db, th, "agent", ch.id, intro, blocks=[{"type": "markdown", "text": intro}])
    elif body.scope == "channel":
        from ..models import Channel, Goal
        from ..models import Message as _Msg

        channel = _404(db.get(Channel, body.ref_id or ""), "unknown channel")
        ch = S.chief(db)
        if not ch:
            raise HTTPException(409, "no Chief of Staff yet: create the team first")
        th = S.get_or_create_thread(db, "channel", channel.id, ch.id, channel.name)
        # Seed an intro so the channel conversation is never empty.
        has_msgs = db.scalar(select(func.count(_Msg.id)).where(_Msg.thread_id == th.id))
        if not has_msgs:
            goal_titles = [g.title for g in db.scalars(select(Goal).where(Goal.channel_id == channel.id))]
            intro = (
                f"**{(channel.emoji + ' ') if channel.emoji else ''}{channel.name}**\n\n"
                + ("A home for: " + ", ".join(goal_titles) + "."
                   if goal_titles else "A new channel. Give it goals and the sessions about them gather here.")
            )
            S.post_message(db, th, "system", ch.id, intro, blocks=[{"type": "markdown", "text": intro}])
    elif body.scope == "group":
        from .. import teamchat as TC

        if body.ref_id and body.ref_id != TC.GENERAL:
            th = _404(db.scalar(select(Thread).where(Thread.scope == "group", Thread.ref_id == body.ref_id)), "unknown chat")
        elif body.title and not body.ref_id:
            th = _run(TC.create, db, body.title)
            S.audit(db, user.id, "chat.create", th.id, title=th.title)
            db.commit()
        else:
            th = _run(TC.general, db)
    else:
        raise HTTPException(400, "scope must be master, staff, task, proposal, goal or group")
    return thread_detail(th.id, db, user)


@router.get("/threads/{thid}")
def thread_get(thid: str, request: Request, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The chat polls this; an ETag from the newest message lets the browser revalidate without downloading it again."""
    from fastapi.responses import JSONResponse, Response
    from sqlalchemy import func as _f

    from ..models import Message

    th = _404(db.get(Thread, thid))
    n, last = db.execute(select(_f.count(Message.id), _f.max(Message.at)).where(Message.thread_id == th.id)).one()
    tag = f'W/"{th.id}-{n}-{last.timestamp() if last else 0}-{int(th.awaiting_reply)}-{th.updated_at.timestamp() if th.updated_at else 0}"'
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers={"ETag": tag, "Cache-Control": "no-cache"})
    return JSONResponse(jsonable_encoder(thread_detail(thid, db, user)), headers={"ETag": tag, "Cache-Control": "no-cache"})


def thread_detail(thid: str, db: Session, user: User) -> dict:
    from .. import thread_extras as TE

    th = _404(db.get(Thread, thid))
    msgs = S.thread_messages(db, th)  # newest page only; older ones load on scroll-up via /messages
    has_more = S.has_messages_before(db, th, msgs[0].at if msgs else None)
    return {**X.thread(th), **TE.enrich(db, th), "messages": X.messages_v2(msgs, db, th), "has_more": has_more}


@router.get("/threads/{thid}/messages")
def thread_messages_page(thid: str, before: str | None = None, limit: int = 40,
                         db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A page of older messages for scroll-up paging: up to `limit` messages strictly older than the
    ISO timestamp `before` (the oldest message you already have), oldest→newest, plus whether more remain."""
    import datetime as _dt

    th = _404(db.get(Thread, thid))
    cursor: _dt.datetime | None = None
    if before:
        try:
            cursor = _dt.datetime.fromisoformat(before)
        except ValueError:
            raise HTTPException(400, "before must be an ISO timestamp") from None
        if cursor.tzinfo is None:
            cursor = cursor.replace(tzinfo=_dt.UTC)
    limit = max(1, min(limit, 100))
    msgs = S.thread_messages(db, th, limit=limit, before=cursor)
    has_more = S.has_messages_before(db, th, msgs[0].at if msgs else None)
    return {"messages": X.messages_v2(msgs, db, th, inject_code=False), "has_more": has_more}


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    blocks: list[dict] | None = None
    mentions: list[str] | None = None  # helper ids the composer picked with @ (names in the text work too)
    goal_ids: list[str] | None = None  # goal ids the composer picked with @ (titles in the text work too)


@router.post("/threads/{thid}/messages")
def send_message(thid: str, body: MessageIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import teamchat as TC

    th = _404(db.get(Thread, thid))
    TC.post(db, th, user.id, body.text, body.blocks, body.mentions, body.goal_ids)
    return thread_detail(thid, db, user)


@router.post("/threads/{thid}/cancel")
def cancel_thread(thid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Force-stop the running AI turn in a thread. Sets awaiting_reply=False, signals the worker."""
    from .. import bus

    th = _404(db.get(Thread, thid))
    th.awaiting_reply = False
    th.pending = None
    db.commit()
    bus.publish("cancel:chat", {"thread_id": thid})
    S.audit(db, user.id, "chat.stop", thid)
    return {"status": "stopping"}


class ThreadPatch(BaseModel):
    title: str = Field(min_length=1, max_length=80)


@router.patch("/threads/{thid}")
def rename_thread(thid: str, body: ThreadPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    th = _404(db.get(Thread, thid))
    if th.scope != "group":
        raise HTTPException(409, "only team chats can be renamed")
    th.title = " ".join(body.title.split())[:80]
    S.audit(db, user.id, "chat.rename", th.id, title=th.title)
    db.commit()
    return X.thread(th)


@router.delete("/threads/{thid}")
def delete_thread(thid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import teamchat as TC

    th = _404(db.get(Thread, thid))
    if th.scope != "group" or th.ref_id == TC.GENERAL:
        raise HTTPException(409, "only team chats you made can be deleted (General stays)")
    from ..models import ThreadTools

    S.audit(db, user.id, "chat.delete", th.id, title=th.title)
    db.query(ThreadTools).filter(ThreadTools.thread_id == th.id).delete()
    db.delete(th)
    db.commit()
    return {"ok": True}


@router.get("/threads/{thid}/focus")
def thread_focus(thid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Return aggregated focus details for the Focus panel right column.

    { progress: [{label, status}], files: [{title, kind, ref}],
      cost: {usd, tokens, minutes} }

    Populated from the linked task (scope='task', ref_id=task_id).
    If no linked task exists, returns empty arrays and zeroed cost.
    """
    from .. import thread_extras as TE

    th = _404(db.get(Thread, thid))
    return TE.focus(db, th)


class AddHelperIn(BaseModel):
    staff_id: str


@router.post("/threads/{thid}/add-helper")
def add_helper(thid: str, body: AddHelperIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Promote a helper into a thread's participant set by writing a system @mention turn.

    Idempotent: if the helper is already a participant (appears in past agent messages
    or is in pending), no additional message is written.
    Returns the updated thread detail (same shape as GET /threads/{id}).
    """
    from .. import thread_extras as TE

    th = _404(db.get(Thread, thid))
    staff = _404(db.get(Staff, body.staff_id), "unknown staff")

    current_participants = TE.participants(db, th)
    if staff.id not in current_participants:
        # Write a system join event so the helper's author record appears.
        S.post_message(
            db, th,
            role="system",
            author=staff.id,
            text=f"@{staff.name} joined the thread",
            blocks=[{"type": "text", "text": f"@{staff.name} joined the thread"}],
        )
        S.audit(db, user.id, "chat.add_helper", th.id, staff_id=staff.id)

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


# ------------------------------------------------------------------ AI (the engine every helper uses)
_LITELLM_PROVIDER_IDS = tuple(_providers_reg.provider_ids())  # 8 vendor ids from registry

AI_PROVIDERS = ("fake", "claude", "claude-direct", "claude-code", "local") + _LITELLM_PROVIDER_IDS
# "claude"        = Claude Code run with your Claude API key: files, commands in shared folders, web, connectors
# "claude-code"   = Claude Code on the subscription pool (Harness), with your API key as automatic overflow
# "claude-direct" = Omilo calls the Claude API itself: nothing to install, web + Omilo's tools only
# "local"         = Claude Code driven via the user's own locally-authenticated `claude` (no key injected by Omilo)
# 8 vendor ids    = LiteLLM-routed direct API calls (anthropic, openai, gemini, xai, deepseek, mistral, bedrock, groq)


def _claude_model(model: str | None) -> str:
    from ..engines.claude import DEFAULT_MODEL

    return model or DEFAULT_MODEL


def _engine_for(provider: str, model: str | None, base_url: str | None = None) -> dict:
    if provider == "claude":
        return {"type": "claude-code", "auth": "api", **({"model": model} if model else {})}
    if provider == "claude-direct":
        return {"type": "claude", "model": _claude_model(model)}
    if provider == "claude-code":
        # subscription pool first, with the company's API key as automatic overflow when the pool is busy/empty
        return {"type": "claude-code", "auth": "auto", **({"model": model} if model else {})}
    if provider == "local":
        # user's own locally-authenticated claude — no credential injected by Omilo
        return {"type": "claude-code", "auth": "local", **({"model": model} if model else {})}
    if provider in _LITELLM_PROVIDER_IDS:
        return {"type": "litellm", "provider": provider, **({"model": model} if model else {})}
    return {"type": "fake"}


def _assign_engine(db: Session, st: Staff, template: dict) -> None:
    keep = {k: v for k, v in (st.engine or {}).items() if k in ("timeout_s", "max_turns", "max_tokens", "web", "tier")}
    st.engine = {**template, **keep}


def _need_claude_key(db: Session) -> None:
    if not S.ai_api_key(db, "claude") and not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(400, "Add your Claude API key first, or choose practice mode for now.")


def _need_vendor_key(db: Session, provider: str) -> None:
    """Require an API key for vendor ids; bedrock accepts AWS_ACCESS_KEY_ID as the env signal."""
    if S.ai_api_key(db, provider):
        return
    env_key = "AWS_ACCESS_KEY_ID" if provider == "bedrock" else f"{provider.upper()}_API_KEY"
    if os.environ.get(env_key):
        return
    raise HTTPException(400, f"Add your {provider} API key first, or choose practice mode for now.")


def _provider_of(e: dict) -> str:
    if e.get("type") in ("claude", "anthropic"):
        return "claude-direct"
    if e.get("type") == "claude-code":
        auth = e.get("auth")
        if auth == "api":
            return "claude"
        if auth == "local":
            return "local"
        return "claude-code"
    if e.get("type") == "litellm" and e.get("provider"):
        return e["provider"]
    return e.get("type", "fake")


@router.get("/ai")
def ai_state(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H

    staff = list(db.scalars(select(Staff)))
    providers = {_provider_of(st.engine or {}) for st in staff}
    current = next(iter(providers)) if len(providers) == 1 else ("mixed" if providers else "fake")
    models = {(st.engine or {}).get("model") for st in staff if _provider_of(st.engine or {}) in ("claude", "claude-direct")}
    cli = H.find_cli()
    return {"provider": current, "model": next(iter(models)) if len(models) == 1 else None,
            "claude_key_hint": S.ai_key_hint(db, "claude"),
            "claude_code": {"installed": bool(cli), "path": cli, "install": H.installer.snapshot()},
            "local_login": H.local_login_status(),
            "pool_consent": H.pool_consent_status(db),
            "staff": {st.id: {"provider": _provider_of(st.engine or {})} for st in staff}}


@router.get("/ai/providers")
def ai_providers(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Return all 8 vendor providers with key-presence flags. No live network calls."""
    def _entry(pid: str) -> dict:
        p = _providers_reg.get_provider(pid)
        return {"id": pid, "label": p.label, "icon": p.icon, "has_key": S.ai_key_hint(db, pid) is not None}
    return [_entry(pid) for pid in _LITELLM_PROVIDER_IDS]


class AiCheckIn(BaseModel):
    api_key: str | None = None
    provider: str | None = None  # a LiteLLM vendor id to test; omitted/claude(-direct) → Claude


@router.post("/ai/check")
async def ai_check(body: AiCheckIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Test one engine's key. For a LiteLLM vendor, confirm its key and model resolve (no paid
    call is made). For Claude (default), test the key and list the models it can use."""
    prov = (body.provider or "").strip()
    if prov in _LITELLM_PROVIDER_IDS:
        from ..engines.litellm_engine import LiteLLMEngine

        cfg = {"provider": prov, **({"api_key": body.api_key.strip()} if (body.api_key or "").strip() else {})}
        res = await LiteLLMEngine().health(cfg)
        # Normalise to the {ok, error} shape the web Test button reads; keep detail for success text.
        return {"ok": res.get("ok", False), "error": None if res.get("ok") else res.get("detail", "Could not verify this key."),
                "detail": res.get("detail", "")}

    from ..engines import claude

    key = (body.api_key or "").strip() or S.ai_api_key(db, "claude") or ""
    if not key:
        return {"ok": False, "error": "Paste your Claude API key first."}
    res = await claude.list_models(key)
    if res["ok"]:
        res["recommended"] = claude.pick_default(res["models"])
    return res


class AiIn(BaseModel):
    provider: str
    api_key: str | None = None
    model: str | None = None
    base_url: str | None = None
    staff_ids: list[str] | None = None  # default: every helper


def _apply_ai(db: Session, user: User, body: "AiIn") -> list[str]:
    if body.provider not in AI_PROVIDERS:
        raise HTTPException(400, f"provider must be one of {', '.join(AI_PROVIDERS)}")
    if body.api_key and body.api_key.strip():
        # claude / claude-direct share one Anthropic key stored under "claude" (back-compat)
        key_slot = "claude" if body.provider in ("claude", "claude-direct") else body.provider
        S.set_ai_key(db, key_slot, body.api_key, user.id)
    if body.provider in ("claude", "claude-direct"):
        _need_claude_key(db)
    if body.provider in _LITELLM_PROVIDER_IDS:
        _need_vendor_key(db, body.provider)
    engine = _engine_for(body.provider, body.model, body.base_url)
    changed = []
    for st in db.scalars(select(Staff)):
        if body.staff_ids is None or st.id in body.staff_ids:
            _assign_engine(db, st, engine)
            changed.append(st.id)
    S.set_setting(db, "ai_provider", body.provider, actor=user.id)
    S.audit(db, user.id, "ai.set", body.provider, model=engine.get("model"), staff=changed)
    db.commit()
    return changed


@router.post("/ai")
def ai_set(body: AiIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    changed = _apply_ai(db, user, body)
    return {**ai_state(db, user), "changed": changed}


# ------------------------------------------------------------------ live run events (workspace view)
@router.get("/events")
def run_events(task_id: str | None = None, thread_id: str | None = None, after: int = 0, limit: int = 500,
               db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import RunEvent

    if not task_id and not thread_id:
        raise HTTPException(400, "give task_id or thread_id")
    q = select(RunEvent).where(RunEvent.id > after)
    q = q.where(RunEvent.task_id == task_id) if task_id else q.where(RunEvent.thread_id == thread_id)
    rows = db.scalars(q.order_by(RunEvent.id).limit(min(limit, 2000)))
    return [{"id": e.id, "at": X.iso(e.at), "kind": e.kind, "staff_id": e.staff_id, "data": e.data} for e in rows]


# ------------------------------------------------------------------ harness pool (Claude Code subscriptions)
@router.get("/harness")
def harness_state(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H

    users = [st.id for st in db.scalars(select(Staff)) if (st.engine or {}).get("type") == "claude-code"]
    return {**H.pool_summary(), "helpers_on_pool": users, "pool_consent": H.pool_consent_status(db)}


def _vendor_key_set(db: Session, provider: str) -> bool:
    """Return True if a usable key exists for *provider*: stored in DB OR the env-var fallback that
    _need_vendor_key checks (AWS_ACCESS_KEY_ID for bedrock, else {PROVIDER}_API_KEY).
    No network calls. Pure DB + os.environ read."""
    if S.ai_api_key(db, provider):
        return True
    env_key = "AWS_ACCESS_KEY_ID" if provider == "bedrock" else f"{provider.upper()}_API_KEY"
    return bool(os.environ.get(env_key))


@router.get("/harness/engines")
def harness_engines(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Return a no-network summary of every engine surface: the Claude Code pool + one card per LiteLLM vendor.

    Powers the multi-engine Harness page. Zero network calls; zero health() calls.
    Key presence and helper assignments are read from DB + env only.
    """
    from .. import harness as H

    # --- 1. Build a lookup: provider_id → list of {id, name} helper stubs --------
    # Known omission: helpers on "claude-direct" (direct Anthropic API) or "claude"
    # (Claude Code CLI with an API key, not the subscription pool) resolve to a provider
    # that is neither "claude-code" nor a LiteLLM vendor, so they appear in no section
    # here. That is acceptable for v1 (pool + vendor cards); a dedicated section can be
    # added later if those surfaces need management on this page.
    staff_rows = list(db.scalars(select(Staff)))
    helpers_by_provider: dict[str, list[dict]] = {}
    for st in staff_rows:
        pid = _provider_of(st.engine or {})
        helpers_by_provider.setdefault(pid, []).append({"id": st.id, "name": st.name})

    # --- 2. Claude Code section (pool summary + helpers on the pool) ---------------
    cc_helpers = helpers_by_provider.get("claude-code", [])
    claude_code_section = {**H.pool_summary(), "helpers": cc_helpers}

    # --- 3. Vendor cards: one per litellm provider id, never 'fake' ----------------
    vendors = []
    for pid in _LITELLM_PROVIDER_IDS:
        p = _providers_reg.get_provider(pid)
        if p is None:
            continue  # registry gap — skip gracefully

        # Derive representative model from the helpers that use this provider, else provider default.
        pid_helpers = helpers_by_provider.get(pid, [])
        # Collect models from staff engines whose provider resolves to pid
        models_used = {
            (st.engine or {}).get("model")
            for st in staff_rows
            if _provider_of(st.engine or {}) == pid and (st.engine or {}).get("model")
        }
        model = next(iter(models_used)) if len(models_used) == 1 else (p.default_model if not models_used else None)

        vendors.append({
            "id": pid,
            "label": p.label,
            "icon": p.icon,
            "key_set": _vendor_key_set(db, pid),
            "model": model,
            "helpers": pid_helpers,
        })

    return {"claude_code": claude_code_section, "vendors": vendors}


class HarnessAccountIn(BaseModel):
    label: str = ""
    token: str


@router.get("/harness/meter")
def harness_meter(user: User = Depends(current_user)):
    """Per-account usage of the Claude Code pool, for the bar in the Workspace (cheap: no CLI checks)."""
    from .. import harness as H

    return H.meter()


@router.post("/harness/accounts")
def harness_add(body: HarnessAccountIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H

    try:
        a = H.add_account(db, body.label, body.token)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    S.audit(db, user.id, "harness.account_add", a.id, label=a.label)
    db.commit()
    return H.serialize(a)


@router.post("/harness/pool-consent")
def harness_pool_consent(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H

    H.grant_pool_consent(db)
    S.audit(db, user.id, "harness.pool_consent", "grant")
    db.commit()
    return H.pool_consent_status(db)


@router.post("/harness/pool-consent/dismiss")
def harness_pool_consent_dismiss(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H

    H.dismiss_pool_notice(db)
    S.audit(db, user.id, "harness.pool_consent", "dismiss")
    db.commit()
    return H.pool_consent_status(db)


class HarnessPatch(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    clear_cooldown: bool = False


@router.patch("/harness/accounts/{aid}")
def harness_patch(aid: str, body: HarnessPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import harness as H
    from ..models import HarnessAccount

    a = _404(db.get(HarnessAccount, aid), "unknown account")
    if body.label is not None:
        a.label = body.label.strip() or a.label
    if body.enabled is not None:
        a.enabled = body.enabled
    if body.clear_cooldown:
        a.cooldown_until, a.status, a.last_error = None, "ready", ""
    S.audit(db, user.id, "harness.account_update", a.id, enabled=a.enabled)
    db.commit()
    return H.serialize(a)


@router.delete("/harness/accounts/{aid}")
def harness_delete(aid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import HarnessAccount

    a = _404(db.get(HarnessAccount, aid), "unknown account")
    db.delete(a)
    S.audit(db, user.id, "harness.account_remove", aid)
    db.commit()
    return {"ok": True}


@router.post("/harness/accounts/{aid}/test")
async def harness_test(aid: str, user: User = Depends(current_user)):
    """Ask Claude Code for a one-word reply with this account (the same probe the pool auto-runs in the background).

    The probe runs a Claude CLI subprocess for up to a minute. We must NOT hold a pooled DB connection
    across it: testing several capped accounts at once (the exact "click Test on every account" flow)
    would otherwise pin every connection for the probe's duration and exhaust the pool. So we take a
    short session to read the token, release it for the probe, then take another to record the result.
    """
    from .. import harness as H
    from ..db import session_scope
    from ..models import HarnessAccount
    from ..security import decrypt

    if not H.find_cli():
        raise HTTPException(409, "Install Claude Code first.")
    with session_scope() as db:
        token = decrypt(_404(db.get(HarnessAccount, aid), "unknown account").token_enc) or ""
    ok, detail = await H.probe(token, timeout=60)
    with session_scope() as db:
        a = _404(db.get(HarnessAccount, aid), "unknown account")
        H.apply_probe_result(a, ok, detail)
        return {"ok": ok, "detail": detail, "account": H.serialize(a)}


@router.post("/harness/install")
def harness_install(user: User = Depends(current_user)):
    from .. import harness as H

    return H.installer.start()


# ------------------------------------------------------------------ capabilities: connectors, folders, skills, files
class ConnectorIn(BaseModel):
    id: str
    label: str = ""
    kind: str = "http"
    url: str = ""
    command: str = ""
    args: list[str] = Field(default_factory=list)
    headers: dict[str, str] | None = None
    env: dict[str, str] | None = None
    approval: str = "ask"
    default_on: bool = True
    enabled: bool = True


def _connector_apply(c, body: ConnectorIn) -> None:
    from .. import capabilities as C

    if body.kind not in ("http", "stdio") or body.approval not in ("auto", "ask"):
        raise HTTPException(400, "kind is http or stdio; approval is auto or ask")
    if body.kind == "http" and not body.url.startswith(("http://", "https://")):
        raise HTTPException(400, "an http connector needs a URL")
    if body.kind == "stdio" and not body.command.strip():
        raise HTTPException(400, "a stdio connector needs a command")
    c.label, c.kind, c.url, c.command, c.args = body.label or body.id, body.kind, body.url, body.command, body.args
    c.approval, c.default_on, c.enabled = body.approval, body.default_on, body.enabled
    C.set_connector_secrets(c, body.headers, body.env)


@router.get("/connectors")
def connectors_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C
    from ..models import Connector

    return [C.connector_public(c) for c in db.scalars(select(Connector).order_by(Connector.created_at))
            if c.kind != "mcp"]


@router.post("/connectors")
def connector_add(body: ConnectorIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C
    from .. import pieces as P
    from ..models import Connector

    if not C.SLUG.match(body.id) or body.id == "omilo":
        raise HTTPException(400, "id: lowercase letters, digits and dashes (and not omilo)")
    if body.kind == "mcp":
        raise HTTPException(400, "mcp connectors are managed from the marketplace")
    if body.id in {p["slug"] for p in P.catalog()}:
        raise HTTPException(400, "id is reserved by a marketplace connector")
    if db.get(Connector, body.id):
        raise HTTPException(409, "a connector with this id exists")
    c = Connector(id=body.id)
    _connector_apply(c, body)
    db.add(c)
    S.audit(db, user.id, "connector.add", c.id, kind=c.kind, approval=c.approval)
    db.commit()
    return C.connector_public(c)


@router.put("/connectors/{cid}")
def connector_update(cid: str, body: ConnectorIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C
    from ..models import Connector

    c = _404(db.get(Connector, cid), "unknown connector")
    if c.kind in ("piece", "mcp"):
        raise HTTPException(400, "piece/mcp connectors are managed from the marketplace")
    _connector_apply(c, body)
    S.audit(db, user.id, "connector.update", c.id, approval=c.approval, enabled=c.enabled)
    db.commit()
    return C.connector_public(c)


@router.post("/connectors/pieces/{slug}/connect")
def piece_connect_start(slug: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Begin an OAuth flow for a piece connector.

    Validates that the slug exists in the catalog, calls broker.start_connect,
    and returns {"auth_url": str, "state": str} to the caller.
    """
    from .. import broker as B
    from .. import pieces as P

    entry = P.get_piece(slug)
    if entry is None or entry.get("status") != "ok":
        raise HTTPException(404, f"piece '{slug}' not found in catalog")

    manifest = entry["manifest"]
    result = B.get_broker().start_connect(manifest)
    return result


@router.get("/connectors/pieces/connect/callback")
def piece_connect_callback(code: str = "", state: str = ""):
    """OAuth2 callback — exchange an authorization code for tokens and stash them.

    This endpoint is hit by the OAuth provider's browser redirect, NOT by an
    authenticated API client.  It therefore carries NO bearer-token auth dependency;
    the ``state`` nonce is the sole correlation secret.

    Flow:
      1. Resolve the piece slug from the broker's pending-state registry.
         Unknown/expired/consumed state → 400; no connector side-effects.
      2. Load the manifest via pieces.get_piece(slug) to read auth.provider.
      3. Exchange the authorization code for tokens via oauth.exchange_code.
      4. Merge ``{"provider": provider}`` into the token dict so that
         HttpBroker.revoke() can identify the provider later.
      5. Stash the token via broker.stash_token(state, token).
         The open poll (GET /connectors/pieces/connect/{state}) completes the
         Connector upsert on its next tick.
      6. Return a minimal success HTML page (200).

    Security: ``code``, ``state``, and token fields are never echoed into the
    response body or logged.
    """
    import logging

    from fastapi.responses import HTMLResponse

    from .. import broker as B
    from .. import oauth
    from .. import pieces as P

    logger = logging.getLogger(__name__)

    broker = B.get_broker()
    slug = broker.slug_for_state(state)
    if slug is None:
        raise HTTPException(400, "unknown or expired OAuth state")

    entry = P.get_piece(slug)
    if entry is None or entry.get("status") != "ok":
        raise HTTPException(400, f"piece '{slug}' not found in catalog")

    manifest = entry["manifest"]
    provider = manifest["auth"]["provider"]

    try:
        token = oauth.exchange_code(provider, code, get_settings().oauth_redirect_uri())
    except Exception:
        logger.warning(
            "piece_connect_callback: code exchange failed for slug=%s", slug
        )
        raise HTTPException(400, "Authorization code exchange failed") from None

    # CRITICAL: merge provider so HttpBroker.revoke() can look up the revoke_url.
    token["provider"] = provider

    broker.stash_token(state, token)
    logger.info("piece_connect_callback: stashed token for slug=%s", slug)

    html = (
        "<!doctype html>"
        "<html><head><title>Connected</title></head>"
        "<body><p>Connected — you can close this window.</p></body></html>"
    )
    return HTMLResponse(content=html, status_code=200)


@router.get("/connectors/pieces/connect/{state}")
def piece_connect_poll(state: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Poll the broker for a pending OAuth flow.

    If the token is ready:
      - Upserts a Connector row (id=slug, kind='piece').
      - Derives approval from the manifest actions: 'ask' if any action is 'ask', else 'auto'.
      - Stores the token encrypted in secrets_enc (clears any needs_reconnect sentinel).
      - Returns {"status": "connected"}.
    If still pending: returns {"status": "pending"}.
    """
    import json

    from .. import broker as B
    from .. import capabilities as C
    from .. import pieces as P
    from ..models import Connector
    from ..security import encrypt

    broker = B.get_broker()
    slug = broker.slug_for_state(state)
    if slug is None:
        # Unknown or already-consumed state — signal the client to stop polling.
        return {"status": "expired"}

    token_result = broker.poll(state)
    if token_result is None:
        return {"status": "pending"}

    # Token is ready — upsert the Connector row.
    # BrokerClient.poll always wraps the credential dict under "token".
    token_dict = token_result["token"]

    # Load the manifest to derive approval and label
    entry = P.get_piece(slug)
    manifest = entry["manifest"] if entry else {}
    label = manifest.get("label", slug)

    # Derive connector-level approval: 'ask' if ANY action has approval=='ask', else 'auto'
    actions = manifest.get("actions", [])
    approval = "ask" if any(a.get("approval") == "ask" for a in actions) else "auto"

    # Upsert: fetch existing or create new
    c = db.get(Connector, slug)
    if c is None:
        c = Connector(id=slug)
        db.add(c)

    c.label = label
    c.kind = "piece"
    c.url = ""
    c.command = ""
    c.args = []
    c.approval = approval
    c.default_on = True
    c.enabled = True

    # Store the token encrypted, clear any needs_reconnect sentinel
    secrets = C.connector_secrets(c)
    secrets["token"] = token_dict
    secrets.pop("needs_reconnect", None)
    c.secrets_enc = encrypt(json.dumps(secrets))

    S.audit(db, user.id, "connector.piece.connect", slug, approval=approval)
    db.commit()

    # Consume the state so it can't be replayed
    broker.consume_state(state)

    return {"status": "connected"}


@router.post("/connectors/mcp/{slug}/connect")
def mcp_connect(slug: str, body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Broker-less connect: enter API keys for a type='mcp' catalog card.

    Validates the catalog entry, renders auth headers from the manifest template, and
    upserts a locked kind='mcp' Connector row.  Field values are NEVER logged.

    Trust boundary: attach header NAMES come from the trusted, server-controlled manifest;
    only the VALUES are rendered from the request body — body input can never become a header name.

    Body: {field_name: value, ...} — every declared field is required and must be non-empty.
    Returns: {"status": "connected"}
    """
    from .. import capabilities as C
    from .. import pieces as P
    from ..models import Connector

    # 1. Load and validate the catalog entry
    entry = P.get_piece(slug)
    if entry is None:
        raise HTTPException(404, f"piece '{slug}' not found in catalog")
    manifest = entry["manifest"]
    if manifest.get("type") != "mcp":
        raise HTTPException(404, f"piece '{slug}' is not an mcp connector")

    mcp_cfg = manifest.get("mcp") or {}

    # 2. Host re-check (defense in depth)
    mcp_url = mcp_cfg.get("url", "")
    if not P.mcp_host_allowed(mcp_url):
        raise HTTPException(400, f"mcp host not allowed for '{slug}'")

    # 3. Require every declared field — reject with 400 before creating anything
    auth = mcp_cfg.get("auth") or {}
    fields = auth.get("fields") or []
    for f in fields:
        name = f["name"]
        if not body.get(name):
            raise HTTPException(400, f"missing required field: {name}")

    # 4. Render headers from the attach templates (never log the values)
    attach = auth.get("attach") or {}
    headers: dict[str, str] = {}
    for header_name, tpl in attach.items():
        headers[header_name] = P._render_str(tpl, body)

    # 5. Upsert the Connector row
    c = db.get(Connector, slug)
    if c is None:
        c = Connector(id=slug)
        db.add(c)

    c.kind = "mcp"
    c.url = mcp_url
    c.label = manifest.get("label", slug)
    c.approval = "ask"
    c.default_on = True
    c.enabled = True

    C.set_connector_secrets(c, headers, None)

    S.audit(db, user.id, "connector.mcp.connect", slug)
    db.commit()

    return {"status": "connected"}


@router.post("/connectors/apikey/{slug}/connect")
def apikey_connect(slug: str, body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Broker-less connect: enter API key fields for a type='piece' + auth.type='apikey' catalog card.

    Validates the catalog entry is a piece with apikey auth, requires every declared field,
    upserts a kind='piece' Connector row, and stores the collected fields encrypted under
    secrets["fields"].  Field values are NEVER logged.

    Trust boundary: field NAMES come from the trusted, server-controlled manifest; only the
    VALUES are supplied by the request body — body input can never become a field name.

    Body: {field_name: value, ...} — every declared auth.fields entry is required and non-empty.
    Returns: {"status": "connected"}
    """
    from .. import capabilities as C
    from .. import pieces as P
    from ..models import Connector

    # 1. Load and validate the catalog entry
    entry = P.get_piece(slug)
    if entry is None:
        raise HTTPException(404, f"piece '{slug}' not found in catalog")
    manifest = entry["manifest"]
    auth = manifest.get("auth") or {}
    if auth.get("type") != "apikey":
        raise HTTPException(404, f"piece '{slug}' is not an apikey connector")

    # 2. Require every declared field — reject with 400 before creating anything
    fields_spec = auth.get("fields") or []
    collected: dict[str, str] = {}
    for f in fields_spec:
        name = f["name"]
        if not body.get(name):
            raise HTTPException(400, f"missing required field: {name}")
        collected[name] = body[name]

    # 3. Derive connector-level approval: 'ask' if ANY action has approval=='ask', else 'auto'
    actions = manifest.get("actions", [])
    approval = "ask" if any(a.get("approval") == "ask" for a in actions) else "auto"

    # 4. Upsert the Connector row
    c = db.get(Connector, slug)
    if c is None:
        c = Connector(id=slug)
        db.add(c)

    c.kind = "piece"
    c.url = ""
    c.label = manifest.get("label", slug)
    c.approval = approval
    c.default_on = True
    c.enabled = True

    # 5. Store the collected fields encrypted under secrets["fields"] (never log values)
    C.set_connector_fields(c, collected)

    # 6. Audit (slug only — NEVER field values) and commit
    S.audit(db, user.id, "connector.apikey.connect", slug)
    db.commit()

    return {"status": "connected"}


@router.delete("/connectors/{cid}")
def connector_delete(cid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import broker as B
    from .. import capabilities as C
    from ..models import Connector

    c = _404(db.get(Connector, cid), "unknown connector")

    # Best-effort revoke for piece connectors
    if c.kind == "piece":
        try:
            secrets = C.connector_secrets(c)
            token = secrets.get("token")
            if token:
                B.get_broker().revoke(token)
        except Exception:  # noqa: BLE001
            pass  # revoke is best-effort; never block disconnect

    db.delete(c)
    S.audit(db, user.id, "connector.remove", cid)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ piece connector marketplace catalog

@router.get("/catalog")
def catalog_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Return all ok pieces with connected/needs_reconnect flags for the current company.

    Each entry: {slug, label, category, logo_url, connected: bool, needs_reconnect: bool}
    logo_url points at /api/catalog/{slug}/logo when the piece has a logo.svg, else ''.
    Only pieces with status=='ok' in the index appear; invalid/missing pieces are hidden.
    """
    from .. import capabilities as C
    from .. import pieces as P
    from ..models import Connector

    ok_pieces = P.catalog()  # [{slug, label, category, description, logo_rel}]

    # Only fetch Connector rows whose id matches a catalog slug (avoids loading all connectors)
    catalog_slugs = [p["slug"] for p in ok_pieces]
    connector_rows: dict[str, Connector] = {
        c.id: c for c in db.scalars(
            select(Connector).where(Connector.id.in_(catalog_slugs))
        )
    }

    manifests = {e.get("slug"): e.get("manifest") or {} for e in P._load_index()}  # one read for the whole list
    result = []
    for piece in ok_pieces:
        slug = piece["slug"]
        logo_url = f"/api/catalog/{slug}/logo" if piece.get("logo_rel") else ""
        conn = connector_rows.get(slug)
        connected = conn is not None
        needs_reconnect = bool(conn and C.connector_secrets(conn).get("needs_reconnect"))
        man = manifests.get(slug) or {}
        entry_type = piece.get("type", "piece")
        if entry_type == "mcp":
            mcp_auth_fields = (man.get("mcp") or {}).get("auth", {}).get("fields") or []
            card_actions: list = []
            card_provider: str = ""
            card_connect_fields: list = [
                {"name": f["name"], "label": f.get("label", f["name"]), "secret": f.get("secret", False)}
                for f in mcp_auth_fields
                if isinstance(f, dict) and "name" in f
            ]
        else:
            card_actions = [
                {"label": a.get("label") or a.get("name", ""), "approval": a.get("approval", "ask")}
                for a in (man.get("actions") or []) if isinstance(a, dict)
            ]
            piece_auth = man.get("auth") or {}
            card_provider = piece_auth.get("provider") or ""
            # For apikey pieces: emit connect_fields (name/label/secret, NEVER values)
            if piece_auth.get("type") == "apikey":
                apikey_fields = piece_auth.get("fields") or []
                card_connect_fields = [
                    {"name": f["name"], "label": f.get("label", f["name"]), "secret": f.get("secret", False)}
                    for f in apikey_fields
                    if isinstance(f, dict) and "name" in f
                ]
            else:
                card_connect_fields = []
        card: dict = {
            "slug": slug,
            "label": piece["label"],
            "category": piece["category"],
            "description": piece.get("description") or "",
            "logo_url": logo_url,
            "connected": connected,
            "needs_reconnect": needs_reconnect,
            "type": entry_type,
            # what a helper can do with it, and which of those wait for your OK (shown on the card and its details)
            "actions": card_actions,
            "provider": card_provider,
        }
        if entry_type == "mcp" or card_connect_fields:
            card["connect_fields"] = card_connect_fields
        result.append(card)

    return result


@router.post("/catalog/refresh")
def catalog_refresh(user: User = Depends(current_user)):
    """Re-fetch the pieces repo and rebuild the catalog index. Returns {ok, invalid, missing}.

    File-based and company-independent: safe to call from any signed-in session. On fetch
    failure the last-good index is kept (see pieces.reindex).
    """
    from .. import pieces as P

    return P.reindex()


# SVG safe headers — same posture as _SAFE_FILE_HEADERS but forces SVG content-type
# and disallows script execution (nosniff + no inline).
_SVG_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=86400",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
}


@router.get("/catalog/{slug}/logo")
def catalog_logo(slug: str, user: User = Depends(current_user)):
    """Serve a piece's logo.svg from the local repo clone.

    Security:
    - The slug is validated against the known catalog (only ok pieces allowed).
    - Path traversal is impossible: we look up logo_rel from the index entry (which
      was validated during reindex) and join it with repo_dir() using resolve(), then
      verify the result stays inside repo_dir().
    - SVG is served with X-Content-Type-Options: nosniff and a tight CSP so the
      browser cannot execute it as a script.
    """
    from fastapi.responses import Response

    from .. import pieces as P

    # Guard 1: slug must be in the ok catalog — reject unknown/invalid slugs entirely
    entry = P.get_piece(slug)
    if entry is None or entry.get("status") != "ok":
        raise HTTPException(404, f"piece '{slug}' not found in catalog")

    logo_rel = entry.get("logo_rel", "")
    if not logo_rel:
        raise HTTPException(404, f"piece '{slug}' has no logo")

    # Guard 2: resolve the path and confirm it stays inside repo_dir()
    base = P.repo_dir().resolve()
    logo_path = (base / logo_rel).resolve()
    if not str(logo_path).startswith(str(base) + "/") and logo_path != base:
        raise HTTPException(404, "logo not found")

    if not logo_path.is_file():
        raise HTTPException(404, "logo not found")

    svg_content = logo_path.read_bytes()
    return Response(
        content=svg_content,
        media_type="image/svg+xml",
        headers=_SVG_HEADERS,
    )


@router.get("/connectors/restorable")
def connectors_restorable(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Connectors left in earlier data folders (moved aside by a reset) that could come back."""
    from .. import restore as R

    return R.restorable(db)


class RestoreIn(BaseModel):
    dir: str
    ids: list[str] | None = None


@router.post("/connectors/restore")
def connectors_restore(body: RestoreIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import restore as R

    try:
        return R.restore(db, body.dir, body.ids)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


# last health check per connector (in memory; refreshed by Test and by the chat box every few minutes)


class _HealthView:
    """Per-company connector health, shared by every API process through Redis (kept a day)."""

    def get(self, k, default=None):
        from .. import bus

        v = bus.get_json(f"conn:health:{k}")
        return default if v is None else v

    def __setitem__(self, k, v):
        from .. import bus

        bus.set_json(f"conn:health:{k}", v, ttl_s=86400)


_conn_health = _HealthView()


async def _probe(rt: dict) -> dict:
    """Connect to an http connector and list its tools. Command connectors are checked by looking for the program."""
    import shutil as _sh
    import time as _t

    import httpx as _h

    if rt["kind"] != "http":
        cmd = (rt["command"] or "").split()[0] if rt["command"] else ""
        found = bool(cmd and (_sh.which(cmd) or os.path.exists(cmd)))
        return {"ok": True if found else False, "detail": "starts when a helper uses it" if found else f"{cmd or 'the program'} is not installed on this computer",
                "at": _t.time()}
    hdrs = {"Accept": "application/json, text/event-stream", **rt["headers"]}
    try:
        async with _h.AsyncClient(timeout=12, headers=hdrs) as h:
            r = await h.post(rt["url"], json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "omilo", "version": "1"}}})
            sid = r.headers.get("mcp-session-id")
            extra = {"mcp-session-id": sid} if sid else {}
            r2 = await h.post(rt["url"], headers=extra, json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        for resp in (r, r2):
            if resp.status_code >= 400:
                hint = " (check the secret headers)" if resp.status_code in (401, 403) else ""
                return {"ok": False, "detail": f"the server answered {resp.status_code}{hint}", "at": _t.time()}
        body = r2.text
        if "data:" in body and "{" in body:
            body = body[body.index("{"): body.rindex("}") + 1]
        data = json.loads(body)
        if "result" not in data:
            return {"ok": False, "detail": str(data.get("error", {}).get("message") or "not an MCP server")[:300], "at": _t.time()}
        tools = [t["name"] for t in data["result"].get("tools", [])]
        return {"ok": True, "detail": f"{len(tools)} tools", "tools": tools[:50], "at": _t.time()}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": (str(e) or e.__class__.__name__)[:300], "at": _t.time()}


@router.post("/connectors/{cid}/test")
async def connector_test(cid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C
    from ..models import Connector

    c = _404(db.get(Connector, cid), "unknown connector")
    if c.kind == "piece":
        raise HTTPException(400, "piece connectors are managed from the marketplace")
    res = await _probe(C.connector_runtime(c))
    _conn_health[cid] = res
    return res


@router.post("/connectors/check")
async def connectors_check(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Check enabled connectors whose last check is older than 5 minutes (in parallel); return every known status."""
    import asyncio as _a
    import time as _t

    from .. import capabilities as C
    from ..models import Connector

    rts = [C.connector_runtime(c) for c in db.scalars(select(Connector).where(Connector.enabled.is_(True)))]
    stale = [rt for rt in rts if _t.time() - _conn_health.get(rt["id"], {}).get("at", 0) > 300]
    for rt, res in zip(stale, await _a.gather(*(_probe(rt) for rt in stale)), strict=True):
        _conn_health[rt["id"]] = res
    return {rt["id"]: {k: v for k, v in _conn_health.get(rt["id"], {}).items() if k != "tools"} for rt in rts}


class FolderIn(BaseModel):
    path: str
    label: str = ""
    access: str = "read"
    commands: bool = False
    default_on: bool = False


@router.get("/folders")
def folders_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from pathlib import Path as _P

    from .. import capabilities as C
    from ..models import Folder

    own = [(st, C.helper_access(st)["folders"]) for st in S.team(db)]
    return [{"id": f.id, "path": f.path, "label": f.label or _P(f.path).name, "access": f.access, "commands": f.commands,
             "default_on": f.default_on, "exists": _P(f.path).is_dir(),
             # helpers with their own setting for this folder (Team → helper → Access)
             "helpers": [{"id": st.id, "name": st.name, **a[f.id]} for st, a in own if f.id in a]}
            for f in db.scalars(select(Folder).order_by(Folder.created_at))]


def _folder_apply(f, body: FolderIn) -> None:
    from pathlib import Path as _P

    p = _P(os.path.expanduser(body.path)).resolve()
    if not p.is_dir():
        raise HTTPException(400, "that folder does not exist on this computer")
    if p == _P("/") or p == _P.home():
        raise HTTPException(400, "choose a specific folder, not the whole disk or home folder")
    if body.access not in ("read", "write"):
        raise HTTPException(400, "access is read or write")
    f.path, f.label, f.access, f.commands, f.default_on = str(p), body.label or p.name, body.access, body.commands, body.default_on


@router.post("/folders")
def folder_add(body: FolderIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Folder

    f = Folder()
    _folder_apply(f, body)
    db.add(f)
    S.audit(db, user.id, "folder.add", f.path, access=f.access, commands=f.commands)
    db.commit()
    return {"id": f.id, "path": f.path}


@router.put("/folders/{fid}")
def folder_update(fid: str, body: FolderIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Folder

    f = _404(db.get(Folder, fid), "unknown folder")
    _folder_apply(f, body)
    S.audit(db, user.id, "folder.update", f.path, access=f.access, commands=f.commands)
    db.commit()
    return {"id": f.id, "path": f.path}


@router.delete("/folders/{fid}")
def folder_delete(fid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Folder

    f = _404(db.get(Folder, fid), "unknown folder")
    db.delete(f)
    S.audit(db, user.id, "folder.remove", f.path)
    db.commit()
    return {"ok": True}


@router.get("/fs")
def fs_browse(path: str = "", user: User = Depends(current_user)):
    """Folders on this computer, to pick one for the helpers (folders only, no file contents)."""
    from pathlib import Path as _P

    p = _P(os.path.expanduser(path or "~")).resolve()
    if not p.is_dir():
        raise HTTPException(404, "not a folder")
    try:
        dirs = sorted((d.name for d in p.iterdir() if d.is_dir() and not d.name.startswith(".")), key=str.lower)[:500]
    except PermissionError as e:
        raise HTTPException(403, "this folder cannot be read") from e
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None, "home": str(_P.home()), "dirs": dirs}


class SkillIn(BaseModel):
    slug: str
    name: str
    description: str = ""
    body: str
    default_on: bool = False


@router.get("/skills")
def skills_list(user: User = Depends(current_user)):
    from .. import capabilities as C

    return [{k: v for k, v in s.items() if k != "body"} | {"chars": len(s["body"])} for s in C.list_skills()]


@router.get("/skills/{slug}")
def skill_get(slug: str, user: User = Depends(current_user)):
    from .. import capabilities as C

    return _404(C.get_skill(slug), "unknown skill")


@router.post("/skills")
def skill_save(body: SkillIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C

    try:
        sk = C.save_skill(body.slug, body.name, body.description, body.body, body.default_on)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    S.audit(db, user.id, "skill.save", body.slug)
    db.commit()
    return sk


@router.post("/skills/{slug}/share")
def skill_share(slug: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Make a helper's own skill a team skill (every helper uses it)."""
    from .. import capabilities as C

    sk = _404(C.get_skill(slug), "unknown skill")
    sk = C.save_skill(slug, sk["name"], sk["description"], sk["body"], default_on=True, owner=None, made_by=sk["owner"] or sk.get("made_by"))
    for it in db.scalars(select(InboxItem).where(InboxItem.kind == "skill_share", InboxItem.ref_id == slug, InboxItem.status == "open")):
        it.status, it.closed_at, it.answer = "done", now(), "shared"
    S.audit(db, user.id, "skill.share", slug)
    db.commit()
    return sk


@router.get("/skill-requests/{iid}")
def skill_request(iid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import growth as G

    it = _404(db.get(InboxItem, iid))
    if it.kind != G.SHARE:
        raise HTTPException(404, "not a skill request")
    return {**G.share_view(it), "staff_id": it.staff_id, "status": it.status}


class SkillDecideIn(BaseModel):
    approve: bool
    note: str = ""


@router.post("/skill-requests/{iid}/decide")
def skill_request_decide(iid: str, body: SkillDecideIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import growth as G

    return _run(G.decide_share, db, _404(db.get(InboxItem, iid)), body.approve, user.id, body.note)


@router.delete("/skills/{slug}")
def skill_delete(slug: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C

    C.delete_skill(slug)
    S.audit(db, user.id, "skill.remove", slug)
    db.commit()
    return {"ok": True}


@router.post("/skills/from-talent/{slug}")
def skill_from_talent(slug: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Turn an Agency specialist's playbook into a skill any helper can use."""
    from .. import capabilities as C
    from .. import talent as T

    a = _404(T.get(slug), "unknown specialist")
    sk = C.save_skill(slug[:40].rstrip("-"), a["name"], a.get("description", ""), a["body"])
    S.audit(db, user.id, "skill.save", sk["slug"], source="agency")
    db.commit()
    return sk


class FileIn(BaseModel):
    name: str
    data: str  # base64


@router.post("/files")
def file_upload(body: FileIn, user: User = Depends(current_user)):
    from .. import capabilities as C

    try:
        return C.save_file(body.name, body.data)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # bad base64
        raise HTTPException(400, "could not read the file") from e


@router.get("/files/{fid}")
def file_download(fid: str, download: bool = False, user: User = Depends(current_user)):
    from fastapi.responses import FileResponse

    from .. import capabilities as C

    p = _404(C.file_path(fid), "unknown file")
    mime, disp = C.serve_headers(p, download)
    return FileResponse(p, media_type=mime, filename=p.name, content_disposition_type=disp, headers=_SAFE_FILE_HEADERS)


_SAFE_FILE_HEADERS = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=300"}


@router.get("/fs/file")
def fs_file(path: str, download: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """A file inside a shared folder or a helper's workspace, for previews and downloads in chat."""
    from fastapi.responses import FileResponse

    from .. import capabilities as C

    p = C.allowed_path(db, path)
    if not p:
        raise HTTPException(404, "this file is not in a shared folder or a helper workspace")
    mime, disp = C.serve_headers(p, download)
    return FileResponse(p, media_type=mime, filename=p.name, content_disposition_type=disp, headers=_SAFE_FILE_HEADERS)


class ThreadToolsIn(BaseModel):
    folders: list[str] | None = None
    connectors: list[str] | None = None
    skills: list[str] | None = None


@router.get("/threads/{thid}/tools")
def thread_tools(thid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as C
    from ..models import Connector, Folder, ThreadTools

    _404(db.get(Thread, thid))
    tt = db.get(ThreadTools, thid)
    folders = list(db.scalars(select(Folder)))
    conns = list(db.scalars(select(Connector).where(Connector.enabled.is_(True))))
    skills = C.list_skills()
    on = lambda chosen, items, key, default: chosen if chosen is not None else [key(i) for i in items if default(i)]  # noqa: E731
    return {
        "folders": {"on": on(tt.folders if tt else None, folders, lambda f: f.id, lambda f: f.default_on),
                    "all": [{"id": f.id, "label": f.label, "path": f.path, "access": f.access, "commands": f.commands} for f in folders]},
        "connectors": {"on": on(tt.connectors if tt else None, conns, lambda c: c.id, lambda c: c.default_on),
                       "all": [{"id": c.id, "label": c.label, "approval": c.approval, "kind": c.kind,
                                "health": {k: v for k, v in _conn_health.get(c.id, {}).items() if k in ("ok", "detail")} or None} for c in conns]},
        "skills": {"on": on(tt.skills if tt else None, skills, lambda s: s["slug"], lambda s: s["default_on"]),
                   "all": [{"id": s["slug"], "label": s["name"], "description": s["description"]} for s in skills]},
    }


@router.put("/threads/{thid}/tools")
def thread_tools_set(thid: str, body: ThreadToolsIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import ThreadTools

    _404(db.get(Thread, thid))
    tt = db.get(ThreadTools, thid) or ThreadTools(thread_id=thid)
    for k in ("folders", "connectors", "skills"):
        v = getattr(body, k)
        if v is not None:
            setattr(tt, k, list(dict.fromkeys(v)))
    db.add(tt)
    db.commit()
    return thread_tools(thid, db, user)


# ------------------------------------------------------------------ talent library (The Agency)
@router.get("/talent")
def talent_list(q: str = "", division: str = "", user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .. import talent as T

    idx = T.index()
    if not idx["agents"] and T.syncer.state == "idle":
        T.syncer.start()  # first visit: fetch the roster in the background
    divs = T.divisions()
    counts: dict[str, int] = {}
    for a in idx["agents"]:
        counts[a["division"]] = counts.get(a["division"], 0) + 1
    hired = {st.role.split(":", 1)[1]: st.id for st in db.scalars(select(Staff)) if (st.role or "").startswith("agency:")}
    agents = [{**a, "hired_as": hired.get(a["slug"])} for a in T.search(q, division)]
    return {"source": {"repo": T.REPO_URL, "license": "MIT", "synced_at": idx["synced_at"], "count": len(idx["agents"]), "sync": T.syncer.snapshot()},
            "divisions": [{"key": k, "label": v.get("label", k), "color": v.get("color", ""), "count": counts.get(k, 0)}
                          for k, v in divs.items() if counts.get(k)],
            "agents": agents}


@router.post("/talent/sync")
def talent_sync(user: User = Depends(current_user)):
    from .. import talent as T

    return T.syncer.start()


@router.get("/talent/{slug}")
def talent_get(slug: str, user: User = Depends(current_user)):
    from .. import talent as T

    return _404(T.get(slug), "unknown specialist")


class HireIn(BaseModel):
    id: str | None = None
    name: str | None = None


@router.post("/talent/{slug}/hire")
def talent_hire(slug: str, body: HireIn | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Hire a specialist from The Agency as a helper. Hired specialists sleep until they get work."""
    from .. import talent as T

    a = _404(T.get(slug), "unknown specialist")
    sid = (body and body.id) or slug
    base, n = sid, 2
    while db.get(Staff, sid):
        sid, n = f"{base}-{n}", n + 1
    engine = S.default_engine(db)
    st = _run(S.create_staff, db, {
        "id": sid, "name": (body and body.name) or a["name"], "role": f"agency:{slug}", "job": T.job_for(a), "engine": engine,
        "permissions": {"actions": dict(T.DIVISION_PERMISSIONS.get(a["division"], {}))}, "shifts": []}, user.id)
    S.rotate_mcp_token(db, st, user.id)
    S.audit(db, user.id, "talent.hire", st.id, specialist=slug, division=a["division"])
    db.commit()
    return X.staff(st)


# ------------------------------------------------------------------ guided onboarding (for non-engineers)
@router.get("/onboarding")
def onboarding_state(db: Session = Depends(get_db), user: User = Depends(current_user)):
    draft = S.get_setting(db, "onboarding_draft", None) or {}
    answers = draft.get("answers") or OB.default_answers(S.get_setting(db, "company_name", ""))
    from .. import interview as I

    return {"answers": answers, "step": draft.get("step", 0), "onboarded": bool(S.get_setting(db, "onboarded", False)),
            "options": OB.options(), "roles": OB.roles_for_people(), "timezone": S.timezone_name(db),
            "has_team": db.scalar(select(func.count()).select_from(Staff)) > 0,
            "ai": _onb_ai_view(db), "providers": _onb_providers(db), "interview": draft.get("interview") or {"history": [], "topic": "business"},
            "topics": I.coverage(answers), "team": draft.get("team")}


def _onb_providers(db: Session) -> list[dict]:
    """The AI choices for onboarding, in plain words, for the cards."""
    from .. import harness as H

    out = [{"id": "claude", "label": "Claude", "by": "Anthropic", "domain": "claude.ai", "kind": "key", "recommended": True,
            "blurb": "Thoughtful, great writing. Works with files and apps on this computer.", "key_url": "https://console.anthropic.com/settings/keys",
            "has_key": bool(S.ai_key_hint(db, "claude"))},
           {"id": "claude-code", "label": "Claude subscription", "by": "Claude Pro or Max", "domain": "claude.ai", "kind": "subscription",
            "blurb": "Use the Claude plan you already pay for. No API key needed.", "has_key": bool(H.pool_summary().get("total"))},
           {"id": "openai", "label": "ChatGPT", "by": "OpenAI", "domain": "openai.com", "kind": "key", "blurb": "The models behind ChatGPT, with your OpenAI API key.",
            "key_url": "https://platform.openai.com/api-keys"},
           {"id": "gemini", "label": "Gemini", "by": "Google", "domain": "gemini.google.com", "kind": "key", "blurb": "Google's AI, with a key from Google AI Studio.",
            "key_url": "https://aistudio.google.com/app/apikey"}]
    more = {"xai": ("Grok", "xAI", "x.ai", "https://console.x.ai"), "deepseek": ("DeepSeek", "DeepSeek", "deepseek.com", "https://platform.deepseek.com/api_keys"),
            "mistral": ("Mistral", "Mistral AI", "mistral.ai", "https://console.mistral.ai/api-keys"), "groq": ("Groq", "Groq", "groq.com", "https://console.groq.com/keys"),
            "bedrock": ("Amazon Bedrock", "AWS", "aws.amazon.com", "https://console.aws.amazon.com/bedrock")}
    for pid, (label, by, domain, url) in more.items():
        if pid in _LITELLM_PROVIDER_IDS:
            out.append({"id": pid, "label": label, "by": by, "domain": domain, "kind": "key", "more": True, "blurb": f"{by} models, with your API key.", "key_url": url})
    for o in out:
        if o["id"] in _LITELLM_PROVIDER_IDS:
            o["has_key"] = bool(S.ai_key_hint(db, o["id"]))
    # The local Claude Code sign-in is intentionally NOT offered: its per-user session limits and global
    # skills/hooks made it unreliable as the team's engine. Omilo runs on the subscription pool, with the
    # company API key as a small chat-only fallback. (The engine still supports auth:"local" if set manually.)
    return out


class DraftIn(BaseModel):
    answers: dict
    step: int = 0


@router.put("/onboarding")
def onboarding_save(body: DraftIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    S.set_setting(db, "onboarding_draft", {"answers": body.answers, "step": body.step}, actor=user.id)
    if str(body.answers.get("company_name") or "").strip():
        S.set_setting(db, "company_name", body.answers["company_name"].strip(), actor=user.id)
    db.commit()
    return {"ok": True}


class AnswersIn(BaseModel):
    answers: dict


class KeyIn(BaseModel):
    api_key: str
    model: str | None = None


@router.post("/ai/key")
def ai_save_key(body: KeyIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Save the Claude key (encrypted) before any helper exists, e.g. at the start of onboarding."""
    if not body.api_key.strip():
        raise HTTPException(400, "empty key")
    S.set_ai_key(db, "claude", body.api_key, user.id)
    if body.model:
        S.set_setting(db, "claude_model", body.model, actor=user.id)
    db.commit()
    return {"claude_key_hint": S.ai_key_hint(db, "claude")}


class AssistIn(BaseModel):
    answers: dict
    messages: list[dict]
    step: str = ""


@router.post("/onboarding/assist")
async def onboarding_assist(body: AssistIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The chat half of the hybrid onboarding: fills the form from what the owner says or pastes."""
    from .. import onboarding_assist as OA

    key = S.ai_api_key(db, "claude") or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(409, "Connect your Claude key first (step 1) so I can help fill this in.")
    try:
        return await OA.assist(key, S.get_setting(db, "claude_model", None), body.answers, body.messages, body.step)
    except Exception as e:  # noqa: BLE001 - shown in the chat
        raise HTTPException(502, f"The assistant could not answer: {e}") from e


# ------------------------------------------------------------------ onboarding: pick the AI, the interview, the team
class OnbAiIn(BaseModel):
    provider: str  # fake | claude (API key) | claude-code (subscription pool) | one of the vendor ids
    api_key: str | None = None
    model: str | None = None


def _onb_ai_view(db: Session) -> dict:
    from .. import interview as I

    cfg = I.ai_config(db)
    return {"provider": cfg["provider"], "label": cfg["label"], "model": cfg.get("model"),
            "chosen": S.get_setting(db, "onboarding_ai", None) is not None}


@router.post("/onboarding/ai")
async def onboarding_ai(body: OnbAiIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Step 1: the AI that runs the interview (and later the helpers). Saves the key, then proves it works."""
    from .. import harness as H
    from .. import interview as I

    pid = body.provider
    if pid not in ("fake", "claude", "claude-code", "local", *_LITELLM_PROVIDER_IDS):
        raise HTTPException(400, "unknown AI provider")
    if body.api_key and body.api_key.strip():
        S.set_ai_key(db, "claude" if pid in ("claude", "anthropic") else pid, body.api_key, user.id)
    if pid == "claude-code" and not H.pool_summary().get("total"):
        raise HTTPException(400, "Add your Claude subscription first (the token from `claude setup-token`).")
    S.set_setting(db, "onboarding_ai", {"provider": pid, **({"model": body.model.strip()} if body.model and body.model.strip() else {})}, actor=user.id)
    db.commit()
    try:
        await I.check(I.ai_config(db))
    except I.AiError as e:
        raise HTTPException(400, str(e)) from e
    return _onb_ai_view(db)


def _draft(db: Session) -> dict:
    d = dict(S.get_setting(db, "onboarding_draft", None) or {})
    d.setdefault("answers", OB.default_answers(S.get_setting(db, "company_name", "")))
    d.setdefault("interview", {"history": [], "topic": "business"})
    return d


class InterviewIn(BaseModel):
    message: str = ""
    restart: bool = False
    file_ids: list[str] | None = None
    website: str | None = None


def _save_interview_turn(db: Session, user: User, d: dict, hist: list[dict], r: dict) -> dict:
    """Persist one interview turn (AI reply) to the draft and return the full response dict."""
    from .. import interview as _I

    answers = {**d["answers"], **r["patch"]}
    hist.append({"role": "ai", "text": r["reply"], "options": r.get("options") or [], **({"field": r.get("field")} if r.get("field") else {}),
                 **({"multi": True} if r.get("multi") else {}), **({"saved": sorted(r["patch"])} if r.get("patch") else {})})
    d.update(answers=answers, interview={"history": hist[-80:], "topic": r["topic"]})
    S.set_setting(db, "onboarding_draft", d, actor=user.id)
    if str(answers.get("company_name") or "").strip():
        S.set_setting(db, "company_name", answers["company_name"].strip(), actor=user.id)
    db.commit()
    return {"history": hist, "topic": r["topic"], "answers": answers, "coverage": _I.coverage(answers), "ai": _onb_ai_view(db)}


@router.post("/onboarding/interview")
async def onboarding_interview(body: InterviewIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """One exchange of the onboarding interview. An empty message (at the start) gets the first question."""
    from .. import interview as I

    d = _draft(db)
    iv = d["interview"] if not body.restart else {"history": [], "topic": "business"}
    hist = list(iv.get("history") or [])
    if body.message.strip():
        hist.append({"role": "owner", "text": body.message.strip()[:4000]})
    elif hist and hist[-1]["role"] == "ai":  # reopened the page: show where we were
        return {"history": hist, "topic": iv.get("topic"), "answers": d["answers"], "coverage": I.coverage(d["answers"]), "ai": _onb_ai_view(db)}
    try:
        r = await I.turn(I.ai_config(db), d["answers"], hist, iv.get("topic") or "business",
                         file_ids=body.file_ids, website=body.website)
    except I.AiError as e:
        raise HTTPException(502, str(e)) from e
    return _save_interview_turn(db, user, d, hist, r)


@router.post("/onboarding/interview/stream")
async def onboarding_interview_stream(body: InterviewIn, request: Request,
                                      db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Streaming interview turn — SSE.

    Body: {message, file_ids?, website?, restart?}

    Events:
      event: tool  data: {"label": str}   — activity (reading file/website, saving profile)
      event: text  data: {"delta": str}   — streamed reply chunk
      event: done  data: {"reply", "options", "topic", "answers", "coverage", "ai"}
      event: error data: {"message": str}
    """
    from fastapi.responses import StreamingResponse

    from .. import interview as I

    d = _draft(db)
    iv = d["interview"] if not body.restart else {"history": [], "topic": "business"}
    hist = list(iv.get("history") or [])
    if body.message.strip():
        hist.append({"role": "owner", "text": body.message.strip()[:4000]})
    elif hist and hist[-1]["role"] == "ai":
        # Reopened: return current state as a single done event
        state = {"history": hist, "topic": iv.get("topic"), "answers": d["answers"],
                 "coverage": I.coverage(d["answers"]), "ai": _onb_ai_view(db)}

        async def _replay():
            yield f"event: done\ndata: {json.dumps(state)}\n\n"

        return StreamingResponse(_replay(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    cfg = I.ai_config(db)

    async def gen():
        final_patch: dict = {}
        final_topic = iv.get("topic") or "business"
        final_reply = ""
        final_options: list = []
        try:
            async for ev in I.stream_turn(cfg, d["answers"], hist, iv.get("topic") or "business",
                                          file_ids=body.file_ids, website=body.website):
                event_name = ev["event"]
                data = ev["data"]
                if event_name == "done":
                    final_patch = data.get("patch") or {}
                    final_topic = data.get("topic") or final_topic
                    final_reply = data.get("reply") or ""
                    final_options = data.get("options") or []
                    # Persist the turn
                    result = {"reply": final_reply, "patch": final_patch, "options": final_options,
                              "topic": final_topic}
                    saved = _save_interview_turn(db, user, d, hist, result)
                    done_data = {**saved}
                    yield f"event: done\ndata: {json.dumps(done_data)}\n\n"
                else:
                    yield f"event: {event_name}\ndata: {json.dumps(data)}\n\n"
        except I.AiError as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)})}\n\n"
        except Exception as e:  # noqa: BLE001
            yield f"event: error\ndata: {json.dumps({'message': f'Unexpected error: {str(e)[:200]}'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/onboarding/team-plan")
async def onboarding_team_plan(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The helpers that fit what the interview found."""
    from .. import interview as I

    d = _draft(db)
    plan = await I.plan_team(I.ai_config(db), d["answers"])
    d["team"] = plan["helpers"]
    S.set_setting(db, "onboarding_draft", d, actor=user.id)
    db.commit()
    return {**plan, "roles": I.role_cards()}


@router.post("/onboarding/preview")
def onboarding_preview(body: AnswersIn, user: User = Depends(current_user)):
    return {"files": OB.render(body.answers), "completeness": OB.completeness(body.answers),
            "recommended": OB.recommend(body.answers)}


class HelperPlanIn(BaseModel):
    id: str
    base: str
    name: str
    focus: str = ""


class FinishIn(BaseModel):
    answers: dict | None = None  # default: what the interview gathered
    roles: list[str] = Field(default_factory=list)
    helpers: list[HelperPlanIn] | None = None  # the team from the interview (base role, name, focus); wins over roles
    engine: dict | None = None  # default: the AI picked in onboarding
    approval_mode: str = "ask_all"
    timezone: str | None = None
    max_concurrent_tasks: int | None = Field(None, ge=1, le=100)
    practice_task: bool = True
    api_key: str | None = None  # Claude key, when engine.type == "claude"


def _engine_from_onboarding(db: Session) -> tuple[str, dict]:
    """The helpers' engine from the AI picked in step 1: a Claude key runs helpers in Claude Code when it's installed
    (files, commands, browser), else straight on the Claude API."""
    from .. import harness as H

    pick = (S.get_setting(db, "onboarding_ai", None) or {})
    pid = pick.get("provider") or "fake"
    if pid in ("claude", "anthropic"):
        pid = "claude" if H.find_cli() else "claude-direct"
        _need_claude_key(db)
    elif pid in _LITELLM_PROVIDER_IDS:
        _need_vendor_key(db, pid)
    elif pid not in ("claude-code", "local", "fake"):
        pid = "fake"
    return pid, _engine_for(pid, pick.get("model"), None)


def _create_planned(db: Session, user: User, helpers: list[HelperPlanIn], engine: dict) -> list[str]:
    """The Chief of Staff plus the planned helpers: each from its base role, with its own name and focus."""
    from .. import interview as I

    company = S.get_setting(db, "company_name", "") or "the company"
    created = []
    if not S.chief(db):
        created += _create_team(db, user, ["chief-of-staff"], engine)[0]
    for h in helpers:
        if not catalog.role(h.base) or catalog.role(h.base).get("is_chief"):
            raise HTTPException(400, f"unknown role {h.base}")
        hid = I._slug(h.id or h.name)
        if db.get(Staff, hid):
            continue
        data = _run(catalog.staff_from_role, h.base, company, engine)
        data.update(id=hid, name=(h.name or data["name"]).strip()[:60], is_chief=False)
        if h.focus.strip():
            data["job"] = data["job"].rstrip() + f"\n\n## Your focus at {company}\n{h.focus.strip()}"
        st = _run(S.create_staff, db, data, user.id)
        S.rotate_mcp_token(db, st, user.id)
        created.append(st.id)
    return created


def _kickoff(cid: str, ids: list[str]) -> None:
    """In the background after onboarding: every new helper drafts its job and proposes it in its own chat."""
    import asyncio as _a
    import threading

    from .. import company as C
    from .. import interview as I
    from .. import jobs as J
    from ..db import session_scope

    def run():
        try:
            with C.use(cid):
                with session_scope() as db:
                    cfg = I.ai_config(db)
                    answers = (S.get_setting(db, "onboarding_draft", None) or {}).get("answers") or {}
                    plan = {h["id"]: h for h in (S.get_setting(db, "onboarding_draft", None) or {}).get("team") or []}
                    helpers = []
                    for sid in ids:
                        st = db.get(Staff, sid)
                        if st:
                            p = plan.get(sid) or {}
                            helpers.append({"id": st.id, "name": st.name, "base": st.role or st.id, "focus": p.get("focus", ""), "is_chief": st.is_chief})
                drafts = _a.run(I.draft_jobs(cfg, answers, helpers))
                with session_scope() as db:
                    for h in helpers:
                        st = db.get(Staff, h["id"])
                        if st and drafts.get(h["id"]):
                            J.propose(db, st, drafts[h["id"]], intro=(
                                f"Hi! I'm {st.name}. Before I start, here's how I understand my job at "
                                f"{S.get_setting(db, 'company_name', '') or 'your company'}. Approve it, or tell me what to change."))
                    S.alert(db, "Your helpers proposed their jobs", "Each helper wrote to you in its chat with how it sees its job, "
                            "goals and first moves. Approve them, or reply to change anything.", None, None, level="decision")
        except Exception:  # noqa: BLE001 - onboarding is done either way; the helpers can still be briefed in chat
            import logging

            logging.getLogger("omilo").exception("onboarding kickoff failed")

    threading.Thread(target=run, daemon=True, name="omilo-kickoff").start()


@router.post("/onboarding/finish")
def onboarding_finish(body: FinishIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import company as C

    d = _draft(db)
    a = body.answers or d["answers"]
    company = str(a.get("company_name") or "").strip()
    if not company:
        raise HTTPException(400, "your business needs a name")
    modes = OB.options()["approval_modes"]
    if body.approval_mode not in modes:
        raise HTTPException(400, "unknown approval mode")
    S.set_setting(db, "company_name", company, actor=user.id)
    if body.timezone:
        _set_timezone(db, body.timezone, user.id)
    for name, content in OB.render(a).items():
        _run(S.write_knowledge, db, name, content, user.id)
    _strict = bool(modes[body.approval_mode]["strict"])
    S.set_setting(db, "strict_mode", _strict, actor=user.id)
    S.set_setting(db, "autonomy_mode", "strict" if _strict else "permissive", actor=user.id)
    if body.engine:  # the older form: an explicit engine
        engine = dict(body.engine)
        # For claude-code engines, auth distinguishes the sub-provider; use _provider_of for correct round-trip.
        if engine.get("type") == "claude-code":
            provider = _provider_of(engine)  # "claude" | "claude-code" | "local"
        else:
            provider = {"claude": "claude", "claude-direct": "claude-direct"}.get(engine.get("type", ""), "fake")
        if provider in ("claude", "claude-direct"):
            if body.api_key and body.api_key.strip():
                S.set_ai_key(db, "claude", body.api_key, user.id)
            _need_claude_key(db)
        engine = _engine_for(provider, engine.get("model"), engine.get("base_url"))
    else:
        provider, engine = _engine_from_onboarding(db)
    if body.helpers is not None:
        created = _create_planned(db, user, body.helpers, engine)
    else:
        created, _tokens = _create_team(db, user, list(dict.fromkeys(["chief-of-staff", *body.roles])), engine)
    S.set_setting(db, "ai_provider", provider, actor=user.id)
    if provider not in ("fake",):
        S.set_setting(db, "max_concurrent_tasks", body.max_concurrent_tasks or min(8, max(2, len(created))), actor=user.id)
    d.update(answers=a, step=0)
    S.set_setting(db, "onboarding_draft", d, actor=user.id)
    S.set_setting(db, "onboarded", True, actor=user.id)
    S.seed_relations(db)
    practice = None
    if body.practice_task:
        who = next((r for r in ("grower", "marketing") if db.get(Staff, r)), "chief-of-staff")
        t = S.create_task(db, who, "manual", f"Practice task: draft a short post that introduces {company} to new customers, "
                          "in our voice, using only facts from the company files. Propose it for approval.", user.id)
        practice = {"task_id": t.id, "staff_id": who}
    if body.helpers is not None:
        _kickoff(C.current(), created)
    return {"created": created, "mcp_tokens": {},
            "mcp_url": get_settings().mcp_url(), "practice": practice, "engine": provider}


class JobDecideIn(BaseModel):
    decision: str = "approve"


@router.post("/messages/{mid}/job")
def job_decide(mid: str, body: JobDecideIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Approve a helper's job proposal (the card in its chat)."""
    from .. import jobs as J
    from ..models import Message

    m = _404(db.get(Message, mid))
    return _run(J.decide, db, m, body.decision, user.id)


@router.get("/kpis")
def kpis(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return S.latest_kpis(db)


# ------------------------------------------------------------------ audit & import
class ImportIn(BaseModel):
    files: dict[str, str]


@router.post("/import/prototype")
def import_v0(body: ImportIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return import_prototype(db, body.files, user.id)


# ------------------------------------------------------------------ notifications: live stream and Web Push
@router.get("/stream")
async def stream(request: Request, after: int | None = None):
    """Server-sent events: one `notice` event per new Notice. Also marks the owner as present, so Web Push stays quiet.
    Auth is checked with a short session of its own, so an open tab does not hold a database connection."""
    import asyncio as _a

    from fastapi.responses import StreamingResponse

    from .. import notify as N
    from ..db import session_scope
    from ..models import Notice

    def poll(last: int) -> tuple[int, list[dict]]:
        with session_scope() as db:
            N.mark_present(db, uid)
            rows = list(db.scalars(select(Notice).where(Notice.id > last).order_by(Notice.id).limit(50)))
            return (rows[-1].id if rows else last), [N.serialize(n) for n in rows]

    with session_scope() as db:
        uid = current_user(request, db).id
        hdr = request.headers.get("last-event-id")
        last = int(hdr) if hdr and hdr.isdigit() else after if after is not None else N.latest_id(db)

    async def gen():
        nonlocal last
        yield f"retry: 3000\nevent: hello\ndata: {json.dumps({'last': last})}\n\n"
        beat = 0
        while not await request.is_disconnected():
            last, rows = await _a.to_thread(poll, last)
            for n in rows:
                yield f"id: {n['id']}\nevent: notice\ndata: {json.dumps(n)}\n\n"
            beat += 1
            if beat % 15 == 0:
                yield ": ping\n\n"
            await _a.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/notices")
def notices(after: int = 0, limit: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import notify as N
    from ..models import Notice

    q = select(Notice).where(Notice.id > after).order_by(Notice.id.desc()).limit(min(limit, 100))
    return [N.serialize(n) for n in db.scalars(q)]


@router.get("/notify")
def notify_config(db: Session = Depends(get_db), adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    from .. import notify as N
    from ..models import PushSub

    p = N.prefs(db, user.id)
    return {"kinds": N.KINDS, "channels": N.CHANNELS, "prefs": p, **N.status(db, p), "timezone": S.timezone_name(db),
            "push": N.push_available(), "vapid_public_key": N.vapid_public_key(),
            "devices": [{"id": s.id, "agent": s.agent, "created_at": X.iso(s.created_at), "last_ok_at": X.iso(s.last_ok_at)}
                        for s in adb.scalars(select(PushSub).where(PushSub.user_id == user.id))]}


@router.put("/notify/prefs")
def notify_prefs(body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import notify as N

    try:
        p = N.set_prefs(db, user.id, body)
    except (ValueError, TypeError) as e:
        raise HTTPException(400, str(e)) from e
    if "focus" in body:
        S.audit(db, user.id, "notify.focus", str(body["focus"]))
        db.commit()
    return {**p, **N.status(db, p)}


class SeenIn(BaseModel):
    item_ids: list[str] = Field(default_factory=list, max_length=200)


@router.post("/notify/seen")
def notify_seen(body: SeenIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The owner looked at these inbox items (acknowledges Critical ones, so their reminders stop)."""
    from .. import nudge

    return {"seen": nudge.seen(db, body.item_ids, user.id)}


class ActIn(BaseModel):
    item_id: str
    action: str  # open | snooze | approve
    sig: str


@router.post("/notify/act")
def notify_act(body: ActIn, request: Request, db: Session = Depends(get_db), adb: Session = Depends(get_auth_db),
               user: User = Depends(current_user)):
    """A button pressed on a notification (the service worker calls this with the browser's session).
    Approve works only for low-risk proposals and only with a sign-in from the last 12 hours; otherwise the answer is
    401 with login_required, and the notification opens the sign-in page first."""
    from .. import company as C
    from .. import notify as N
    from .. import nudge
    from ..models import AuthToken
    from ..security import COOKIE, _bearer, sha256

    if not N.check_sig(C.current(), body.item_id, body.sig):
        raise HTTPException(403, "bad signature")
    item = _404(db.get(InboxItem, body.item_id))
    if body.action == "open":
        nudge.seen(db, [item.id], user.id, action="opened")
        return {"ok": True, "url": N.item_url(item.id)}
    if body.action == "snooze":
        if item.status == "open":
            _run(nudge.snooze, db, item, user.id, 1)
        return {"ok": True}
    if body.action != "approve":
        raise HTTPException(400, "action must be open, snooze or approve")
    raw = _bearer(request) or request.cookies.get(COOKIE)  # the credential this request was signed in with
    tok = adb.scalar(select(AuthToken).where(AuthToken.token_hash == sha256(raw))) if raw else None
    created = tok.created_at.replace(tzinfo=tok.created_at.tzinfo or dt.UTC) if tok else None
    if not tok or tok.kind != "session" or created < now() - dt.timedelta(hours=12):
        raise HTTPException(401, "login_required")
    if item.status != "open":
        raise HTTPException(409, "already decided")
    if not N.one_tap_ok(db, item.id):
        raise HTTPException(409, "open it to decide: only low-risk proposals can be approved from a notification")
    p = _404(db.get(Proposal, item.ref_id))
    _run(S.decide_proposal, db, p, "approve", "", user.id)
    nudge.record(db, item, "owner", "approved", user.id)
    S.audit(db, user.id, "proposal.approve_from_notification", p.id)
    db.commit()
    return {"ok": True, "approved": p.id}


class PushSubIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: dict
    agent: str = ""


@router.post("/notify/subscribe")
def notify_subscribe(body: PushSubIn, db: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    from ..models import PushSub

    if not body.endpoint.startswith("https://") or not {"p256dh", "auth"} <= set(body.keys):
        raise HTTPException(400, "not a Web Push subscription")
    for old in db.scalars(select(PushSub).where(PushSub.endpoint == body.endpoint)):
        db.delete(old)
    s = PushSub(user_id=user.id, endpoint=body.endpoint, keys={"p256dh": body.keys["p256dh"], "auth": body.keys["auth"]}, agent=body.agent[:200])
    db.add(s)
    S.audit(db, user.id, "notify.subscribe", s.id)
    db.commit()
    return {"id": s.id}


@router.post("/notify/unsubscribe")
def notify_unsubscribe(body: dict, db: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    from ..models import PushSub

    for s in db.scalars(select(PushSub).where(PushSub.user_id == user.id, PushSub.endpoint == str(body.get("endpoint", "")))):
        db.delete(s)
    db.commit()
    return {"ok": True}


@router.post("/notify/test")
def notify_test(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Notice

    db.add(Notice(kind="test", title="Notifications work", body="This is how Omilo will tell you when a helper needs you.", url="/settings/", tag="test"))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ helper avatars (their look; drawn by the web app)
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_PROPS = {"crown", "glasses", "headset", "megaphone", "tie", "coin", "gear", "antenna", "sprout", "beret", "magnifier", "none"}


def _looks(db) -> dict:
    from ..models import Setting

    return {s.key.split(":", 1)[1]: s.value for s in db.scalars(select(Setting).where(Setting.key.like("avatar:%"))) if s.value}


@router.get("/avatars")
def avatars(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return _looks(db)


@router.put("/staff/{sid}/avatar")
def set_avatar(sid: str, body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Change a helper's look: colour (#rrggbb), shape (blob, box, bean), prop, or an uploaded picture (file id). {} resets."""
    from .. import capabilities as C
    from ..models import Setting

    _404(db.get(Staff, sid), "unknown staff")
    look: dict = {}
    if body.get("color"):
        if not _HEX.match(str(body["color"])):
            raise HTTPException(400, "color must look like #4f46e5")
        look["color"] = body["color"]
    if body.get("shape"):
        if body["shape"] not in ("blob", "box", "bean"):
            raise HTTPException(400, "shape is blob, box or bean")
        look["shape"] = body["shape"]
    if body.get("prop"):
        if body["prop"] not in _PROPS:
            raise HTTPException(400, "unknown prop")
        look["prop"] = body["prop"]
    if body.get("image"):
        p = C.file_path(str(body["image"]))
        if not p or not (C.mimetypes.guess_type(p.name)[0] or "").startswith("image/") or p.suffix.lower() == ".svg":
            raise HTTPException(400, "the picture must be an uploaded PNG, JPEG, GIF or WebP")
        look["image"] = body["image"]
    key = f"avatar:{sid}"
    s = db.get(Setting, key)
    if look:
        if s:
            s.value = look
        else:
            db.add(Setting(key=key, value=look))
    elif s:
        db.delete(s)
    S.audit(db, user.id, "staff.avatar", sid)
    db.commit()
    return _looks(db)


@router.get("/monitor")
def monitor(range: str = "7d", db: Session = Depends(get_db), user: User = Depends(current_user)):  # noqa: A002
    """Everything for the Monitor page over one time range (24h, 7d or 30d)."""
    from .. import monitor as M

    return M.build(db, range)


@router.get("/board")
def inbox_board(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The Inbox board: needs you, running, done (last 48 hours)."""
    from .. import board as B
    from .. import notify as N

    return B.build(db, prefs=N.prefs(db, user.id))


@router.get("/board/stream")
async def board_stream(request: Request):
    """Server-sent events: emits a 'tick' whenever the office bus fires for this company.
    The web board refetches /api/board on each tick — no more poll-only.
    Auth uses the same cookie/bearer as /api/stream. Subscribes to ch:office (light tier
    in-process queue or Redis pubsub) exactly like the office WebSocket."""
    import asyncio as _a

    from fastapi.responses import StreamingResponse

    from .. import bus
    from .. import company as C
    from ..db import session_scope

    with session_scope() as db:
        current_user(request, db)  # raises 401 if not authenticated

    cid = C.current()
    HEARTBEAT_S = 30
    FALLBACK_S = 5

    async def gen():
        yield "retry: 3000\nevent: hello\ndata: {}\n\n"

        if bus._light():
            q = bus.subscribe(cid, ["ch:office"])
            try:
                while not await request.is_disconnected():
                    try:
                        await _a.wait_for(q.get(), timeout=HEARTBEAT_S)
                        yield "event: tick\ndata: {}\n\n"
                    except TimeoutError:
                        yield ": ping\n\n"
            finally:
                bus.unsubscribe(q)
            return

        # Full tier: Redis pubsub
        try:
            ps = bus.ar().pubsub()
            await ps.subscribe(bus.key("ch:office", cid))
            beat = 0
            while not await request.is_disconnected():
                msg = await _a.wait_for(ps.get_message(ignore_subscribe_messages=True), timeout=FALLBACK_S)
                if msg and msg.get("type") == "message":
                    yield "event: tick\ndata: {}\n\n"
                else:
                    beat += 1
                    if beat % (HEARTBEAT_S // FALLBACK_S) == 0:
                        yield ": ping\n\n"
        except Exception:  # noqa: BLE001 – stream closes gracefully
            pass

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/digest")
def digest_get(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import digest as D

    return {"enabled": D.enabled(db), "last_sent": D.last_sent(db), "send_hour": D.SEND_HOUR, "preview": D.compose(db)}


@router.put("/digest")
def digest_set(body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import digest as D

    S.set_setting(db, "digest_enabled", bool(body.get("enabled")), actor=user.id)
    return {"enabled": D.enabled(db)}


@router.post("/digest/send")
def digest_send(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import digest as D

    return {"thread_id": _run(D.send, db)}


# ------------------------------------------------------------------ Docs: the shared notebook (Obsidian-style vault)
def _docs(fn, *a, **kw):
    from .. import docs as D

    try:
        return fn(*a, **kw)
    except D.DocError as e:
        if e.code == 409 and e.extra.get("current"):
            raise HTTPException(409, {"message": str(e), "current": e.extra["current"]}) from e
        raise HTTPException(e.code, str(e)) from e


class DocWrite(BaseModel):
    path: str = Field(min_length=1, max_length=400)
    content: str = Field(max_length=2_000_000)
    base_version: int | None = None
    summary: str = ""


class DocMove(BaseModel):
    path: str
    to: str


@router.get("/vault")
def docs_tree(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return {"docs": D.tree(db), "vault": str(D.vault_dir()), **D.stats(db)}


@router.get("/vault/read")
def docs_read(path: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return _docs(D.read, db, path)


@router.put("/vault/write")
def docs_write(body: DocWrite, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return _docs(D.write, db, body.path, body.content, author=user.id, author_kind="owner", base_version=body.base_version, summary=body.summary)


@router.post("/vault/move")
def docs_move(body: DocMove, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return _docs(D.move, db, body.path, body.to, author=user.id, author_kind="owner")


@router.post("/vault/delete")
def docs_delete(body: dict, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return _docs(D.delete, db, str(body.get("path") or ""), author=user.id)


@router.get("/vault/history")
def docs_history(path: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return _docs(D.history, db, path)


@router.get("/vault/version")
def docs_version(path: str, version: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return {"content": _docs(D.version_content, db, path, version)}


@router.get("/vault/search")
def docs_search(q: str = "", db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return D.search(db, q, 30)


@router.get("/vault/graph")
def docs_graph(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    return D.graph(db)


# ------------------------------------------------------------------ loops: scorecard, self-improvement, memory
@router.get("/loops")
def loops_scorecard(days: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import loops as L

    return {"days": days, "loops": L.scorecard(db, days=max(1, min(days, 365)))}


@router.get("/improvements")
def improvements(limit: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import loops as L
    from ..models import Improvement

    rows = db.scalars(select(Improvement).order_by(Improvement.created_at.desc()).limit(min(limit, 200)))
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    shifts = {sh.id: sh.name for sh in db.scalars(select(Shift))}
    return [{**L.serialize(i), "staff": names.get(i.staff_id, i.staff_id), "by_name": names.get(i.by, "You" if i.by == "owner" else i.by),
             "shift": shifts.get(i.ref)} for i in rows]


@router.post("/improvements/{iid}/undo")
def improvement_undo(iid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import loops as L
    from ..models import Improvement

    imp = _404(db.get(Improvement, iid), "unknown change")
    try:
        L.undo(db, imp, by=user.id)
    except L.LoopError as e:
        raise HTTPException(e.code, str(e)) from e
    S.audit(db, user.id, "improvement.undo", iid)
    db.commit()
    return L.serialize(imp)


@router.post("/loops/retro")
def run_retro_now(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Start the weekly retro now (the Chief of Staff reviews every loop and improves what isn't working)."""
    from .. import loops as L

    L.ensure_retro(db)
    c = S.chief(db)
    if not c:
        raise HTTPException(400, "there is no Chief of Staff to run the retro")
    sh = next(s for s in c.shifts if s.name in ("weekly-retro", "Weekly retro"))
    t = S.create_task(db, c.id, "shift", sh.brief, user.id)
    t.shift_id = sh.id
    db.commit()
    return {"task_id": t.id}



# ------------------------------------------------------------------ the plan: goals → work → sub-work
@router.get("/plan")
def plan_tree(days: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import plan as P

    return P.tree(db, days=max(1, min(days, 365)))


class GoalIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    target: str | None = Field(default=None, max_length=2000)
    due: str | None = Field(default=None, max_length=32)
    status: str | None = None
    position: int | None = None
    shift_ids: list[str] | None = None  # regular jobs that serve this goal


class ChannelIn(BaseModel):
    name: str = Field(max_length=120)
    emoji: str | None = Field(default=None, max_length=16)
    member_ids: list[str] | None = None   # staff in this channel
    goal_ids: list[str] | None = None      # goals this channel is a home for


class GoalChannelIn(BaseModel):
    channel_id: str | None = None   # null to remove the goal from its channel


def _goal_apply(db: Session, g, body: GoalIn) -> None:
    from ..models import ShiftGoal

    for k in ("title", "target", "due", "position"):
        v = getattr(body, k)
        if v is not None:
            setattr(g, k, v.strip() if isinstance(v, str) else v)
    if body.status is not None:
        if body.status not in ("active", "done", "dropped"):
            raise HTTPException(400, "status is active, done or dropped")
        g.status = body.status
    if body.shift_ids is not None:
        db.flush()
        for sg in db.scalars(select(ShiftGoal).where(ShiftGoal.goal_id == g.id)):
            if sg.shift_id not in body.shift_ids:
                db.delete(sg)
        for sid in body.shift_ids:
            if not db.get(Shift, sid):
                raise HTTPException(400, f"unknown regular job {sid}")
            sg = db.get(ShiftGoal, sid)
            if sg:
                sg.goal_id = g.id
            else:
                db.add(ShiftGoal(shift_id=sid, goal_id=g.id))


@router.get("/goals")
def goals_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Active goals for the @-mention picker: lightweight id + title, ordered by position."""
    from ..models import Goal

    goals = db.scalars(select(Goal).where(Goal.status == "active").order_by(Goal.position))
    return [{"id": g.id, "title": g.title} for g in goals]


@router.post("/goals")
def goal_create(body: GoalIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Goal
    from ..plan import start_planning

    if not (body.title or "").strip():
        raise HTTPException(400, "give the goal a title")
    g = Goal(title=body.title.strip(), created_by=user.id,
             position=(db.scalar(select(func.max(Goal.position))) or 0) + 1)
    db.add(g)
    _goal_apply(db, g, body)
    S.audit(db, user.id, "goal.create", g.id, title=g.title)
    db.commit()
    start_planning(db, g.id)
    return {"id": g.id}


@router.get("/channels")
def channels_list(db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Chat-mode channels with their members + goals, plus goals not yet in a channel."""
    return S.list_channels(db)


@router.post("/channels")
def channel_create(body: ChannelIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        ch = S.create_channel(db, body.name, emoji=body.emoji or "",
                              member_ids=body.member_ids, goal_ids=body.goal_ids, actor=user.id)
    except S.DomainError as e:
        raise HTTPException(e.code, str(e)) from e
    return {"id": ch.id}


@router.patch("/goals/{gid}/channel")
def goal_set_channel(gid: str, body: GoalChannelIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        S.assign_goal_channel(db, gid, body.channel_id, actor=user.id)
    except S.DomainError as e:
        raise HTTPException(e.code, str(e)) from e
    return {"ok": True}


@router.patch("/goals/{gid}")
def goal_update(gid: str, body: GoalIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Goal

    g = _404(db.get(Goal, gid), "unknown goal")
    _goal_apply(db, g, body)
    S.audit(db, user.id, "goal.update", gid)
    db.commit()
    return {"id": g.id}


@router.delete("/goals/{gid}")
def goal_delete(gid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import Goal, ShiftGoal, TaskGoal

    g = _404(db.get(Goal, gid), "unknown goal")
    for o in list(db.scalars(select(TaskGoal).where(TaskGoal.goal_id == gid))) + list(db.scalars(select(ShiftGoal).where(ShiftGoal.goal_id == gid))):
        db.delete(o)
    db.delete(g)
    S.audit(db, user.id, "goal.delete", gid)
    db.commit()
    return {"ok": True}


class TaskGoalIn(BaseModel):
    goal_id: str | None = None


@router.put("/tasks/{tid}/goal")
def task_goal(tid: str, body: TaskGoalIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Put a job (and so its sub-jobs) under a goal, or take it out."""
    from ..models import Goal, TaskGoal

    _404(db.get(Task, tid))
    tg = db.get(TaskGoal, tid)
    if body.goal_id:
        _404(db.get(Goal, body.goal_id), "unknown goal")
        if tg:
            tg.goal_id = body.goal_id
        else:
            db.add(TaskGoal(task_id=tid, goal_id=body.goal_id))
    elif tg:
        db.delete(tg)
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ previews of pages helpers visited (Browser panel)
@router.get("/browser/preview")
async def browser_preview(url: str, user: User = Depends(current_user)):
    from .. import browser_preview as BP

    try:
        return await BP.meta(url)
    except BP.PreviewError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/browser/shot")
async def browser_shot(url: str, fresh: bool = False, user: User = Depends(current_user)):
    from fastapi.responses import FileResponse

    from .. import browser_preview as BP

    try:
        f = await BP.screenshot(url, fresh=fresh)
    except BP.PreviewError as e:
        raise HTTPException(422, str(e)) from e
    return FileResponse(f, media_type="image/png", headers={"Cache-Control": "private, max-age=600"})


# ------------------------------------------------------------------ KPIs: definitions, values, asking for an update
@router.get("/kpis/board")
def kpi_board(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import kpis as K

    return K.board(db)


class KpiDefIn(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    unit: str | None = Field(default=None, max_length=24)
    target: float | None = None
    clear_target: bool = False
    direction: str | None = None
    goal_id: str | None = None
    owner: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    position: int | None = None


@router.put("/kpis/defs/{name}")
def kpi_define(name: str, body: KpiDefIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import kpis as K
    from ..models import Goal, KpiDef

    try:
        k = K.key(name)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    d = db.get(KpiDef, k)
    if not d:
        d = KpiDef(name=k, position=(db.scalar(select(func.max(KpiDef.position))) or 0) + 1)
        db.add(d)
    for f in ("label", "unit", "note", "position"):
        v = getattr(body, f)
        if v is not None:
            setattr(d, f, v.strip() if isinstance(v, str) else v)
    if body.target is not None:
        d.target = body.target
    if body.clear_target:
        d.target = None
    if body.direction is not None:
        if body.direction not in ("up", "down"):
            raise HTTPException(400, "direction is up (higher is better) or down (lower is better)")
        d.direction = body.direction
    if body.goal_id is not None:
        if body.goal_id and not db.get(Goal, body.goal_id):
            raise HTTPException(400, "unknown goal")
        d.goal_id = body.goal_id or None
    if body.owner is not None:
        if body.owner and not db.get(Staff, body.owner):
            raise HTTPException(400, "unknown helper")
        d.owner = body.owner
    S.audit(db, user.id, "kpi.define", k)
    db.commit()
    return {"name": k}


@router.delete("/kpis/defs/{name}")
def kpi_undefine(name: str, values: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import KpiDef, KpiValue

    d = db.get(KpiDef, name)
    if d:
        db.delete(d)
    if values:
        for v in db.scalars(select(KpiValue).where(KpiValue.name == name)):
            db.delete(v)
    S.audit(db, user.id, "kpi.delete", name, values=values)
    db.commit()
    return {"ok": True}


class KpiValueIn(BaseModel):
    name: str
    value: float
    period: str = Field(default="", max_length=32)
    source: str = Field(default="", max_length=500)


@router.post("/kpis/values")
def kpi_record(body: KpiValueIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import kpis as K
    from ..models import KpiValue

    try:
        k = K.key(body.name)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    v = KpiValue(name=k, value=body.value, period=body.period.strip(), source=body.source.strip() or "entered by you", staff_id="owner")
    db.add(v)
    S.audit(db, user.id, "kpi.write", k, value=body.value, period=body.period)
    db.commit()
    return {"id": v.id}


@router.delete("/kpis/values/{vid}")
def kpi_value_delete(vid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..models import KpiValue

    v = _404(db.get(KpiValue, vid), "unknown value")
    db.delete(v)
    S.audit(db, user.id, "kpi.value.delete", vid, name=v.name)
    db.commit()
    return {"ok": True}


@router.post("/kpis/{name}/ask")
def kpi_ask(name: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Ask the helper who keeps this KPI (else Finance, else the Chief) to find the current number, with its source."""
    from .. import kpis as K
    from ..models import KpiDef

    d = db.get(KpiDef, name)
    row = next((r for r in K.board(db, history=1) if r["name"] == name), None)
    if not row:
        raise HTTPException(404, "unknown KPI")
    who = (d.owner if d and d.owner and db.get(Staff, d.owner) else None) or ("finance" if db.get(Staff, "finance") else None) or (S.chief(db).id if S.chief(db) else None)
    if not who:
        raise HTTPException(400, "no helper to ask")
    tgt = f" Target: {row['target']:g}{(' ' + row['unit']) if row['unit'] else ''}." if row["target"] is not None else ""
    brief = (f"Update the KPI “{row['label']}” (name: {name}). Find the current number from a real source, record it with "
             f"update_kpi(name=\"{name}\", value=…, period=…, source=…), and say in your report what changed and why.{tgt}"
             + (f"\nWhat it means: {row['note']}" if row["note"] else ""))
    t = S.create_task(db, who, "manual", brief, user.id, goal_id=row["goal_id"])
    return {"task_id": t.id, "staff_id": who}

# ------------------------------------------------------------------ /ask (⌘K)

class AskIn(BaseModel):
    q: str = Field(min_length=1, max_length=2000)

    @field_validator("q", mode="before")
    @classmethod
    def strip_and_reject_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("q must not be blank")
        return v


@router.post("/ask")
async def ask(body: AskIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Synchronous grounded answer: retrieve sources then ask the engine. Returns answer + sources."""
    S.audit(db, user.id, "ask", "", q=body.q)
    db.commit()
    try:
        return await ask_mod.answer(db, body.q)
    except ask_mod.NoEngineError:
        raise HTTPException(503, "AI is unavailable") from None
