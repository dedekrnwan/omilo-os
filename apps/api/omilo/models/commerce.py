"""Commerce models: DoitPayment, WalletSettings.

DoitPayment — per-tenant Doit payment gateway record (tenant/RLS).
WalletSettings — per-tenant auto-topup configuration, one row per company
                 (company_id IS the primary key).

Both tables have ENABLE+FORCE RLS with tenant_isolation policy (applied in
migration 0011_p5a_commerce).
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import TimestampMixin


class DoitPayment(TimestampMixin, Base):  # TimestampMixin adds created_at
    """Doit payment gateway record for a tenant. Tenant table (RLS-protected).

    id prefix: pay_
    Stores one row per payment attempt (topup or subscription billing event).
    ``granted`` is an idempotency guard — set to True after credits are awarded.
    ``provider_payment_id`` is unique per company (NULLs are treated as distinct
    by Postgres, so multiple NULL rows are allowed — only non-NULL values are
    constrained).
    """

    __tablename__ = "doit_payment"

    __table_args__ = (
        UniqueConstraint("company_id", "provider_payment_id", name="uq_doit_payment_company_ppid"),
    )

    id: Mapped[str] = mapped_column(primary_key=True)
    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(nullable=False, server_default="doit")
    provider_payment_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference: Mapped[str] = mapped_column(sa.String(128), nullable=False)
    kind: Mapped[str] = mapped_column(nullable=False)  # "topup" | "subscription"
    amount_idr: Mapped[int] = mapped_column(Integer, nullable=False)
    credits: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    rail: Mapped[str | None] = mapped_column(Text, nullable=True)
    hosted_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        nullable=False, server_default="pending"
    )  # pending|paid|expired|failed|refunded
    plan_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    raw: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


class WalletSettings(Base):
    """Per-tenant auto-topup wallet settings. Tenant table (RLS-protected).

    company_id IS the primary key — one row per company.
    ``updated_at`` is maintained by the application on every write.
    """

    __tablename__ = "wallet_settings"

    company_id: Mapped[str] = mapped_column(primary_key=True)
    auto_topup_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    auto_topup_threshold_credits: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    auto_topup_pack: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=sa.text("now()"),
        onupdate=sa.text("now()"),
        nullable=False,
    )
