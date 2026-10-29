"""GET /v1/inbox — Repos-parity read endpoints for inbox items (+ read state).

Endpoints:
  GET  /inbox            → InboxItem[] (newest first)
  GET  /inbox/{id}       → InboxItem | 404
  POST /inbox/{id}/read  → InboxItem (read_at set; idempotent)
  POST /inbox/read-all {before?} → {updated: n}

``proposals`` is always a list of {who, area, text, due, proposalId?, type?,
risk?, …}. When the linked Proposal has an assignee / due date (edited from the
review dialog) those override ``who`` / ``due``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.models.approvals import Proposal
from omilo.models.inbox import InboxItem
from omilo.schemas.read import InboxItemDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["inbox"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


class ReadAllBody(BaseModel):
    before: Optional[datetime] = None


def _dump(rows: list[InboxItem], db: Session) -> list[dict[str, Any]]:
    out = [
        InboxItemDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True)
        for r in rows
    ]
    pids = {r.proposal_id for r in rows if r.proposal_id}
    if pids:
        props = {p.id: p for p in db.query(Proposal).filter(Proposal.id.in_(pids)).all()}
        for item in out:
            for entry in item.get("proposals") or []:
                p = props.get(entry.get("proposalId"))
                if p is None:
                    continue
                if p.assignee:
                    entry["who"] = p.assignee
                if p.due:
                    entry["due"] = p.due
                entry["status"] = p.status
    return out


@router.get("/inbox", response_model=list[InboxItemDTO], response_model_by_alias=True)
def list_inbox(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(InboxItem).order_by(InboxItem.created_at.desc(), InboxItem.id.desc()).all()
    return _dump(rows, db)


@router.get("/inbox/{item_id}", response_model=InboxItemDTO, response_model_by_alias=True)
def get_inbox_item(item_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(InboxItem).filter(InboxItem.id == item_id).first()
    if row is None:
        raise _404
    return _dump([row], db)[0]


# ── sweep/inbox-flows: read state ────────────────────────────────────────────


@router.post("/inbox/read-all")
def read_all(body: ReadAllBody = ReadAllBody(), db: Session = Depends(get_tenant_db)) -> dict:
    """Mark every unread item (optionally only those created before ``before``) read."""
    q = db.query(InboxItem).filter(InboxItem.read_at.is_(None))
    if body.before is not None:
        q = q.filter(InboxItem.created_at <= body.before)
    now = datetime.now(timezone.utc)
    rows = q.all()
    for r in rows:
        r.read_at = now
    db.flush()
    return {"updated": len(rows)}


@router.post("/inbox/{item_id}/read", response_model=InboxItemDTO, response_model_by_alias=True)
def read_item(item_id: str, db: Session = Depends(get_tenant_db)) -> dict:
    row = db.query(InboxItem).filter(InboxItem.id == item_id).first()
    if row is None:
        raise _404
    if row.read_at is None:
        row.read_at = datetime.now(timezone.utc)
        db.flush()
    return _dump([row], db)[0]
