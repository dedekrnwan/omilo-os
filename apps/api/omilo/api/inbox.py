"""GET /v1/inbox — Repos-parity read endpoints for inbox items.

Endpoints:
  GET /inbox      → InboxItem[]
  GET /inbox/{id} → InboxItem | 404
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from omilo.models.inbox import InboxItem
from omilo.schemas.read import InboxItemDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["inbox"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


@router.get("/inbox", response_model=list[InboxItemDTO], response_model_by_alias=True)
def list_inbox(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(InboxItem).all()
    return [InboxItemDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]


@router.get("/inbox/{item_id}", response_model=InboxItemDTO, response_model_by_alias=True)
def get_inbox_item(item_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(InboxItem).filter(InboxItem.id == item_id).first()
    if row is None:
        raise _404
    return InboxItemDTO.model_validate(row, from_attributes=True).model_dump(by_alias=True, exclude_none=True)
