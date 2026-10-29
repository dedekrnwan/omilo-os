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
    return ChannelDTO.model_validate(channel, from_attributes=True).model_dump(by_alias=True, exclude_none=False)
