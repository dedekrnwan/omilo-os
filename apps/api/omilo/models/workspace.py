"""Workspace structure models: Channel, Folder, Goal.

All are tenant tables (company_id + RLS).
Helper is deferred to P1 (YAGNI for P0).
"""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, Text
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Channel(IdMixin, TimestampMixin, Base):
    """A focused area / channel. Tenant table."""

    __tablename__ = "channel"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    # accent maps to ChannelAccent in types.ts: 'general' | 'dev' | 'marketing' | 'sales'
    accent: Mapped[str] = mapped_column(nullable=False, server_default="general")
    is_default: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    agent_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    chat_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    open_items: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # P5d additive columns — area context
    icon: Mapped[str | None] = mapped_column(nullable=True)          # lucide icon name
    purpose: Mapped[str | None] = mapped_column(nullable=True)       # area purpose text
    # context_scope bounds RAG retrieval; default 'isolated' for existing rows
    context_scope: Mapped[str] = mapped_column(nullable=False, server_default="isolated")
    # ── sweep/chat (0023): custom area colour (hex); icon reuses `icon` ──
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    # sweep/control — archive (read-only, hidden from the app) + mute.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    muted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")


class Folder(IdMixin, TimestampMixin, Base):
    """A chat folder inside a channel. Tenant table."""

    __tablename__ = "folder"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("channel.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # ── sweep/chat (0023) ──
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    shares: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")


class Goal(IdMixin, TimestampMixin, Base):
    """A goal linked to a channel. Tenant table."""

    __tablename__ = "goal"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("channel.id", ondelete="CASCADE"), nullable=False
    )
    title: Mapped[str] = mapped_column(nullable=False)
    progress: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # P2 additive columns
    target: Mapped[str] = mapped_column(nullable=False, server_default="")
    status: Mapped[str] = mapped_column(nullable=False, server_default="active")
    autonomy_override: Mapped[str | None] = mapped_column(nullable=True)
    owner_helper_id: Mapped[str | None] = mapped_column(nullable=True)
    # ── sweep/goals-routines (0023) ──
    due: Mapped[str | None] = mapped_column(Text, nullable=True)
    measured_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    helper_ids: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    period: Mapped[str | None] = mapped_column(Text, nullable=True)  # e.g. "2026-Q4"
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    status_set_by: Mapped[str | None] = mapped_column(Text, nullable=True)  # 'user'|'system'


# ── sweep/chat (0023) ─────────────────────────────────────────────────────────


class FolderFile(IdMixin, TimestampMixin, Base):
    """A file attached to a folder as shared context. Tenant table.

    Kept deliberately simple: metadata plus extracted text (for text-like
    files) that helpers can read as folder context. Binary payloads are not
    stored.
    """

    __tablename__ = "folder_file"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    folder_id: Mapped[str] = mapped_column(
        ForeignKey("folder.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    mime: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChiefNudgeState(IdMixin, TimestampMixin, Base):
    """Per-user dismiss / snooze state of a derived Chief nudge. Tenant table."""

    __tablename__ = "chief_nudge_state"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    nudge_key: Mapped[str] = mapped_column(Text, nullable=False)
    dismissed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    snooze_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
