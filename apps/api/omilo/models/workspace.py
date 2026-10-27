"""Workspace structure models: Channel, Folder, Goal.

All are tenant tables (company_id + RLS).
Helper is deferred to P1 (YAGNI for P0).
"""
from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer
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


class Folder(IdMixin, TimestampMixin, Base):
    """A chat folder inside a channel. Tenant table."""

    __tablename__ = "folder"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("channel.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")


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
