"""0021_company_settings — add free-form settings JSONB to company.

Adds:
  - company.settings (jsonb, not null, server_default '{}') — tenant-scoped
    control-panel settings (safety / notifications / ai_engine / knowledge /
    about / language / hours). Deep-merged on PATCH /v1/company/settings.

Revision ID: 0021_company_settings
Revises: 0020_company_onboarded_at
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0021_company_settings"
down_revision: Union[str, Sequence[str], None] = "0020_company_onboarded_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "company",
        sa.Column(
            "settings",
            JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("company", "settings")
