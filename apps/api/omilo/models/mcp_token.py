"""McpAccessToken model (§P5b Role-3 MCP).

Scoped bearer token that allows external clients (e.g. Claude Desktop) to
drive omilo agents via MCP. Tenant table (company_id + RLS).

token_hash stores the sha256 hex digest of the raw secret — the raw token
is NEVER stored here.
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import DateTime, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class McpAccessToken(IdMixin, TimestampMixin, Base):
    """Scoped bearer token for Role-3 external MCP clients. Tenant table.

    id prefix: mct_
    ``token_hash`` is the sha256 hex digest of the raw secret (NEVER store raw).
    ``scopes`` is a JSON list of permission strings (e.g. ["goals","docs"]).
    ``is_active(now)`` returns True if not revoked and not expired.
    """

    __tablename__ = "mcp_access_token"

    __table_args__ = (
        UniqueConstraint("token_hash", name="uq_mcp_access_token_hash"),
    )

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    label: Mapped[str] = mapped_column(nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    scopes: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default="[]"
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=sa.text("now()"),
        nullable=False,
    )

    def is_active(self, now: datetime) -> bool:
        """Return True if this token is valid at ``now``.

        A token is active when:
        - it has not been revoked (revoked_at is None), AND
        - it has no expiry OR its expiry is strictly in the future.
        """
        return self.revoked_at is None and (
            self.expires_at is None or self.expires_at > now
        )
