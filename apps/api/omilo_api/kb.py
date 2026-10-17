"""The helpers' knowledge base: Postgres + pgvector.

Everything worth knowing is a *source* (a doc, memory note, finished job, chat, approved proposal, uploaded file, web
page, connector or workflow data) split into *chunks*. Each chunk gets a full-text vector (tsvector, right away) and an
embedding (pgvector, in the background by the worker). Search is hybrid: meaning (cosine distance on embeddings) and
words (full-text rank), merged with reciprocal rank fusion, so it works before embeddings exist and finds paraphrases
once they do.

Keeping it current:
- docs (incl. Memory/ and Company/) are indexed when written, moved or deleted, and swept for outside changes;
- jobs, chats and proposals are *marked* by a session hook when they change (a Redis set) and indexed by the worker;
- files, web pages, connector data and workflow results are added explicitly (UI, the kb_add tool, a workflow step).
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import time

from sqlalchemy import delete, event, func, select, text, update
from sqlalchemy.orm import Session

from . import bus
from . import company as C
from .models import KbChunk, KbQuery, KbSource, Message, Proposal, Report, Staff, Task, Thread, now

log = logging.getLogger("omilo.kb")

KINDS = {
    "doc": ("Docs", "ri-file-text-line"), "memory": ("Memory", "ri-brain-line"), "context": ("Company", "ri-building-2-line"),
    "job": ("Jobs", "ri-briefcase-4-line"), "chat": ("Chats", "ri-chat-3-line"), "proposal": ("Approved work", "ri-checkbox-circle-line"),
    "file": ("Files", "ri-attachment-2"), "web": ("Web pages", "ri-global-line"), "connector": ("Connectors", "ri-plug-line"),
    "workflow": ("Workflows", "ri-flow-chart"), "note": ("Notes", "ri-sticky-note-line"),
}
CHUNK = 900      # characters per chunk (about 200 tokens)
OVERLAP = 120
MAX_TEXT = 400_000


# ------------------------------------------------------------------ indexes
def ensure_indexes(eng) -> None:
    with eng.begin() as c:
        c.exec_driver_sql("CREATE INDEX IF NOT EXISTS kb_chunk_tsv ON kb_chunk USING gin (tsv)")
        c.exec_driver_sql("CREATE INDEX IF NOT EXISTS kb_source_kind_ref ON kb_source (kind, ref)")


_dim_indexed: set[tuple[str, int]] = set()


def _ensure_dim_index(db: Session, dim: int) -> None:
    """An HNSW index for this embedding size (rows of other sizes are left out by the WHERE)."""
    k = (C.current(), dim)
    if k in _dim_indexed:
        return
    db.execute(text(f"CREATE INDEX IF NOT EXISTS kb_chunk_hnsw_{dim} ON kb_chunk USING hnsw ((embedding::vector({dim})) vector_cosine_ops) "
                    f"WHERE dim = {dim}"))
    db.commit()
    _dim_indexed.add(k)


# ------------------------------------------------------------------ splitting text
_HEAD = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")


def chunk(body: str) -> list[tuple[str, str]]:
    """Markdown-aware pieces of ~CHUNK characters: (nearest heading, text). Paragraphs are kept whole when they fit."""
    body = (body or "").replace("\r\n", "\n")[:MAX_TEXT]
    sections: list[tuple[str, list[str]]] = [("", [])]
    for line in body.split("\n"):
        m = _HEAD.match(line)
        if m:
            sections.append((m.group(2)[:200], []))
        else:
            sections[-1][1].append(line)
    out: list[tuple[str, str]] = []
    for head, lines in sections:
        paras = [p.strip() for p in re.split(r"\n\s*\n", "\n".join(lines)) if p.strip()]
        buf = ""
        for p in paras:
            while len(p) > CHUNK:  # a very long paragraph: cut at a sentence end near the limit
                cut = max(p.rfind(". ", 0, CHUNK), p.rfind("\n", 0, CHUNK))
                cut = cut + 1 if cut > CHUNK // 2 else CHUNK
                if buf:
                    out.append((head, buf)); buf = ""  # noqa: E702
                out.append((head, p[:cut].strip()))
                p = p[max(0, cut - OVERLAP):].strip()
            if len(buf) + len(p) + 2 > CHUNK and buf:
                out.append((head, buf))
                tail = buf[-OVERLAP:]
                buf = (tail[tail.find(" ") + 1:] if " " in tail else "") + "\n\n" + p
            else:
                buf = f"{buf}\n\n{p}" if buf else p
        if buf.strip():
            out.append((head, buf.strip()))
    if not out and body.strip():
        out.append(("", body.strip()[:CHUNK]))
    # small sections next to each other share a piece (a job report's "Done: …" is too little on its own)
    merged: list[tuple[str, str]] = []
    for head, t in out:
        if merged and len(merged[-1][1]) + len(t) + len(head) + 8 <= CHUNK and (len(t) < CHUNK // 3 or len(merged[-1][1]) < CHUNK // 3):
            ph, pt = merged[-1]
            merged[-1] = (ph, pt + "\n\n" + (f"{head}:\n" if head and head != ph else "") + t)
        else:
            merged.append((head, t))
    return merged


# ------------------------------------------------------------------ adding and removing
def _ref(ref: str) -> str:
    ref = str(ref or "")
    return ref if len(ref) <= 500 else ref[:440] + "#" + hashlib.sha256(ref.encode()).hexdigest()[:40]


def put(db: Session, kind: str, ref: str, title: str, body: str, *, url: str = "", staff_id: str = "", meta: dict | None = None,
        commit: bool = True) -> KbSource:
    """Add or update a source. Unchanged text is a no-op; changed text replaces its chunks (embedded later)."""
    if kind not in KINDS:
        raise ValueError(f"unknown knowledge kind {kind!r}")
    ref = _ref(ref)
    title = (title or ref)[:300]
    h = hashlib.sha256(f"{title}\n{body}".encode()).hexdigest()
    src = db.scalar(select(KbSource).where(KbSource.kind == kind, KbSource.ref == ref))
    if src and src.content_hash == h:
        changed = False
        if url and src.url != url:
            src.url, changed = url, True
        if meta and src.meta != {**(src.meta or {}), **meta}:
            src.meta, changed = {**(src.meta or {}), **meta}, True
        if changed and commit:
            db.commit()
        return src
    if not src:
        src = KbSource(kind=kind, ref=ref)
        db.add(src)
    src.title, src.url, src.staff_id = title, url or src.url or "", staff_id or src.staff_id or ""
    src.meta = {**(src.meta or {}), **(meta or {})}
    src.content_hash, src.chars, src.updated_at, src.status, src.error = h, len(body or ""), now(), "pending", ""
    db.flush()
    db.execute(delete(KbChunk).where(KbChunk.source_id == src.id))
    pieces = chunk(body)
    for i, (head, t) in enumerate(pieces):
        # the title goes into every chunk's heading, so word search and embeddings know what the piece belongs to
        db.add(KbChunk(source_id=src.id, ord=i, heading=(f"{title} › {head}" if head and head != title else title)[:300], text=t))
    src.chunks = len(pieces)
    if not pieces:
        src.status, src.indexed_at = "ready", now()
    if commit:
        db.commit()
        _wake()
    return src


def remove(db: Session, kind: str, ref: str, commit: bool = True) -> bool:
    src = db.scalar(select(KbSource).where(KbSource.kind == kind, KbSource.ref == _ref(ref)))
    if not src:
        return False
    db.delete(src)
    if commit:
        db.commit()
    return True


def _wake(cid: str | None = None) -> None:
    """Tell the embedding worker this company has new chunks."""
    try:
        bus.r().sadd(bus.gkey("kb:pending"), cid or C.current())
    except Exception:  # noqa: BLE001 - the worker also sweeps every minute
        pass


# ------------------------------------------------------------------ marks: jobs, chats and proposals that changed
def mark(kind: str, ref: str, cid: str | None = None) -> None:
    try:
        bus.r().sadd(bus.key("kb:marks", cid), f"{kind}|{ref}")
    except Exception:  # noqa: BLE001
        pass


@event.listens_for(Session, "before_flush")
def _collect_marks(session: Session, _ctx, _inst) -> None:
    marks = session.info.setdefault("kb_marks", set())
    for obj in list(session.new) + list(session.dirty):
        if isinstance(obj, Report):
            marks.add(("job", obj.task_id))
        elif isinstance(obj, Message) and getattr(obj, "thread_id", None):
            marks.add(("chat", obj.thread_id))
        elif isinstance(obj, Proposal) and obj.status in ("approved", "executing", "executed"):
            marks.add(("proposal", obj.id))


@event.listens_for(Session, "after_commit")
def _push_marks(session: Session) -> None:
    marks = session.info.pop("kb_marks", None)
    if marks:
        cid = session.info.get("cid") or C.current()
        for k, ref in marks:
            if ref:
                mark(k, ref, cid)


@event.listens_for(Session, "after_rollback")
def _drop_marks(session: Session) -> None:
    session.info.pop("kb_marks", None)


def _collect(db: Session, kind: str, ref: str) -> dict | None:
    """Build a source's text from the database (None: nothing to index, remove it)."""
    if kind == "job":
        t = db.get(Task, ref)
        rep = db.scalar(select(Report).where(Report.task_id == ref)) if t else None
        if not t or not rep:
            return None
        st = db.get(Staff, t.staff_id)
        brief = (t.brief or "").strip()
        title = (brief.splitlines() or [t.origin])[0][:160]
        body = f"Job for {st.name if st else t.staff_id} ({t.origin}): {brief}\n\n## Result\n{rep.headline}\n\n{rep.body_md or ''}"
        return {"title": title, "body": body, "staff_id": t.staff_id, "meta": {"task_id": t.id, "status": t.status}}
    if kind == "chat":
        th = db.get(Thread, ref)
        if not th:
            return None
        msgs = list(db.scalars(select(Message).where(Message.thread_id == ref).order_by(Message.at.desc()).limit(300)))[::-1]
        msgs = [m for m in msgs if (m.text or "").strip() and m.role in ("owner", "agent")]
        if len(msgs) < 2:
            return None
        names = {s.id: s.name for s in db.scalars(select(Staff))}
        body = "\n\n".join(f"{'You' if m.role == 'owner' else names.get(m.author, m.author or m.role)}: {m.text.strip()}" for m in msgs)
        return {"title": th.title or "Chat", "body": body, "staff_id": th.staff_id or "", "meta": {"thread_id": th.id, "scope": th.scope}}
    if kind == "proposal":
        from . import services as S

        p = db.get(Proposal, ref)
        if not p or p.status not in ("approved", "executing", "executed"):
            return None
        body = f"{S.current_body(p)}\n\n" + (f"## Result\n{p.result}" if getattr(p, "result", "") else "")
        return {"title": p.title, "body": body, "staff_id": p.staff_id, "meta": {"proposal_id": p.id, "type": p.type, "task_id": p.task_id}}
    return None


