"""Helpers endpoints: list, detail, create, patch, retire + per-helper settings.

Endpoints:
  GET  /v1/helpers              → HelperStat[] (retired helpers excluded unless ?include_retired=true)
      {id, name, area, role, status, jobs: <count>, success: <pct>, isChief,
       model, title, reportsTo, look, jobsMonth, costMonth, currentJob, nextRoutine,
       loops, lastActive, budgetCreditsMonth, channelCount}
  GET  /v1/helpers/{id}         → {helper, jobs: [recent], skills: [], routines: [], counts}
  POST /v1/helpers {name, area, role, job_description?, autonomy_cap?, is_chief?,
                    model?, reports_to?, title?, look?, channels?}
      → {id, name, area, role, status, ...}
      Guard: if is_chief=true and a Chief already exists → 409.
  PATCH /v1/helpers/{id} {status?, role?, job_description?, autonomy_cap?, model?,
                          name?, area?, title?, reports_to?, look?, behavior?,
                          budget_credits_month?}
      → {id, name, area, role, status, ...}
  POST /v1/helpers/{id}/retire  → let a helper go (status='retired'); Chief → 409
  POST /v1/helpers/{id}/budget/allow-one → one-off budget override (+ resume if paused)

  GET    /v1/helpers/{id}/channels            → HelperChannel[]
  POST   /v1/helpers/{id}/channels {kind, config, secrets?}  → HelperChannel
  PATCH  /v1/helpers/{id}/channels/{cid} {config}            → HelperChannel
  DELETE /v1/helpers/{id}/channels/{cid}                     → 204

  GET /v1/helpers/{id}/tools   → {connectors: [...], builtins: [...]}
  PUT /v1/helpers/{id}/tools {connectors?: [{id, on, access}], builtins?: {key: bool}}
  GET /v1/helpers/{id}/skills  → [{id, name, version, status, own, enabled, permission}]
  PUT /v1/helpers/{id}/skills {skills: [{id, enabled, permission}]}
  GET /v1/helpers/{id}/files   → working files (PERSONA/STYLE/PLAYBOOK/MEMORY.md)
  PUT /v1/helpers/{id}/files/{name} {content} → upsert the helper's working file

Currency: every cost here is in credits (CreditLedger.credits_charged).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import case, func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
from omilo.models.execution import Job
from omilo.models.helper_channel import HelperChannel
from omilo.models.routines import Routine
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["helpers"])


# ── Request schemas ───────────────────────────────────────────────────────────


class CreateHelperBody(BaseModel):
    name: str
    area: str
    role: str
    job_description: Optional[str] = None
    autonomy_cap: Optional[str] = None
    is_chief: Optional[bool] = False
    # sweep/team-analytics — hire Setup fields
    model: Optional[str] = None
    reports_to: Optional[str] = None
    title: Optional[str] = None
    look: Optional[dict[str, Any]] = None
    # external channel kinds to bind (telegram | whatsapp | email); 'omilo' is built in
    channels: Optional[list[str]] = None


class PatchHelperBody(BaseModel):
    status: Optional[str] = None
    role: Optional[str] = None
    job_description: Optional[str] = None
    autonomy_cap: Optional[str] = None
    # model: engine id (e.g. "gpt-4o", "claude-sonnet") — stored in engine.model.
    # An empty string clears it (→ company default).
    model: Optional[str] = None
    # sweep/team-analytics
    name: Optional[str] = None
    area: Optional[str] = None
    title: Optional[str] = None
    reports_to: Optional[str] = None
    look: Optional[dict[str, Any]] = None
    behavior: Optional[dict[str, Any]] = None
    budget_credits_month: Optional[int] = None


VALID_STATUSES = {"active", "paused"}
CHANNEL_KINDS = {"telegram", "whatsapp", "email"}
SECRET_KEYS = {"token", "bot_token", "password", "access_token", "api_key"}
BUILTIN_TOOLS = {
    "browser": ("Browser", "Open pages and fill simple forms", True),
    "web_search": ("Web search", "Look things up on the web", True),
    "code_runner": ("Code runner", "Run small scripts on files", False),
}
CONNECTOR_ACCESS = {"read", "write", "ask"}
SKILL_PERMISSIONS = {"always", "ask"}
WORKING_FILES = {
    "PERSONA.md": "How {n} thinks and what it cares about",
    "STYLE.md": "Tone, language and formatting",
    "PLAYBOOK.md": "Step-by-step answers for common cases",
    "MEMORY.md": "What it remembers between chats",
}
_FILE_KEYS = {k.upper(): k for k in WORKING_FILES}
_MAX_LOOK_BYTES = 400_000  # data-URL pictures are stored inline; keep them small


# ── Internal helpers ──────────────────────────────────────────────────────────


def _404() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Helper not found.")


def _get_helper(db: Session, helper_id: str) -> Helper:
    helper = db.query(Helper).filter(Helper.id == helper_id).first()
    if helper is None:
        raise _404()
    return helper


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(tz=timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def cost_by_helper(db: Session, since: datetime) -> dict[str, int]:
    """Credits charged per helper since *since* (CreditLedger reason='job')."""
    rows = (
        db.query(CreditLedger.helper_id, func.sum(CreditLedger.credits_charged))
        .filter(
            CreditLedger.reason == "job",
            CreditLedger.at >= since,
            CreditLedger.helper_id.isnot(None),
        )
        .group_by(CreditLedger.helper_id)
        .all()
    )
    return {hid: int(total or 0) for hid, total in rows}


def current_job_by_helper(db: Session) -> dict[str, dict[str, Any]]:
    """Newest in-flight (running | waiting | queued) job per helper."""
    rows = (
        db.query(Job)
        .filter(Job.status.in_(("running", "waiting", "queued")))
        .order_by(Job.created_at.desc())
        .limit(500)
        .all()
    )
    out: dict[str, dict[str, Any]] = {}
    for j in rows:
        if j.helper_id in out:
            continue
        out[j.helper_id] = {
            "id": j.id,
            "brief": (j.brief or "").splitlines()[0][:200] if j.brief else "",
            "status": j.status,
            "startedAt": j.started_at.isoformat() if j.started_at else None,
        }
    return out


def next_routine_by_helper(db: Session) -> dict[str, dict[str, Any]]:
    rows = (
        db.query(Routine)
        .filter(Routine.enabled.is_(True), Routine.paused.is_(False), Routine.next_at.isnot(None))
        .order_by(Routine.next_at.asc())
        .all()
    )
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        if r.helper_id not in out:
            out[r.helper_id] = {"id": r.id, "name": r.name, "nextAt": r.next_at.isoformat()}
    return out


def last_active_by_helper(db: Session) -> dict[str, str]:
    rows = db.query(Job.helper_id, func.max(Job.created_at)).group_by(Job.helper_id).all()
    return {hid: at.isoformat() for hid, at in rows if at is not None}


def _count_by_helper(db: Session, column, *filters) -> dict[str, int]:
    q = db.query(column, func.count()).group_by(column)
    for f in filters:
        q = q.filter(f)
    return {hid: int(n) for hid, n in q.all()}


def _helper_to_stat(helper: Helper, job_count: int, done_count: int) -> dict[str, Any]:
    """Build a HelperStat dict (camelCase) from a Helper ORM object + counts."""
    success = round(100 * done_count / job_count) if job_count > 0 else 0
    return {
        "id": helper.id,
        "name": helper.name,
        "area": helper.area,
        "role": helper.role,
        "status": helper.status,
        "jobs": job_count,
        "success": success,
        "isChief": helper.is_chief,
    }


def _helper_to_dict(helper: Helper) -> dict[str, Any]:
    """Full helper dict (camelCase) for create/patch responses."""
    return {
        "id": helper.id,
        "name": helper.name,
        "area": helper.area,
        "role": helper.role,
        "status": helper.status,
        "isChief": helper.is_chief,
        "autonomyCap": helper.autonomy_cap,
        "jobDescription": helper.job_description,
        "model": (helper.engine or {}).get("model"),
        # sweep/team-analytics
        "title": helper.title,
        "reportsTo": helper.reports_to,
        "look": helper.look,
        "behavior": helper.behavior or {},
        "budgetCreditsMonth": helper.budget_credits_month,
        "budgetAllowJobs": helper.budget_allow_jobs or 0,
        "retiredAt": helper.retired_at.isoformat() if helper.retired_at else None,
    }


def _channel_to_dict(ch: HelperChannel) -> dict[str, Any]:
    return {
        "id": ch.id,
        "helperId": ch.helper_id,
        "kind": ch.kind,
        "config": ch.config or {},
        # never return secret values — only which secret fields are set
        "secretsSet": sorted((ch.secrets_enc or {}).keys()),
        "status": ch.status,
        "createdAt": ch.created_at.isoformat() if ch.created_at else None,
    }


def _encrypt(value: str) -> str:
    # Same (non-production) reversible encoding the connectors credential path uses.
    from omilo.api.connectors import _encrypt_field

    return _encrypt_field(value)


def _validate_look(look: dict[str, Any] | None) -> None:
    if look is None:
        return
    import json

    if len(json.dumps(look)) > _MAX_LOOK_BYTES:
        raise HTTPException(status_code=413, detail="Picture is too large (max ~300 KB).")


def _set_model(helper: Helper, model: str) -> None:
    engine = dict(helper.engine or {})
    if model:
        engine["model"] = model
    else:
        engine.pop("model", None)
    helper.engine = engine
    flag_modified(helper, "engine")


# ── Routes ────────────────────────────────────────────────────────────────────


@router.get("/helpers", status_code=status.HTTP_200_OK)
def list_helpers(
    include_retired: bool = Query(default=False),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return HelperStat[] for the active company (company-scoped via RLS).

    Retired (let go) helpers are excluded unless include_retired=true.
    """
    q = db.query(Helper)
    if not include_retired:
        q = q.filter(Helper.status != "retired")
    helpers = q.order_by(Helper.created_at.asc()).all()

    job_counts = (
        db.query(
            Job.helper_id,
            func.count(Job.id).label("total"),
            func.sum(case((Job.status == "done", 1), else_=0)).label("done"),
        )
        .group_by(Job.helper_id)
        .all()
    )
    counts: dict[str, tuple[int, int]] = {
        row.helper_id: (row.total, int(row.done or 0)) for row in job_counts
    }

    since = month_start()
    jobs_month = _count_by_helper(db, Job.helper_id, Job.created_at >= since)
    cost_month = cost_by_helper(db, since)
    current = current_job_by_helper(db)
    nxt = next_routine_by_helper(db)
    last = last_active_by_helper(db)
    loops = _count_by_helper(db, Routine.helper_id, Routine.enabled.is_(True))
    channels = _count_by_helper(db, HelperChannel.helper_id)

    out = []
    for h in helpers:
        row = _helper_to_stat(h, *counts.get(h.id, (0, 0)))
        row.update(
            {
                "model": (h.engine or {}).get("model"),
                "title": h.title,
                "reportsTo": h.reports_to,
                "look": h.look,
                "jobDescription": h.job_description,
                "autonomyCap": h.autonomy_cap,
                "jobsMonth": jobs_month.get(h.id, 0),
                "costMonth": cost_month.get(h.id, 0),
                "currentJob": current.get(h.id),
                "nextRoutine": nxt.get(h.id),
                "loops": loops.get(h.id, 0),
                "lastActive": last.get(h.id),
                "budgetCreditsMonth": h.budget_credits_month,
                "channelCount": channels.get(h.id, 0),
            }
        )
        out.append(row)
    return out


