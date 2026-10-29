"""GET /v1/sessions — Repos-parity read endpoints for sessions and messages.

Endpoints:
  GET /sessions               → SessionDTO[]
        ?archived=1           → archived chats only (newest first)
        ?kind=chief_private   → the caller's private Chief threads
        ?channel_id=…         → narrow to one area (with archived=1)
  GET /sessions/{id}          → SessionDTO | 404
  GET /sessions/{id}/messages → Message[]

Default listing hides archived, soft-deleted and private Chief threads.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from omilo.api.chat_workspace import (
    load_visible_session,
    session_out,
    visible_sessions_query,
)
from omilo.models.chat import Message
from omilo.schemas.read import MessageDTO, SessionOutDTO
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["sessions"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


@router.get("/sessions", response_model=list[SessionOutDTO], response_model_by_alias=True, response_model_exclude_none=True)
def list_sessions(
    archived: bool = Query(default=False),
    kind: Optional[str] = Query(default=None),
    channel_id: Optional[str] = Query(default=None),
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict]:
    q = visible_sessions_query(db, ctx, archived=archived, kind=kind or "chat")
    if channel_id:
        from omilo.models.chat import ChatSession

        q = q.filter(ChatSession.channel_id == channel_id)
    return [session_out(r, ctx.user_id) for r in q.all()]


@router.get("/sessions/{session_id}", response_model=SessionOutDTO, response_model_by_alias=True, response_model_exclude_none=True)
def get_session(
    session_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    row = load_visible_session(db, ctx, session_id, allow_archived=True)
    if row is None:
        raise _404
    return session_out(row, ctx.user_id)


@router.get(
    "/sessions/{session_id}/messages",
    response_model=list[MessageDTO],
    response_model_by_alias=True,
)
def list_session_messages(
    session_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict]:
    from omilo.models.chat import ChatSession

    exists = db.query(ChatSession.id).filter(ChatSession.id == session_id).first()
    if exists is not None and load_visible_session(db, ctx, session_id, allow_archived=True) is None:
        raise _404
    rows = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at)
        .all()
    )
    return [MessageDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]
