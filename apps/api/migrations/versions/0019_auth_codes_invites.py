"""0019_auth_codes_invites — control-plane auth: codes, invites, user flags.

Adds:
  - user.email_verified_at  (timestamptz, nullable)
  - user.two_factor_enabled (bool, NOT NULL, default false)
  - auth_code  — one-time codes/tokens (email verify, magic sign-in, password
                 reset, two-factor).  Global/non-tenant (queried by email pre-auth).
  - invite     — pending company invitations (token-addressed).

auth_code / invite are globally-queried tables (like install_token): requests
arrive pre-auth with no app.company_id GUC, so lookups cross tenant boundaries
on the privileged session.  omilo_app gets SELECT/INSERT/UPDATE/DELETE.

user is the global identity table (no RLS) — plain add_column.

Revision ID: 0019_auth_codes_invites
Revises: 0018_p12_billing_yearly_interval
Create Date: 2026-10-28
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_auth_codes_invites"
down_revision: Union[str, Sequence[str], None] = "0018_p12_billing_yearly_interval"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── user flags ────────────────────────────────────────────────────────────
    op.add_column(
        "user",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "user",
        sa.Column(
            "two_factor_enabled",
            sa.Boolean(),
            nullable=False,
            server_default="false",
        ),
    )

    # ── auth_code ─────────────────────────────────────────────────────────────
    op.create_table(
        "auth_code",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_auth_code_email"), "auth_code", ["email"], unique=False)
    op.create_index(op.f("ix_auth_code_user_id"), "auth_code", ["user_id"], unique=False)
    op.create_index(op.f("ix_auth_code_purpose"), "auth_code", ["purpose"], unique=False)
    op.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON auth_code TO omilo_app")
    )

    # ── invite ────────────────────────────────────────────────────────────────
    op.create_table(
        "invite",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("company_id", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="member"),
        sa.Column("channels", sa.String(), nullable=True),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("invited_by_user_id", sa.String(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_invite_token_hash"),
    )
    op.create_index(op.f("ix_invite_company_id"), "invite", ["company_id"], unique=False)
    op.create_index(op.f("ix_invite_email"), "invite", ["email"], unique=False)
    op.execute(
        sa.text("GRANT SELECT, INSERT, UPDATE, DELETE ON invite TO omilo_app")
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_invite_email"), table_name="invite")
    op.drop_index(op.f("ix_invite_company_id"), table_name="invite")
    op.drop_table("invite")

    op.drop_index(op.f("ix_auth_code_purpose"), table_name="auth_code")
    op.drop_index(op.f("ix_auth_code_user_id"), table_name="auth_code")
    op.drop_index(op.f("ix_auth_code_email"), table_name="auth_code")
    op.drop_table("auth_code")

    op.drop_column("user", "two_factor_enabled")
    op.drop_column("user", "email_verified_at")