def process_marks(db: Session, limit: int = 40) -> int:
    try:
        items = bus.r().spop(bus.key("kb:marks"), limit) or []
    except Exception:  # noqa: BLE001
        return 0
    n = 0
    for it in items:
        kind, _, ref = it.partition("|")
        try:
            data = _collect(db, kind, ref)
            if data is None:
                remove(db, kind, ref)
            else:
                put(db, kind, ref, data["title"], data["body"], staff_id=data.get("staff_id", ""), meta=data.get("meta"))
            n += 1
        except Exception:  # noqa: BLE001 - one bad item never stops the rest
            db.rollback()
            log.exception("indexing %s failed", it)
    return n


# ------------------------------------------------------------------ docs
def doc_kind(path: str) -> str:
    from . import docs as D
    from . import memory as M

    if path.startswith(M.ROOT + "/"):
        return "memory"
    if path.startswith(D.COMPANY + "/"):
        return "context"
    return "doc"


def sync_doc(db: Session, path: str, commit: bool = True) -> None:
    from . import docs as D

    p = D.norm(path)
    txt = D._read_file(p)
    kinds = ("doc", "memory", "context")
    if txt is None:
        for k in kinds:
            remove(db, k, p, commit=False)
    else:
        k = doc_kind(p)
        for other in kinds:
            if other != k:
                remove(db, other, p, commit=False)
        put(db, k, p, D.title_of(p), txt, url=f"/docs/?path={p}", meta={"path": p}, commit=False)
    if commit:
        db.commit()
        _wake()


