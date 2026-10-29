"""omilo.api.memory — editable memory doc endpoints.

Endpoints
---------
GET    /v1/memory?helper_id=&kind=   → [doc]  (company-scoped)
POST   /v1/memory {title, content, kind?, area?} → doc
GET    /v1/memory/graph               → {nodes:[{id,title,area,kind,by}], edges:[{from,to}]}
GET    /v1/memory/{id}                → doc + {links, goals, unresolved, backlinks}
GET    /v1/memory/{id}/versions       → [{version, title, updatedBy, note, createdAt}]
PATCH  /v1/memory/{id} {title?, content?, pinned?, area?, hidden?} → doc (re-indexes)
DELETE /v1/memory/{id}                → 204 (drops its KB index)

A doc dict is {id, path, title, content, kind, area, pinned, hidden, helper_id,
version, updatedAt, updatedBy, createdAt, createdBy}.

Tenant is implicit — RLS via get_tenant_db ensures company B cannot access
company A's docs.

Spec: docs/technical/04-rag-knowledge-learning.md §5;
      docs/technical/02-api-contracts.md §10.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.kb.db import get_knowledge_db
from omilo.memory.docs import (
    build_graph,
    doc_kind,
    doc_to_dict,
    drop_index,
    reindex_doc,
    resolve_links,
    save_version,
)
from omilo.models.base import prefixed_id
from omilo.models.memory import MemoryDoc, MemoryDocVersion
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["memory"])

_404 = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")


def _doc_to_dict(doc: MemoryDoc) -> dict[str, Any]:
    return doc_to_dict(doc)


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class PatchMemoryBody(BaseModel):
    content: str | None = None
    title: str | None = None
    pinned: bool | None = None
    area: str | None = None
    hidden: bool | None = None


class CreateMemoryBody(BaseModel):
    title: str
    content: str
    kind: str | None = None
    area: str | None = None


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
    """Create a company-KB MemoryDoc ({title, content, kind?, area?}) and index it.

    The doc is company-scoped (helper_id=None). ``kind`` (default 'doc') prefixes
    the logical path. The content is KB-indexed so it appears in knowledge recall.
    """
    from omilo.billing.storage import check_upload

    check_upload(ctx.company_id, len((body.content or "").encode()))
    kind = body.kind or "doc"
    path = f"Docs/{kind}/{_slugify(body.title)}-{prefixed_id('mem')[-6:]}.md"
    by = f"operator:{ctx.user_id}"

    doc = MemoryDoc(
        id=prefixed_id("mem"),
        company_id=ctx.company_id,
        helper_id=None,
        path=path,
        title=body.title,
        kind=kind,
        area=body.area,
        content=body.content,
        created_by=by,
        updated_by=by,
        updated_at=datetime.now(timezone.utc),
        version=1,
        meta={},
    )
    db.add(doc)
    db.flush()
    save_version(db, doc, by=by, note="Created", bump=False)

    # Index so the doc is recall-able via GET /v1/knowledge.
    reindex_doc(db, doc)
    return _doc_to_dict(doc)


# ---------------------------------------------------------------------------
# GET /v1/memory
# ---------------------------------------------------------------------------

@router.get("/memory")
def list_memory(
    helper_id: str | None = Query(default=None, description="Filter by helper_id"),
    kind: str | None = Query(default=None, description="Filter by doc kind"),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    """Return all MemoryDocs for the active company, optionally filtered.

    RLS guarantees company-scoped results — no explicit company_id filter needed.
    """
    q = db.query(MemoryDoc)
    if helper_id is not None:
        q = q.filter_by(helper_id=helper_id)
    docs = q.order_by(MemoryDoc.updated_at.desc()).all()
    if kind is not None:
        docs = [d for d in docs if doc_kind(d) == kind]
    return [_doc_to_dict(d) for d in docs]


# ---------------------------------------------------------------------------
# GET /v1/memory/graph  (declared before /memory/{id})
# ---------------------------------------------------------------------------

@router.get("/memory/graph")
def memory_graph(db: Session = Depends(get_knowledge_db)) -> dict:
    """Company docs as nodes, [[wikilinks]] between them (and to goals) as edges."""
    return build_graph(db)


# ---------------------------------------------------------------------------
# GET /v1/memory/{id}
# ---------------------------------------------------------------------------

def _get_or_404(db: Session, doc_id: str) -> MemoryDoc:
    doc = db.query(MemoryDoc).filter_by(id=doc_id).first()
    if doc is None:
        raise _404
    return doc


@router.get("/memory/{doc_id}")
def get_memory(doc_id: str, db: Session = Depends(get_knowledge_db)) -> dict:
    """One doc plus its resolved links, goal links, unresolved targets and backlinks."""
    doc = _get_or_404(db, doc_id)
    return {**_doc_to_dict(doc), **resolve_links(db, doc)}


@router.get("/memory/{doc_id}/versions")
def get_memory_versions(doc_id: str, db: Session = Depends(get_knowledge_db)) -> list[dict]:
    """Saved versions of a doc, newest first."""
    _get_or_404(db, doc_id)
    rows = (
        db.query(MemoryDocVersion)
        .filter_by(doc_id=doc_id)
        .order_by(MemoryDocVersion.version.desc(), MemoryDocVersion.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": r.id,
            "version": r.version,
            "title": r.title,
            "updatedBy": r.updated_by,
            "note": r.note,
            "createdAt": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


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
    """Operator edits a MemoryDoc (content/title/pinned/area/hidden) and re-indexes it.

    Content or title changes bump the version and record a history row.
    404 if the doc doesn't exist or belongs to another tenant (RLS).
    """
    doc = _get_or_404(db, doc_id)
    by = f"operator:{ctx.user_id}"
    if body.content is not None and len(body.content) > len(doc.content or ""):
        from omilo.billing.storage import check_upload

        check_upload(ctx.company_id, len(body.content.encode()) - len((doc.content or "").encode()))

    changed_text = False
    if body.content is not None and body.content != doc.content:
        doc.content = body.content
        changed_text = True
    if body.title is not None and body.title.strip() and body.title.strip() != doc.title:
        doc.title = body.title.strip()
        changed_text = True
    if body.pinned is not None:
        doc.pinned = body.pinned
    if body.area is not None:
        doc.area = body.area or None
    if body.hidden is not None:
        doc.meta = {**(doc.meta or {}), "hidden": body.hidden}
        flag_modified(doc, "meta")

    if changed_text:
        save_version(db, doc, by=by)
        reindex_doc(db, doc)
    elif body.content is not None:
        # Content PATCH with identical body: still stamp who saved it.
        doc.updated_by = by
        doc.updated_at = datetime.now(timezone.utc)
    db.flush()

    return _doc_to_dict(doc)


# ---------------------------------------------------------------------------
# DELETE /v1/memory/{id}
# ---------------------------------------------------------------------------

@router.delete("/memory/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(doc_id: str, db: Session = Depends(get_knowledge_db)) -> Response:
    """Delete a doc, its version history and its KB index."""
    doc = _get_or_404(db, doc_id)
    drop_index(db, doc.path)
    db.query(MemoryDocVersion).filter_by(doc_id=doc.id).delete(synchronize_session="fetch")
    db.delete(doc)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
