"""GET /v1/channels — Repos-parity read endpoints for channels.

Endpoints:
  GET /channels            → Channel[]
  GET /channels/{id}       → Channel | 404
  GET /channels/{id}/folders → Folder[]
  GET /channels/{id}/goals   → Goal[]
  GET /channels/{id}/sessions → Session[]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from omilo.models.workspace import Channel, Folder, Goal
from omilo.models.chat import ChatSession
from omilo.schemas.read import ChannelDTO, FolderDTO, GoalDTO, SessionDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["channels"])

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
    rows = db.query(Goal).filter(Goal.channel_id == channel_id).all()
    return [GoalDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


@router.get(
    "/channels/{channel_id}/sessions",
    response_model=list[SessionDTO],
    response_model_by_alias=True,
)
def list_channel_sessions(channel_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(ChatSession).filter(ChatSession.channel_id == channel_id).all()
    return [SessionDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]