def sync_docs(db: Session, force: bool = False) -> int:
    """Pick up docs changed outside Omilo (another editor, git pull): at most every 15 s per company."""
    from . import docs as D

    if not force and not bus.throttle("kb:docsync", 15):
        return 0
    have = {s.ref: s for s in db.scalars(select(KbSource).where(KbSource.kind.in_(("doc", "memory", "context"))))}
    paths = set(D.all_paths())
    n = 0
    for p in paths:
        try:
            mt = D.file_for(p).stat().st_mtime_ns
        except OSError:
            continue
        s = have.get(p)
        if s and (s.meta or {}).get("mtime") == mt:
            continue
        sync_doc(db, p, commit=False)
        s2 = db.scalar(select(KbSource).where(KbSource.ref == p, KbSource.kind == doc_kind(p)))
        if s2:
            s2.meta = {**(s2.meta or {}), "mtime": mt}
        n += 1
    for p, s in have.items():
        if p not in paths:
            db.delete(s)
            n += 1
    if n:
        db.commit()
        _wake()
    return n


# ------------------------------------------------------------------ embedding (the worker calls this)
def embed_pending(db: Session, budget: int = 64) -> int:
    """Embed chunks that have no embedding yet, or were made by another model. Returns how many were embedded."""
    from . import embed as EM

    try:
        E = EM.current(db)
    except EM.EmbedError as e:
        bus.set_json("kb:error", {"error": str(e), "at": now().isoformat()}, ttl_s=3600)
        return 0
    rows = list(db.scalars(select(KbChunk).where((KbChunk.embedding.is_(None)) | (KbChunk.model != E.tag)).order_by(KbChunk.id).limit(budget)))
    if not rows:
        return 0
    try:
        vecs = E.embed([f"{c.heading}\n{c.text}" if c.heading else c.text for c in rows], "doc")
    except EM.EmbedError as e:
        bus.set_json("kb:error", {"error": str(e), "at": now().isoformat()}, ttl_s=3600)
        log.warning("embedding failed: %s", e)
        return 0
    _ensure_dim_index(db, E.dim)
    for c, v in zip(rows, vecs, strict=True):
        c.embedding, c.dim, c.model = v, E.dim, E.tag
    db.flush()
    srcs = {c.source_id for c in rows}
    left = set(db.scalars(select(KbChunk.source_id).where(KbChunk.source_id.in_(srcs), (KbChunk.embedding.is_(None)) | (KbChunk.model != E.tag))))
    db.execute(update(KbSource).where(KbSource.id.in_(srcs - left)).values(status="ready", indexed_at=now(), error=""))
    db.commit()
    try:
        bus.r().delete(bus.key("kb:error"))
    except Exception:  # noqa: BLE001
        pass
    bus.publish("kb", {"embedded": len(rows)})
    return len(rows)


