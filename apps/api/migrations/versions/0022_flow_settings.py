"""0022_flow_settings — add free-form settings JSONB to flow.

Adds:
  - flow.settings (jsonb, not null, server_default '{}') — flow-editor Settings
    page fields (budget / approvals / quiet-hours / notifications). Deep-merged
    on PATCH /v1/flows/{id}, mirroring company.settings.

Revision ID: 0022_flow_settings
Revises: 0021_company_settings
Create Date: 2026-10-29
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0022_flow_settings"
down_revision: Union[str, Sequence[str], None] = "0021_company_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "flow",
        sa.Column(
            "settings",
            JSONB(),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("flow", "settings")