@router.get("/helpers/{helper_id}", status_code=status.HTTP_200_OK)
def get_helper_detail(
    helper_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Return {helper, jobs: [recent 20], skills, routines, counts} for the helper.

    404 for a helper belonging to another company (RLS surfaces it as not found).
    """
    helper = _get_helper(db, helper_id)

    jobs = (
        db.query(Job)
        .filter(Job.helper_id == helper_id)
        .order_by(Job.created_at.desc())
        .limit(20)
        .all()
    )
    jobs_data = [
        {
            "id": j.id,
            "status": j.status,
            "origin": j.origin,
            "brief": j.brief,
            "tokensIn": j.tokens_in,
            "tokensOut": j.tokens_out,
            "costCredits": j.cost_credits,
            "createdAt": j.created_at.isoformat() if j.created_at else None,
        }
        for j in jobs
    ]

    since = month_start()
    total = db.query(func.count(Job.id)).filter(Job.helper_id == helper_id).scalar() or 0
    done = (
        db.query(func.count(Job.id))
        .filter(Job.helper_id == helper_id, Job.status == "done")
        .scalar()
        or 0
    )
    jobs_month = (
        db.query(func.count(Job.id))
        .filter(Job.helper_id == helper_id, Job.created_at >= since)
        .scalar()
        or 0
    )

    routines = (
        db.query(Routine).filter(Routine.helper_id == helper_id).order_by(Routine.at.asc()).all()
    )
    skills = _helper_skills(db, helper)
    tools = _helper_tools(db, helper)
    channel_count = (
        db.query(func.count(HelperChannel.id)).filter(HelperChannel.helper_id == helper_id).scalar()
        or 0
    )

    helper_dict = _helper_to_dict(helper)
    helper_dict.update(
        {
            "jobs": total,
            "success": round(100 * done / total) if total else 0,
            "jobsMonth": jobs_month,
            "costMonth": cost_by_helper(db, since).get(helper_id, 0),
            "currentJob": current_job_by_helper(db).get(helper_id),
            "nextRoutine": next_routine_by_helper(db).get(helper_id),
            "lastActive": last_active_by_helper(db).get(helper_id),
            "loops": sum(1 for r in routines if r.enabled),
        }
    )

    return {
        "helper": helper_dict,
        "jobs": jobs_data,
        "skills": skills,
        "routines": [
            {
                "id": r.id,
                "name": r.name,
                "freq": r.freq,
                "at": r.at,
                "days": r.days or [],
                "paused": r.paused,
                "enabled": r.enabled,
                "nextAt": r.next_at.isoformat() if r.next_at else None,
                "managedByChief": r.managed_by_chief,
            }
            for r in routines
        ],
        "counts": {
            # +1: Omilo chat is always on
            "channels": channel_count + 1,
            "tools": sum(1 for t in tools["connectors"] if t["on"])
            + sum(1 for t in tools["builtins"] if t["on"]),
            "skills": sum(1 for s in skills if s["enabled"]),
            "routines": len(routines),
        },
    }


@router.post("/helpers", status_code=status.HTTP_201_CREATED)
def create_helper(
    body: CreateHelperBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create a Helper for the active company.

    Guard: if is_chief=true and a Chief already exists → 409.
    """
    if body.is_chief:
        existing_chief = db.query(Helper).filter(Helper.is_chief.is_(True)).first()
        if existing_chief is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A Chief Helper already exists for this company. Only one Chief is allowed.",
            )
    _validate_look(body.look)

    engine: dict[str, Any] = {"type": "fake"}
    if body.model:
        engine["model"] = body.model

    helper = Helper(
        id=prefixed_id("hlp"),
        company_id=ctx.company_id,
        name=body.name,
        area=body.area,
        role=body.role,
        job_description=body.job_description or "",
        is_chief=body.is_chief or False,
        autonomy_cap=body.autonomy_cap,
        engine=engine,
        permissions=[],
        status="active",
        channel_ids=[],
        title=body.title,
        reports_to=body.reports_to,
        look=body.look,
        behavior={},
        tool_access={},
        skill_settings={},
        budget_allow_jobs=0,
    )
    db.add(helper)
    db.flush()

    for kind in body.channels or []:
        k = kind.strip().lower()
        if k in CHANNEL_KINDS:
            db.add(
                HelperChannel(
                    id=prefixed_id("hch"),
                    company_id=ctx.company_id,
                    helper_id=helper.id,
                    kind=k,
                    config={},
                    secrets_enc={},
                    status="pending_setup",
                )
            )
    db.flush()

    from omilo import audit  # sweep/control — activity log

    audit.record_ctx(ctx, type="helpers", action="added helper", target=helper.name)
    return _helper_to_dict(helper)