# ------------------------------------------------------------------ search
_WORD = re.compile(r"[\w]+", re.UNICODE)
# small words that say nothing about the topic (English and Indonesian)
STOP = set("the a an and or of to in on at for with from by is are was were be been do does did what why how when where who which "
           "that this these those it its as if not no yes can could should would will my your our their me we you they i "
           "yang dan atau di ke dari untuk dengan ini itu ada tidak apa kenapa mengapa bagaimana kapan siapa saya kami kita "
           "mereka juga sudah akan bisa harus".split())


def _terms(q: str) -> list[str]:
    words = [w.lower() for w in _WORD.findall(q or "") if len(w) > 1]
    keep = [w for w in words if w not in STOP]
    return (keep or words)[:16]


def _tsquery(q: str, prefix: bool = True, op: str = "|") -> str:
    words = _terms(q)
    return f" {op} ".join(f"{w}:*" if prefix else w for w in words)


def search(db: Session, q: str, k: int = 8, *, kinds: list[str] | None = None, staff_id: str | None = None, who: str = "owner",
           task_id: str = "", via: str = "recall", log_it: bool = True, exclude_source: str | None = None) -> dict:
    """Hybrid search. Returns {mode, results: [{chunk_id, source_id, kind, title, ref, url, heading, text, score, meaning, words}]}."""
    from . import embed as EM

    t0 = time.monotonic()
    q = (q or "").strip()
    if not q:
        return {"mode": "none", "results": []}
    where, params = ["1=1"], {"k": max(k * 5, 40)}
    if kinds:
        where.append("s.kind = ANY(:kinds)")
        params["kinds"] = list(kinds)
    if staff_id:
        where.append("(s.staff_id = :staff OR s.staff_id = '')")
        params["staff"] = staff_id
    if exclude_source:
        where.append("s.id <> :ex")
        params["ex"] = exclude_source
    w = " AND ".join(where)
    ranked: dict[int, dict] = {}
    mode = "words"
    # meaning
    try:
        E = EM.current(db)
        if not E.ready():
            raise EM.EmbedError("the local model is still loading")
        qv = E.embed([q], "query")[0]
        params.update(qv=str(qv), tag=E.tag)
        rows = db.execute(text(
            f"SELECT c.id, 1 - ((c.embedding::vector({E.dim})) <=> CAST(:qv AS vector({E.dim}))) AS sim FROM kb_chunk c JOIN kb_source s ON s.id = c.source_id "
            f"WHERE c.dim = {E.dim} AND c.model = :tag AND {w} ORDER BY (c.embedding::vector({E.dim})) <=> CAST(:qv AS vector({E.dim})) LIMIT :k"), params).all()
        for i, (cid_, sim) in enumerate(rows):
            ranked.setdefault(cid_, {"score": 0.0})
            ranked[cid_]["score"] += max(float(sim), 0.0) * 2 / (60 + i)  # a weak match in meaning counts little
            ranked[cid_]["meaning"] = round(float(sim), 4)
        mode = "hybrid" if rows else "words"
    except EM.EmbedError:
        pass
    except Exception:  # noqa: BLE001 - never lose the word search because of the vector half
        db.rollback()
        log.exception("vector search failed")
    # words
    tq = _tsquery(q)
    if tq:
        params["tq"] = tq
        rows = db.execute(text(
            f"SELECT c.id, ts_rank_cd(c.tsv, to_tsquery('simple', :tq)) AS r FROM kb_chunk c JOIN kb_source s ON s.id = c.source_id "
            f"WHERE c.tsv @@ to_tsquery('simple', :tq) AND {w} ORDER BY r DESC LIMIT :k"), params).all()
        for i, (cid_, rk) in enumerate(rows):
            ranked.setdefault(cid_, {"score": 0.0})
            ranked[cid_]["score"] += 1 / (60 + i) * 1.1  # an exact word match counts a little more
            ranked[cid_]["words"] = round(float(rk), 4)
    # how many of the query's words a piece contains decides close calls (and lifts exact matches)
    terms = _terms(q)
    cand = {c.id: c for c in db.scalars(select(KbChunk).where(KbChunk.id.in_(list(ranked))))} if ranked else {}
    for cid_, sc in ranked.items():
        c = cand.get(cid_)
        if c and terms:
            hay = f"{c.heading} {c.text}".lower()
            sc["score"] += 0.04 * sum(1 for t in terms if re.search(r"\b" + re.escape(t), hay)) / len(terms)
    top = sorted(ranked.items(), key=lambda x: -x[1]["score"])[: max(k * 3, k)]
    chunks = {i: cand[i] for i, _ in top if i in cand}
    srcs = {s.id: s for s in db.scalars(select(KbSource).where(KbSource.id.in_({c.source_id for c in chunks.values()})))} if chunks else {}
    out, per_source = [], {}
    for cid_, sc in top:
        c = chunks.get(cid_)
        if not c:
            continue
        s = srcs[c.source_id]
        if per_source.get(s.id, 0) >= 2:  # at most two pieces of the same source, so results cover more ground
            continue
        per_source[s.id] = per_source.get(s.id, 0) + 1
        out.append({"chunk_id": c.id, "source_id": s.id, "kind": s.kind, "title": s.title, "ref": s.ref, "url": s.url, "heading": c.heading,
                    "text": c.text, "score": round(sc["score"] * 60, 3), "meaning": sc.get("meaning"), "words": sc.get("words"),
                    "staff_id": s.staff_id, "updated_at": s.updated_at.isoformat() if s.updated_at else None})
        if len(out) >= k:
            break
    ms = int((time.monotonic() - t0) * 1000)
    if log_it:
        db.add(KbQuery(who=who, task_id=task_id or "", via=via, query=q[:2000], mode=mode, ms=ms,
                       results=[{"chunk_id": r["chunk_id"], "source_id": r["source_id"], "title": r["title"], "kind": r["kind"],
                                 "score": r["score"]} for r in out]))
        db.commit()
    return {"mode": mode, "results": out, "ms": ms}


