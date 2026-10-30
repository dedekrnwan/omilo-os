"""Cloud storage: what counts toward a company's plan, and the upload gate.

Counted (the plan's storage): docs, files & artifacts, knowledge.
Free (never counted): chats and run logs.

At the limit, new uploads pause (HTTP 413 with a plain message) until the
company upgrades — nothing is deleted or charged automatically. Local mode
(self-hosted) has no limit.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException
from sqlalchemy import text

log = logging.getLogger(__name__)

# (key, label, tables, counted toward the plan)
GROUPS: list[tuple[str, str, tuple[str, ...], bool]] = [
    ("docs", "Docs", ("memory_doc", "memory_doc_version", "handbook_suggestion", "lesson"), True),
    ("files", "Files & artifacts", ("folder_file", "skill", "data_export"), True),
    ("knowledge", "Knowledge", ("kb_source", "kb_chunk"), True),
    ("chats", "Chats & run logs (free)", ("session", "message", "inbox_item", "job", "run_event", "flow_run",
                                          "routine_run", "tool_call", "report", "audit_event"), False),
]
GB = 1024**3


def _table_bytes(session: Any, table: str, company_id: str) -> int:
    try:
        exists = session.execute(
            text("SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' "
                 "AND table_name = :t AND column_name = 'company_id'"), {"t": table}).scalar()
        if not exists:
            return 0
        with session.begin_nested():
            val = session.execute(
                text(f"SELECT COALESCE(SUM(pg_column_size(t.*)), 0) FROM {table} t WHERE t.company_id = :cid"),
                {"cid": company_id}).scalar()
        return int(val or 0)
    except Exception as exc:  # e.g. knowledge on a separate database
        log.debug("storage size for %s failed: %s", table, exc)
        return 0


def limit_bytes(session: Any, company: Any) -> int | None:
    """The plan's storage in bytes; None = unlimited (self-hosted / local mode)."""
    from omilo.billing.catalog import TRIAL_PLAN_ID, plan_features
    from omilo.control.factory import is_local_mode
    from omilo.models.billing import Plan

    if is_local_mode() or company is None:
        return None
    plan_id = company.plan_id or TRIAL_PLAN_ID
    plan = session.get(Plan, plan_id) if plan_id else None
    if plan is None:
        return None  # no plan sold here (no cloud plugin) → no limit
    gb = plan_features(plan).get("storage_gb")
    return None if gb is None else int(gb) * GB


def usage(session: Any, company: Any, counted_only: bool = False) -> dict:
    segments = []
    for key, label, tables, counted in GROUPS:
        if counted_only and not counted:
            continue
        segments.append({"key": key, "label": label, "counted": counted,
                         "bytes": sum(_table_bytes(session, t, company.id) for t in tables)})
    used = sum(s["bytes"] for s in segments if s["counted"])
    return {"used_bytes": used, "quota_bytes": limit_bytes(session, company), "segments": segments}


def fmt(n: int) -> str:
    if n >= GB:
        return f"{n / GB:.1f} GB".replace(".0 ", " ")
    return f"{max(1, round(n / 1024**2))} MB"


def ensure_room(session: Any, company_id: str, adding_bytes: int = 0) -> None:
    """Raise 413 when this upload would go past the plan's storage."""
    from omilo.models.tenancy import Company

    company = session.get(Company, company_id)
    limit = limit_bytes(session, company)
    if limit is None:
        return
    used = usage(session, company, counted_only=True)["used_bytes"]
    if used + max(0, adding_bytes) > limit:
        raise HTTPException(
            status_code=413,
            detail=(f"Your storage is full ({fmt(used)} of {fmt(limit)}). New uploads are paused — "
                    "upgrade your plan in Control panel → Usage & billing, or delete files you no longer need."),
        )


def check_upload(company_id: str, adding_bytes: int = 0) -> None:
    """``ensure_room`` on its own main-database session (works from any router,
    including the ones on the knowledge database)."""
    from omilo.db import SessionLocal

    with SessionLocal() as session:
        ensure_room(session, company_id, adding_bytes)
