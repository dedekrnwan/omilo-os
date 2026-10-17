"""The knowledge base, for Docs → Knowledge: what the helpers know, how it is searched, and the map of it."""
from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import embed as EM
from .. import kb
from .. import services as S
from ..db import get_db
from ..models import KbChunk, KbQuery, KbSource, Staff, User
from ..security import current_user

router = APIRouter(prefix="/api/kb", tags=["knowledge"])


def _src(db: Session, sid: str) -> KbSource:
    s = db.get(KbSource, sid)
    if not s:
        raise HTTPException(404, "no such source")
    return s


@router.get("/stats")
def stats(db: Session = Depends(get_db), user: User = Depends(current_user)):
    return kb.stats(db)


@router.get("/sources")
def sources(kind: str | None = None, q: str = "", status: str | None = None, staff_id: str | None = None, limit: int = 60, offset: int = 0,
            db: Session = Depends(get_db), user: User = Depends(current_user)):
    qry = select(KbSource)
    if kind:
        qry = qry.where(KbSource.kind.in_(kind.split(",")))
    if status:
        qry = qry.where(KbSource.status == status)
    if staff_id:
        qry = qry.where(KbSource.staff_id == staff_id)
    if q.strip():
        like = f"%{q.strip()}%"
        qry = qry.where(KbSource.title.ilike(like) | KbSource.ref.ilike(like))
    total = db.scalar(select(func.count()).select_from(qry.subquery()))
    rows = db.scalars(qry.order_by(KbSource.updated_at.desc()).limit(max(1, min(limit, 200))).offset(max(0, offset)))
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    return {"total": total, "sources": [{**kb.source_view(s), "staff_name": names.get(s.staff_id, "")} for s in rows]}