def docs_search(db: Session, q: str, limit: int = 20, folder: str | None = None) -> list[dict]:
    """Docs search (whole words and prefixes, all words required, then any word): one result per doc."""
    from . import docs as D

    sync_docs(db)
    out: dict[str, dict] = {}
    for op in ("&", "|"):
        tq = _tsquery(q, op=op)
        if not tq:
            return []
        params = {"tq": tq, "tqa": _tsquery(q, op="|"), "lim": limit * 4}
        extra = ""
        if folder:
            extra = " AND s.ref LIKE :folder"
            params["folder"] = folder.rstrip("/") + "/%"
        rows = db.execute(text(
            "SELECT s.ref, s.title, c.text, ts_rank_cd(c.tsv, to_tsquery('simple', :tq)) + "
            "ts_rank(to_tsvector('simple', s.title), to_tsquery('simple', :tqa)) * 10 AS r "
            "FROM kb_chunk c JOIN kb_source s ON s.id = c.source_id WHERE s.kind IN ('doc', 'memory', 'context') "
            f"AND c.tsv @@ to_tsquery('simple', :tq){extra} ORDER BY r DESC LIMIT :lim"), params).all()
        words = [w.lower() for w in _WORD.findall(q)]
        for ref, title, body, r in rows:
            if ref in out:
                continue
            low = body.lower()
            i = next((low.find(w) for w in words if w in low), 0)
            out[ref] = {"path": ref, "title": title or D.title_of(ref), "score": round(float(r), 4), "snippet": D._plain(body[max(0, i - 60): i + 180])}
        if len(out) >= limit or op == "|" and out:
            break
    return sorted(out.values(), key=lambda x: -x["score"])[:limit]


