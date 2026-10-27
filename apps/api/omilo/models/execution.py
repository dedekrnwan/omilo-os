"""Execution models: Job, Report, RunEvent.

All are tenant tables (company_id + RLS).

Job is the unit of work dispatched to a Helper.
Report is the structured output a Helper writes after a Job completes.
RunEvent is a high-volume stream of live progress events for a Job.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Job(IdMixin, TimestampMixin, Base):
    """A unit of work run by a Helper. Tenant table.

    id prefix: job_
    """

    __tablename__ = "job"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # helper_id: FK to helper (plain text per P0 cross-module pattern)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # origin: JobOrigin — chat|goal|routine|flow|delegation|execution|plan
    origin: Mapped[str] = mapped_column(nullable=False)
    # parent_job_id: for delegated sub-jobs
    parent_job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # source linkage (all nullable)
    goal_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    routine_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    flow_run_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # what to do
    brief: Mapped[str] = mapped_column(Text, nullable=False)
    operator_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # status: JobStatus — queued|running|waiting|done|failed|cancelled
    status: Mapped[str] = mapped_column(
        nullable=False, server_default="queued"
    )
    # set when this job executes an approved proposal
    proposal_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # metering
    cost_credits: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    tokens_in: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    tokens_out: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    # engine_type: EngineType — litellm|claude_code|anthropic|graph|fake
    engine_type: Mapped[str] = mapped_column(
        nullable=False, server_default="fake"
    )
    # checkpoint: LangGraph durable state {plan, step, done, next}
    checkpoint: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Report(IdMixin, TimestampMixin, Base):
    """Structured output written by a Helper after a Job. Tenant table.

    id prefix: rpt_
    """

    __tablename__ = "report"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    job_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False)
    headline: Mapped[str] = mapped_column(nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # kpis: list of KPI snapshots
    kpis: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # sources: list of source refs (what was read)
    sources: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )


class RunEvent(Base):
    """Live progress event for a Job. Tenant table. High-volume.

    id prefix: evt_
    Uses `at` (not `created_at`) per spec.
    """

    __tablename__ = "run_event"

    id: Mapped[str] = mapped_column(primary_key=True)
    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    job_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # kind: status|thinking|text|tool|sources|usage|browser|approval
    kind: Mapped[str] = mapped_column(nullable=False)
    # data: event payload
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # at: event timestamp (spec uses `at`, not `created_at`)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
