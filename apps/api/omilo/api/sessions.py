"""GET /v1/sessions — Repos-parity read endpoints for sessions and messages.

Endpoints:
  GET /sessions               → SessionDTO[]
  GET /sessions/{id}          → SessionDTO | 404
  GET /sessions/{id}/messages → Message[]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from omilo.models.chat import ChatSession, Message
from omilo.schemas.read import MessageDTO, SessionDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["sessions"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


@router.get("/sessions", response_model=list[SessionDTO], response_model_by_alias=True)
def list_sessions(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(ChatSession).all()
    return [SessionDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


@router.get("/sessions/{session_id}", response_model=SessionDTO, response_model_by_alias=True)
def get_session(session_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if row is None:
        raise _404
    return SessionDTO.model_validate(row, from_attributes=True).model_dump(by_alias=True, exclude_none=True)


@router.get(
    "/sessions/{session_id}/messages",
    response_model=list[MessageDTO],
    response_model_by_alias=True,
)
def list_session_messages(session_id: str, db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Message).filter(Message.session_id == session_id).all()
    return [MessageDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]