# ------------------------------------------------------------------ views for Docs → Knowledge
def stats(db: Session) -> dict:
    from . import embed as EM

    by_kind = dict(db.execute(select(KbSource.kind, func.count()).group_by(KbSource.kind)).all())
    chunks = db.scalar(select(func.count()).select_from(KbChunk)) or 0
    try:
        E = EM.current(db)
        emb = {"provider": E.provider, "model": E.model, "dim": E.dim, "label": EM.PROVIDERS[E.provider]["label"], "ok": True}
        done = db.scalar(select(func.count()).select_from(KbChunk).where(KbChunk.model == E.tag)) or 0
    except EM.EmbedError as e:
        emb, done = {"ok": False, "error": str(e)}, 0
    err = bus.get_json("kb:error")
    week = now() - dt.timedelta(days=7)
    return {"sources": sum(by_kind.values()), "chunks": chunks, "embedded": done, "pending": max(chunks - done, 0),
            "by_kind": [{"kind": k, "label": KINDS[k][0], "icon": KINDS[k][1], "count": by_kind.get(k, 0)} for k in KINDS],
            "embedder": emb, "error": err.get("error") if err else None,
            "searches_7d": db.scalar(select(func.count()).select_from(KbQuery).where(KbQuery.at >= week)) or 0}


