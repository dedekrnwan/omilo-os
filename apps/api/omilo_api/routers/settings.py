"""Settings support: the activity log (paged, filtered, exportable), the owner's account and sessions, and what this
install runs on (database, Redis, data folder)."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .. import serialize as X
from .. import services as S
from ..db import get_auth_db, get_db
from ..models import AuditEvent, AuthToken, Staff, User, now
from ..security import COOKIE, _bearer, current_user, hash_password, sha256, verify_password

router = APIRouter(prefix="/api", tags=["settings"])

# ------------------------------------------------------------------ activity log
CATEGORIES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "settings": ("Settings", "ri-settings-3-line", ("setting", "company", "import", "ai")),
    "security": ("Sign-in & security", "ri-shield-keyhole-line", ("login", "owner", "token", "password", "session", "notify")),
    "team": ("Team & jobs", "ri-team-line", ("staff", "talent", "task", "shift", "report")),
    "decisions": ("Decisions", "ri-checkbox-circle-line", ("proposal", "question", "inbox", "action")),
    "plan": ("Plan & KPIs", "ri-line-chart-line", ("goal", "kpi", "improvement")),
    "capabilities": ("Capabilities", "ri-plug-line", ("connector", "folder", "skill", "harness")),
    "workflows": ("Workflows", "ri-flow-chart", ("workflow",)),
    "knowledge": ("Knowledge", "ri-database-2-line", ("kb", "knowledge")),
}
PHRASES = {
    "ai.key_set": "saved an AI key", "ai.set": "changed the AI", "setting.set": "changed a setting", "company.create": "created a company",
    "login.failed": "failed to sign in", "owner.create": "created the owner account", "token.revoke": "revoked an access token",
    "password.change": "changed the password", "session.revoke_others": "signed out other devices", "notify.subscribe": "turned on notifications",
    "staff.create": "added a helper", "staff.update": "changed a helper", "staff.retire": "let a helper go", "staff.rehire": "hired a helper back",
    "staff.avatar": "changed a helper's look", "staff.budget_tokens": "changed a token budget", "staff.access": "changed what a helper may use", "skill.share": "shared a skill with the team", "skill.keep_personal": "kept a helper's skill personal", "staff.job_agreed": "approved a helper's job", "budget.company": "changed the company budget", "staff.mcp_token.rotate": "renewed a helper's access key",
    "talent.hire": "hired a specialist", "task.create": "gave a job", "shift.create": "added a regular job", "shift.update": "changed a regular job",
    "shift.delete": "removed a regular job", "shift.fire": "started a regular job", "proposal.revise": "revised a proposal",
    "question.answer": "answered a question", "inbox.dismiss": "dismissed an Inbox item", "inbox.snooze": "snoozed an Inbox item", "chat.create": "started a team chat", "chat.rename": "renamed a team chat",
    "chat.delete": "deleted a team chat", "shift.skip": "skipped one run of a regular job",
    "shift.unskip": "put a skipped run back", "shift.run_now": "ran a regular job now", "inbox.ask_cos": "asked the Chief of Staff about an Inbox item",
    "notify.focus": "changed the focus switch", "proposal.decide_similar": "decided similar proposals together",
    "proposal.approve_from_notification": "approved from a notification",
    "goal.create": "added a goal", "goal.update": "changed a goal", "goal.delete": "removed a goal", "kpi.define": "set up a KPI",
    "kpi.delete": "removed a KPI", "kpi.write": "recorded a KPI value", "kpi.value.delete": "deleted a KPI value", "improvement.undo": "undid an improvement",
    "connector.add": "added a connector", "connector.update": "changed a connector", "connector.remove": "removed a connector",
    "connector.restore": "brought connectors back", "folder.add": "shared a folder", "folder.update": "changed a shared folder",
    "folder.remove": "stopped sharing a folder", "skill.save": "saved a skill", "skill.remove": "removed a skill",
    "harness.account_add": "added a Claude account", "harness.account_update": "changed a Claude account", "harness.account_remove": "removed a Claude account",
    "workflow.create": "created a workflow", "workflow.update": "changed a workflow", "workflow.delete": "deleted a workflow",
    "workflow.activate": "switched on a workflow", "workflow.pause": "paused a workflow", "workflow.reject": "turned down a workflow",
    "workflow.install": "added a workflow from the marketplace", "workflow.build": "asked a helper to build a workflow",
    "workflow.approved": "approved a workflow step", "workflow.rejected": "rejected a workflow step",
    "kb.add": "added knowledge", "kb.delete": "removed knowledge", "kb.reindex": "re-embedded the knowledge base", "knowledge.write": "changed company knowledge",
    "import.prototype": "imported data", "login": "signed in", "report.write": "reported on a job", "proposal.create": "asked for approval",
    "proposal.approve": "approved a proposal", "proposal.reject": "turned down a proposal", "proposal.changes": "asked for changes",
    "proposal.executed": "carried out approved work", "task.done": "marked a job done", "task.failed": "marked a job failed",
    "question.ask": "asked you a question", "action.allowed": "did an allowed action", "action.refused": "was stopped from an action",
}


def category_of(action: str) -> str:
    head = action.split(".", 1)[0]
    return next((k for k, (_, _, pre) in CATEGORIES.items() if head in pre), "other")


def _who(db: Session, adb: Session, actors: set[str]) -> dict[str, dict]:
    ids = {a[6:] if a.startswith("staff:") else a for a in actors}
    staff = {s.id: s.name for s in db.scalars(select(Staff).where(Staff.id.in_(ids)))} if ids else {}
    users = {u.id: (u.name or u.email) for u in adb.scalars(select(User).where(User.id.in_(actors)))} if actors else {}
    out = {}
    for a in actors:
        if a in users:
            out[a] = {"kind": "owner", "name": users[a]}
        elif a.startswith("staff:") and a[6:] in staff:
            out[a] = {"kind": "helper", "id": a[6:], "name": staff[a[6:]]}
        elif a in staff:
            out[a] = {"kind": "helper", "id": a, "name": staff[a]}
        elif a in ("system", "schedule", "omilo", "") or a.startswith("workflow:"):
            out[a] = {"kind": "system", "name": "Omilo" if not a.startswith("workflow:") else "A workflow"}
        else:
            out[a] = {"kind": "other", "name": a}
    return out


def _filtered(q: str, category: str, actor: str, days: int):
    qry = select(AuditEvent)
    if category and category in CATEGORIES:
        pre = CATEGORIES[category][2]
        qry = qry.where(or_(*[AuditEvent.action.like(f"{p}.%") for p in pre], AuditEvent.action.in_(pre)))
    elif category == "other":
        known = [p for c in CATEGORIES.values() for p in c[2]]
        for p in known:
            qry = qry.where(~AuditEvent.action.like(f"{p}.%"))
    if actor == "owner":
        qry = qry.where(AuditEvent.actor.like("usr_%"))
    elif actor == "helpers":
        qry = qry.where(AuditEvent.actor.like("staff:%") | AuditEvent.actor.in_(select(Staff.id)))
    elif actor == "system":
        qry = qry.where(AuditEvent.actor.in_(("system", "schedule", "omilo", "")) | AuditEvent.actor.like("workflow:%"))
    if days:
        qry = qry.where(AuditEvent.at >= now() - dt.timedelta(days=days))
    if q.strip():
        like = f"%{q.strip()}%"
        qry = qry.where(AuditEvent.action.ilike(like) | AuditEvent.ref.ilike(like) | AuditEvent.actor.ilike(like))
    return qry


def _refs(db: Session, rows: list[AuditEvent]) -> dict[str, str | None]:
    """Readable names for the things log lines point at (a job's first line, a workflow's name …)."""
    from ..models import Proposal, Shift, Task, Workflow

    refs = {r.ref for r in rows if r.ref}
    out: dict[str, str | None] = {}

    def pick(prefix, model, attr):
        ids = [x for x in refs if x.startswith(prefix)]
        if ids:
            for o in db.scalars(select(model).where(model.id.in_(ids))):
                v = getattr(o, attr) or ""
                out[o.id] = (v.strip().splitlines() or [""])[0][:80]
    pick("tsk_", Task, "brief")
    pick("sh_", Shift, "name")
    pick("prp_", Proposal, "title")
    pick("wf_", Workflow, "name")
    staff = {s.id: s.name for s in db.scalars(select(Staff).where(Staff.id.in_(refs)))} if refs else {}
    out.update(staff)
    for x in refs:
        if x.startswith("usr_"):
            out[x] = None  # the owner's id says nothing
    return out


def _row(a: AuditEvent, who: dict, refs: dict | None = None) -> dict:
    cat = category_of(a.action)
    detail = a.detail or {}
    return {"id": a.id, "at": X.iso(a.at), "actor": a.actor, "who": who.get(a.actor, {"kind": "other", "name": a.actor}),
            "action": a.action, "what": PHRASES.get(a.action, a.action.replace(".", " ").replace("_", " ")),
            "category": cat, "category_label": CATEGORIES.get(cat, ("Other",))[0], "ref": a.ref,
            "ref_label": (refs or {}).get(a.ref, a.ref) if a.ref else None, "detail": detail}


@router.get("/audit")
def audit_log(q: str = "", category: str = "", actor: str = "", days: int = 0, page: int = 1, per_page: int = 25,
              db: Session = Depends(get_db), adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    per_page = max(5, min(per_page, 100))
    page = max(1, page)
    qry = _filtered(q, category, actor, days)
    total = db.scalar(select(func.count()).select_from(qry.subquery())) or 0
    rows = list(db.scalars(qry.order_by(AuditEvent.id.desc()).limit(per_page).offset((page - 1) * per_page)))
    who = _who(db, adb, {r.actor for r in rows})
    counts: dict[str, int] = {}
    since = now() - dt.timedelta(days=30)
    for action, n in db.execute(select(AuditEvent.action, func.count()).where(AuditEvent.at >= since).group_by(AuditEvent.action)):
        c = category_of(action)
        counts[c] = counts.get(c, 0) + n
    refs = _refs(db, rows)
    return {"items": [_row(r, who, refs) for r in rows], "total": total, "page": page, "per_page": per_page,
            "pages": max(1, -(-total // per_page)),
            "categories": [{"id": k, "label": v[0], "icon": v[1], "count_30d": counts.get(k, 0)} for k, v in CATEGORIES.items()]
            + ([{"id": "other", "label": "Other", "icon": "ri-more-line", "count_30d": counts["other"]}] if counts.get("other") else [])}


@router.get("/audit/export")
def audit_export(q: str = "", category: str = "", actor: str = "", days: int = 0,
                 db: Session = Depends(get_db), adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    rows = list(db.scalars(_filtered(q, category, actor, days).order_by(AuditEvent.id.desc()).limit(50_000)))
    who = _who(db, adb, {r.actor for r in rows})
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["when", "who", "category", "what", "action", "ref", "detail"])
    for r in rows:
        x = _row(r, who)
        w.writerow([x["at"], x["who"]["name"], x["category_label"], x["what"], r.action, r.ref, json.dumps(r.detail or {}, ensure_ascii=False, default=str)])
    name = f"omilo-activity-{now().strftime('%Y%m%d')}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ------------------------------------------------------------------ account
class MeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.patch("/auth/me")
def update_me(body: MeIn, adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    u = adb.get(User, user.id)
    u.name = body.name.strip()
    adb.commit()
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role}


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=10, max_length=200)


def _current_token(request: Request) -> str | None:
    raw = _bearer(request) or request.cookies.get(COOKIE)
    return sha256(raw) if raw else None


@router.post("/auth/password")
def change_password(body: PasswordIn, request: Request, adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    u = adb.get(User, user.id)
    if not verify_password(body.current, u.password_hash):
        raise HTTPException(400, "the current password is not right")
    if body.new == body.current:
        raise HTTPException(400, "pick a password different from the current one")
    u.password_hash = hash_password(body.new)
    # other browsers have to sign in again with the new password; this one stays signed in
    mine = _current_token(request)
    n = 0
    for t in adb.scalars(select(AuthToken).where(AuthToken.user_id == u.id, AuthToken.kind == "session")):
        if t.token_hash != mine:
            adb.delete(t)
            n += 1
    S.audit(adb, u.id, "password.change", "", signed_out=n)
    adb.commit()
    return {"ok": True, "signed_out": n}


@router.get("/auth/sessions")
def sessions(request: Request, adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    mine = _current_token(request)
    rows = adb.scalars(select(AuthToken).where(AuthToken.user_id == user.id).order_by(AuthToken.last_used_at.desc().nulls_last()))
    return [{"id": t.id, "kind": t.kind, "name": t.name or ("Browser" if t.kind == "session" else "API token"), "current": t.token_hash == mine,
             "created_at": X.iso(t.created_at), "last_used_at": X.iso(getattr(t, "last_used_at", None)), "expires_at": X.iso(t.expires_at)} for t in rows]


@router.post("/auth/sessions/sign-out-others")
def sign_out_others(request: Request, adb: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    mine = _current_token(request)
    n = 0
    for t in adb.scalars(select(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == "session")):
        if t.token_hash != mine:
            adb.delete(t)
            n += 1
    S.audit(adb, user.id, "session.revoke_others", "", count=n)
    adb.commit()
    return {"signed_out": n}


# ------------------------------------------------------------------ what this install runs on
@router.get("/system/info")
def system_info(db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import bus
    from .. import company as C
    from ..config import get_settings
    from ..db import schema_for

    cfg = get_settings()
    out: dict = {"version": "0.4.0", "data_dir": str(cfg.data_dir), "public_url": cfg.public_url, "companies": len(C.ids()),
                 "embedded_worker": cfg.embedded_worker}
    try:
        ver = db.execute(text("SHOW server_version")).scalar()
        size = db.execute(text("SELECT pg_database_size(current_database())")).scalar()
        schema = schema_for(C.current())
        ssize = db.execute(text("SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                                "WHERE n.nspname = :s"), {"s": schema}).scalar()
        vec = db.execute(text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")).scalar()
        url = cfg.resolved_database_url()
        out["database"] = {"ok": True, "version": ver, "pgvector": vec, "size_bytes": int(size or 0), "company_bytes": int(ssize or 0),
                           "schema": schema, "host": url.split("@")[-1].split("/")[0] if "@" in url else ""}
    except Exception as e:  # noqa: BLE001
        out["database"] = {"ok": False, "error": str(e)[:200]}
    try:
        info = bus.r().info()
        out["redis"] = {"ok": True, "version": info.get("redis_version"), "memory": info.get("used_memory_human"),
                        "host": cfg.redis_url.split("@")[-1].split("//")[-1].split("/")[0]}
    except Exception as e:  # noqa: BLE001
        out["redis"] = {"ok": False, "error": str(e)[:200]}
    try:
        d = cfg.company_dir
        total = sum(p.stat().st_size for p in d.rglob("*") if p.is_file()) if d.exists() else 0
        out["files"] = {"path": str(d), "size_bytes": total}
    except Exception:  # noqa: BLE001
        out["files"] = {"path": str(cfg.data_dir), "size_bytes": None}
    return out
