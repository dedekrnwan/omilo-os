"""MemoryDoc model (§10 persistent memory per helper / company).

Tenant tables (company_id + RLS):
    memory_doc            – a markdown doc (company doc, handbook file, helper memory)
    memory_doc_version    – one row per saved version of a doc (history)
    handbook_suggestion   – a proposed edit to a handbook file (accept/dismiss)
    lesson                – one learned memory (lesson / preference / fact) with
                            a review status; confirmed lessons are KB-indexed.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class MemoryDoc(IdMixin, Base):
    """A persistent memory document for a Helper or company. Tenant table.

    id prefix: mem_

    ``kind`` distinguishes company docs ('doc' and custom kinds), handbook
    files ('handbook') and helper memory (NULL / 'memory').
    """

    __tablename__ = "memory_doc"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    path: Mapped[str] = mapped_column(Text, nullable=False)   # logical path / key
    content: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    # ── sweep/docs (0023) ──
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    area: Mapped[str | None] = mapped_column(Text, nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")


class MemoryDocVersion(IdMixin, TimestampMixin, Base):
    """A saved version of a MemoryDoc. Tenant table. id prefix: mdv_"""

    __tablename__ = "memory_doc_version"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(Text, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class HandbookSuggestion(IdMixin, TimestampMixin, Base):
    """A proposed edit to a handbook file. Tenant table. id prefix: hbs_"""

    __tablename__ = "handbook_suggestion"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    doc_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    proposed_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="open")
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Lesson(IdMixin, TimestampMixin, Base):
    """One learned memory with a review status. Tenant table. id prefix: les_

    status: 'review' (proposed, not used by agents yet) | 'active'.
    tag:    'lesson' | 'preference' | 'fact'.
    helper_id NULL → a company-wide fact.
    """

    __tablename__ = "lesson"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    tag: Mapped[str] = mapped_column(Text, nullable=False, server_default="lesson")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="review")
    created_by: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )
