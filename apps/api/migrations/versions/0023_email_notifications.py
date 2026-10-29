"""0023_email_notifications — email delivery log + waitlist.

Adds two global (non-tenant) tables used by ``omilo.notify``:

  - email_log: one row per notification email, keyed by a unique
    ``dedupe_key`` (e.g. ``digest:cmp_x:2026-W44``) so each mail is sent at most
    once even with several API workers.  status: sending|sent|failed|skipped.
  - waitlist_entry: people who joined the waitlist from the landing page.

Both are written by system code (superuser session), never by tenant
requests, so they carry no RLS policy.

Revision ID: 0023_email_notifications
Revises: 0022_flow_settings
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_email_notifications"
down_revision: Union[str, Sequence[str], None] = "0022_flow_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_log",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("company_id", sa.Text(), nullable=True, index=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("dedupe_key", sa.Text(), nullable=False, unique=True),
        sa.Column("to_email", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="sending"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "waitlist_entry",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("email", sa.Text(), nullable=False, unique=True),
        sa.Column("name", sa.Text(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.Text(), nullable=True),
        sa.Column("unsubscribed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("waitlist_entry")
    op.drop_table("email_log")
