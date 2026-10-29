"""omilo.memory.docs — shared helpers for company docs, handbook files and lessons.

Public API
----------
    doc_title(doc) -> str
    doc_to_dict(doc) -> dict
    parse_wikilinks(content) -> list[str]
    resolve_links(db, doc) -> dict            (outgoing docs/goals, unresolved, backlinks)
    save_version(db, doc, *, by, note=None)   (bump version + history row)
    reindex_doc(db, doc)                      (KB index with the right kind)
    drop_index(db, ref)                       (remove a KbSource + its chunks)
    knowledge_enabled(db) -> bool             (company.settings.knowledge.enabled)
    agent_memory_kinds                        (kinds treated as agent memory)
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.kb.index import index_source
from omilo.models.base import prefixed_id
from omilo.models.knowledge import KbChunk, KbSource
from omilo.models.memory import MemoryDoc, MemoryDocVersion
from omilo.models.workspace import Goal

# KB kinds that count as "agent memory" — skipped at recall time while the
# company's Knowledge toggle is off (docs, handbook and uploads stay searchable).
AGENT_MEMORY_KINDS: tuple[str, ...] = ("memory", "lesson")

_WIKILINK = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]*)?\]\]")
_SUFFIX = re.compile(r"-[a-z0-9]{6}$")


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def doc_title(doc: MemoryDoc) -> str:
    """The doc's title, derived from its path for rows written before 0023."""
    if doc.title:
        return doc.title
    stem = doc.path.split("/")[-1]
    if stem.lower().endswith(".md") and (doc.kind or "") != "handbook":
        stem = stem[:-3]
    stem = _SUFFIX.sub("", stem)
    return stem.replace("-", " ").strip().capitalize() or "Untitled"


def doc_kind(doc: MemoryDoc) -> str:
    if doc.kind:
        return doc.kind
    if doc.helper_id:
        return "memory"
    parts = doc.path.split("/")
    if len(parts) >= 3 and parts[0] == "Docs":
        return parts[1]
    return "doc"


def doc_to_dict(doc: MemoryDoc) -> dict[str, Any]:
    meta = doc.meta or {}
    return {
        "id": doc.id,
        "path": doc.path,
        "title": doc_title(doc),
        "content": doc.content,
        "kind": doc_kind(doc),
        "area": doc.area,
        "pinned": bool(doc.pinned),
        "hidden": bool(meta.get("hidden", False)),
        "helper_id": doc.helper_id,
        "version": doc.version or 1,
        "updatedAt": _iso(doc.updated_at),
        "updatedBy": doc.updated_by,
        "createdAt": _iso(doc.created_at),
        "createdBy": doc.created_by or doc.updated_by,
    }


def parse_wikilinks(content: str) -> list[str]:
    """Return the distinct [[wikilink]] targets in order of appearance."""
    seen: list[str] = []
    for m in _WIKILINK.finditer(content or ""):
        t = m.group(1).strip()
        if t and t.lower() not in {s.lower() for s in seen}:
            seen.append(t)
    return seen


def company_docs(db: Session) -> list[MemoryDoc]:
    """All company-level docs (no helper memory)."""
    return db.query(MemoryDoc).filter(MemoryDoc.helper_id.is_(None)).all()


def _title_index(docs: list[MemoryDoc]) -> dict[str, MemoryDoc]:
    idx: dict[str, MemoryDoc] = {}
    for d in docs:
        idx.setdefault(doc_title(d).lower(), d)
        # Handbook files are linkable by file name too ([[POLICIES.md]]).
        idx.setdefault(d.path.split("/")[-1].lower(), d)
    return idx


def resolve_links(db: Session, doc: MemoryDoc) -> dict[str, Any]:
    """Outgoing links (docs + goals), unresolved targets and backlinks."""
    docs = company_docs(db)
    by_title = _title_index(docs)
    goals = db.query(Goal).all()
    goals_by_title = {g.title.lower(): g for g in goals}

    outgoing: list[dict[str, Any]] = []
    goal_links: list[dict[str, Any]] = []
    unresolved: list[str] = []
    for target in parse_wikilinks(doc.content):
        key = target.lower()
        if key in by_title and by_title[key].id != doc.id:
            d = by_title[key]
            outgoing.append({"id": d.id, "title": doc_title(d), "kind": doc_kind(d)})
        elif key in goals_by_title or (key.startswith("goal:") and key[5:].strip() in goals_by_title):
            g = goals_by_title.get(key) or goals_by_title[key[5:].strip()]
            goal_links.append({"id": g.id, "title": g.title, "progress": g.progress, "status": g.status})
        else:
            unresolved.append(target)

    my_keys = {doc_title(doc).lower(), doc.path.split("/")[-1].lower()}
    backlinks = [
        {"id": d.id, "title": doc_title(d), "kind": doc_kind(d)}
        for d in docs
        if d.id != doc.id and any(t.lower() in my_keys for t in parse_wikilinks(d.content))
    ]
    return {"links": outgoing, "goals": goal_links, "unresolved": unresolved, "backlinks": backlinks}


