"""Control-panel models (sweep/control).

Tenant tables (company_id + RLS):
  - AuditEvent   — append-only activity log ("who did what") for the
                   control-panel Activity section + CSV export.
  - DataExport   — a generated JSON zip export of a company's data.
  - McpServer    — an external MCP server (remote URL or built from an
                   OpenAPI spec) registered for the company's helpers.

Global table (no RLS — queried by user/session id on the privileged plane):
  - UserSession  — one row per issued sign-in token (``sid`` JWT claim), so
                   people can see their devices and sign one out.
"""
from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Boolean, DateTime, Integer, LargeBinary, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class AuditEvent(IdMixin, Base):
    """Activity-log entry. Tenant table. id prefix: aud_"""

    __tablename__ = "audit_event"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sa.text("now()"), nullable=False, index=True
    )
    # person | agent | system
    actor_type: Mapped[str] = mapped_column(nullable=False, server_default="person")
    actor_id: Mapped[str | None] = mapped_column(nullable=True)
    actor_name: Mapped[str] = mapped_column(nullable=False, server_default="")
    # Helper area for agent actors (drives the mascot in the UI).
    actor_area: Mapped[str | None] = mapped_column(nullable=True)
    # members | billing | settings | helpers | connectors | approvals |
    # channels | skills | data | account
    type: Mapped[str] = mapped_column(nullable=False, index=True)
    action: Mapped[str] = mapped_column(nullable=False)  # verb, e.g. "invited"
    target: Mapped[str] = mapped_column(nullable=False, server_default="")
    channel: Mapped[str | None] = mapped_column(nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")


class DataExport(IdMixin, TimestampMixin, Base):
    """A company data export (zip of JSON files). Tenant table. id prefix: exp_"""

    __tablename__ = "data_export"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    requested_by: Mapped[str | None] = mapped_column(nullable=True)
    # pending | ready | failed
    status: Mapped[str] = mapped_column(nullable=False, server_default="pending")
    filename: Mapped[str] = mapped_column(nullable=False, server_default="")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    # Table name → row count, for the export summary line.
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class McpServer(IdMixin, TimestampMixin, Base):
    """External MCP server registered for a company. Tenant table. id prefix: mcs_"""

    __tablename__ = "mcp_server"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(nullable=False)
    # remote | openapi
    kind: Mapped[str] = mapped_column(nullable=False, server_default="remote")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # none | bearer | header
    auth_type: Mapped[str] = mapped_column(nullable=False, server_default="none")
    token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_hint: Mapped[str | None] = mapped_column(nullable=True)
    # connected | error | pending
    status: Mapped[str] = mapped_column(nullable=False, server_default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # [{name, description, level}] — level: read | ask | blocked
    tools: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    # Original OpenAPI document for kind=openapi.
    spec: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")


class UserSession(IdMixin, TimestampMixin, Base):
    """A signed-in device/session (one per issued access token). Global table.

    id == the ``sid`` claim of the access token. id prefix: usn_
    """

    __tablename__ = "user_session"

    user_id: Mapped[str] = mapped_column(nullable=False, index=True)
    company_id: Mapped[str | None] = mapped_column(nullable=True)
    # password | google | code | invite | switch | signup
    method: Mapped[str | None] = mapped_column(nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip: Mapped[str | None] = mapped_column(nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
