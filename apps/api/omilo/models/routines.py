"""Routine and RoutineRun models (§8 cron/shift).

All are tenant tables (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Routine(IdMixin, TimestampMixin, Base):
    """A recurring scheduled task for a Helper (os Shift). Tenant table.

    id prefix: rtn_
    """

    __tablename__ = "routine"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    subtitle: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    instructions: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    freq: Mapped[str] = mapped_column(nullable=False)  # RoutineFreq
    at: Mapped[str] = mapped_column(nullable=False, server_default="09:00")  # "HH:MM"
    days: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    monthly: Mapped[str | None] = mapped_column(Text, nullable=True)  # "date"|"last_working_day"
    timezone: Mapped[str] = mapped_column(nullable=False, server_default="UTC")
    cron: Mapped[str | None] = mapped_column(Text, nullable=True)  # derived cron expression
    sends_to: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    paused: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    managed_by_chief: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    goal_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    created_by: Mapped[str] = mapped_column(nullable=False, server_default="operator")


class RoutineRun(IdMixin, Base):
    """Thin history row per Routine firing. Tenant table.

    id prefix: rrn_
    Uses created_at manually (no TimestampMixin — it stores `when` instead).
    """

    __tablename__ = "routine_run"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    routine_id: Mapped[str] = mapped_column(nullable=False, index=True)
    job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    when: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    skipped: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    cost_credits: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )
