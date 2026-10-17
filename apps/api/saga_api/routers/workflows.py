"""Workflow automations: build, approve, run, watch, share, and the marketplace of ready-made ones."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import services as S
from .. import workflows as W
from ..db import get_db
from ..models import InboxItem, Staff, User, Workflow, WorkflowRun, now
from ..security import current_user

router = APIRouter(prefix="/api", tags=["workflows"])


def _wf(db: Session, wid: str) -> Workflow:
    wf = db.get(Workflow, wid)
    if not wf:
        raise HTTPException(404, "no such workflow")
    return wf


def _valid(graph: dict) -> dict:
    try:
        return W.validate(graph)
    except W.Invalid as e:
        raise HTTPException(422, str(e)) from e


class WorkflowIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    graph: dict
    autonomy: str = Field("ask", pattern="^(ask|auto)$")


class WorkflowPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = None
    graph: dict | None = None
    autonomy: str | None = Field(None, pattern="^(ask|auto)$")


@router.get("/workflows")
def list_workflows(db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = db.scalars(select(Workflow).order_by(Workflow.updated_at.desc()).limit(500))
    return [W.view(db, w) for w in rows]


@router.get("/workflows/blocks")
def blocks(user: User = Depends(current_user)):
    return W.blocks_public()


@router.get("/workflows/market")
def market(user: User = Depends(current_user)):
    return W.market()


@router.post("/workflows/market/{slug}/install")
def install(slug: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    try:
        wf, missing = W.install(db, slug)
    except KeyError as e:
        raise HTTPException(404, "no such template") from e
    except W.Invalid as e:
        raise HTTPException(422, str(e)) from e
    S.audit(db, user.id, "workflow.install", wf.id, slug=slug)
    db.commit()
    return {**W.view(db, wf, full=True), "missing_connectors": missing}


@router.get("/workflows/connector-tools/{cid}")
async def connector_tools(cid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    import asyncio

    from .. import capabilities as CAP
    from ..models import Connector

    c = db.get(Connector, cid)
    if not c:
        raise HTTPException(404, "unknown connector")
    try:
        return {"tools": await asyncio.wait_for(W.list_tools(CAP.connector_runtime(c)), timeout=40)}
    except Exception as e:  # noqa: BLE001 - shown in the builder
        return {"tools": [], "error": (str(e) or type(e).__name__)[:300]}


@router.get("/workflows/patterns")
def patterns(days: int = 30, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return W.patterns(db, max(7, min(days, 90)))


@router.get("/workflow-runs")
def recent_runs(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(current_user)):
    rows = list(db.scalars(select(WorkflowRun).order_by(WorkflowRun.created_at.desc()).limit(max(1, min(limit, 200)))))
    names = {w.id: w.name for w in db.scalars(select(Workflow).where(Workflow.id.in_({r.workflow_id for r in rows})))} if rows else {}
    return [{**W.run_view(r), "workflow_name": names.get(r.workflow_id, "(deleted)")} for r in rows]


class BuildIn(BaseModel):
    description: str = Field(min_length=3, max_length=4000)
    staff_id: str | None = None
    task_ids: list[str] = []


@router.post("/workflows/build")
def build(body: BuildIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Ask a helper to design a workflow. It comes back as a proposal in your Inbox."""
    st = db.get(Staff, body.staff_id) if body.staff_id else S.chief(db)
    if not st or st.status == "retired":
        raise HTTPException(409, "pick a helper on your team")
    from ..models import Task

    examples = [t.brief for t in db.scalars(select(Task).where(Task.id.in_(body.task_ids[:5])))] if body.task_ids else []
    t = S.create_task(db, st.id, "manual", W.build_brief(body.description, examples), created_by=user.id)
    S.audit(db, user.id, "workflow.build", t.id, staff=st.id)
    db.commit()
    return {"task_id": t.id, "staff": {"id": st.id, "name": st.name}}


class ImportIn(BaseModel):
    data: dict


