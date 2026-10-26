"""GET /v1/goals — Repos-parity read endpoints for goals.

Endpoints:
  GET /goals → Goal[]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from omilo.models.workspace import Goal
from omilo.schemas.read import GoalDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["goals"])


@router.get("/goals", response_model=list[GoalDTO], response_model_by_alias=True)
def list_goals(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Goal).all()
    return [GoalDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]
