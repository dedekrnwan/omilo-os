"""ToolCall model (§14 platform/ops).

Audit record for every MCP tool call. Tenant table (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin


class ToolCall(IdMixin, Base):
    """Every MCP tool invocation is logged here. Tenant table.

    id prefix: tc_
    Uses `at` instead of created_at (matches RunEvent pattern).
    """

    __tablename__ = "tool_call"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool: Mapped[str] = mapped_column(nullable=False)
    decision: Mapped[str] = mapped_column(nullable=False)  # allowed|proposal|refused|error
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor: Mapped[str] = mapped_column(nullable=False, server_default="agent")
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default="now()",
    )
