"""Billing models: Plan (global), CreditLedger, Subscription, Invoice (tenant).

Plan is a global catalog table — no company_id, no RLS.
CreditLedger, Subscription, Invoice are tenant tables (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import DateTime, Integer, Numeric, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Plan(IdMixin, Base):
    """Global billing plan catalog — no company_id, no RLS.

    id prefix: pln_
    """

    __tablename__ = "plan"

    tier: Mapped[str] = mapped_column(nullable=False)
    name: Mapped[str] = mapped_column(nullable=False)
    monthly_price_usd: Mapped[Decimal] = mapped_column(
        Numeric, nullable=False, server_default="0"
    )
    included_credits: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    credit_overage_usd: Mapped[Decimal] = mapped_column(
        Numeric, nullable=False, server_default="0"
    )
    seats: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    features: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )


class CreditLedger(IdMixin, Base):
    """Credit ledger entry for a tenant. Tenant table (RLS-protected).

    id prefix: cl_
    """

    __tablename__ = "credit_ledger"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    delta: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(nullable=False)
    job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    provider_cost_usd: Mapped[Decimal] = mapped_column(
        Numeric, nullable=False, server_default="0"
    )
    credits_charged: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    meta: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )


class Subscription(IdMixin, TimestampMixin, Base):
    """Tenant billing subscription — links company to a Plan.

    id prefix: sub_
    """

    __tablename__ = "subscription"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    plan_id: Mapped[str] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, server_default="active")
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    seats: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    provider: Mapped[str] = mapped_column(nullable=False, server_default="manual")
    external_ref: Mapped[str | None] = mapped_column(Text, nullable=True)


class Invoice(IdMixin, TimestampMixin, Base):
    """Billing invoice for a tenant. Tenant table (RLS-protected).

    id prefix: inv_
    """

    __tablename__ = "invoice"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric, nullable=False)
    currency: Mapped[str] = mapped_column(nullable=False, server_default="USD")
    status: Mapped[str] = mapped_column(nullable=False, server_default="offline")
    period: Mapped[str] = mapped_column(nullable=False)
    provider: Mapped[str] = mapped_column(nullable=False, server_default="manual")
    external_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_url: Mapped[str | None] = mapped_column(Text, nullable=True)
