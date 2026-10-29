"""Flow and FlowRun models (§9 visual automations).

All are tenant tables (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Flow(IdMixin, TimestampMixin, Base):
    """A visual automation / workflow (os Workflow). Tenant table.

    id prefix: flw_
    """

    __tablename__ = "flow"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    title: Mapped[str] = mapped_column(nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    channel_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    areas: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    # trigger: {kind, spec} — kind ∈ schedule|manual|internal_event|connector_poll
    trigger: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # poll_cursor: watermark for connector_poll flows
    poll_cursor: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # nodes: CanvasNode[] — {id,kind,label,sublabel,x,y,w,h,config}
    nodes: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    # edges: CanvasEdge[] — {id,from,to,label}
    edges: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    # settings: free-form flow-editor settings (budget / approvals / quiet-hours /
    # notifications). Deep-merged on PATCH /v1/flows/{id}, mirrors company.settings.
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    status: Mapped[str] = mapped_column(nullable=False, server_default="draft")  # draft|published
    created_by: Mapped[str] = mapped_column(nullable=False, server_default="operator")
    proposed_from_pattern: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )


class FlowRun(IdMixin, TimestampMixin, Base):
    """A single execution of a Flow. Tenant table.

    id prefix: frn_
    """

    __tablename__ = "flow_run"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    flow_id: Mapped[str] = mapped_column(nullable=False, index=True)
    status: Mapped[str] = mapped_column(nullable=False, server_default="running")  # FlowRunStatus
    trigger_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_credits: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    duration: Mapped[int | None] = mapped_column(Integer, nullable=True)  # seconds
    waiting_for: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_ids: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="[]")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
