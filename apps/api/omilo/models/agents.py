"""Agent models: Helper.

Tenant table (company_id + RLS).

Helper is the AI agent / staff member that runs Jobs, sends Proposals,
and belongs to one or more Channels (areas).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Helper(IdMixin, TimestampMixin, Base):
    """AI agent / staff. Tenant table.

    id prefix: hlp_
    """

    __tablename__ = "helper"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    # area: soft category key (e.g. 'marketing', 'ops'); not a closed enum
    area: Mapped[str] = mapped_column(nullable=False, server_default="ops")
    role: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    job_description: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )
    is_chief: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    # engine: {type, auth, model, tier}
    engine: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    # autonomy_cap: 'strict' | 'ask' | 'yolo' | null
    autonomy_cap: Mapped[str | None] = mapped_column(Text, nullable=True)
    # permissions: list of allowed ProposalType strings
    permissions: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="active"
    )
    # channel_ids: list of channel id strings this helper serves
    channel_ids: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    # mcp_token_hash: sha256 hex digest of the per-helper MCP token secret.
    # Null = no token minted yet.  Raw token is NEVER stored.
    mcp_token_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    # budget_tokens_month: optional per-helper monthly AI budget in tokens
    # (input + output). Null = unlimited. When the helper's month-to-date
    # tokens reach it, the runner pauses the helper (omilo.ai.usage).
    budget_tokens_month: Mapped[int | None] = mapped_column(
        BigInteger, nullable=True
    )

    # ── sweep/team-analytics ──
    # title: job title shown under the name (Profile tab)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    # reports_to: 'owner' | helper id (Profile tab / hire setup)
    reports_to: Mapped[str | None] = mapped_column(Text, nullable=True)
    # look: {color, shape, prop, picture} mascot look (Profile tab)
    look: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # behavior: Behavior tab settings — tokens_per_task, messages_per_hour,
    # never_discuss[], work_hours_override, handoff_to, language
    behavior: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # tool_access: {builtins: {browser: bool, web_search: bool, code_runner: bool}}
    tool_access: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # skill_settings: {skill_id: {enabled: bool, permission: 'always'|'ask'}}
    skill_settings: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    # budget_allow_jobs: one-off overrides that let a job start past the budget
    budget_allow_jobs: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # retired_at: set when the helper is let go (status='retired'); history kept
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