def source_view(s: KbSource) -> dict:
    return {"id": s.id, "kind": s.kind, "kind_label": KINDS.get(s.kind, (s.kind, ""))[0], "ref": s.ref, "title": s.title, "url": s.url,
            "staff_id": s.staff_id, "meta": s.meta or {}, "chars": s.chars, "chunks": s.chunks, "status": s.status, "error": s.error,
            "created_at": s.created_at.isoformat() if s.created_at else None, "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            "indexed_at": s.indexed_at.isoformat() if s.indexed_at else None}


def related(db: Session, source_id: str, k: int = 6) -> list[dict]:
    """Other sources closest in meaning to this one (by the average of its chunk embeddings)."""
    from . import embed as EM

    try:
        E = EM.current(db)
    except EM.EmbedError:
        return []
    row = db.execute(text(f"SELECT AVG(embedding::vector({E.dim}))::text FROM kb_chunk WHERE source_id = :s AND dim = {E.dim} AND model = :tag"),
                     {"s": source_id, "tag": E.tag}).scalar()
    if not row:
        return []
    rows = db.execute(text(
        f"SELECT c.source_id, MIN((c.embedding::vector({E.dim})) <=> CAST(:v AS vector({E.dim}))) AS d FROM kb_chunk c "
        f"WHERE c.dim = {E.dim} AND c.model = :tag AND c.source_id <> :s GROUP BY c.source_id ORDER BY d LIMIT :k"),
        {"v": row, "tag": E.tag, "s": source_id, "k": k}).all()
    srcs = {s.id: s for s in db.scalars(select(KbSource).where(KbSource.id.in_([r[0] for r in rows])))}
    return [{**source_view(srcs[sid]), "similarity": round(1 - float(d), 3)} for sid, d in rows if sid in srcs]


def projection(db: Session, limit: int = 3000) -> dict:
    """A 2-D map of the knowledge base: each chunk's embedding projected on its two main directions (PCA), so things
    with similar meaning sit near each other. Cached in Redis until the knowledge changes."""
    import numpy as np

    from . import embed as EM

    try:
        E = EM.current(db)
    except EM.EmbedError as e:
        return {"points": [], "error": str(e)}
    stamp = db.execute(text("SELECT count(*), max(id) FROM kb_chunk WHERE model = :tag"), {"tag": E.tag}).one()
    ck = f"kb:map:{E.tag}:{stamp[0]}:{stamp[1]}"
    cached = bus.get_json(ck)
    if cached:
        return cached
    rows = db.execute(text(
        "SELECT c.id, c.source_id, c.ord, c.heading, left(c.text, 160), c.embedding::text FROM kb_chunk c WHERE c.model = :tag "
        "ORDER BY c.id DESC LIMIT :lim"), {"tag": E.tag, "lim": limit}).all()
    if len(rows) < 2:
        out = {"points": [], "sources": [], "basis": None}
        return out
    X = np.array([json.loads(r[5]) for r in rows], dtype=np.float32)
    mean = X.mean(axis=0)
    _, _, vt = np.linalg.svd(X - mean, full_matrices=False)
    comps = vt[:2]
    P = (X - mean) @ comps.T
    scale = float(np.percentile(np.abs(P), 97)) or 1.0  # a few outliers shouldn't squeeze everything into the middle
    P = np.clip(P / scale, -1.0, 1.0)
    srcs = {s.id: s for s in db.scalars(select(KbSource).where(KbSource.id.in_({r[1] for r in rows})))}
    pts = [{"id": r[0], "s": r[1], "o": r[2], "h": r[3] or "", "t": r[4], "x": round(float(P[i, 0]), 4), "y": round(float(P[i, 1]), 4)}
           for i, r in enumerate(rows) if r[1] in srcs]
    out = {"points": pts, "sources": {sid: {"title": s.title, "kind": s.kind, "ref": s.ref, "url": s.url} for sid, s in srcs.items()},
           "basis": {"mean": mean.round(6).tolist(), "comps": comps.round(6).tolist(), "scale": scale}, "model": E.tag}
    bus.set_json(ck, out, ttl_s=1800)
    return out


def project(db: Session, q: str) -> dict | None:
    """Where a search lands on the map."""
    import numpy as np

    from . import embed as EM

    m = projection(db)
    b = m.get("basis")
    if not b:
        return None
    try:
        E = EM.current(db)
        if not E.ready():
            return None
        v = np.array(E.embed([q], "query")[0], dtype=np.float32)
    except EM.EmbedError:
        return None
    p = (v - np.array(b["mean"])) @ np.array(b["comps"]).T / b["scale"]
    return {"x": round(float(p[0]), 4), "y": round(float(p[1]), 4)}


def reindex(db: Session) -> int:
    """Re-embed everything (after switching models, or on request) and rebuild docs."""
    n = db.execute(update(KbChunk).values(embedding=None, dim=0, model="")).rowcount
    db.execute(update(KbSource).values(status="pending"))
    db.commit()
    sync_docs(db, force=True)
    _wake()
    return n or 0


def backfill(db: Session, limit: int = 400) -> int:
    """First run on an install with history: mark recent jobs, chats and approved proposals for indexing."""
    from . import services as S

    if S.get_setting(db, "kb_backfilled", None):
        return 0
    n = 0
    for (tid,) in db.execute(select(Report.task_id).order_by(Report.at.desc()).limit(limit)):
        mark("job", tid); n += 1  # noqa: E702
    for (thid,) in db.execute(select(Thread.id).order_by(Thread.updated_at.desc()).limit(limit)):
        mark("chat", thid); n += 1  # noqa: E702
    for (pid,) in db.execute(select(Proposal.id).where(Proposal.status.in_(("approved", "executing", "executed"))).limit(limit)):
        mark("proposal", pid); n += 1  # noqa: E702
    S.set_setting(db, "kb_backfilled", True, actor="system")
    db.commit()
    sync_docs(db, force=True)
    return n


# ------------------------------------------------------------------ text from files and web pages
def html_text(html: str) -> tuple[str, str]:
    """(title, readable text as light Markdown) from an HTML page."""
    from html import unescape

    title = ""
    if m := re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S):
        title = unescape(re.sub(r"\s+", " ", m.group(1)).strip())
    body = re.sub(r"(?is)<(head|title|script|style|noscript|svg|nav|footer|header|form|iframe)\b.*?</\1>", " ", html)
    body = re.sub(r"(?is)<!--.*?-->", " ", body)
    m = re.search(r"(?is)<(main|article)\b[^>]*>(.*?)</\1>", body)
    if m and len(m.group(2)) > 500:
        body = m.group(2)
    body = re.sub(r"(?i)<h([1-6])[^>]*>", lambda mm: "\n\n" + "#" * int(mm.group(1)) + " ", body)
    body = re.sub(r"(?i)</h[1-6]>", "\n\n", body)
    body = re.sub(r"(?i)<li[^>]*>", "\n- ", body)
    body = re.sub(r"(?i)<(br|/p|/div|/tr|/section|/li)[^>]*>", "\n", body)
    body = unescape(re.sub(r"<[^>]+>", " ", body))
    body = re.sub(r"[ \t ]+", " ", body)
    body = re.sub(r"\n\s*\n\s*(\n\s*)+", "\n\n", body)
    return title[:300], "\n".join(ln.strip() for ln in body.splitlines()).strip()


