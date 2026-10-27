"""omilo.kb.index — KB ingestion: chunk + embed + upsert.

Public API
----------
    index_source(db, *, kind, ref, title, body,
                 helper_id=None, meta=None) -> KbSource

Algorithm
---------
1. Compute content_hash = sha256(body).
2. Upsert KbSource by (company_id via RLS, ref):
   - If existing with same hash → skip re-index (idempotent).
   - If existing with changed hash → delete old KbChunk rows, re-chunk.
   - If new → create KbSource.
3. chunk(body) → [(heading, text), ...]
4. For each chunk: embed via HashEmbedder; INSERT KbChunk with:
   - embedding (list[float], dim=256)
   - tsv set via SQL to_tsvector('english', text)
   - embedding_model="hash", dim=256
   - indexed_at=now, embedded_at=now
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, text, update
from sqlalchemy.orm import Session

from omilo.kb.chunk import chunk
from omilo.kb.embed import get_embedder
from omilo.models.base import prefixed_id
from omilo.models.knowledge import KbChunk, KbSource


def _sha256(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def _get_company_id(db: Session) -> str:
    """Read the transaction-local company_id GUC set by set_company()."""
    row = db.execute(
        text("SELECT current_setting('app.company_id', true) AS cmp")
    ).fetchone()
    cmp = row.cmp if row else None
    if not cmp:
        raise RuntimeError(
            "No company_id GUC set on this session. "
            "Use a tenant-scoped session (get_db / get_tenant_db)."
        )
    return cmp


def index_source(
    db: Session,
    *,
    kind: str,
    ref: str,
    title: str,
    body: str,
    helper_id: str | None = None,
    meta: dict[str, Any] | None = None,
) -> KbSource:
    """Upsert a KbSource by ref, chunk+embed body, persist KbChunk rows.

    Company-scoped: the RLS session automatically filters/scopes by
    company_id — no manual company filter is needed.

    Parameters
    ----------
    db:        Tenant-scoped SQLAlchemy Session.
    kind:      KbKind string (note, doc, web, memory, …).
    ref:       External reference / stable identifier for dedup.
    title:     Human-readable title.
    body:      Full text (markdown or plain).
    helper_id: Optional Helper affinity.
    meta:      Optional JSONB metadata.

    Returns
    -------
    KbSource ORM object (flushed, not committed — caller owns the txn).
    """
    content_hash = _sha256(body)
    meta = meta or {}
    now = datetime.now(timezone.utc)

    # Read company_id from the RLS GUC (set by get_db / set_company)
    company_id = _get_company_id(db)

    # ── 1. Look up existing source by ref (RLS scopes to this company) ───────
    existing: KbSource | None = (
        db.query(KbSource).filter_by(ref=ref).first()
    )

    if existing is not None:
        if existing.content_hash == content_hash:
            # Same content — skip re-index
            return existing

        # Content changed — delete old chunks and re-index
        db.query(KbChunk).filter_by(source_id=existing.id).delete(
            synchronize_session="fetch"
        )
        existing.content_hash = content_hash
        existing.title = title
        existing.kind = kind
        existing.helper_id = helper_id
        existing.meta = meta
        db.flush()
        source = existing
    else:
        source = KbSource(
            id=prefixed_id("kbs"),
            company_id=company_id,
            kind=kind,
            ref=ref,
            title=title,
            content_hash=content_hash,
            helper_id=helper_id,
            meta=meta,
        )
        db.add(source)
        db.flush()

    # ── 2. Chunk + embed ──────────────────────────────────────────────────────
    embedder = get_embedder({"type": "hash"})
    chunks = chunk(body)

    if not chunks:
        # Body is blank or all-whitespace — nothing to chunk
        return source

    for heading, text in chunks:
        vec: list[float] = embedder.embed([text])[0]

        kbc = KbChunk(
            id=prefixed_id("kbc"),
            company_id=company_id,
            source_id=source.id,
            heading=heading,
            text=text,
            dim=256,
            embedding=vec,
            embedding_model="hash",
            embedded_at=now,
            indexed_at=now,
        )
        db.add(kbc)
        db.flush()

        # Set tsv via SQL so Postgres computes the proper tsvector
        db.execute(
            update(KbChunk)
            .where(KbChunk.id == kbc.id)
            .values(tsv=func.to_tsvector("english", text))
        )

    db.flush()
    return source
