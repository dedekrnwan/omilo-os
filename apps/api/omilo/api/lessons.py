"""omilo.api.lessons — reviewable lessons / preferences / facts (Docs · Knowledge).

Endpoints
---------
GET   /v1/lessons?status=review|active&helper_id=  → [lesson]
POST  /v1/lessons {text, helper_id?, tag?}         → lesson (status active — taught by a person)
PATCH /v1/lessons/{id} {text?, tag?}               → lesson
POST  /v1/lessons/{id}/confirm                     → lesson (status active)
POST  /v1/lessons/{id}/forget                      → {ok: true} (row + KB index removed)

A lesson dict is {id, helper_id, tag, text, source, status, created_by, created_at}.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from omilo.kb.db import get_knowledge_db
from omilo.learning.lessons import (
    TAGS,
    confirm_lesson,
    forget_lesson,
    lesson_to_dict,
    record_lesson,
    rename_lesson,
)
from omilo.models.memory import Lesson
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["lessons"])


class CreateLessonBody(BaseModel):
    text: str
    helper_id: str | None = None
    tag: str | None = None
    source: str | None = None


class PatchLessonBody(BaseModel):
    text: str | None = None
    tag: str | None = None


def _get(db: Session, lesson_id: str) -> Lesson:
    row = db.query(Lesson).filter_by(id=lesson_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    return row


@router.get("/lessons")
def list_lessons(
    status_: str | None = Query(default=None, alias="status"),
    helper_id: str | None = Query(default=None),
    db: Session = Depends(get_knowledge_db),
) -> list[dict]:
    q = db.query(Lesson)
    if status_:
        q = q.filter_by(status=status_)
    if helper_id:
        q = q.filter_by(helper_id=helper_id)
    return [lesson_to_dict(r) for r in q.order_by(Lesson.created_at.desc()).all()]


@router.post("/lessons", status_code=status.HTTP_201_CREATED)
def create_lesson(
    body: CreateLessonBody,
    db: Session = Depends(get_knowledge_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    if not body.text.strip():
        raise HTTPException(status_code=422, detail="Lesson text is required.")
    row = record_lesson(
        db,
        text=body.text,
        helper_id=body.helper_id,
        tag=body.tag or ("fact" if body.helper_id is None else "lesson"),
        source=body.source or "You taught it",
        status="active",
        created_by=f"operator:{ctx.user_id}",
    )
    return lesson_to_dict(row)


@router.patch("/lessons/{lesson_id}")
def patch_lesson(lesson_id: str, body: PatchLessonBody, db: Session = Depends(get_knowledge_db)) -> dict:
    row = _get(db, lesson_id)
    if body.tag is not None and body.tag in TAGS:
        row.tag = body.tag
    if body.text is not None:
        rename_lesson(db, row, body.text)
    db.flush()
    return lesson_to_dict(row)


@router.post("/lessons/{lesson_id}/confirm")
def confirm(lesson_id: str, db: Session = Depends(get_knowledge_db)) -> dict:
    return lesson_to_dict(confirm_lesson(db, _get(db, lesson_id)))


@router.post("/lessons/{lesson_id}/forget")
def forget(lesson_id: str, db: Session = Depends(get_knowledge_db)) -> dict:
    forget_lesson(db, _get(db, lesson_id))
    return {"ok": True}
