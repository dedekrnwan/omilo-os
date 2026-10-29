"""GET /v1/folders — Repos-parity read endpoints for folders.

Endpoints:
  GET /folders → Folder[]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from omilo.models.workspace import Folder
from omilo.schemas.read import FolderDTO
from omilo.schemas.read import FolderOutDTO  # sweep/chat
from omilo.api.chat_workspace import folders_out  # sweep/chat
from omilo.tenancy.deps import get_tenant_db

router = APIRouter(tags=["folders"])


@router.get("/folders", response_model=list[FolderOutDTO], response_model_by_alias=True, response_model_exclude_none=True)
def list_folders(db: Session = Depends(get_tenant_db)) -> list[dict]:
    rows = db.query(Folder).order_by(Folder.created_at).all()
    return folders_out(db, rows)
