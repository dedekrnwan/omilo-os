"""omilo.kb.retrieve — Hybrid KB recall: FTS + vector + RRF.

Public API
----------
    recall(db, query, *, kinds=None, k=8) -> list[dict]

Algorithm
---------
1. FTS leg: SELECT id, ts_rank(tsv, plainto_tsquery('english', q)) AS rank
            FROM kb_chunk WHERE tsv @@ plainto_tsquery('english', q)
            [AND kind IN (...)]
            ORDER BY rank DESC LIMIT n
2. Vector leg: embed query → ORDER BY embedding <=> qvec LIMIT n
3. RRF merge: score = Σ 1/(k0 + rank_position); k0 = 60.
4. Join KbChunk→KbSource for kind; return top-k [{source_id, heading, text, kind, score}].

Both legs are company-scoped by RLS — no manual company_id filter added.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from omilo.kb.embed import get_embedder
from omilo.models.knowledge import KbChunk, KbSource

# RRF constant (standard choice from IR literature)
_K0: int = 60
# How many candidates to fetch per leg before RRF
_LEG_LIMIT: int = 50


def recall(
    db: Session,
    query: str,
    *,
    kinds: list[str] | None = None,
    k: int = 8,
) -> list[dict[str, Any]]:
    """Hybrid FTS + vector recall with RRF fusion.

    Parameters
    ----------
    db:    Tenant-scoped (RLS) Session — company filtering is implicit.
    query: Natural-language query string.
    kinds: Optional list of KbKind strings to restrict retrieval.
    k:     Number of top results to return.

    Returns
    -------
    list of dicts: [{source_id, heading, text, kind, score}], sorted by score desc.
    Returns [] for empty query or empty KB (never raises on those cases).
    """
    if not query or not query.strip():
        return []

    embedder = get_embedder({"type": "hash"})
    qvec: list[float] = embedder.embed([query])[0]

    # ── FTS leg ───────────────────────────────────────────────────────────────
    fts_ids: list[str] = _run_fts_leg(db, query, kinds=kinds, limit=_LEG_LIMIT)

    # ── Vector leg ────────────────────────────────────────────────────────────
    vec_ids: list[str] = _run_vector_leg(db, qvec, kinds=kinds, limit=_LEG_LIMIT)

    if not fts_ids and not vec_ids:
        return []

    # ── RRF merge ─────────────────────────────────────────────────────────────
    scores: dict[str, float] = {}
    for rank, chunk_id in enumerate(fts_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (_K0 + rank + 1)
    for rank, chunk_id in enumerate(vec_ids):
        scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (_K0 + rank + 1)

    top_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)[:k]

    if not top_ids:
        return []

    # ── Fetch chunk + source rows ─────────────────────────────────────────────
    chunk_rows = (
        db.query(KbChunk, KbSource.kind)
        .join(KbSource, KbChunk.source_id == KbSource.id)
        .filter(KbChunk.id.in_(top_ids))
        .all()
    )

    chunk_map: dict[str, dict] = {}
    for kbc, src_kind in chunk_rows:
        chunk_map[kbc.id] = {
            "source_id": kbc.source_id,
            "heading": kbc.heading,
            "text": kbc.text,
            "kind": src_kind,
            "score": scores[kbc.id],
        }

    # Return in RRF score order
    results = [chunk_map[cid] for cid in top_ids if cid in chunk_map]
    return results


# ---------------------------------------------------------------------------
# Internal leg helpers
# ---------------------------------------------------------------------------

def _run_fts_leg(
    db: Session,
    query: str,
    *,
    kinds: list[str] | None,
    limit: int,
) -> list[str]:
    """Run the FTS leg and return chunk IDs in rank order (best first)."""
    try:
        tsquery = func.plainto_tsquery("english", query)
        ts_rank_expr = func.ts_rank(KbChunk.tsv, tsquery)

        stmt = (
            select(KbChunk.id)
            .where(KbChunk.tsv.op("@@")(tsquery))
            .order_by(ts_rank_expr.desc())
            .limit(limit)
        )

        if kinds:
            stmt = (
                select(KbChunk.id)
                .join(KbSource, KbChunk.source_id == KbSource.id)
                .where(
                    KbChunk.tsv.op("@@")(tsquery),
                    KbSource.kind.in_(kinds),
                )
                .order_by(ts_rank_expr.desc())
                .limit(limit)
            )

        rows = db.execute(stmt).fetchall()
        return [r[0] for r in rows]
    except Exception:
        # If FTS fails (e.g. tsv null/empty), degrade gracefully
        return []


def _run_vector_leg(
    db: Session,
    qvec: list[float],
    *,
    kinds: list[str] | None,
    limit: int,
) -> list[str]:
    """Run the vector (cosine) leg and return chunk IDs in distance order (closest first)."""
    try:
        stmt = (
            select(KbChunk.id)
            .where(KbChunk.embedding.is_not(None))
            .order_by(KbChunk.embedding.cosine_distance(qvec))
            .limit(limit)
        )

        if kinds:
            stmt = (
                select(KbChunk.id)
                .join(KbSource, KbChunk.source_id == KbSource.id)
                .where(
                    KbChunk.embedding.is_not(None),
                    KbSource.kind.in_(kinds),
                )
                .order_by(KbChunk.embedding.cosine_distance(qvec))
                .limit(limit)
            )

        rows = db.execute(stmt).fetchall()
        return [r[0] for r in rows]
    except Exception:
        # If vector leg fails, degrade gracefully
        return []
