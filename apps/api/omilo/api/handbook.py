"""omilo.api.handbook — the company handbook (Docs · Handbook + Control panel).

Handbook files are MemoryDoc rows with kind='handbook' and path
``Handbook/<NAME>.md``; ``meta`` carries {description, visibility, brief}.
Every save bumps the version and stores a MemoryDocVersion row. Files are
KB-indexed (kind='handbook') so helpers recall them.

Endpoints
---------
GET  /v1/handbook                                → {files:[file], open_suggestions}
GET  /v1/handbook/suggestions?file=&status=open  → [suggestion]
POST /v1/handbook/suggestions {file, text, proposed_content?, helper_id?} → suggestion
POST /v1/handbook/suggestions/{id}/accept        → suggestion (applies proposed_content)
POST /v1/handbook/suggestions/{id}/dismiss       → suggestion
GET  /v1/handbook/{file}                         → file + {content, versions, suggestions}
PUT  /v1/handbook/{file} {content, title?, description?, visibility?, note?} → file detail
     (creates the file when it doesn't exist — "New file")

The first GET seeds a starter handbook (BRIEF.md + five files) for a company
that has none, written from the company name/about — no demo content.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from omilo.kb.db import get_knowledge_db
from omilo.memory.docs import reindex_doc, save_version
from omilo.models.base import prefixed_id
from omilo.models.memory import HandbookSuggestion, MemoryDoc, MemoryDocVersion
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["handbook"])

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$")


def _norm_name(name: str) -> str:
    name = name.strip()
    if not name.lower().endswith(".md"):
        name = f"{name}.md"
    stem = name[:-3]
    return f"{stem.upper()}.md" if stem.replace("_", "").replace("-", "").isalnum() else name


def _path(name: str) -> str:
    return f"Handbook/{name}"


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


# ---------------------------------------------------------------------------
# Starter handbook
# ---------------------------------------------------------------------------

def _company(db: Session) -> tuple[str, str]:
    row = db.execute(
        sql_text(
            "SELECT name, settings FROM company WHERE id = current_setting('app.company_id', true)"
        )
    ).fetchone()
    if not row:
        return "Your company", ""
    settings = row[1] or {}
    return row[0] or "Your company", str(settings.get("about") or "")


def _starter(name: str, about: str) -> list[tuple[str, str, str, str, str]]:
    """(file, title, description, visibility, content) for a new company."""
    what = about or f"{name} — describe what you do, who you serve and how you work."
    return [
        ("BRIEF.md", "Company brief", "The paragraph every helper reads first", "everyone",
         f"{what}\n"),
        ("COMPANY.md", "Company", "Who we are and who we serve", "everyone",
         f"Who {name} is and who we serve.\n\n## Who we are\n\n{what}\n\n## Who we serve\n\n- Add your customers here.\n"),
        ("SERVICES.md", "Services", "What we offer, what it costs and how long it takes", "everyone",
         "What we offer, what each costs and how long it takes.\n\n## Services\n\n- Add a service, its price and turnaround.\n"),
        ("POLICIES.md", "Policies", "Refunds, customer data, and what needs an owner's OK", "everyone",
         f"The rules every helper and every person at {name} follows. When something isn't covered here, ask the owner — don't guess.\n\n## Refunds\n\n- Anything unusual needs an owner's OK first.\n\n## Customer data\n\n- Never paste customer data into a public channel.\n"),
        ("VOICE.md", "Voice", "How we talk to customers", "everyone",
         "How we talk to customers — the same voice, every helper.\n\n## Tone\n\nWarm, plain and short.\n"),
        ("FAQ.md", "FAQ", "What customers ask every week, answered once", "everyone",
         "What customers ask every week, answered once so every helper replies the same way.\n"),
        ("PEOPLE.md", "People", "Who owns what, and who to call after hours", "members",
         "Who owns what, and who to call after hours. Members and helpers only.\n\n## Owners\n\n- Add who owns what.\n"),
    ]


def _files(db: Session) -> list[MemoryDoc]:
    return db.query(MemoryDoc).filter(MemoryDoc.kind == "handbook").order_by(MemoryDoc.created_at).all()


def _ensure_seeded(db: Session, ctx: RequestContext) -> list[MemoryDoc]:
    files = _files(db)
    if files:
        return files
    name, about = _company(db)
    for fname, title, desc, vis, content in _starter(name, about):
        doc = _new_file(db, ctx, fname, title=title, description=desc, visibility=vis, content=content, by="system")
        files.append(doc)
    return files


def _new_file(
    db: Session,
    ctx: RequestContext,
    name: str,
    *,
    title: str | None,
    description: str | None,
    visibility: str | None,
    content: str,
    by: str,
) -> MemoryDoc:
    doc = MemoryDoc(
        id=prefixed_id("mem"),
        company_id=ctx.company_id,
        helper_id=None,
        path=_path(name),
        title=title or name[:-3].capitalize(),
        kind="handbook",
        area=None,
        pinned=True,
        content=content,
        created_by=by,
        updated_by=by,
        updated_at=datetime.now(timezone.utc),
        version=1,
        meta={
            "description": description or "",
            "visibility": visibility if visibility in ("everyone", "members") else "everyone",
            "brief": name == "BRIEF.md",
        },
    )
    db.add(doc)
    db.flush()
    save_version(db, doc, by=by, note="Created", bump=False)
    reindex_doc(db, doc)
    return doc


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------

def _open_counts(db: Session) -> dict[str, int]:
    rows = db.query(HandbookSuggestion).filter_by(status="open").all()
    out: dict[str, int] = {}
    for r in rows:
        out[r.doc_id] = out.get(r.doc_id, 0) + 1
    return out


def _file_dict(doc: MemoryDoc, open_count: int = 0) -> dict[str, Any]:
    meta = doc.meta or {}
    name = doc.path.split("/", 1)[-1]
    return {
        "id": doc.id,
        "name": name,
        "title": doc.title or name[:-3].capitalize(),
        "description": meta.get("description", ""),
        "visibility": meta.get("visibility", "everyone"),
        "brief": bool(meta.get("brief", name == "BRIEF.md")),
        "version": doc.version or 1,
        "updated_at": _iso(doc.updated_at),
        "updated_by": doc.updated_by,
        "open_suggestions": open_count,
    }


def _suggestion_dict(s: HandbookSuggestion, file_name: str | None = None) -> dict[str, Any]:
    return {
        "id": s.id,
        "doc_id": s.doc_id,
        "file": file_name,
        "helper_id": s.helper_id,
        "author": s.author,
        "text": s.text,
        "proposed_content": s.proposed_content,
        "status": s.status,
        "created_at": _iso(s.created_at),
        "resolved_at": _iso(s.resolved_at),
    }


def _detail(db: Session, doc: MemoryDoc) -> dict[str, Any]:
    versions = (
        db.query(MemoryDocVersion)
        .filter_by(doc_id=doc.id)
        .order_by(MemoryDocVersion.version.desc(), MemoryDocVersion.created_at.desc())
        .limit(20)
        .all()
    )
    sugg = (
        db.query(HandbookSuggestion)
        .filter_by(doc_id=doc.id, status="open")
        .order_by(HandbookSuggestion.created_at.desc())
        .all()
    )
    name = doc.path.split("/", 1)[-1]
    return {
        **_file_dict(doc, len(sugg)),
        "content": doc.content,
        "versions": [
            {"version": v.version, "updated_by": v.updated_by, "note": v.note, "created_at": _iso(v.created_at)}
            for v in versions
        ],
        "suggestions": [_suggestion_dict(s, name) for s in sugg],
    }


def _get_file(db: Session, name: str) -> MemoryDoc | None:
    return db.query(MemoryDoc).filter_by(kind="handbook", path=_path(_norm_name(name))).first()


def _user_label(db: Session, ctx: RequestContext) -> str:
    try:
        row = db.execute(sql_text('SELECT name FROM "user" WHERE id = :id'), {"id": ctx.user_id}).fetchone()
        if row and row[0]:
            return str(row[0])
    except Exception:
        pass
    return "A teammate"


# ---------------------------------------------------------------------------
# Routes (static paths first so /handbook/suggestions isn't read as a file)
# ---------------------------------------------------------------------------

@router.get("/handbook")
def list_handbook(
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    files = _ensure_seeded(db, ctx)
    counts = _open_counts(db)
    return {
        "files": [_file_dict(f, counts.get(f.id, 0)) for f in files],
        "open_suggestions": sum(counts.values()),
    }


@router.get("/handbook/suggestions")
def list_suggestions(
    file: str | None = Query(default=None),
    status_: str | None = Query(default="open", alias="status"),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    q = db.query(HandbookSuggestion)
    if status_:
        q = q.filter_by(status=status_)
    names = {d.id: d.path.split("/", 1)[-1] for d in _files(db)}
    if file:
        doc = _get_file(db, file)
        if doc is None:
            return []
        q = q.filter_by(doc_id=doc.id)
    return [_suggestion_dict(s, names.get(s.doc_id)) for s in q.order_by(HandbookSuggestion.created_at.desc()).all()]


class SuggestionBody(BaseModel):
    file: str
    text: str
    proposed_content: str | None = None
    helper_id: str | None = None


@router.post("/handbook/suggestions", status_code=status.HTTP_201_CREATED)
def create_suggestion(
    body: SuggestionBody,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    doc = _get_file(db, body.file)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Handbook file not found.")
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="Say what should change.")
    author = _user_label(db, ctx)
    if body.helper_id:
        row = db.execute(sql_text("SELECT name FROM helper WHERE id = :id"), {"id": body.helper_id}).fetchone()
        author = row[0] if row else "A helper"
    s = HandbookSuggestion(
        id=prefixed_id("hbs"),
        company_id=ctx.company_id,
        doc_id=doc.id,
        helper_id=body.helper_id,
        author=author,
        text=body.text.strip(),
        proposed_content=body.proposed_content,
        status="open",
    )
    db.add(s)
    db.flush()
    return _suggestion_dict(s, doc.path.split("/", 1)[-1])


def _resolve(db: Session, suggestion_id: str) -> HandbookSuggestion:
    s = db.query(HandbookSuggestion).filter_by(id=suggestion_id).first()
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if s.status != "open":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already resolved.")
    return s


@router.post("/handbook/suggestions/{suggestion_id}/accept")
def accept_suggestion(suggestion_id: str, db: Session = Depends(get_knowledge_db)) -> dict:
    s = _resolve(db, suggestion_id)
    doc = db.query(MemoryDoc).filter_by(id=s.doc_id).first()
    if doc is not None and s.proposed_content is not None and s.proposed_content != doc.content:
        doc.content = s.proposed_content
        save_version(db, doc, by=f"suggestion:{s.author}", note=f"Accepted from {s.author}")
        reindex_doc(db, doc)
    s.status = "accepted"
    s.resolved_at = datetime.now(timezone.utc)
    db.flush()
    return _suggestion_dict(s, doc.path.split("/", 1)[-1] if doc else None)


@router.post("/handbook/suggestions/{suggestion_id}/dismiss")
def dismiss_suggestion(suggestion_id: str, db: Session = Depends(get_knowledge_db)) -> dict:
    s = _resolve(db, suggestion_id)
    s.status = "dismissed"
    s.resolved_at = datetime.now(timezone.utc)
    db.flush()
    return _suggestion_dict(s)


@router.get("/handbook/{file}")
def get_handbook_file(
    file: str,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    _ensure_seeded(db, ctx)
    doc = _get_file(db, file)
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Handbook file not found.")
    return _detail(db, doc)


class PutFileBody(BaseModel):
    content: str
    title: str | None = None
    description: str | None = None
    visibility: str | None = None
    note: str | None = None


@router.put("/handbook/{file}")
def put_handbook_file(
    file: str,
    body: PutFileBody,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    name = _norm_name(file)
    if not _NAME.match(name):
        raise HTTPException(status_code=422, detail="Use letters, numbers, dashes or underscores.")
    by = f"operator:{ctx.user_id}"
    doc = _get_file(db, name)
    if doc is None:
        doc = _new_file(
            db, ctx, name,
            title=body.title, description=body.description, visibility=body.visibility,
            content=body.content, by=by,
        )
        return _detail(db, doc)

    meta = dict(doc.meta or {})
    if body.description is not None:
        meta["description"] = body.description
    if body.visibility in ("everyone", "members"):
        meta["visibility"] = body.visibility
    doc.meta = meta
    flag_modified(doc, "meta")
    if body.title and body.title.strip():
        doc.title = body.title.strip()
    if body.content != doc.content:
        doc.content = body.content
        save_version(db, doc, by=by, note=body.note)
        reindex_doc(db, doc)
    db.flush()
    return _detail(db, doc)
