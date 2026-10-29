"""ComputeWorker and ComputeJob models.

Both are tenant tables (company_id + FORCE RLS), following the same pattern
as every other domain table (IdMixin, TimestampMixin, company_id indexed).

ComputeWorker — represents a self-hosted worker node registered to a company.
  id prefix: cwk_
  status: 'online' | 'offline'
  capacity: total concurrent slots the worker can handle
  in_use: slots currently occupied
  last_seen_at: last heartbeat timestamp (nullable until first ping)
  token_hash: sha256 hex digest of the worker's registration secret

ComputeJob — a unit of work dispatched to (or awaiting) a ComputeWorker.
  id prefix: cjb_
  worker_id: FK → compute_worker.id (nullable — queued jobs may be unassigned)
  status: 'queued' | 'dispatched' | 'running' | 'done' | 'error'
  spec: JSONB payload describing the work (e.g. {type, flow_id, …})
  lease_expires_at: when the dispatch lease expires (nullable)
  result: JSONB output once done (nullable)
  artifact: opaque reference to stored output (nullable)
  error: human-readable error message when status='error' (nullable)
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class ComputeWorker(IdMixin, TimestampMixin, Base):
    """Self-hosted worker node registered to a company. Tenant table.

    id prefix: cwk_
    ``token_hash`` is the sha256 hex digest of the raw registration secret.
    ``status`` is 'online' or 'offline'.
    ``capacity`` is the total concurrent job slots.
    ``in_use`` is the number of slots currently occupied.
    ``last_seen_at`` is updated on each heartbeat.
    """

    __tablename__ = "compute_worker"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="offline")
    capacity: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    in_use: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)


class ComputeJob(IdMixin, TimestampMixin, Base):
    """Unit of work dispatched to (or awaiting) a ComputeWorker. Tenant table.

    id prefix: cjb_
    ``worker_id`` is None for queued jobs awaiting dispatch.
    ``status`` progresses: queued → dispatched → running → done | error.
    ``spec`` is the JSONB work payload.
    ``lease_expires_at`` gates re-dispatch of stale dispatched jobs.
    ``result`` holds JSONB output on success.
    ``artifact`` is an opaque storage reference (URL, key, etc.) for large output.
    ``error`` holds the failure message when status='error'.
    """

    __tablename__ = "compute_job"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    worker_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("compute_worker.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="queued")
    spec: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
    )
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    artifact: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