@router.post("/workflows/import")
def import_workflow(body: ImportIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    d = body.data
    g, missing = W._fill_placeholders(db, d.get("graph") or {})
    wf = Workflow(name=str(d.get("name") or "Imported workflow")[:120], description=str(d.get("description") or "")[:2000],
                  graph=_valid(g), status="draft", created_by="owner", source="import")
    db.add(wf)
    db.commit()
    return {**W.view(db, wf, full=True), "missing_connectors": missing}


@router.post("/workflows")
def create(body: WorkflowIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = Workflow(name=body.name, description=body.description, graph=_valid(body.graph), autonomy=body.autonomy, status="draft", created_by="owner")
    db.add(wf)
    db.flush()
    S.audit(db, user.id, "workflow.create", wf.id)
    db.commit()
    return W.view(db, wf, full=True)


@router.get("/workflows/{wid}")
def get_workflow(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return W.view(db, _wf(db, wid), full=True)


@router.put("/workflows/{wid}")
def update(wid: str, body: WorkflowPatch, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = _wf(db, wid)
    if body.graph is not None:
        wf.graph = _valid(body.graph)
    if body.name is not None:
        wf.name = body.name
    if body.description is not None:
        wf.description = body.description
    if body.autonomy is not None:
        wf.autonomy = body.autonomy
    wf.updated_at = now()
    if wf.status == "active":
        W.activate(db, wf)  # the trigger may have changed
    S.audit(db, user.id, "workflow.update", wf.id)
    db.commit()
    return W.view(db, wf, full=True)


def _close_proposal(db: Session, wf: Workflow, answer: str):
    for i in db.scalars(select(InboxItem).where(InboxItem.kind == "workflow", InboxItem.ref_id == f"wf:{wf.id}", InboxItem.status != "done")):
        i.status, i.answer, i.closed_at = "done", answer, now()


@router.delete("/workflows/{wid}")
def delete(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = _wf(db, wid)
    _close_proposal(db, wf, "deleted")
    for r in db.scalars(select(WorkflowRun).where(WorkflowRun.workflow_id == wf.id, WorkflowRun.status.in_(["queued", "waiting"]))):
        r.status, r.error, r.ended_at = "cancelled", "the workflow was deleted", now()
    db.delete(wf)
    S.audit(db, user.id, "workflow.delete", wid)
    db.commit()
    return {"ok": True}


@router.post("/workflows/{wid}/activate")
def activate(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = _wf(db, wid)
    _valid(wf.graph or {})
    W.activate(db, wf)
    _close_proposal(db, wf, "approved")
    S.audit(db, user.id, "workflow.activate", wf.id)
    db.commit()
    return W.view(db, wf, full=True)


@router.post("/workflows/{wid}/pause")
def pause(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = _wf(db, wid)
    wf.status, wf.next_at = "paused", None
    S.audit(db, user.id, "workflow.pause", wf.id)
    db.commit()
    return W.view(db, wf, full=True)


class RejectIn(BaseModel):
    note: str = ""


@router.post("/workflows/{wid}/reject")
def reject(wid: str, body: RejectIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    wf = _wf(db, wid)
    wf.status, wf.next_at = "rejected", None
    if body.note:
        wf.reason = (wf.reason or "") + f"\n\nYou said no: {body.note}"
    _close_proposal(db, wf, "rejected")
    S.audit(db, user.id, "workflow.reject", wf.id)
    db.commit()
    return W.view(db, wf, full=True)


class RunIn(BaseModel):
    input: dict | None = None


@router.post("/workflows/{wid}/run")
def run(wid: str, body: RunIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """Run now (a test run works on drafts too). Uses the given input, else the trigger's test input."""
    wf = _wf(db, wid)
    if wf.status in ("rejected",):
        raise HTTPException(409, "this workflow was turned down")
    _valid(wf.graph or {})
    payload = body.input
    if payload is None:
        sample = W.trigger_of(wf).get("config", {}).get("sample")
        payload = sample if isinstance(sample, dict) else {}
    r = W.start_run(db, wf, "manual" if wf.status == "active" else "test", payload, user.id)
    return W.run_view(r, full=True)


@router.get("/workflows/{wid}/runs")
def runs(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    _wf(db, wid)
    return [W.run_view(r) for r in db.scalars(select(WorkflowRun).where(WorkflowRun.workflow_id == wid).order_by(WorkflowRun.created_at.desc()).limit(50))]


@router.get("/workflows/{wid}/export")
def export(wid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    return W.export(_wf(db, wid))


@router.get("/workflow-runs/{rid}")
def get_run(rid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = db.get(WorkflowRun, rid)
    if not r:
        raise HTTPException(404, "no such run")
    return W.run_view(r, full=True)


@router.post("/workflow-runs/{rid}/cancel")
def cancel_run(rid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    r = db.get(WorkflowRun, rid)
    if not r:
        raise HTTPException(404, "no such run")
    if r.status in ("done", "failed", "cancelled"):
        raise HTTPException(409, f"the run already {r.status}")
    r.status, r.error, r.ended_at = "cancelled", "you stopped it", now()
    for i in db.scalars(select(InboxItem).where(InboxItem.kind == "workflow", InboxItem.ref_id.like(f"%:{r.id}:%"), InboxItem.status != "done")):
        i.status, i.answer, i.closed_at = "done", "cancelled", now()
    db.commit()
    return W.run_view(r, full=True)


class DecideIn(BaseModel):
    decision: str = Field(pattern="^(approved|rejected)$")
    note: str = ""


@router.post("/inbox/{iid}/decide")
def decide(iid: str, body: DecideIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import serialize as X

    item = db.get(InboxItem, iid)
    if not item:
        raise HTTPException(404, "not found")
    try:
        W.decide(db, item, body.decision, body.note, user.id)
    except S.DomainError as e:
        raise HTTPException(e.code, str(e)) from e
    return X.inbox(item)


# ------------------------------------------------------------------ webhooks (no sign-in: the secret address is the key)
@router.post("/hooks/{token}")
async def hook(token: str, request: Request, db: Session = Depends(get_db)):
    wf = db.scalar(select(Workflow).where(Workflow.hook_token == token)) if len(token) >= 16 else None
    if not wf or wf.status != "active" or W.trigger_of(wf)["type"] != "trigger.webhook":
        raise HTTPException(404, "not found")
    raw = await request.body()
    if len(raw) > 1_000_000:
        raise HTTPException(413, "too large")
    try:
        import json

        payload = json.loads(raw or b"{}")
    except ValueError:
        payload = {"text": raw.decode(errors="replace")}
    if not isinstance(payload, dict):
        payload = {"items": payload}
    payload.setdefault("_query", dict(request.query_params))
    recent = db.scalar(select(WorkflowRun.id).where(WorkflowRun.workflow_id == wf.id, WorkflowRun.status == "queued").offset(50).limit(1))
    if recent:
        raise HTTPException(429, "too many runs waiting")
    r = W.start_run(db, wf, "webhook", payload, "webhook")
    return {"ok": True, "run_id": r.id}
