"""omilo.memory.store — editable markdown memory for Helpers.

Design
------
Memory is stored as plain markdown MemoryDoc rows, one per logical path.
Two canonical paths per helper:

    Memory/<helper_id>/Lessons.md   – rules learned from operator decisions / retro
    Memory/<helper_id>/Notes.md     – things the helper chose to remember

`add_lesson` prepends (newest first); `remember` appends.
Both KB-index the updated doc so lessons are recall-able.

Public API
----------
    add_lesson(db, helper_id, text, source="", on_date=None) -> MemoryDoc
    remember(db, helper_id, text, on_date=None) -> MemoryDoc
    get_memory(db, helper_id) -> str
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from omilo.kb.index import index_source
from omilo.models.base import prefixed_id
from omilo.models.memory import MemoryDoc


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_company_id(db: Session) -> str:
    """Read the transaction-local company_id GUC."""
    from sqlalchemy import text
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


def _upsert_doc(db: Session, *, company_id: str, helper_id: str, path: str) -> MemoryDoc:
    """Return existing MemoryDoc by path (RLS-scoped) or create a new empty one."""
    existing = db.query(MemoryDoc).filter_by(path=path, helper_id=helper_id).first()
    if existing is not None:
        return existing

    doc = MemoryDoc(
        id=prefixed_id("mem"),
        company_id=company_id,
        helper_id=helper_id,
        path=path,
        content="",
        updated_by="system",
        updated_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.flush()
    return doc


def _kb_index_doc(db: Session, doc: MemoryDoc, helper_id: str) -> None:
    """KB-index a MemoryDoc so it is recall-able."""
    # Extract a short title from the path: last component without extension
    title_part = doc.path.split("/")[-1].replace(".md", "")
    index_source(
        db,
        kind="memory",
        ref=doc.path,
        title=f"{title_part} · {helper_id}",
        body=doc.content,
        helper_id=helper_id,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_lesson(
    db: Session,
    helper_id: str,
    text: str,
    source: str = "",
    *,
    on_date: date | None = None,
) -> MemoryDoc:
    """Upsert Lessons.md and PREPEND a new lesson line (newest first).

    Line format: ``- **<YYYY-MM-DD>** · <text> (<source>)``

    Also KB-indexes the updated doc so the lesson is recall-able via recall().

    Parameters
    ----------
    db:        Tenant-scoped SQLAlchemy Session.
    helper_id: The Helper this lesson belongs to.
    text:      Lesson text.
    source:    Short provenance label (e.g. "approval", "retro").
    on_date:   Optional override for the lesson date (defaults to today).
               Pass for deterministic tests.

    Returns
    -------
    Updated MemoryDoc (flushed, not committed — caller owns the txn).
    """
    company_id = _get_company_id(db)
    lesson_date = (on_date or date.today()).isoformat()
    source_str = f" ({source})" if source else ""
    new_line = f"- **{lesson_date}** · {text}{source_str}"

    path = f"Memory/{helper_id}/Lessons.md"
    doc = _upsert_doc(db, company_id=company_id, helper_id=helper_id, path=path)

    # Prepend: new line goes to the top
    if doc.content.strip():
        doc.content = new_line + "\n" + doc.content
    else:
        doc.content = new_line + "\n"

    doc.updated_by = "system"
    doc.updated_at = datetime.now(timezone.utc)
    db.flush()

    _kb_index_doc(db, doc, helper_id)
    return doc


def remember(
    db: Session,
    helper_id: str,
    text: str,
    *,
    on_date: date | None = None,
) -> MemoryDoc:
    """Upsert Notes.md and APPEND a new note line.

    Line format: ``- <text>``

    Also KB-indexes the updated doc.

    Parameters
    ----------
    db:        Tenant-scoped SQLAlchemy Session.
    helper_id: The Helper this note belongs to.
    text:      Note text.
    on_date:   Unused; kept for API symmetry with add_lesson.

    Returns
    -------
    Updated MemoryDoc (flushed, not committed — caller owns the txn).
    """
    company_id = _get_company_id(db)
    new_line = f"- {text}"

    path = f"Memory/{helper_id}/Notes.md"
    doc = _upsert_doc(db, company_id=company_id, helper_id=helper_id, path=path)

    # Append
    if doc.content.strip():
        doc.content = doc.content.rstrip("\n") + "\n" + new_line + "\n"
    else:
        doc.content = new_line + "\n"

    doc.updated_by = "system"
    doc.updated_at = datetime.now(timezone.utc)
    db.flush()

    _kb_index_doc(db, doc, helper_id)
    return doc


def get_memory(db: Session, helper_id: str) -> str:
    """Return the concatenated Lessons.md + Notes.md content for a helper.

    Used to populate TaskContext.memory before every run.
    Returns empty string if neither doc exists.
    """
    paths = [
        f"Memory/{helper_id}/Lessons.md",
        f"Memory/{helper_id}/Notes.md",
    ]
    parts: list[str] = []
    for path in paths:
        doc = db.query(MemoryDoc).filter_by(path=path, helper_id=helper_id).first()
        if doc and doc.content.strip():
            parts.append(doc.content)

    return "\n".join(parts)
