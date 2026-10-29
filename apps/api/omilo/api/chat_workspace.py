"""Chat workspace write endpoints — persisted sidebar, folders, sharing, Chief DM.

Sessions
  PATCH  /sessions/{id}            {title?, folder_id?, pinned?, archived?, goal_id?, model?}
  DELETE /sessions/{id}            soft delete (distinct from archive) → 204
  DELETE /sessions/archived        bulk soft-delete archived chats (?channel_id=) → {deleted}
  GET    /sessions/{id}/shares     → Shares
  PUT    /sessions/{id}/shares     {members:[{user_id, permission}], general_access?} → Shares
  GET    /sessions/{id}/results    → {steps, outputs, activity, usage} derived from jobs

Folders
  GET    /folders/{id}             → Folder (+icon,color,instructions)
  POST   /folders                  {channel_id, name, icon?, color?} → Folder (201)
  PATCH  /folders/{id}             {name?, icon?, color?, instructions?} → Folder
  DELETE /folders/{id}             chats move to "no folder" → 204
  GET    /folders/{id}/files       → FolderFile[]
  POST   /folders/{id}/files       {name, size?, mime?, text?} → FolderFile (201)
  DELETE /folders/{id}/files/{fid} → 204
  GET    /folders/{id}/shares      → Shares
  PUT    /folders/{id}/shares      {members:[{user_id, permission}]} → Shares

Areas
  PATCH  /channels/{id}            {icon?, color?, name?, purpose?} → Channel

Chief
  GET    /chief/nudges             → Nudge[] (derived from inbox items that need you)
  POST   /chief/nudges/{id}/dismiss {snooze_until?} → 204

Pins are per user (session.pinned_by holds user ids). Private Chief threads
are sessions with kind='chief_private' and owner_user_id = the caller; they are
excluded from every normal listing and 404 for anyone else.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Query as SAQuery
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.db import SessionLocal
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.chat import ChatSession
from omilo.models.execution import Job, Report, RunEvent
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Member, User
from omilo.models.workspace import Channel, ChiefNudgeState, Folder, FolderFile, Goal
from omilo.schemas.read import ChannelOutDTO, FolderOutDTO, SessionOutDTO
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["chat-workspace"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")

KIND_CHAT = "chat"
KIND_CHIEF = "chief_private"
SESSION_KINDS = (KIND_CHAT, KIND_CHIEF)
PERMISSIONS = ("can_talk", "can_view")
GENERAL_ACCESS = ("restricted", "company")


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Shared serializers / visibility (also used by sessions.py, channels.py) ──


def session_out(row: ChatSession, user_id: str | None) -> dict:
    dto = SessionOutDTO.model_validate(row, from_attributes=True)
    pinned_by = row.pinned_by or []
    dto.pinned = True if (user_id and user_id in pinned_by) else None
    dto.kind = row.kind if row.kind and row.kind != KIND_CHAT else None
    return dto.model_dump(by_alias=True, exclude_none=True)


def folder_out(row: Folder, count: int | None = None) -> dict:
    dto = FolderOutDTO.model_validate(row, from_attributes=True)
    if count is not None:
        dto.count = count
    if not dto.instructions:
        dto.instructions = None
    return dto.model_dump(by_alias=True, exclude_none=True)


def channel_out(row: Channel) -> dict:
    return ChannelOutDTO.model_validate(row, from_attributes=True).model_dump(
        by_alias=True, exclude_none=True
    )


def folder_counts(db: Session, folder_ids: list[str]) -> dict[str, int]:
    """Live chat counts per folder (active, non-deleted, normal chats)."""
    if not folder_ids:
        return {}
    rows = (
        db.query(ChatSession.folder_id, func.count(ChatSession.id))
        .filter(
            ChatSession.folder_id.in_(folder_ids),
            ChatSession.deleted_at.is_(None),
            ChatSession.archived_at.is_(None),
            ChatSession.kind == KIND_CHAT,
        )
        .group_by(ChatSession.folder_id)
        .all()
    )
    return {fid: n for fid, n in rows}


def folders_out(db: Session, rows: list[Folder]) -> list[dict]:
    counts = folder_counts(db, [f.id for f in rows])
    return [folder_out(f, counts.get(f.id, 0)) for f in rows]


def visible_sessions_query(
    db: Session,
    ctx: RequestContext,
    *,
    archived: bool = False,
    kind: str = KIND_CHAT,
) -> SAQuery:
    q = db.query(ChatSession).filter(ChatSession.deleted_at.is_(None))
    if kind == KIND_CHIEF:
        q = q.filter(ChatSession.kind == KIND_CHIEF, ChatSession.owner_user_id == ctx.user_id)
    else:
        q = q.filter(ChatSession.kind == KIND_CHAT)
    if archived:
        q = q.filter(ChatSession.archived_at.is_not(None)).order_by(ChatSession.archived_at.desc())
    else:
        q = q.filter(ChatSession.archived_at.is_(None)).order_by(ChatSession.created_at.desc())
    return q


def load_visible_session(
    db: Session,
    ctx: RequestContext,
    session_id: str,
    *,
    allow_archived: bool = True,
) -> ChatSession | None:
    row = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if row is None or row.deleted_at is not None:
        return None
    if row.kind == KIND_CHIEF and row.owner_user_id != ctx.user_id:
        return None
    if not allow_archived and row.archived_at is not None:
        return None
    return row


def _require_session(db: Session, ctx: RequestContext, session_id: str) -> ChatSession:
    row = load_visible_session(db, ctx, session_id)
    if row is None:
        raise _404
    return row


def _require_folder(db: Session, folder_id: str) -> Folder:
    row = db.query(Folder).filter(Folder.id == folder_id).first()
    if row is None:
        raise _404
    return row


# ── Members lookup (User is a global table → privileged session) ─────────────


def _company_people(company_id: str) -> dict[str, dict[str, str]]:
    with SessionLocal() as s:
        rows = (
            s.query(Member, User)
            .join(User, User.id == Member.user_id)
            .filter(Member.company_id == company_id)
            .all()
        )
    return {u.id: {"name": u.name, "email": u.email, "role": m.role} for m, u in rows}


class ShareMember(BaseModel):
    user_id: str
    permission: Literal["can_talk", "can_view"] = "can_talk"


class PutSharesBody(BaseModel):
    members: list[ShareMember] = Field(default_factory=list)
    general_access: Optional[Literal["restricted", "company"]] = None


def _shares_out(
    company_id: str,
    shares: list[dict],
    *,
    owner_user_id: str | None,
    general_access: str | None,
) -> dict[str, Any]:
    people = _company_people(company_id)
    members: list[dict[str, Any]] = []
    if owner_user_id and owner_user_id in people:
        p = people[owner_user_id]
        members.append(
            {"userId": owner_user_id, "name": p["name"], "email": p["email"], "permission": "owner"}
        )
    for sh in shares or []:
        uid = sh.get("user_id")
        if not uid or uid == owner_user_id or uid not in people:
            continue
        p = people[uid]
        members.append(
            {"userId": uid, "name": p["name"], "email": p["email"], "permission": sh.get("permission", "can_talk")}
        )
    out: dict[str, Any] = {"members": members}
    if general_access is not None:
        out["generalAccess"] = general_access
    return out


def _validated_shares(company_id: str, body: PutSharesBody, owner_user_id: str | None) -> list[dict]:
    people = _company_people(company_id)
    seen: set[str] = set()
    result: list[dict] = []
    for m in body.members:
        if m.user_id not in people:
            raise HTTPException(status_code=422, detail=f"Unknown member: {m.user_id}")
        if m.user_id == owner_user_id or m.user_id in seen:
            continue
        seen.add(m.user_id)
        result.append({"user_id": m.user_id, "permission": m.permission})
    return result


# ── Sessions ──────────────────────────────────────────────────────────────────


class PatchSessionBody(BaseModel):
    title: Optional[str] = None
    folder_id: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    goal_id: Optional[str] = None
    model: Optional[str] = None

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("title must not be empty")
        return v.strip() if v is not None else v


@router.delete("/sessions/archived")
def delete_archived_sessions(
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, int]:
    q = visible_sessions_query(db, ctx, archived=True)
    if channel_id:
        q = q.filter(ChatSession.channel_id == channel_id)
    rows = q.all()
    now = _now()
    for r in rows:
        r.deleted_at = now
    db.flush()
    return {"deleted": len(rows)}


@router.patch("/sessions/{session_id}", response_model=SessionOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
def patch_session(
    session_id: str,
    body: PatchSessionBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    row = _require_session(db, ctx, session_id)
    fields = body.model_fields_set

    if "title" in fields and body.title:
        row.title = body.title
    if "folder_id" in fields:
        if body.folder_id is None:
            row.folder_id = None
        else:
            folder = _require_folder(db, body.folder_id)
            row.folder_id = folder.id
            if row.channel_id is None:
                row.channel_id = folder.channel_id
    if "pinned" in fields and body.pinned is not None:
        pins = [u for u in (row.pinned_by or []) if u != ctx.user_id]
        if body.pinned:
            pins.append(ctx.user_id)
        row.pinned_by = pins
        flag_modified(row, "pinned_by")
    if "archived" in fields and body.archived is not None:
        row.archived_at = _now() if body.archived else None
    if "goal_id" in fields:
        if body.goal_id is None:
            row.goal_id = None
            row.goal = None
        else:
            goal = db.query(Goal).filter(Goal.id == body.goal_id).first()
            if goal is None:
                raise HTTPException(status_code=422, detail="Unknown goal.")
            row.goal_id = goal.id
            row.goal = goal.title
    if "model" in fields:
        row.model = body.model
    db.flush()
    return session_out(row, ctx.user_id)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> Response:
    row = _require_session(db, ctx, session_id)
    row.deleted_at = _now()
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions/{session_id}/shares")
def get_session_shares(
    session_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    row = _require_session(db, ctx, session_id)
    return _shares_out(
        ctx.company_id, row.shares or [], owner_user_id=row.owner_user_id, general_access=row.general_access
    )


@router.put("/sessions/{session_id}/shares")
def put_session_shares(
    session_id: str,
    body: PutSharesBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    row = _require_session(db, ctx, session_id)
    if row.kind == KIND_CHIEF:
        raise HTTPException(status_code=409, detail="Private Chief chats can't be shared.")
    row.shares = _validated_shares(ctx.company_id, body, row.owner_user_id)
    flag_modified(row, "shares")
    if body.general_access is not None:
        row.general_access = body.general_access
    db.flush()
    return _shares_out(
        ctx.company_id, row.shares, owner_user_id=row.owner_user_id, general_access=row.general_access
    )


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


_STEP_STATUS = {
    "done": "done",
    "waiting": "waiting",
    "failed": "failed",
    "running": "running",
    "queued": "pending",
    "pending": "pending",
    "cancelled": "failed",
}


@router.get("/sessions/{session_id}/results")
def get_session_results(
    session_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Progress / outputs / browser-tool activity for a chat, derived from its jobs.

    - steps:    one per Job run in this session (brief, helper, status, timing)
    - outputs:  Reports written by those jobs (headline + markdown body)
    - activity: tool RunEvents (executed actions; url/title when present) —
                the Browser panel shows these; empty when nothing was browsed.
    """
    _require_session(db, ctx, session_id)
    jobs = (
        db.query(Job)
        .filter(Job.session_id == session_id)
        .order_by(Job.created_at)
        .all()
    )
    job_ids = [j.id for j in jobs]
    helper_ids = {j.helper_id for j in jobs}
    helpers = (
        {h.id: h for h in db.query(Helper).filter(Helper.id.in_(helper_ids)).all()}
        if helper_ids
        else {}
    )

    def helper_name(hid: str) -> str:
        h = helpers.get(hid)
        return h.name if h else "Helper"

    steps = []
    tokens_in = tokens_out = cost = 0
    for j in jobs:
        duration = None
        if j.started_at and j.ended_at:
            duration = int((j.ended_at - j.started_at).total_seconds())
        brief = (j.brief or "").strip().splitlines()[0] if j.brief else ""
        steps.append(
            {
                "id": j.id,
                "label": brief[:120] or "Helper turn",
                "status": _STEP_STATUS.get(j.status, j.status),
                "helper": helper_name(j.helper_id),
                "helperArea": helpers[j.helper_id].area if j.helper_id in helpers else None,
                "startedAt": _iso(j.started_at),
                "endedAt": _iso(j.ended_at),
                "durationS": duration,
            }
        )
        tokens_in += j.tokens_in or 0
        tokens_out += j.tokens_out or 0
        cost += j.cost_credits or 0

    outputs = []
    if job_ids:
        for r in db.query(Report).filter(Report.job_id.in_(job_ids)).order_by(Report.created_at).all():
            outputs.append(
                {
                    "id": r.id,
                    "jobId": r.job_id,
                    "title": r.headline,
                    "bodyMd": r.body_md,
                    "helper": helper_name(r.helper_id),
                    "createdAt": _iso(r.created_at),
                }
            )

    activity = []
    if job_ids:
        events = (
            db.query(RunEvent)
            .filter(RunEvent.job_id.in_(job_ids), RunEvent.kind.in_(("tool", "browser")))
            .order_by(RunEvent.at)
            .all()
        )
        for ev in events:
            data = ev.data or {}
            action = data.get("executed") if isinstance(data.get("executed"), dict) else data
            action = action or {}
            activity.append(
                {
                    "id": ev.id,
                    "jobId": ev.job_id,
                    "helper": helper_name(ev.helper_id),
                    "kind": ev.kind,
                    "action": str(action.get("type") or action.get("tool") or action.get("action") or ev.kind),
                    "url": action.get("url") or data.get("url"),
                    "title": action.get("title") or action.get("summary") or data.get("title"),
                    "at": _iso(ev.at),
                }
            )

    return {
        "steps": steps,
        "outputs": outputs,
        "activity": activity,
        "usage": {"tokensIn": tokens_in, "tokensOut": tokens_out, "costCredits": cost},
    }


