"""Inbox model: InboxItem.

Tenant table (company_id + RLS). Fields match the InboxItem DTO from types.ts.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Text, event
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
    # kind: 'decision' | 'update' | 'mention' | 'question' | 'alert' | 'failure'
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
    actions: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    reassurance: Mapped[str | None] = mapped_column(Text, nullable=True)
    compact: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # progress: {step, total, elapsed} stored as JSONB
    progress: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ── sweep/inbox-flows ──
    # read_at: set when the operator reads the item (notifications read state)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # updated_at: bumped whenever the row changes (drives "Done today")
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # proposal_id: the Proposal this decision resolves (derived from `proposals`)
    proposal_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)


def proposal_id_from(proposals: Any) -> str | None:
    """Extract a proposal id from either the legacy dict or the list shape."""
    if isinstance(proposals, dict):
        pid = proposals.get("proposal_id")
        return str(pid) if pid else None
    if isinstance(proposals, list):
        for entry in proposals:
            if isinstance(entry, dict):
                pid = entry.get("proposal_id") or entry.get("proposalId")
                if pid:
                    return str(pid)
    return None


@event.listens_for(InboxItem, "before_insert")
def _inbox_before_insert(_mapper, _conn, target: InboxItem) -> None:
    if target.proposal_id is None:
        target.proposal_id = proposal_id_from(target.proposals)


@event.listens_for(InboxItem, "before_update")
def _inbox_before_update(_mapper, _conn, target: InboxItem) -> None:
    from datetime import timezone

    from sqlalchemy import inspect as sa_inspect

    # Only a status change counts as an "update" (reading an item does not).
    if sa_inspect(target).attrs.status.history.has_changes():
        target.updated_at = datetime.now(timezone.utc)
    if target.proposal_id is None:
        target.proposal_id = proposal_id_from(target.proposals)
