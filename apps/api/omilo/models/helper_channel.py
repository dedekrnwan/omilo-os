"""HelperChannel model — per-helper external channel binding. Tenant table (RLS).

A helper can be reached on Telegram / WhatsApp / Email in addition to the
built-in Omilo chat. The binding stores its non-secret config as JSON and any
secret (bot token, password) encrypted in ``secrets_enc``. ``status`` stays
``pending_setup`` until a delivery integration confirms the binding — there is
no live Telegram/WhatsApp/Email delivery yet, so nothing claims "connected".
"""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class HelperChannel(IdMixin, TimestampMixin, Base):
    """id prefix: hch_"""

    __tablename__ = "helper_channel"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    kind: Mapped[str] = mapped_column(nullable=False)  # telegram | whatsapp | email
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    secrets_enc: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    status: Mapped[str] = mapped_column(nullable=False, server_default="pending_setup")
