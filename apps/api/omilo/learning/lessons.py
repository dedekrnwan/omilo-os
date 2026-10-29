"""omilo.learning.lessons — reviewable lessons / preferences / facts.

A Lesson row is one thing an agent (or the company) learned. Rows created by
the system (e.g. from a rejected proposal via ``memory.store.add_lesson``)
start in ``review``; rows taught by a person start ``active``. Active rows
that are not already mirrored in a helper's Lessons.md are KB-indexed under
kind='lesson' (ref ``lesson:<id>``) so agents recall them.

Public API
----------
    lesson_to_dict(row) -> dict
    record_lesson(db, *, text, helper_id=None, tag="lesson", source="", status="review", created_by="system") -> Lesson
    confirm_lesson(db, row) -> Lesson
    rename_lesson(db, row, text) -> Lesson
    forget_lesson(db, row) -> None
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from omilo.kb.index import index_source
from omilo.models.base import prefixed_id
from omilo.models.memory import Lesson, MemoryDoc

# created_by marker for rows mirrored from a helper's Lessons.md (already indexed).
FROM_LESSONS_MD = "system:lessons_md"

TAGS = ("lesson", "preference", "fact")


def _company_id(db: Session) -> str:
    row = db.execute(sql_text("SELECT current_setting('app.company_id', true) AS cmp")).fetchone()
    cmp = row.cmp if row else None
    if not cmp:
        raise RuntimeError("No company_id GUC set on this session.")
    return cmp


def lesson_to_dict(row: Lesson) -> dict[str, Any]:
    return {
        "id": row.id,
        "helper_id": row.helper_id,
        "tag": row.tag,
        "text": row.text,
        "source": row.source,
        "status": row.status,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _ref(row: Lesson) -> str:
    return f"lesson:{row.id}"


def _index(db: Session, row: Lesson) -> None:
    if row.status != "active" or row.created_by == FROM_LESSONS_MD:
        return
    index_source(
        db,
        kind="lesson",
        ref=_ref(row),
        title=row.text[:80],
        body=row.text,
        helper_id=row.helper_id,
        meta={"tag": row.tag},
    )


def _unindex(db: Session, row: Lesson) -> None:
    from omilo.memory.docs import drop_index

    drop_index(db, _ref(row))


def record_lesson(
    db: Session,
    *,
    text: str,
    helper_id: str | None = None,
    tag: str = "lesson",
    source: str = "",
    status: str = "review",
    created_by: str = "system",
) -> Lesson:
    row = Lesson(
        id=prefixed_id("les"),
        company_id=_company_id(db),
        helper_id=helper_id,
        tag=tag if tag in TAGS else "lesson",
        text=text.strip(),
        source=source,
        status=status,
        created_by=created_by,
    )
    db.add(row)
    db.flush()
    _index(db, row)
    return row


def confirm_lesson(db: Session, row: Lesson) -> Lesson:
    row.status = "active"
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    _index(db, row)
    return row


def _lessons_md(db: Session, row: Lesson) -> MemoryDoc | None:
    if not row.helper_id:
        return None
    return (
        db.query(MemoryDoc)
        .filter_by(helper_id=row.helper_id, path=f"Memory/{row.helper_id}/Lessons.md")
        .first()
    )


def _rewrite_lessons_md(db: Session, row: Lesson, replace_with: str | None) -> None:
    """Edit (or drop) the matching line in the helper's Lessons.md and re-index it."""
    doc = _lessons_md(db, row)
    if doc is None or row.text not in doc.content:
        return
    lines = doc.content.split("\n")
    out: list[str] = []
    for line in lines:
        if row.text in line:
            if replace_with is None:
                continue
            line = line.replace(row.text, replace_with)
        out.append(line)
    doc.content = "\n".join(out)
    doc.updated_by = "operator"
    doc.updated_at = datetime.now(timezone.utc)
    db.flush()
    from omilo.memory.docs import reindex_doc

    reindex_doc(db, doc)


def rename_lesson(db: Session, row: Lesson, text: str) -> Lesson:
    text = text.strip()
    if not text or text == row.text:
        return row
    _rewrite_lessons_md(db, row, text)
    row.text = text
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    _unindex(db, row)
    _index(db, row)
    return row


def forget_lesson(db: Session, row: Lesson) -> None:
    _rewrite_lessons_md(db, row, None)
    _unindex(db, row)
    db.delete(row)
    db.flush()
