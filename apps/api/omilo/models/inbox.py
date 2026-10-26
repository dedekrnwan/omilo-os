"""Inbox model: InboxItem.

Tenant table (company_id + RLS). Fields match the InboxItem DTO from types.ts.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class InboxItem(IdMixin, TimestampMixin, Base):
    """An inbox item (decision/update/mention). Tenant table."""

    __tablename__ = "inbox_item"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    session_id: Mapped[str] = mapped_column(nullable=False)
    channel_id: Mapped[str] = mapped_column(nullable=False)
    # kind: 'decision' | 'update' | 'mention'
    kind: Mapped[str] = mapped_column(nullable=False)
    # status: 'pending' | 'running' | 'done'
    status: Mapped[str] = mapped_column(nullable=False, server_default="pending")
    # created_at is inherited from TimestampMixin; maps to DTO `createdAt` ISO
    asker: Mapped[str] = mapped_column(nullable=False)
    asker_area: Mapped[str] = mapped_column(nullable=False)
    asked_ago: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_you: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # proposals: [{who, area, text, due}] stored as JSONB
    proposals: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # actions: [{label, primary?, icon?}] stored as JSONB
    actions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    reassurance: Mapped[str | None] = mapped_column(Text, nullable=True)
    compact: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # progress: {step, total, elapsed} stored as JSONB
    progress: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