def build_graph(db: Session) -> dict[str, Any]:
    """Doc graph: company docs as nodes, [[wikilinks]] as edges, goals as nodes."""
    docs = [d for d in company_docs(db) if not (d.meta or {}).get("hidden")]
    by_title = _title_index(docs)
    goals_by_title = {g.title.lower(): g for g in db.query(Goal).all()}

    nodes: list[dict[str, Any]] = [
        {
            "id": d.id,
            "title": doc_title(d),
            "area": d.area,
            "kind": doc_kind(d),
            "by": "team" if (d.created_by or d.updated_by or "").startswith("operator:") else "agents",
            "updatedAt": _iso(d.updated_at),
            "excerpt": (d.content or "").strip().split("\n")[0][:160],
        }
        for d in docs
    ]
    edges: list[dict[str, str]] = []
    goal_nodes: dict[str, dict[str, Any]] = {}
    seen: set[tuple[str, str]] = set()
    for d in docs:
        for target in parse_wikilinks(d.content):
            key = target.lower()
            to: str | None = None
            if key in by_title and by_title[key].id != d.id:
                to = by_title[key].id
            else:
                g = goals_by_title.get(key) or (goals_by_title.get(key[5:].strip()) if key.startswith("goal:") else None)
                if g is not None:
                    to = f"goal:{g.id}"
                    goal_nodes.setdefault(to, {"id": to, "title": g.title, "area": None, "kind": "goal", "by": "team"})
            if to and (d.id, to) not in seen and (to, d.id) not in seen:
                seen.add((d.id, to))
                edges.append({"from": d.id, "to": to})
    return {"nodes": nodes + list(goal_nodes.values()), "edges": edges}


def save_version(db: Session, doc: MemoryDoc, *, by: str, note: str | None = None, bump: bool = True) -> None:
    """Bump the doc version (optionally) and store a history row for it."""
    if bump:
        doc.version = (doc.version or 1) + 1
    doc.updated_by = by
    doc.updated_at = datetime.now(timezone.utc)
    db.add(
        MemoryDocVersion(
            id=prefixed_id("mdv"),
            company_id=doc.company_id,
            doc_id=doc.id,
            version=doc.version or 1,
            title=doc.title,
            content=doc.content,
            updated_by=by,
            note=note,
        )
    )
    db.flush()


def reindex_doc(db: Session, doc: MemoryDoc) -> None:
    """KB-index a doc under the kind that matches what it is."""
    kind = doc_kind(doc)
    kb_kind = "memory" if doc.helper_id else ("handbook" if kind == "handbook" else "doc")
    index_source(
        db,
        kind=kb_kind,
        ref=doc.path,
        title=doc_title(doc),
        body=doc.content,
        helper_id=doc.helper_id,
    )


def drop_index(db: Session, ref: str) -> None:
    """Delete the KbSource for *ref* and its chunks (no-op if absent)."""
    src = db.query(KbSource).filter_by(ref=ref).first()
    if src is None:
        return
    db.query(KbChunk).filter_by(source_id=src.id).delete(synchronize_session="fetch")
    db.delete(src)
    db.flush()


def knowledge_enabled(db: Session) -> bool:
    """Whether the active company turned Knowledge (agent memory) on.

    Reads company.settings.knowledge.enabled; anything but ``true`` is off,
    matching the Docs · Knowledge screen's default.
    """
    try:
        with db.begin_nested():
            row = db.execute(
                text(
                    "SELECT settings FROM company "
                    "WHERE id = current_setting('app.company_id', true)"
                )
            ).fetchone()
    except Exception:
        return False
    settings = (row[0] if row else None) or {}
    knowledge = settings.get("knowledge") or {}
    return knowledge.get("enabled") is True
