"""Notification email models: EmailLog, WaitlistEntry (global tables, no RLS).

EmailLog makes every notification email at-most-once: a row is inserted with a
unique ``dedupe_key`` *before* sending, so two API workers (or a retried hook)
can never mail the same thing twice.

WaitlistEntry stores people who joined from the landing page.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base


class EmailLog(Base):
    """One notification email (id prefix: eml_)."""

    __tablename__ = "email_log"

    id: Mapped[str] = mapped_column(primary_key=True)
    company_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    # kind: welcome|waitlist|approval|digest|alert
    kind: Mapped[str] = mapped_column(nullable=False)
    dedupe_key: Mapped[str] = mapped_column(nullable=False, unique=True)
    to_email: Mapped[str] = mapped_column(nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # status: sending|sent|failed|skipped
    status: Mapped[str] = mapped_column(nullable=False, server_default="sending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WaitlistEntry(Base):
    """Someone on the waitlist (id prefix: wl_)."""

    __tablename__ = "waitlist_entry"

    id: Mapped[str] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(nullable=False, unique=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
