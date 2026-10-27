"""Piece model — global integration catalog. No company_id, no RLS.

Piece is a global table: grants to omilo_app, but no RLS.
The id is a slug (TEXT PK), not a prefixed ULID.
"""
from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base


class Piece(Base):
    """Global integration/action piece catalog entry. No RLS.

    id is a slug (e.g. 'github', 'slack'), not a ULID.
    """

    __tablename__ = "piece"

    # slug TEXT primary key (not prefixed ULID)
    id: Mapped[str] = mapped_column(Text, primary_key=True)

    label: Mapped[str] = mapped_column(nullable=False)
    category: Mapped[str] = mapped_column(nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(nullable=False, server_default="piece")
    runtime: Mapped[str] = mapped_column(nullable=False, server_default="http")
    auth_descriptor: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default="{}"
    )
    actions: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    mcp: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    triggers: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    catalog_commit: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(nullable=False, server_default="ok")
    errors: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
