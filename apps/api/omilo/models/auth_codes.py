"""AuthCode and Invite models — control-plane auth artifacts.

Both are **globally-queried, non-tenant tables** (like ``install_token``): the
requests arrive pre-auth (no company_id GUC), so lookups cross tenant
boundaries by ``email``/``token_hash`` on the privileged session.  Raw codes and
tokens are NEVER stored — only their sha256 hex digests.

``omilo_app`` gets SELECT + INSERT + UPDATE (codes are consumed, not deleted).
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin

# AuthCode.purpose values
PURPOSE_EMAIL_VERIFY = "email_verify"
PURPOSE_SIGNIN_CODE = "signin_code"
PURPOSE_PASSWORD_RESET = "password_reset"
PURPOSE_TWO_FACTOR = "two_factor"


class AuthCode(IdMixin, TimestampMixin, Base):
    """A one-time code or token emailed to a user.

    id prefix: ``acd_``.  ``code_hash`` is sha256(raw code|token).  A row is
    consumed (``consumed_at`` set) on first successful use; ``attempts`` guards
    against brute force.
    """

    __tablename__ = "auth_code"

    # The target email (always set — some flows have no user row yet).
    email: Mapped[str] = mapped_column(nullable=False, index=True)
    # The user this code belongs to (null only in rare pre-user flows).
    user_id: Mapped[str | None] = mapped_column(nullable=True, index=True)
    # One of the PURPOSE_* constants.
    purpose: Mapped[str] = mapped_column(nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempts: Mapped[int] = mapped_column(nullable=False, server_default="0")

    def is_usable(self, now: datetime) -> bool:
        """True when not consumed, not expired, and under the attempt cap."""
        return (
            self.consumed_at is None
            and self.expires_at > now
            and self.attempts < 6
        )


class Invite(IdMixin, TimestampMixin, Base):
    """A pending invitation for an email to join a company with a role.

    id prefix: ``inv_``.  ``token_hash`` is sha256(raw token) and UNIQUE.
    Accepting sets ``accepted_at``.
    """

    __tablename__ = "invite"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_invite_token_hash"),)

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    email: Mapped[str] = mapped_column(nullable=False, index=True)
    role: Mapped[str] = mapped_column(nullable=False, server_default="member")
    # Optional comma-separated channel names (UI-level grouping; advisory).
    channels: Mapped[str | None] = mapped_column(nullable=True)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    invited_by_user_id: Mapped[str | None] = mapped_column(nullable=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def is_open(self, now: datetime) -> bool:
        """True when not yet accepted and not expired."""
        return self.accepted_at is None and self.expires_at > now
