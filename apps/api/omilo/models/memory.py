"""MemoryDoc model (§10 persistent memory per helper / company).

Tenant table (company_id + RLS).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin


class MemoryDoc(IdMixin, Base):
    """A persistent memory document for a Helper or company. Tenant table.

    id prefix: mem_
    """

    __tablename__ = "memory_doc"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    path: Mapped[str] = mapped_column(Text, nullable=False)   # logical path / key
    content: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
