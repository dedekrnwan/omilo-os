"""Tenancy & identity models: Company, User, Member.

Global tables (no company_id, no RLS): Company, User.
Tenant table (company_id + RLS): Member.
"""
from __future__ import annotations

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Company(IdMixin, TimestampMixin, Base):
    """The tenant root — no company_id on itself, no RLS."""

    __tablename__ = "company"

    name: Mapped[str] = mapped_column(nullable=False)
    color: Mapped[str] = mapped_column(nullable=False)
    timezone: Mapped[str] = mapped_column(nullable=False, server_default="UTC")
    # autonomy_default: workspace-level autonomy dial — strict | ask | yolo
    autonomy_default: Mapped[str] = mapped_column(
        nullable=False, server_default="ask"
    )

    # P4 billing additive columns
    plan_id: Mapped[str | None] = mapped_column(nullable=True)
    credit_balance: Mapped[int] = mapped_column(
        nullable=False, server_default="0"
    )
    edition: Mapped[str] = mapped_column(nullable=False, server_default="cloud")
    overage_policy: Mapped[str] = mapped_column(
        nullable=False, server_default="soft"
    )

    # P5d profile columns — onboarding / company-settings enrichment
    industry: Mapped[str | None] = mapped_column(nullable=True)
    team_size: Mapped[str | None] = mapped_column(nullable=True)
    region: Mapped[str | None] = mapped_column(nullable=True)
    currency: Mapped[str] = mapped_column(nullable=False, server_default="IDR")
    pic_role: Mapped[str | None] = mapped_column(nullable=True)


class User(IdMixin, TimestampMixin, Base):
    """Human login — global, no company_id, no RLS."""

    __tablename__ = "user"

    email: Mapped[str] = mapped_column(nullable=False, unique=True)
    name: Mapped[str] = mapped_column(nullable=False)
    # nullable: SSO users may not have a password hash
    password_hash: Mapped[str | None] = mapped_column(nullable=True)


class Member(IdMixin, TimestampMixin, Base):
    """User ↔ Company binding with role. Tenant table (RLS-protected)."""

    __tablename__ = "member"
    __table_args__ = (UniqueConstraint("company_id", "user_id"),)

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(nullable=False, server_default="member")
