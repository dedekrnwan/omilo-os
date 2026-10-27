"""Connector model — per-tenant integration instance. Tenant table (RLS).

Connector links a Piece (or custom source) to a company's workspace,
holding credentials, config, and health state.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Connector(IdMixin, TimestampMixin, Base):
    """A tenant integration connector instance. Tenant table (RLS-protected).

    id prefix: con_
    """

    __tablename__ = "connector"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    source: Mapped[str] = mapped_column(nullable=False)
    piece_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    slug: Mapped[str] = mapped_column(nullable=False)
    label: Mapped[str] = mapped_column(nullable=False)
    kind: Mapped[str] = mapped_column(nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    command: Mapped[str | None] = mapped_column(Text, nullable=True)
    args: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    secrets_enc: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    scopes: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    approval: Mapped[str] = mapped_column(nullable=False, server_default="ask")
    default_on: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    enabled: Mapped[bool] = mapped_column(nullable=False, server_default="true")
    status: Mapped[str] = mapped_column(nullable=False, server_default="needs_auth")
    poll_spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    health_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
