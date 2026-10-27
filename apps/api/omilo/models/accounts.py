"""Engine-pool / harness models: HarnessAccount, ProviderKey (tenant tables).

Both are RLS-protected tenant tables with company_id.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class HarnessAccount(IdMixin, TimestampMixin, Base):
    """A pooled LLM harness account (API key + rate-limit state). Tenant table.

    id prefix: acc_
    """

    __tablename__ = "harness_account"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    harness: Mapped[str] = mapped_column(nullable=False)
    label: Mapped[str] = mapped_column(nullable=False)
    token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    token_hint: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    status: Mapped[str] = mapped_column(nullable=False, server_default="ready")
    cooldown_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    pct_window: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    tokens: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    runs: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    cost_credits: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProviderKey(IdMixin, TimestampMixin, Base):
    """A provider API key attached to a tenant. Tenant table.

    id prefix: pk_
    """

    __tablename__ = "provider_key"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    provider: Mapped[str] = mapped_column(nullable=False)
    key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    key_hint: Mapped[str] = mapped_column(Text, nullable=False)
    connected: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    label: Mapped[str] = mapped_column(nullable=False)
    used_by: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
