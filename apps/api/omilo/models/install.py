"""InstallToken model — company-scoped revocable install credential.

Storage decision
----------------
InstallToken is a **cloud-authoritative, globally-queried table** (not a
tenant RLS table).  The /control/* endpoints authenticate by install token:
the incoming request carries ONLY the raw token (no company_id claim), so the
lookup must cross tenant boundaries (hash → row → company_id).  This mirrors
the MCP external-auth pattern where the privileged session looks up the token
by hash and resolves company from it.

Table design:
  - omilo_app has SELECT + UPDATE (for last_seen_at).
  - No tenant_isolation RLS policy (the table is queried by token_hash, not
    by app.company_id GUC; lookups always use the privileged session).
  - company_id is indexed for analytics / per-company listing queries.
  - token_hash is UNIQUE — ensures one DB row per raw token.
  - Raw token is NEVER stored here.
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class InstallToken(IdMixin, TimestampMixin, Base):
    """Company-scoped install token for /control/* federation.

    id prefix: itk_
    ``token_hash`` is the sha256 hex digest of the raw token (NEVER store raw).
    ``is_active(now)`` returns True when not revoked.
    """

    __tablename__ = "install_token"

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_install_token_hash"),
    )

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    label: Mapped[str] = mapped_column(nullable=False, server_default="default")
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def is_active(self, now: datetime) -> bool:
        """Return True if this install token has not been revoked."""
        return self.revoked_at is None
