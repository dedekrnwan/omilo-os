"""omilo.api.knowledge — KB ingestion + recall endpoints.

Endpoints
---------
POST /v1/knowledge/sources
    Body: {kind, ref, title, body}
    → index_source → {source_id, chunks}

GET /v1/knowledge?q=&kind=
    → recall(db, q, kinds=[kind] if kind else None) → list[dict]

GET /v1/knowledge/sources?kind=
    → [{id, kind, title, ref, chunks, created_at, helper_id}]
    (default: only added sources — uploads, links, web; not docs/memory/lessons)

DELETE /v1/knowledge/sources/{id}
    → 204, source + chunks removed

POST /v1/ask {q, k?}
    → {answer, citations:[{n, source_id, kind, title, heading, text, ref, doc_id}],
       memory_searched}
    Recall over the KB (agent memory only while Knowledge is on) and an
    extractive answer built from the top passages. No LLM call — the engine
    layer has no synchronous completion path yet.
"""
from __future__ import annotations

import re
from typing import Any

from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from omilo.kb.db import get_knowledge_db
from omilo.kb.index import index_source
from omilo.kb.retrieve import recall
from omilo.models.knowledge import KbChunk, KbSource
from omilo.models.memory import MemoryDoc

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
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Index a new (or updated) KB source.

    Returns the source_id and chunk count. Paused (413) when storage is full.
    """
    from omilo.billing.storage import check_upload

    check_upload(ctx.company_id, len((req.body or "").encode()))
    src = index_source(
        db,
        kind=req.kind,
        ref=req.ref,
        title=req.title,
        body=req.body,
        helper_id=req.helper_id,
    )
    chunks = db.query(KbChunk).filter_by(source_id=src.id).count()
    return {"source_id": src.id, "chunks": chunks, **_source_dict(src, chunks)}


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


# ── sweep/docs ──────────────────────────────────────────────────────────────

# KbSource kinds that are mirrors of other records (docs, handbook, helper
# memory, lessons) rather than sources someone added to Knowledge.
_MIRROR_KINDS = ("doc", "handbook", "memory", "lesson")


def _source_dict(src: KbSource, chunks: int) -> dict[str, Any]:
    return {
        "id": src.id,
        "company_id": src.company_id,
        "kind": src.kind,
        "ref": src.ref,
        "title": src.title,
        "content_hash": src.content_hash,
        "helper_id": src.helper_id,
        "chunks": chunks,
        "created_at": src.created_at.isoformat() if src.created_at else None,
    }


@router.get("/knowledge/sources")
def list_knowledge_sources(
    kind: str | None = Query(default=None, description="Only this KbKind ('all' for every kind)"),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    """Sources added to company knowledge, newest first, with chunk counts."""
    q = db.query(KbSource)
    if kind and kind != "all":
        q = q.filter(KbSource.kind == kind)
    elif not kind:
        q = q.filter(KbSource.kind.not_in(_MIRROR_KINDS))
    sources = q.order_by(KbSource.created_at.desc()).all()
    counts = dict(
        db.query(KbChunk.source_id, func.count(KbChunk.id))
        .filter(KbChunk.source_id.in_([s.id for s in sources] or [""]))
        .group_by(KbChunk.source_id)
        .all()
    )
    return [_source_dict(s, int(counts.get(s.id, 0))) for s in sources]


@router.delete("/knowledge/sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_source(source_id: str, db: Session = Depends(get_knowledge_db)) -> Response:
    """Remove a source and every chunk (fact) it added."""
    src = db.query(KbSource).filter_by(id=source_id).first()
    if src is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    db.query(KbChunk).filter_by(source_id=src.id).delete(synchronize_session="fetch")
    db.delete(src)
    db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class AskRequest(BaseModel):
    q: str
    k: int = 5


_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _first_sentences(text: str, n: int = 2) -> str:
    clean = " ".join(line.strip("-*# ").strip() for line in text.splitlines() if line.strip())
    parts = [p for p in _SENTENCE.split(clean) if p]
    out = " ".join(parts[:n]).strip()
    return out[:400]


@router.post("/ask")
def ask(req: AskRequest, db: Session = Depends(get_knowledge_db)) -> dict:
    """Answer a question from company knowledge with numbered citations."""
    from omilo.memory.docs import AGENT_MEMORY_KINDS, knowledge_enabled

    q = (req.q or "").strip()
    memory_on = knowledge_enabled(db)
    if not q:
        return {"answer": "", "citations": [], "memory_searched": memory_on}
    k = max(1, min(req.k, 10))
    hits = recall(db, q, k=k, exclude_kinds=None if memory_on else AGENT_MEMORY_KINDS)

    # One citation per source, in rank order.
    by_source: dict[str, dict] = {}
    for h in hits:
        by_source.setdefault(h["source_id"], h)
    srcs = {
        s.id: s
        for s in db.query(KbSource).filter(KbSource.id.in_(list(by_source) or [""])).all()
    }
    refs = [s.ref for s in srcs.values()]
    docs_by_path = {
        d.path: d.id for d in db.query(MemoryDoc).filter(MemoryDoc.path.in_(refs or [""])).all()
    }

    citations: list[dict[str, Any]] = []
    for n, (sid, h) in enumerate(by_source.items(), start=1):
        src = srcs.get(sid)
        citations.append(
            {
                "n": n,
                "source_id": sid,
                "kind": h["kind"],
                "title": src.title if src else h.get("heading", ""),
                "heading": h.get("heading", ""),
                "text": h["text"][:400],
                "ref": src.ref if src else "",
                "doc_id": docs_by_path.get(src.ref) if src else None,
            }
        )

    if not citations:
        answer = "I couldn’t find anything about that in your docs yet."
    else:
        top = citations[0]
        answer = f"{_first_sentences(top['text'])} [1]"
        if len(citations) > 1:
            also = ", ".join("[%d]" % c["n"] for c in citations[1:3])
            answer += f" — see also {also}."
    return {"answer": answer, "citations": citations, "memory_searched": memory_on}