# ── Folders ───────────────────────────────────────────────────────────────────


class CreateFolderBody(BaseModel):
    channel_id: str
    name: str
    icon: Optional[str] = None
    color: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


class PatchFolderBody(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    instructions: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name must not be empty")
        return v.strip() if v is not None else v


@router.get("/folders/{folder_id}", response_model=FolderOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
def get_folder(folder_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = _require_folder(db, folder_id)
    return folder_out(row, folder_counts(db, [row.id]).get(row.id, 0))


@router.post("/folders", response_model=FolderOutDTO, response_model_by_alias=True, response_model_exclude_none=True, status_code=status.HTTP_201_CREATED)
def create_folder(
    body: CreateFolderBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    channel = db.query(Channel).filter(Channel.id == body.channel_id).first()
    if channel is None:
        raise HTTPException(status_code=422, detail="Unknown area.")
    row = Folder(
        id=prefixed_id("fld"),
        company_id=ctx.company_id,
        channel_id=channel.id,
        name=body.name,
        count=0,
        icon=body.icon,
        color=body.color,
        instructions="",
        shares=[],
    )
    db.add(row)
    db.flush()
    return folder_out(row, 0)


@router.patch("/folders/{folder_id}", response_model=FolderOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
def patch_folder(folder_id: str, body: PatchFolderBody, db: Session = Depends(get_tenant_db)) -> dict:
    row = _require_folder(db, folder_id)
    fields = body.model_fields_set
    if "name" in fields and body.name:
        row.name = body.name
    if "icon" in fields:
        row.icon = body.icon or None
    if "color" in fields:
        row.color = body.color or None
    if "instructions" in fields:
        row.instructions = body.instructions or ""
    db.flush()
    return folder_out(row, folder_counts(db, [row.id]).get(row.id, 0))


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(folder_id: str, db: Session = Depends(get_tenant_db)) -> Response:
    row = _require_folder(db, folder_id)
    db.query(ChatSession).filter(ChatSession.folder_id == row.id).update(
        {ChatSession.folder_id: None}, synchronize_session=False
    )
    db.delete(row)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class AddFolderFileBody(BaseModel):
    name: str
    size: int = 0
    mime: Optional[str] = None
    # Extracted text of text-like files (helpers read it as folder context).
    text: Optional[str] = Field(default=None, max_length=2_000_000)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()


def _file_out(f: FolderFile) -> dict[str, Any]:
    return {
        "id": f.id,
        "folderId": f.folder_id,
        "name": f.name,
        "size": f.size,
        "mime": f.mime,
        "hasText": bool(f.text),
        "createdAt": _iso(f.created_at),
    }


@router.get("/folders/{folder_id}/files")
def list_folder_files(folder_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    _require_folder(db, folder_id)
    rows = (
        db.query(FolderFile)
        .filter(FolderFile.folder_id == folder_id)
        .order_by(FolderFile.created_at)
        .all()
    )
    return [_file_out(f) for f in rows]


@router.post("/folders/{folder_id}/files", status_code=status.HTTP_201_CREATED)
def add_folder_file(
    folder_id: str,
    body: AddFolderFileBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    _require_folder(db, folder_id)
    from omilo.billing.storage import check_upload

    check_upload(ctx.company_id, len((body.text or "").encode()) or max(0, body.size))
    f = FolderFile(
        id=prefixed_id("ffl"),
        company_id=ctx.company_id,
        folder_id=folder_id,
        name=body.name,
        size=max(0, body.size),
        mime=body.mime,
        text=body.text,
        uploaded_by=ctx.user_id,
    )
    db.add(f)
    db.flush()
    return _file_out(f)


@router.delete("/folders/{folder_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder_file(folder_id: str, file_id: str, db: Session = Depends(get_tenant_db)) -> Response:
    f = (
        db.query(FolderFile)
        .filter(FolderFile.id == file_id, FolderFile.folder_id == folder_id)
        .first()
    )
    if f is None:
        raise _404
    db.delete(f)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/folders/{folder_id}/shares")
def get_folder_shares(
    folder_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    row = _require_folder(db, folder_id)
    return _shares_out(ctx.company_id, row.shares or [], owner_user_id=None, general_access=None)


@router.put("/folders/{folder_id}/shares")
def put_folder_shares(
    folder_id: str,
    body: PutSharesBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    row = _require_folder(db, folder_id)
    row.shares = _validated_shares(ctx.company_id, body, None)
    flag_modified(row, "shares")
    db.flush()
    return _shares_out(ctx.company_id, row.shares, owner_user_id=None, general_access=None)


# ── Areas (looks) ─────────────────────────────────────────────────────────────


class PatchChannelBody(BaseModel):
    name: Optional[str] = None
    purpose: Optional[str] = None
    icon: Optional[str] = None
    color: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("name must not be empty")
        return v.strip() if v is not None else v


@router.patch("/channels/{channel_id}", response_model=ChannelOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
def patch_channel(channel_id: str, body: PatchChannelBody, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(Channel).filter(Channel.id == channel_id).first()
    if row is None:
        raise _404
    fields = body.model_fields_set
    if "name" in fields and body.name:
        row.name = body.name
    if "purpose" in fields:
        row.purpose = body.purpose
    if "icon" in fields:
        row.icon = body.icon or None
    if "color" in fields:
        row.color = body.color or None
    db.flush()
    return channel_out(row)


# ── Chief nudges ──────────────────────────────────────────────────────────────


class DismissNudgeBody(BaseModel):
    snooze_until: Optional[datetime] = None


def _nudge_states(db: Session, user_id: str) -> dict[str, ChiefNudgeState]:
    rows = db.query(ChiefNudgeState).filter(ChiefNudgeState.user_id == user_id).all()
    return {r.nudge_key: r for r in rows}


@router.get("/chief/nudges")
def list_chief_nudges(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Derived nudges: pending inbox items that need the operator.

    Rule (kept simple): every pending item flagged needs_you becomes a nudge
    (decisions first, oldest first), unless this user dismissed it — a
    dismissal with snooze_until hides it only until that time. Max 3.
    """
    now = _now()
    states = _nudge_states(db, ctx.user_id)
    items = (
        db.query(InboxItem)
        .filter(InboxItem.needs_you.is_(True), InboxItem.status == "pending")
        .order_by(InboxItem.created_at)
        .all()
    )
    items.sort(key=lambda i: 0 if i.kind == "decision" else 1)
    out: list[dict[str, Any]] = []
    for it in items:
        key = f"inbox:{it.id}"
        st = states.get(key)
        if st is not None:
            if st.snooze_until is None:
                continue
            snooze = st.snooze_until if st.snooze_until.tzinfo else st.snooze_until.replace(tzinfo=timezone.utc)
            if snooze > now:
                continue
        verb = "needs your decision on" if it.kind == "decision" else "is waiting on you for"
        out.append(
            {
                "id": key,
                "body": f"Got two minutes? {it.asker} {verb} “{it.title}”.",
                "prompt": f"Walk me through “{it.title}” — what does {it.asker} need from me?",
                "primary": "Walk me through",
                "secondary": "Later",
                "inboxItemId": it.id,
                "sessionId": it.session_id,
                "createdAt": _iso(it.created_at),
            }
        )
        if len(out) == 3:
            break
    return out


@router.post("/chief/nudges/{nudge_id}/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_chief_nudge(
    nudge_id: str,
    body: DismissNudgeBody | None = None,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> Response:
    snooze = body.snooze_until if body else None
    st = (
        db.query(ChiefNudgeState)
        .filter(ChiefNudgeState.user_id == ctx.user_id, ChiefNudgeState.nudge_key == nudge_id)
        .first()
    )
    if st is None:
        st = ChiefNudgeState(
            id=prefixed_id("cns"),
            company_id=ctx.company_id,
            user_id=ctx.user_id,
            nudge_key=nudge_id,
            dismissed_at=_now(),
            snooze_until=snooze,
        )
        db.add(st)
    else:
        st.dismissed_at = _now()
        st.snooze_until = snooze
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = [
    "router",
    "session_out",
    "folder_out",
    "folders_out",
    "channel_out",
    "folder_counts",
    "visible_sessions_query",
    "load_visible_session",
    "KIND_CHAT",
    "KIND_CHIEF",
    "SESSION_KINDS",
]
