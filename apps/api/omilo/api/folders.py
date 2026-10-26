"""GET /v1/folders — Repos-parity read endpoints for folders.

Endpoints:
  GET /folders → Folder[]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from omilo.models.workspace import Folder
from omilo.schemas.read import FolderDTO
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["folders"])


@router.get("/folders", response_model=list[FolderDTO], response_model_by_alias=True)
def list_folders(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Folder).all()
    return [FolderDTO.model_validate(r, from_attributes=True).model_dump(by_alias=True, exclude_none=True) for r in rows]
