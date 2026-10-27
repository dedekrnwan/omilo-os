"""HelperAccess model — per-helper connector/folder/skill grants. Tenant table (RLS).

Grants a Helper access to a specific connector (or folder/skill).
An installed Connector is not visible to any Helper until a HelperAccess row
with kind='connector' and ref_id=connector.id exists for that helper.

Spec: docs/technical/01-data-model.md §HelperAccess.
"""
from __future__ import annotations

from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from omilo.db import Base
from omilo.models.base import IdMixin, TimestampMixin


class HelperAccess(IdMixin, TimestampMixin, Base):
    """Per-helper resource grant. Tenant table (RLS-protected).

    id prefix: hac_

    kind: 'connector' | 'folder' | 'skill'
    ref_id: the id of the granted resource (connector.id, folder.id, skill.id)
    access: 'read' | 'write'
    default_on: if True, grant is auto-created when connector is installed
    """

    __tablename__ = "helper_access"

    company_id: Mapped[str] = mapped_column(nullable=False, index=True)
    helper_id: Mapped[str] = mapped_column(nullable=False, index=True)
    kind: Mapped[str] = mapped_column(nullable=False)       # connector | folder | skill
    ref_id: Mapped[str] = mapped_column(nullable=False)     # id of the granted resource
    access: Mapped[str] = mapped_column(nullable=False, server_default="read")  # read | write
    default_on: Mapped[bool] = mapped_column(nullable=False, server_default="false")
