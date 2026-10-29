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

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


@router.get("/channels", response_model=list[ChannelDTO], response_model_by_alias=True)
def list_channels(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Channel).all()
    return [ChannelDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


@router.get("/channels/{channel_id}", response_model=ChannelDTO, response_model_by_alias=True)
def get_channel(channel_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(Channel).filter(Channel.id == channel_id).first()
    if row is None:
        raise _404
    return ChannelDTO.model_validate(row, from_attributes=True).model_dump(by_alias=True, exclude_none=True)


@router.get(
    "/channels/{channel_id}/folders",
    response_model=list[FolderDTO],
    response_model_by_alias=True,
)
def list_channel_folders(channel_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Folder).filter(Folder.channel_id == channel_id).all()
    return [FolderDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


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
    response_model=list[SessionDTO],
    response_model_by_alias=True,
)
def list_channel_sessions(channel_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(ChatSession).filter(ChatSession.channel_id == channel_id).all()
    return [SessionDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


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
    )
    db.add(channel)
    db.flush()
    return ChannelDTO.model_validate(channel, from_attributes=True).model_dump(by_alias=True, exclude_none=False)
