"""Skill model (§10 learned callable skills per Helper).

Tenant table (company_id + RLS).
"""
from __future__ import annotations

from sqlalchemy import Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class Skill(IdMixin, TimestampMixin, Base):
    """A learned / authored callable skill for a Helper. Tenant table.

    id prefix: skl_
    """

    __tablename__ = "skill"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    body_md: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(nullable=False, server_default="draft")  # draft|published
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    created_by: Mapped[str] = mapped_column(nullable=False)