def file_text(path) -> str:
    """Readable text of an uploaded file: text-like files, PDF, Word (.docx), HTML. Raises ValueError otherwise."""
    import zipfile
    from pathlib import Path

    p = Path(path)
    ext = p.suffix.lower()
    if ext == ".pdf":
        from pypdf import PdfReader

        rd = PdfReader(str(p))
        return "\n\n".join(f"## Page {i + 1}\n{(pg.extract_text() or '').strip()}" for i, pg in enumerate(rd.pages[:400]))
    if ext == ".docx":
        with zipfile.ZipFile(p) as z:
            xml = z.read("word/document.xml").decode(errors="replace")
        xml = re.sub(r"</w:p>", "\n", xml)
        return re.sub(r"<[^>]+>", "", xml).strip()
    if ext in (".html", ".htm"):
        return html_text(p.read_text(errors="replace"))[1]
    from .capabilities import TEXT_EXT

    if ext in TEXT_EXT or ext in ("", ".text", ".rst", ".org"):
        return p.read_text(errors="replace")
    raise ValueError(f"{ext or 'this'} files can't be read as text yet (PDF, Word, HTML and text files can)")


async def fetch_page(url: str) -> tuple[str, str, str]:
    """(final url, title, text) of a public web page (same checks as the browser panel: no local addresses)."""
    import httpx

    from .browser_preview import UA, PreviewError, check_url

    url = check_url(url)
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": UA, "Accept": "text/html,text/plain,*/*"}) as h:
            r = await h.get(url)
        check_url(str(r.url))
    except PreviewError:
        raise
    except Exception as e:  # noqa: BLE001
        raise PreviewError(f"could not open the page: {(str(e) or type(e).__name__)[:160]}") from e
    if r.status_code >= 400:
        raise PreviewError(f"the page answered {r.status_code}")
    ctype = r.headers.get("content-type", "")
    if "html" in ctype:
        title, body = html_text(r.text[:3_000_000])
    elif ctype.startswith("text/") or "json" in ctype:
        title, body = url, r.text[:MAX_TEXT]
    else:
        raise PreviewError(f"not a web page ({ctype.split(';')[0] or 'unknown type'})")
    return str(r.url), title or str(r.url), body
