"""omilo.api.knowledge — KB ingestion + recall endpoints.

Endpoints
---------
POST /v1/knowledge/sources
    Body: {kind, ref, title, body}
    → index_source → {source_id, chunks}

GET /v1/knowledge?q=&kind=
    → recall(db, q, kinds=[kind] if kind else None) → list[dict]
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.kb.db import get_knowledge_db
from omilo.kb.index import index_source
from omilo.kb.retrieve import recall
from omilo.models.knowledge import KbChunk

router = APIRouter(tags=["knowledge"])


class IndexSourceRequest(BaseModel):
    kind: str
    ref: str
    title: str
    body: str
    helper_id: str | None = None


@router.post("/knowledge/sources")
def post_knowledge_source(
    req: IndexSourceRequest,
    db: Session = Depends(get_knowledge_db),
) -> dict:
    """Index a new (or updated) KB source.

    Returns the source_id and chunk count.
    """
    src = index_source(
        db,
        kind=req.kind,
        ref=req.ref,
        title=req.title,
        body=req.body,
        helper_id=req.helper_id,
    )
    chunks = db.query(KbChunk).filter_by(source_id=src.id).count()
    return {"source_id": src.id, "chunks": chunks}


@router.get("/knowledge")
def get_knowledge(
    q: str = Query(default="", description="Recall query"),
    kind: str | None = Query(default=None, description="Filter by KbKind"),
    k: int = Query(default=8, ge=1, le=50, description="Max results"),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    """Hybrid KB recall: FTS + vector + RRF.

    Returns a ranked list of [{source_id, heading, text, kind, score}].
    Returns [] for empty query or empty KB.
    """
    kinds = [kind] if kind else None
    return recall(db, q, kinds=kinds, k=k)
