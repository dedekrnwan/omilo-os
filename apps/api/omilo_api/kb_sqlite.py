"""Light-tier (SQLite) knowledge-base search backend: FTS5 + sqlite-vec.

Postgres keeps a `tsv` generated column + GIN index and a pgvector HNSW index. SQLite has neither,
so this module provides the dialect equivalents, kept out of kb.py's Postgres path:

- Full text: an external-content FTS5 table `kb_chunk_fts(heading, text, content='kb_chunk',
  content_rowid='id')` kept in sync with kb_chunk by AFTER INSERT/UPDATE/DELETE triggers. Because
  KbChunk.id aliases the sqlite rowid, `content_rowid='id'` maps one-to-one onto kb_chunk rows.
- Vectors: one `kb_vec_{dim}` vec0 virtual table per embedding size, whose rowid is kb_chunk.id.
  The embedding blob (little-endian float32, the format KbChunk.embedding stores on sqlite) is
  mirrored in on write; KNN is `embedding MATCH :qv ORDER BY distance`. When sqlite-vec is not
  loadable (db.VEC_OK is False) the vec tables are skipped and kb.py falls back to a brute-force
  cosine scan over the blobs.

All DDL is idempotent (CREATE ... IF NOT EXISTS), so ensure_* can run on every boot.
"""
from __future__ import annotations

import re
import struct

from sqlalchemy import text
from sqlalchemy.orm import Session

from . import db as _db

_WORD = re.compile(r"[\w]+", re.UNICODE)


# ------------------------------------------------------------------ blob <-> vector
def pack(vec) -> bytes:
    """A vector (list/tuple of floats) to the little-endian float32 blob KbChunk.embedding stores."""
    v = list(vec)
    return struct.pack(f"<{len(v)}f", *v)


def unpack(blob: bytes) -> list[float]:
    """The reverse of pack(): a float32 blob back to a list of floats."""
    if not blob:
        return []
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob))


# ------------------------------------------------------------------ FTS5 (full text)
def ensure_fts_and_vec(eng) -> None:
    """Create the FTS5 external-content table + sync triggers for kb_chunk. Idempotent.

    Vector tables are per-dimension, so they are created lazily by ensure_vec_table once a dim is
    known; here we only set up full text (which needs no dimension)."""
    with eng.begin() as c:
        c.exec_driver_sql(
            "CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunk_fts USING fts5("
            "heading, text, content='kb_chunk', content_rowid='id', tokenize='unicode61')"
        )
        # Keep the external-content index in step with kb_chunk. 'delete' rows carry the old values
        # so FTS can remove the right posting, per the FTS5 external-content contract.
        c.exec_driver_sql(
            "CREATE TRIGGER IF NOT EXISTS kb_chunk_ai AFTER INSERT ON kb_chunk BEGIN "
            "INSERT INTO kb_chunk_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text); END"
        )
        c.exec_driver_sql(
            "CREATE TRIGGER IF NOT EXISTS kb_chunk_ad AFTER DELETE ON kb_chunk BEGIN "
            "INSERT INTO kb_chunk_fts(kb_chunk_fts, rowid, heading, text) "
            "VALUES ('delete', old.id, old.heading, old.text); END"
        )
        c.exec_driver_sql(
            "CREATE TRIGGER IF NOT EXISTS kb_chunk_au AFTER UPDATE ON kb_chunk BEGIN "
            "INSERT INTO kb_chunk_fts(kb_chunk_fts, rowid, heading, text) "
            "VALUES ('delete', old.id, old.heading, old.text); "
            "INSERT INTO kb_chunk_fts(rowid, heading, text) VALUES (new.id, new.heading, new.text); END"
        )


def _sanitize(term: str) -> str:
    """A single FTS5 bareword: strip everything FTS5 treats as syntax, leaving word characters."""
    return "".join(_WORD.findall(term))


def fts_query(terms, prefix: bool = True, op: str = "OR") -> str:
    """Translate query terms into an FTS5 MATCH string.

    terms may be a raw query string or an already-split list of words. Each surviving word becomes a
    quoted bareword (prefix -> trailing *), joined by OR/AND. Punctuation-only / empty input yields
    "" so the caller can short-circuit (an empty MATCH is an FTS5 syntax error otherwise)."""
    if isinstance(terms, str):
        words = [w.lower() for w in _WORD.findall(terms) if len(w) > 1]
    else:
        words = [str(w).lower() for w in terms]
    parts = []
    for w in words:
        s = _sanitize(w)
        if not s:
            continue
        parts.append(f'"{s}"*' if prefix else f'"{s}"')
    if not parts:
        return ""
    return f" {op} ".join(parts)


