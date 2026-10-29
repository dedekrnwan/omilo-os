"""Channel endpoints — read (GET) + write (POST).

Endpoints:
  GET  /channels            → Channel[]
  GET  /channels/{id}       → Channel | 404
  GET  /channels/{id}/folders → Folder[]
  GET  /channels/{id}/goals   → Goal[]
  GET  /channels/{id}/sessions → Session[]
  POST /channels            → Channel (created; 201)
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from omilo.models.base import prefixed_id
from omilo.models.workspace import Channel, Folder, Goal
from omilo.models.chat import ChatSession
from omilo.schemas.read import ChannelDTO, FolderDTO, GoalDTO, SessionDTO
from omilo.api.goals_write import goal_dtos
from omilo.schemas.read import ChannelOutDTO, FolderOutDTO, SessionOutDTO  # sweep/chat
from omilo.api.chat_workspace import channel_out, folders_out, session_out, visible_sessions_query  # sweep/chat
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["channels"])


# ── Request schema ────────────────────────────────────────────────────────────


class CreateChannelBody(BaseModel):
    name: str
    accent: Optional[str] = "general"
    icon: Optional[str] = None
    purpose: Optional[str] = None
    context_scope: Optional[str] = "isolated"
    # ── sweep/chat ──
    color: Optional[str] = None          # hex look colour
    helper_ids: Optional[list[str]] = None  # helpers (besides Chief) joining the area

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


@router.get("/channels", response_model=list[ChannelOutDTO], response_model_by_alias=True, response_model_exclude_none=True)
def list_channels(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Channel).all()
    return [channel_out(r) for r in rows]


@router.get("/channels/{channel_id}", response_model=ChannelOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
    # sweep/control — archived channels are read-only and hidden from the app.
    rows = db.query(Channel).filter(Channel.archived_at.is_(None)).all()
    return [ChannelDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


# ── sweep/control: control-panel channel management ─────────────────────────
#   GET    /channels/manage   → every channel (incl. archived) with real counts
#   PATCH  /channels/{id}     {archived?, muted?, name?, purpose?, context_scope?}
#   DELETE /channels/{id}     → 204 (not the default channel)
# (declared before /channels/{channel_id} so "manage" isn't read as an id)


class PatchChannelBody(BaseModel):
    archived: Optional[bool] = None
    muted: Optional[bool] = None
    name: Optional[str] = None
    purpose: Optional[str] = None
    context_scope: Optional[str] = None
    accent: Optional[str] = None
    icon: Optional[str] = None


def _manage_dict(ch: Channel, *, chats: int, goals: int, helpers: list[dict], people: int | None) -> dict:
    return {
        "id": ch.id,
        "name": ch.name,
        "accent": ch.accent,
        "icon": ch.icon,
        "purpose": ch.purpose,
        "is_default": bool(ch.is_default),
        "context_scope": ch.context_scope or "isolated",
        "chat_count": chats,
        "goal_count": goals,
        "helpers": helpers,
        "helper_count": len(helpers),
        # None = everyone in the company can work here.
        "people_count": people,
        "archived": ch.archived_at is not None,
        "archived_at": ch.archived_at.isoformat() if ch.archived_at else None,
        "muted": bool(ch.muted),
    }


def _manage_rows(db: Session, ctx: RequestContext, channels: list[Channel]) -> list[dict]:
    from sqlalchemy import func

    from omilo.db import SessionLocal
    from omilo.models.agents import Helper
    from omilo.models.tenancy import Member

    ids = [c.id for c in channels]
    chat_counts = dict(
        db.query(ChatSession.channel_id, func.count(ChatSession.id))
        .filter(ChatSession.channel_id.in_(ids))
        .group_by(ChatSession.channel_id)
        .all()
    ) if ids else {}
    goal_counts = dict(
        db.query(Goal.channel_id, func.count(Goal.id))
        .filter(Goal.channel_id.in_(ids))
        .group_by(Goal.channel_id)
        .all()
    ) if ids else {}
    helpers = db.query(Helper).all()
    with SessionLocal() as s:
        members = s.query(Member).filter(Member.company_id == ctx.company_id).all()
    total_people = len(members)
    out = []
    for ch in channels:
        chs = [
            {"id": h.id, "name": h.name, "area": h.area, "is_chief": bool(h.is_chief)}
            for h in helpers
            if ch.id in (h.channel_ids or []) or (h.is_chief and ch.is_default)
        ]
        restricted = [m for m in members if isinstance(m.channels, list) and m.channels]
        if ch.is_default:
            people: int | None = None
        else:
            people = total_people - len(restricted) + sum(1 for m in restricted if ch.id in m.channels)
            if people == total_people:
                people = None
        out.append(
            _manage_dict(
                ch,
                chats=int(chat_counts.get(ch.id, 0)),
                goals=int(goal_counts.get(ch.id, 0)),
                helpers=chs,
                people=people,
            )
        )
    return out


@router.get("/channels/manage")
def manage_channels(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict]:
    rows = db.query(Channel).order_by(Channel.is_default.desc().nullslast(), Channel.created_at).all()
    return _manage_rows(db, ctx, rows)


@router.patch("/channels/{channel_id}")
def patch_channel(
    channel_id: str,
    body: PatchChannelBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    from datetime import datetime, timezone

    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can change channels.")
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if ch is None:
        raise _404
    from omilo import audit

    if body.archived is not None:
        if ch.is_default and body.archived:
            raise HTTPException(status_code=400, detail="The default channel can't be archived.")
        was = ch.archived_at is not None
        ch.archived_at = datetime.now(timezone.utc) if body.archived else None
        if was != body.archived:
            audit.record_ctx(ctx, type="channels", action="archived" if body.archived else "restored", target=ch.name)
    if body.muted is not None:
        ch.muted = body.muted
        audit.record_ctx(ctx, type="channels", action="muted" if body.muted else "unmuted", target=ch.name)
    if body.name is not None and body.name.strip():
        ch.name = body.name.strip()
    if body.purpose is not None:
        ch.purpose = body.purpose
    if body.context_scope is not None:
        ch.context_scope = body.context_scope
    if body.accent is not None:
        ch.accent = body.accent
    if body.icon is not None:
        ch.icon = body.icon
    db.flush()
    return _manage_rows(db, ctx, [ch])[0]


@router.delete("/channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    channel_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owners and admins can remove channels.")
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if ch is None:
        raise _404
    if ch.is_default:
        raise HTTPException(status_code=400, detail="The default channel can't be removed.")
    name = ch.name
    db.delete(ch)
    db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="channels", action="removed", target=name)


@router.get("/channels/{channel_id}", response_model=ChannelDTO, response_model_by_alias=True)
def get_channel(channel_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(Channel).filter(Channel.id == channel_id).first()
    if row is None:
        raise _404
    return channel_out(row)


@router.get(
    "/channels/{channel_id}/folders",
    response_model=list[FolderOutDTO],
    response_model_by_alias=True,
    response_model_exclude_none=True,
)
def list_channel_folders(channel_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Folder).filter(Folder.channel_id == channel_id).order_by(Folder.created_at).all()
    return folders_out(db, rows)


@router.get(
    "/channels/{channel_id}/goals",
    response_model=list[GoalDTO],
    response_model_by_alias=True,
)
def list_channel_goals(channel_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Goal).filter(Goal.channel_id == channel_id).order_by(Goal.created_at.asc()).all()
    return goal_dtos(db, rows)


@router.get(
    "/channels/{channel_id}/sessions",
    response_model=list[SessionOutDTO],
    response_model_by_alias=True,
    response_model_exclude_none=True,
)
def list_channel_sessions(
    channel_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict]:
    rows = visible_sessions_query(db, ctx).filter(ChatSession.channel_id == channel_id).all()
    return [session_out(r, ctx.user_id) for r in rows]


@router.post("/channels", response_model=ChannelDTO, response_model_by_alias=True, status_code=status.HTTP_201_CREATED)
def create_channel(
    body: CreateChannelBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Create a new Channel (Area) scoped to the active company.

    company_id comes from the RLS context (ctx.company_id); the DB enforces
    isolation — a user from another company cannot read or write this row.
    """
    channel = Channel(
        id=prefixed_id("chn"),
        company_id=ctx.company_id,
        name=body.name,
        accent=body.accent or "general",
        is_default=False,
        agent_count=0,
        chat_count=0,
        open_items=0,
        icon=body.icon,
        purpose=body.purpose,
        context_scope=body.context_scope or "isolated",
        color=body.color,  # sweep/chat
    )
    db.add(channel)
    db.flush()
    # sweep/chat: helpers toggled on in the create dialog join the area.
    if body.helper_ids:
        from sqlalchemy.orm.attributes import flag_modified

        from omilo.models.agents import Helper

        joined = 0
        for h in db.query(Helper).filter(Helper.id.in_(body.helper_ids)).all():
            if h.is_chief:
                continue
            h.channel_ids = [*(h.channel_ids or []), channel.id]
            flag_modified(h, "channel_ids")
            joined += 1
        channel.agent_count = joined
        db.flush()
    from omilo import audit

    audit.record_ctx(ctx, type="channels", action="created", target=channel.name)
    return ChannelDTO.model_validate(channel, from_attributes=True).model_dump(by_alias=True, exclude_none=False)
