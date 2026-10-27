"""Approval models: Proposal, ProposalRevision, SafetyLimit.

All are tenant tables (company_id + RLS).

Proposal is a request for human approval before a Helper acts.
ProposalRevision is the full history of edits to a Proposal.
SafetyLimit is an operator-set hard cap (Control-Panel → Safety & limits).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Proposal(IdMixin, TimestampMixin, Base):
    """A request for human approval before a Helper acts. Tenant table.

    id prefix: prp_
    """

    __tablename__ = "proposal"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # job_id: the job that raised this proposal (plain text FK per P0 pattern)
    job_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False)
    # type: ProposalType enum value
    type: Mapped[str] = mapped_column(nullable=False)
    # risk: Risk — low|medium|high
    risk: Mapped[str] = mapped_column(nullable=False)
    title: Mapped[str] = mapped_column(nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # status: ProposalStatus — pending|approved|rejected|changes_requested|executing|done|failed
    status: Mapped[str] = mapped_column(
        nullable=False, server_default="pending"
    )
    current_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    # decided_by: 'operator:usr_…' | 'chief' | null
    decided_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # execution_job_id: the execution job spawned when approved (null until then)
    execution_job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    # result: jsonb outcome of the execution
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class ProposalRevision(Base):
    """Full history of edits to a Proposal. Tenant table.

    id prefix: prv_
    Uses `at` (not `created_at`) per spec.
    """

    __tablename__ = "proposal_revision"

    id: Mapped[str] = mapped_column(primary_key=True)
    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # proposal_id: FK to proposal (plain text)
    proposal_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # n: revision number (1-based)
    n: Mapped[int] = mapped_column(Integer, nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # author: 'agent' | 'operator'
    author: Mapped[str] = mapped_column(nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # at: revision timestamp (spec uses `at`)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )


class SafetyLimit(IdMixin, TimestampMixin, Base):
    """Operator-set hard cap. Tenant table.

    id prefix: lim_
    """

    __tablename__ = "safety_limit"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    # kind: spend_day|spend_month|messages_day|external_write|deploy
    kind: Mapped[str] = mapped_column(nullable=False)
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    # scope: workspace|channel|helper
    scope: Mapped[str] = mapped_column(
        nullable=False, server_default="workspace"
    )
    # block_or_warn: block|warn
    block_or_warn: Mapped[str] = mapped_column(
        nullable=False, server_default="block"
    )
