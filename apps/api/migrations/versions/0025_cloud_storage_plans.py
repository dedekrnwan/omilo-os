"""0025_cloud_storage_plans — plans come from the catalog at start-up.

Cloud plan rows (prices, storage limits) are owned by the private cloud plugin
and synced into ``plan`` by ``omilo.billing.catalog.seed_plans()`` when the API
starts, so this revision changes no data. It is kept so the revision chain
stays intact for databases that already applied it.

Revision ID: 0025_cloud_storage_plans
Revises: 0024_control_plans
"""
from __future__ import annotations

from typing import Sequence, Union

revision: str = "0025_cloud_storage_plans"
down_revision: Union[str, Sequence[str], None] = "0024_control_plans"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
