"""0020_company_onboarded_at — add onboarded_at to company for onboarding gate.

Adds:
  - company.onboarded_at (timestamptz, nullable) — set when the company
    completes the onboarding wizard (P13 onboarding gate).

Revision ID: 0020_company_onboarded_at
Revises: 0019_auth_codes_invites
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_company_onboarded_at"
down_revision: Union[str, Sequence[str], None] = "0019_auth_codes_invites"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company",
        sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("company", "onboarded_at")
