"""Improvement model (§13/§14 self-improvement tracking).

Tenant table (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Improvement(IdMixin, TimestampMixin, Base):
    """Records a proposed or applied improvement to a Helper. Tenant table.

    id prefix: imp_
    """

    __tablename__ = "improvement"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    by: Mapped[str] = mapped_column(nullable=False)            # who proposed it (helper_id or operator)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    kind: Mapped[str] = mapped_column(nullable=False)          # e.g. "prompt_patch", "skill_add"
    ref: Mapped[str | None] = mapped_column(Text, nullable=True)  # optional target ref
    before: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    after: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    baseline: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    status: Mapped[str] = mapped_column(nullable=False, server_default="active")  # active|applied|rejected
    task_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
