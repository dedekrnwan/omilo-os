"""omilo.api.memory — editable memory doc endpoints.

Endpoints
---------
GET  /v1/memory?helper_id=   → [{id, path, content, updatedAt}]  (company-scoped)
PATCH /v1/memory/{id} {content} → {id, path, content, updatedAt}  (re-indexes)

Tenant is implicit — RLS via get_tenant_db ensures company B cannot access
company A's docs.

Spec: docs/technical/04-rag-knowledge-learning.md §5;
      docs/technical/02-api-contracts.md §10.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.kb.db import get_knowledge_db
from omilo.kb.index import index_source
from omilo.models.base import prefixed_id
from omilo.models.memory import MemoryDoc
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["memory"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


# ---------------------------------------------------------------------------
# Serialiser
# ---------------------------------------------------------------------------

def _doc_to_dict(doc: MemoryDoc) -> dict[str, Any]:
    return {
        "id": doc.id,
        "path": doc.path,
        "content": doc.content,
        "updatedAt": doc.updated_at.isoformat() if doc.updated_at else None,
        "helper_id": doc.helper_id,
    }


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class PatchMemoryBody(BaseModel):
    content: str


class CreateMemoryBody(BaseModel):
    title: str
    content: str
    kind: str | None = None


# ---------------------------------------------------------------------------
# POST /v1/memory — create a company-KB doc
# ---------------------------------------------------------------------------


def _slugify(title: str) -> str:
    """Lowercase, replace non-alnum runs with '-', trim. Fallback 'doc'."""
    import re

    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "doc"


@router.post("/memory", status_code=status.HTTP_201_CREATED)
def create_memory(
    body: CreateMemoryBody,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Create a company-KB MemoryDoc ({title, content, kind?}) and index it.

    The doc is company-scoped (helper_id=None). ``kind`` (default 'doc') prefixes
    the logical path. The content is KB-indexed so it appears in knowledge recall.
    """
    kind = body.kind or "doc"
    path = f"Docs/{kind}/{_slugify(body.title)}-{prefixed_id('mem')[-6:]}.md"

    doc = MemoryDoc(
        id=prefixed_id("mem"),
        company_id=ctx.company_id,
        helper_id=None,
        path=path,
        content=body.content,
        updated_by=f"operator:{ctx.user_id}",
        updated_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.flush()

    # Index so the doc is recall-able via GET /v1/knowledge.
    index_source(
        db,
        kind="memory",
        ref=doc.path,
        title=body.title,
        body=doc.content,
        helper_id=None,
    )

    result = _doc_to_dict(doc)
    result["title"] = body.title
    return result


# ---------------------------------------------------------------------------
# GET /v1/memory
# ---------------------------------------------------------------------------

@router.get("/memory")
def list_memory(
    helper_id: str | None = Query(default=None, description="Filter by helper_id"),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    """Return all MemoryDocs for the active company, optionally filtered by helper_id.

    RLS guarantees company-scoped results — no explicit company_id filter needed.
    """
    q = db.query(MemoryDoc)
    if helper_id is not None:
        q = q.filter_by(helper_id=helper_id)
    docs = q.order_by(MemoryDoc.updated_at.desc()).all()
    return [_doc_to_dict(d) for d in docs]


# ---------------------------------------------------------------------------
# PATCH /v1/memory/{id}
# ---------------------------------------------------------------------------

@router.patch("/memory/{doc_id}")
def patch_memory(
    doc_id: str,
    body: PatchMemoryBody,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Operator edits a MemoryDoc and re-indexes it in the KB.

    404 if the doc doesn't exist or belongs to another tenant (RLS).
    """
    doc = db.query(MemoryDoc).filter_by(id=doc_id).first()
    if doc is None:
        raise _404

    doc.content = body.content
    doc.updated_by = f"operator:{ctx.user_id}"
    doc.updated_at = datetime.now(timezone.utc)
    db.flush()

    # Re-index so the edited content is recall-able
    helper_id = doc.helper_id or ""
    title_part = doc.path.split("/")[-1].replace(".md", "")
    index_source(
        db,
        kind="memory",
        ref=doc.path,
        title=f"{title_part} · {helper_id}",
        body=doc.content,
        helper_id=doc.helper_id,
    )

    return _doc_to_dict(doc)