def fts_match(db: Session, tq: str, where_sql: str, params: dict, k: int) -> list[tuple[int, float]]:
    """FTS5 MATCH over kb_chunk_fts, ranked by bm25 (lower is better -> returned as a positive rank
    where higher is better), honouring the same `where_sql` (referencing c = kb_chunk, s = kb_source)
    the Postgres path uses. Returns [(chunk_id, rank)]."""
    if not tq:
        return []
    p = dict(params)
    p["tq"] = tq
    p["k"] = k
    rows = db.execute(text(
        "SELECT c.id, bm25(kb_chunk_fts) AS b FROM kb_chunk_fts "
        "JOIN kb_chunk c ON c.id = kb_chunk_fts.rowid "
        "JOIN kb_source s ON s.id = c.source_id "
        f"WHERE kb_chunk_fts MATCH :tq AND {where_sql} ORDER BY b LIMIT :k"), p).all()
    # bm25 is negative-is-better in sqlite-vec's bm25(); flip the sign so bigger == more relevant,
    # mirroring ts_rank_cd's "higher is better" so the RRF merge in kb.search reads the same shape.
    return [(cid, -float(b)) for cid, b in rows]


# ------------------------------------------------------------------ vec0 (vectors)
def ensure_vec_table(db: Session, dim: int) -> None:
    """Create kb_vec_{dim} (vec0, cosine) if sqlite-vec is available. Idempotent; a no-op otherwise."""
    if not _db.VEC_OK:
        return
    db.execute(text(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec_{dim} USING vec0("
        f"embedding float[{dim}] distance_metric=cosine)"))
    db.commit()


def upsert_vec(db: Session, chunk_id: int, dim: int, vec) -> None:
    """Mirror a chunk's embedding into kb_vec_{dim} (rowid = kb_chunk.id). No-op without sqlite-vec.

    vec may be a list of floats or an already-packed blob."""
    if not _db.VEC_OK:
        return
    ensure_vec_table(db, dim)
    blob = vec if isinstance(vec, (bytes, bytearray)) else pack(vec)
    db.execute(text(f"DELETE FROM kb_vec_{dim} WHERE rowid = :id"), {"id": chunk_id})
    db.execute(text(f"INSERT INTO kb_vec_{dim}(rowid, embedding) VALUES (:id, :e)"),
               {"id": chunk_id, "e": bytes(blob)})


def delete_vec(db: Session, chunk_id: int, dims=None) -> None:
    """Remove a chunk from every kb_vec_{dim} it may be in. No-op without sqlite-vec."""
    if not _db.VEC_OK:
        return
    tables = [f"kb_vec_{d}" for d in dims] if dims else _vec_tables(db)
    for t in tables:
        db.execute(text(f"DELETE FROM {t} WHERE rowid = :id"), {"id": chunk_id})


def _vec_tables(db: Session) -> list[str]:
    rows = db.execute(text(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'kb_vec_%'")).all()
    return [r[0] for r in rows]


def knn(db: Session, dim: int, qv, k: int, where_sql: str, params: dict) -> list[tuple[int, float]]:
    """K-nearest chunks to query vector qv, honouring `where_sql` (c = kb_chunk, s = kb_source).

    Uses sqlite-vec when available (sim = 1 - cosine distance); otherwise a brute-force cosine scan
    over the embedding blobs. Returns [(chunk_id, similarity)] sorted best-first."""
    if _db.VEC_OK:
        return _knn_vec(db, dim, qv, k, where_sql, params)
    return _knn_brute(db, dim, qv, k, where_sql, params)


def _knn_vec(db: Session, dim: int, qv, k: int, where_sql: str, params: dict) -> list[tuple[int, float]]:
    ensure_vec_table(db, dim)
    p = dict(params)
    p["qv"] = bytes(pack(qv))
    p["k"] = k
    # vec0 KNN must stand alone (MATCH + LIMIT); filter by joining its rowids back to the WHERE.
    rows = db.execute(text(
        f"SELECT c.id, v.distance FROM kb_vec_{dim} v "
        f"JOIN kb_chunk c ON c.id = v.rowid "
        f"JOIN kb_source s ON s.id = c.source_id "
        f"WHERE v.embedding MATCH :qv AND k = :k AND c.dim = {dim} AND {where_sql} "
        f"ORDER BY v.distance"), p).all()
    return [(cid, 1.0 - float(d)) for cid, d in rows]


def _cosine(a: list[float], b: list[float]) -> float:
    import math

    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def _knn_brute(db: Session, dim: int, qv, k: int, where_sql: str, params: dict) -> list[tuple[int, float]]:
    """Fallback (no sqlite-vec): cosine over the raw blobs. Reads only the rows the WHERE keeps."""
    p = dict(params)
    rows = db.execute(text(
        "SELECT c.id, c.embedding FROM kb_chunk c JOIN kb_source s ON s.id = c.source_id "
        f"WHERE c.dim = {dim} AND c.embedding IS NOT NULL AND {where_sql}"), p).all()
    q = list(qv)
    scored = [(cid, _cosine(q, unpack(blob))) for cid, blob in rows]
    scored.sort(key=lambda x: -x[1])
    return scored[:k]
