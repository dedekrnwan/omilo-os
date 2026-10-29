"""Chat models: ChatSession (table=session), Message.

Both are tenant tables (company_id + RLS).

Note: the class is named `ChatSession` to avoid clashing with
`sqlalchemy.orm.Session`; the actual Postgres table name is `session`.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class ChatSession(IdMixin, TimestampMixin, Base):
    """A chat session / thread. Tenant table. Table name is 'session'."""

    __tablename__ = "session"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(nullable=False)
    channel_id: Mapped[str | None] = mapped_column(
        ForeignKey("channel.id", ondelete="SET NULL"), nullable=True
    )
    folder_id: Mapped[str | None] = mapped_column(
        ForeignKey("folder.id", ondelete="SET NULL"), nullable=True
    )
    # updated stores a relative label verbatim, e.g. "now", "2h", "Yesterday"
    updated: Mapped[str] = mapped_column(Text, nullable=False, server_default="now")
    unread: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # goal stores the goal label string, e.g. "Passwordless login by Q4"
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    # participants: [{name, area}] stored as JSONB
    participants: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # ── sweep/chat (0023) ──
    # 'chat' (normal, company-visible) | 'chief_private' (owner-only Chief DM thread)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default="chat")
    # The member who started the chat (owner of chief_private threads).
    owner_user_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    goal_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Model id picked in the composer (e.g. "opus-5-5"); informational.
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Pins are per user: list of user ids that pinned this chat.
    pinned_by: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Soft delete — hidden everywhere once set.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Sharing: [{user_id, permission}] + general access ('restricted' | 'company').
    shares: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    general_access: Mapped[str] = mapped_column(Text, nullable=False, server_default="restricted")


class Message(IdMixin, TimestampMixin, Base):
    """A chat message within a session. Tenant table."""

    __tablename__ = "message"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("session.id", ondelete="CASCADE"), nullable=False
    )
    # author: {kind, name, role?, area?} stored as JSONB
    author: Mapped[dict] = mapped_column(JSONB, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # created_at is inherited from TimestampMixin; maps to DTO `createdAt` ISO
    system: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # attachment: {title, meta} stored as JSONB
    attachment: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # actions: [{label, primary?}] stored as JSONB
    actions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
