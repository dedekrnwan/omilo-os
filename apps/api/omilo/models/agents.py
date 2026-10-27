"""Agent models: Helper.

Tenant table (company_id + RLS).

Helper is the AI agent / staff member that runs Jobs, sends Proposals,
and belongs to one or more Channels (areas).
"""
from __future__ import annotations

from sqlalchemy import Boolean, Text
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
