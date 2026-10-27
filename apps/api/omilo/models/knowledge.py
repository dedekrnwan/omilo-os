"""KbSource and KbChunk models (§10 knowledge-base / RAG).

All are tenant tables (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class KbSource(IdMixin, TimestampMixin, Base):
    """A knowledge-base source document / integration entry. Tenant table.

    id prefix: kbs_
    """

    __tablename__ = "kb_source"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    kind: Mapped[str] = mapped_column(nullable=False)          # e.g. "notion", "upload", "url"
    ref: Mapped[str] = mapped_column(Text, nullable=False)     # external reference / URL
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )


class KbChunk(IdMixin, TimestampMixin, Base):
    """A single chunk of text from a KbSource, with optional embedding. Tenant table.

    id prefix: kbc_
    """

    __tablename__ = "kb_chunk"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    source_id: Mapped[str] = mapped_column(nullable=False, index=True)
    heading: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    dim: Mapped[int] = mapped_column(Integer, nullable=False, server_default="256")
    embedding: Mapped[list | None] = mapped_column(Vector(256), nullable=True)
    embedding_model: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="hash"
    )
    embedded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    indexed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tsv: Mapped[sa.engine.row.Row | None] = mapped_column(TSVECTOR, nullable=True)