@router.patch("/helpers/{helper_id}", status_code=status.HTTP_200_OK)
def patch_helper(
    helper_id: str,
    body: PatchHelperBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Update a Helper. 404 for another company's helper (RLS).

    status accepts 'active' | 'paused' (use POST /retire to let a helper go).
    budget_credits_month: explicit null clears the budget.
    behavior: shallow-merged; keys set to null are removed.
    """
    helper = _get_helper(db, helper_id)
    fields = body.model_fields_set

    if body.status is not None:
        if body.status not in VALID_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="status must be 'active' or 'paused' — use POST /retire to let a helper go.",
            )
        if helper.status == "retired":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Helper was let go.")
        helper.status = body.status
    if body.role is not None:
        helper.role = body.role
    if body.job_description is not None:
        helper.job_description = body.job_description
    if "autonomy_cap" in fields:
        helper.autonomy_cap = body.autonomy_cap or None
    if body.model is not None:
        _set_model(helper, body.model)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Name can't be empty.")
        helper.name = name
    if body.area is not None:
        helper.area = body.area
    if "title" in fields:
        helper.title = body.title or None
    if "reports_to" in fields:
        if body.reports_to and body.reports_to not in ("owner",):
            if body.reports_to == helper.id:
                raise HTTPException(status_code=422, detail="A helper can't report to itself.")
            _get_helper(db, body.reports_to)
        helper.reports_to = body.reports_to or None
    if "look" in fields:
        _validate_look(body.look)
        helper.look = body.look
        flag_modified(helper, "look")
    if body.behavior is not None:
        merged = dict(helper.behavior or {})
        for k, v in body.behavior.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        helper.behavior = merged
        flag_modified(helper, "behavior")
    if "budget_credits_month" in fields:
        if body.budget_credits_month is not None and body.budget_credits_month < 0:
            raise HTTPException(status_code=422, detail="Budget must be ≥ 0.")
        helper.budget_credits_month = body.budget_credits_month

    db.flush()
    from omilo import audit  # sweep/control — activity log

    changed = [k for k, v in body.model_dump(exclude_none=True).items()]
    if changed:
        what = "paused" if body.status == "paused" else "resumed" if body.status == "active" else "changed"
        audit.record_ctx(
            ctx, type="helpers", action=what,
            target=helper.name if what != "changed" else f"{helper.name} · {', '.join(k.replace('_', ' ') for k in changed)}",
        )
    return _helper_to_dict(helper)


@router.post("/helpers/{helper_id}/retire", status_code=status.HTTP_200_OK)
def retire_helper(
    helper_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Let a helper go: status='retired', routines paused, history kept.

    The Chief cannot be let go (409). Jobs, memory and ledger rows are kept so
    analytics history stays correct; the helper just leaves the roster.
    """
    helper = _get_helper(db, helper_id)
    if helper.is_chief:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="The Chief can't be let go."
        )
    helper.status = "retired"
    helper.retired_at = datetime.now(timezone.utc)
    for r in db.query(Routine).filter(Routine.helper_id == helper_id).all():
        r.paused = True
    db.flush()
    from omilo import audit  # sweep/control — activity log

    audit.record_ctx(ctx, type="helpers", action="let go", target=helper.name)
    return _helper_to_dict(helper)


@router.post("/helpers/{helper_id}/budget/allow-one", status_code=status.HTTP_200_OK)
def allow_one_more_job(
    helper_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """One-off budget override: the next job may start even though the budget is spent.

    Also resumes the helper if it was paused (the budget gate pauses it).
    """
    helper = _get_helper(db, helper_id)
    if helper.status == "retired":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Helper was let go.")
    helper.budget_allow_jobs = (helper.budget_allow_jobs or 0) + 1
    if helper.status == "paused":
        helper.status = "active"
    db.flush()
    return _helper_to_dict(helper)


# ── Channels ──────────────────────────────────────────────────────────────────


class CreateChannelBody(BaseModel):
    kind: str
    config: Optional[dict[str, Any]] = None
    secrets: Optional[dict[str, str]] = None


class PatchChannelBody(BaseModel):
    config: Optional[dict[str, Any]] = None
    secrets: Optional[dict[str, str]] = None


def _split_secrets(config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    plain: dict[str, Any] = {}
    secret: dict[str, str] = {}
    for k, v in config.items():
        if k in SECRET_KEYS and isinstance(v, str):
            secret[k] = v
        else:
            plain[k] = v
    return plain, secret


@router.get("/helpers/{helper_id}/channels", status_code=status.HTTP_200_OK)
def list_helper_channels(
    helper_id: str,
    db: Session = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    _get_helper(db, helper_id)
    rows = (
        db.query(HelperChannel)
        .filter(HelperChannel.helper_id == helper_id)
        .order_by(HelperChannel.created_at.asc())
        .all()
    )
    return [_channel_to_dict(c) for c in rows]


@router.post("/helpers/{helper_id}/channels", status_code=status.HTTP_201_CREATED)
def create_helper_channel(
    helper_id: str,
    body: CreateChannelBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Bind an external channel to a helper (one binding per kind; re-posting updates it).

    Secrets (bot token, password) are stored encrypted and never returned.
    Status is 'pending_setup': no live delivery integration exists yet.
    """
    _get_helper(db, helper_id)
    kind = body.kind.strip().lower()
    if kind not in CHANNEL_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown channel kind {body.kind!r}.")
    plain, secret = _split_secrets(body.config or {})
    secret.update(body.secrets or {})

    ch = (
        db.query(HelperChannel)
        .filter(HelperChannel.helper_id == helper_id, HelperChannel.kind == kind)
        .first()
    )
    if ch is None:
        ch = HelperChannel(
            id=prefixed_id("hch"),
            company_id=ctx.company_id,
            helper_id=helper_id,
            kind=kind,
            config={},
            secrets_enc={},
            status="pending_setup",
        )
        db.add(ch)
    ch.config = {**(ch.config or {}), **plain}
    ch.secrets_enc = {**(ch.secrets_enc or {}), **{k: _encrypt(v) for k, v in secret.items()}}
    flag_modified(ch, "config")
    flag_modified(ch, "secrets_enc")
    db.flush()
    return _channel_to_dict(ch)


@router.patch("/helpers/{helper_id}/channels/{channel_id}", status_code=status.HTTP_200_OK)
def patch_helper_channel(
    helper_id: str,
    channel_id: str,
    body: PatchChannelBody,
    db: Session = Depends(get_tenant_db),
) -> dict[str, Any]:
    ch = (
        db.query(HelperChannel)
        .filter(HelperChannel.id == channel_id, HelperChannel.helper_id == helper_id)
        .first()
    )
    if ch is None:
        raise HTTPException(status_code=404, detail="Channel not found.")
    plain, secret = _split_secrets(body.config or {})
    secret.update(body.secrets or {})
    ch.config = {**(ch.config or {}), **plain}
    ch.secrets_enc = {**(ch.secrets_enc or {}), **{k: _encrypt(v) for k, v in secret.items()}}
    flag_modified(ch, "config")
    flag_modified(ch, "secrets_enc")
    db.flush()
    return _channel_to_dict(ch)


@router.delete(
    "/helpers/{helper_id}/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_helper_channel(
    helper_id: str,
    channel_id: str,
    db: Session = Depends(get_tenant_db),
) -> Response:
    ch = (
        db.query(HelperChannel)
        .filter(HelperChannel.id == channel_id, HelperChannel.helper_id == helper_id)
        .first()
    )
    if ch is None:
        raise HTTPException(status_code=404, detail="Channel not found.")
    db.delete(ch)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Tools ─────────────────────────────────────────────────────────────────────


class ConnectorToolBody(BaseModel):
    id: str
    on: bool
    access: Optional[str] = None


class PutToolsBody(BaseModel):
    connectors: Optional[list[ConnectorToolBody]] = None
    builtins: Optional[dict[str, bool]] = None


def _helper_tools(db: Session, helper: Helper) -> dict[str, Any]:
    """Company connectors (granted via HelperAccess) + built-in tools for a helper."""
    from omilo.models.connectors import Connector
    from omilo.models.helper_access import HelperAccess

    grants = {
        g.ref_id: g
        for g in db.query(HelperAccess)
        .filter(HelperAccess.helper_id == helper.id, HelperAccess.kind == "connector")
        .all()
    }
    connectors = []
    for c in db.query(Connector).order_by(Connector.created_at.asc()).all():
        g = grants.get(c.id)
        connectors.append(
            {
                "id": c.id,
                "label": getattr(c, "label", c.id),
                "pieceId": getattr(c, "piece_id", None),
                "kind": getattr(c, "kind", None),
                "status": getattr(c, "status", None),
                "on": g is not None,
                "access": g.access if g is not None else "read",
            }
        )
    saved = (helper.tool_access or {}).get("builtins", {})
    builtins = [
        {"id": key, "label": label, "desc": desc, "on": bool(saved.get(key, default))}
        for key, (label, desc, default) in BUILTIN_TOOLS.items()
    ]
    return {"connectors": connectors, "builtins": builtins}


@router.get("/helpers/{helper_id}/tools", status_code=status.HTTP_200_OK)
def get_helper_tools(helper_id: str, db: Session = Depends(get_tenant_db)) -> dict[str, Any]:
    return _helper_tools(db, _get_helper(db, helper_id))


@router.put("/helpers/{helper_id}/tools", status_code=status.HTTP_200_OK)
def put_helper_tools(
    helper_id: str,
    body: PutToolsBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Set which company connectors (and how much) + built-in tools a helper may use.

    Connector grants are HelperAccess rows (kind='connector'), the same table
    the runtime consults; 'off' deletes the grant. access ∈ read|write|ask.
    """
    from omilo.models.connectors import Connector
    from omilo.models.helper_access import HelperAccess

    helper = _get_helper(db, helper_id)
    for t in body.connectors or []:
        if db.get(Connector, t.id) is None:
            raise HTTPException(status_code=404, detail=f"Connector {t.id!r} not found.")
        access = t.access or "read"
        if access not in CONNECTOR_ACCESS:
            raise HTTPException(status_code=422, detail=f"access must be one of {sorted(CONNECTOR_ACCESS)}")
        grant = (
            db.query(HelperAccess)
            .filter(
                HelperAccess.helper_id == helper_id,
                HelperAccess.kind == "connector",
                HelperAccess.ref_id == t.id,
            )
            .first()
        )
        if t.on:
            if grant is None:
                db.add(
                    HelperAccess(
                        id=prefixed_id("hac"),
                        company_id=ctx.company_id,
                        helper_id=helper_id,
                        kind="connector",
                        ref_id=t.id,
                        access=access,
                        default_on=False,
                    )
                )
            else:
                grant.access = access
        elif grant is not None:
            db.delete(grant)
    if body.builtins is not None:
        unknown = set(body.builtins) - set(BUILTIN_TOOLS)
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown built-in tools: {sorted(unknown)}")
        ta = dict(helper.tool_access or {})
        ta["builtins"] = {**ta.get("builtins", {}), **body.builtins}
        helper.tool_access = ta
        flag_modified(helper, "tool_access")
    db.flush()
    return _helper_tools(db, helper)


# ── Skills ────────────────────────────────────────────────────────────────────


class SkillSettingBody(BaseModel):
    id: str
    enabled: bool = True
    permission: str = "ask"


class PutSkillsBody(BaseModel):
    skills: list[SkillSettingBody]


def _helper_skills(db: Session, helper: Helper) -> list[dict[str, Any]]:
    """The helper's own skills + company skills added to it, with on/permission."""
    from omilo.models.skills import Skill

    settings = helper.skill_settings or {}
    own = db.query(Skill).filter(Skill.helper_id == helper.id).all()
    ids = {s.id for s in own}
    added_ids = [sid for sid in settings if sid not in ids]
    added = db.query(Skill).filter(Skill.id.in_(added_ids)).all() if added_ids else []
    out = []
    for s in [*own, *added]:
        cfg = settings.get(s.id, {})
        out.append(
            {
                "id": s.id,
                "name": s.name,
                "version": s.version,
                "status": s.status,
                "own": s.helper_id == helper.id,
                "createdBy": s.created_by,
                "description": (s.body_md or "").strip().splitlines()[0][:140] if s.body_md else "",
                "enabled": bool(cfg.get("enabled", True)),
                "permission": cfg.get("permission", "always" if s.helper_id == helper.id else "ask"),
            }
        )
    return out


@router.get("/helpers/{helper_id}/skills", status_code=status.HTTP_200_OK)
def get_helper_skills(helper_id: str, db: Session = Depends(get_tenant_db)) -> list[dict[str, Any]]:
    return _helper_skills(db, _get_helper(db, helper_id))


@router.put("/helpers/{helper_id}/skills", status_code=status.HTTP_200_OK)
def put_helper_skills(
    helper_id: str,
    body: PutSkillsBody,
    db: Session = Depends(get_tenant_db),
) -> list[dict[str, Any]]:
    """Upsert per-helper skill settings ({id, enabled, permission}).

    Adding a company skill = sending it here (Browse skills → Add). Entries not
    sent are kept; send enabled=false to switch one off.
    """
    from omilo.models.skills import Skill

    helper = _get_helper(db, helper_id)
    settings = dict(helper.skill_settings or {})
    for s in body.skills:
        if s.permission not in SKILL_PERMISSIONS:
            raise HTTPException(status_code=422, detail="permission must be 'always' or 'ask'.")
        if db.get(Skill, s.id) is None:
            raise HTTPException(status_code=404, detail=f"Skill {s.id!r} not found.")
        settings[s.id] = {"enabled": s.enabled, "permission": s.permission}
    helper.skill_settings = settings
    flag_modified(helper, "skill_settings")
    db.flush()
    return _helper_skills(db, helper)


# ── Working files (helper memory docs) ────────────────────────────────────────


class PutFileBody(BaseModel):
    content: str


def _file_path(helper_id: str, name: str) -> str:
    return f"Helpers/{helper_id}/{name}"


@router.get("/helpers/{helper_id}/files", status_code=status.HTTP_200_OK)
def list_helper_files(helper_id: str, db: Session = Depends(get_tenant_db)) -> list[dict[str, Any]]:
    """The helper's four working files, from MemoryDoc rows with this helper_id.

    A file the helper hasn't written yet is returned with content '' and
    updatedAt null so the card still renders.
    """
    from omilo.models.memory import MemoryDoc

    helper = _get_helper(db, helper_id)
    docs = db.query(MemoryDoc).filter(MemoryDoc.helper_id == helper_id).all()
    by_name: dict[str, MemoryDoc] = {}
    for d in docs:
        key = _FILE_KEYS.get(d.path.rsplit("/", 1)[-1].upper())
        if key and key not in by_name:
            by_name[key] = d
    out = []
    for name, desc in WORKING_FILES.items():
        d = by_name.get(name)
        out.append(
            {
                "name": name,
                "description": desc.format(n=helper.name),
                "docId": d.id if d else None,
                "content": d.content if d else "",
                "updatedAt": d.updated_at.isoformat() if d and d.updated_at else None,
                "updatedBy": d.updated_by if d else None,
            }
        )
    return out


@router.put("/helpers/{helper_id}/files/{name}", status_code=status.HTTP_200_OK)
def put_helper_file(
    helper_id: str,
    name: str,
    body: PutFileBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Create or replace one of the helper's working files (operator edit wins)."""
    from omilo.models.memory import MemoryDoc

    helper = _get_helper(db, helper_id)
    key = _FILE_KEYS.get(name.upper())
    if key is None:
        raise HTTPException(status_code=404, detail="Unknown working file.")
    docs = db.query(MemoryDoc).filter(MemoryDoc.helper_id == helper_id).all()
    doc = next((d for d in docs if d.path.rsplit("/", 1)[-1].upper() == key.upper()), None)
    now = datetime.now(timezone.utc)
    if doc is None:
        doc = MemoryDoc(
            id=prefixed_id("mem"),
            company_id=ctx.company_id,
            helper_id=helper_id,
            path=_file_path(helper_id, key),
            content=body.content,
            updated_by=f"operator:{ctx.user_id}",
            updated_at=now,
        )
        db.add(doc)
    else:
        doc.content = body.content
        doc.updated_by = f"operator:{ctx.user_id}"
        doc.updated_at = now
    db.flush()
    try:
        from omilo.kb.index import index_source

        with db.begin_nested():
            index_source(
                db,
                kind="memory",
                ref=doc.path,
                title=f"{key} · {helper.name}",
                body=doc.content,
                helper_id=helper_id,
            )
    except Exception:  # indexing is best-effort; the edit itself is saved
        pass
    return {
        "name": key,
        "description": WORKING_FILES[key].format(n=helper.name),
        "docId": doc.id,
        "content": doc.content,
        "updatedAt": doc.updated_at.isoformat() if doc.updated_at else None,
        "updatedBy": doc.updated_by,
    }