@router.get("/sources/{sid}")
def source(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _src(db, sid)
    chunks = list(db.scalars(select(KbChunk).where(KbChunk.source_id == sid).order_by(KbChunk.ord).limit(400)))
    used = db.scalars(select(KbQuery).order_by(KbQuery.at.desc()).limit(500))
    hits = [{"query": q.query, "who": q.who, "at": q.at.isoformat(), "via": q.via} for q in used if any(r.get("source_id") == sid for r in q.results or [])][:20]
    return {**kb.source_view(s), "chunk_list": [{"id": c.id, "ord": c.ord, "heading": c.heading, "text": c.text, "embedded": c.embedding is not None,
                                                "model": c.model} for c in chunks],
            "related": kb.related(db, sid), "retrieved": hits}


@router.delete("/sources/{sid}")
def delete_source(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _src(db, sid)
    if s.kind in ("doc", "memory", "context"):
        raise HTTPException(409, "this comes from a doc: delete or move the doc instead")
    db.delete(s)
    S.audit(db, user.id, "kb.delete", sid, kind=s.kind, title=s.title)
    db.commit()
    return {"ok": True}


@router.post("/sources/{sid}/reindex")
def reindex_source(sid: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    s = _src(db, sid)
    from sqlalchemy import update

    db.execute(update(KbChunk).where(KbChunk.source_id == sid).values(embedding=None, dim=0, model=""))
    s.status = "pending"
    db.commit()
    kb._wake()
    return kb.source_view(s)


@router.get("/search")
def search(q: str, kinds: str | None = None, k: int = 10, project: bool = False, db: Session = Depends(get_db), user: User = Depends(current_user)):
    """The same search helpers use (recall), so you can see what they would find."""
    res = kb.search(db, q, max(1, min(k, 30)), kinds=kinds.split(",") if kinds else None, who="owner", via="ui")
    if project:
        res["point"] = kb.project(db, q)
    return res


@router.get("/map")
def kb_map(db: Session = Depends(get_db), user: User = Depends(current_user)):
    m = kb.projection(db)
    return {k: v for k, v in m.items() if k != "basis"}


@router.get("/related-doc")
def related_doc(path: str, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import docs as D

    p = D.norm(path)
    s = db.scalar(select(KbSource).where(KbSource.ref == p, KbSource.kind.in_(("doc", "memory", "context"))))
    return {"source": kb.source_view(s) if s else None, "related": kb.related(db, s.id, 8) if s else []}


@router.get("/queries")
def queries(limit: int = 50, who: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)):
    qry = select(KbQuery).order_by(KbQuery.at.desc()).limit(max(1, min(limit, 200)))
    if who:
        qry = qry.where(KbQuery.who == who)
    names = {s.id: s.name for s in db.scalars(select(Staff))}
    return [{"id": q.id, "at": q.at.isoformat(), "who": q.who, "who_name": "You" if q.who == "owner" else names.get(q.who, q.who),
             "task_id": q.task_id, "via": q.via, "query": q.query, "mode": q.mode, "ms": q.ms, "results": q.results} for q in db.scalars(qry)]


class NoteIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=1, max_length=400_000)


@router.post("/notes")
def add_note(body: NoteIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    import secrets

    s = kb.put(db, "note", f"note:{secrets.token_hex(6)}", body.title, body.text, meta={"added_by": "owner"})
    S.audit(db, user.id, "kb.add", s.id, kind="note")
    db.commit()
    return kb.source_view(s)


class WebIn(BaseModel):
    url: str


@router.post("/web")
async def add_web(body: WebIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from ..browser_preview import PreviewError

    try:
        final, title, text = await kb.fetch_page(body.url)
    except PreviewError as e:
        raise HTTPException(400, str(e)) from e
    if len(text.strip()) < 40:
        raise HTTPException(400, "that page has almost no readable text (it may need a browser to load)")
    s = kb.put(db, "web", final, title, text, url=final, meta={"added_by": "owner"})
    S.audit(db, user.id, "kb.add", s.id, kind="web", url=final)
    db.commit()
    return kb.source_view(s)


class FileIn(BaseModel):
    name: str
    data: str  # base64


@router.post("/files")
def add_file(body: FileIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    from .. import capabilities as CAP

    try:
        f = CAP.save_bytes(body.name, base64.b64decode(body.data, validate=True))
        text = kb.file_text(CAP.file_path(f["id"]))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 - a broken PDF and the like
        raise HTTPException(400, f"could not read {body.name}: {str(e)[:160]}") from e
    if not text.strip():
        raise HTTPException(400, "no text found in that file (a scanned PDF needs text recognition first)")
    s = kb.put(db, "file", f["id"], f["name"], text, url=f"/api/files/{f['id']}", meta={"added_by": "owner", "mime": f["mime"], "size": f["size"]})
    S.audit(db, user.id, "kb.add", s.id, kind="file", name=f["name"])
    db.commit()
    return kb.source_view(s)


# ------------------------------------------------------------------ the embedding model
@router.get("/settings")
def get_settings_(db: Session = Depends(get_db), user: User = Depends(current_user)):
    cfg = S.get_setting(db, "kb_embedder", None) or {}
    try:
        E = EM.current(db)
        cur = {"provider": E.provider, "model": E.model, "dim": E.dim, "ok": True}
    except EM.EmbedError as e:
        cur = {"provider": cfg.get("provider"), "model": cfg.get("model"), "ok": False, "error": str(e)}
    if cur.get("provider") == "local":
        cur["local"] = EM.local_status(cur["model"])
    return {"current": cur, "providers": EM.PROVIDERS, "local_models": EM.LOCAL_MODELS,
            "keys": {p: S.ai_key_hint(db, p) for p in ("voyage", "openai")}}


class EmbedIn(BaseModel):
    provider: str
    model: str | None = None
    api_key: str | None = None


@router.put("/settings")
def set_embedder(body: EmbedIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    if body.provider not in EM.PROVIDERS:
        raise HTTPException(400, "unknown provider")
    model = body.model or EM.DEFAULT_MODEL[body.provider]
    if model not in EM.PROVIDERS[body.provider]["models"]:
        raise HTTPException(400, "unknown model for that provider")
    if body.api_key:
        S.set_ai_key(db, body.provider, body.api_key, user.id)
    if EM.PROVIDERS[body.provider]["needs_key"] and not S.ai_api_key(db, body.provider):
        raise HTTPException(400, f"{EM.PROVIDERS[body.provider]['label']} needs an API key")
    before = S.get_setting(db, "kb_embedder", None) or {}
    S.set_setting(db, "kb_embedder", {"provider": body.provider, "model": model}, actor=user.id)
    if body.provider in ("voyage", "openai"):
        try:  # check the key/model with one tiny call before re-embedding everything
            EM.current(db).embed(["Omilo check"], "query")
        except EM.EmbedError as e:
            if before:
                S.set_setting(db, "kb_embedder", before, actor=user.id)
            db.commit()
            raise HTTPException(400, str(e)) from e
    db.commit()
    kb._wake()  # chunks made with another model are re-embedded in the background
    return get_settings_(db, user)


@router.post("/reindex")
def reindex_all(db: Session = Depends(get_db), user: User = Depends(current_user)):
    n = kb.reindex(db)
    S.audit(db, user.id, "kb.reindex", "", chunks=n)
    db.commit()
    return {"chunks": n}
