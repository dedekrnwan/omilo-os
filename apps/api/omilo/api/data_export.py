"""Data & storage API (sweep/control).

  GET  /v1/data/storage                 → {used_bytes, quota_bytes, segments[]}
  GET  /v1/data/exports                 → DataExport[] (newest first, no content)
  POST /v1/data/exports                 → build a JSON zip export now (owner/admin)
  GET  /v1/data/exports/{id}/download   → application/zip

Storage is measured from the company's own rows (``pg_column_size`` of each
tenant row), grouped into the categories the page shows.  The export is a zip
with one ``<table>.json`` per tenant table plus a manifest; secrets (keys,
token hashes, encrypted credentials) are never exported.  Exports are built
synchronously (company datasets are small) and kept for 7 days.
"""
from __future__ import annotations

import io
import json
import logging
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import text

from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.control import DataExport
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, require_role

router = APIRouter(tags=["data"])
logger = logging.getLogger(__name__)

EXPORT_TTL = timedelta(days=7)

# Storage categories → tenant tables.
STORAGE_GROUPS: list[tuple[str, str, tuple[str, ...]]] = [
    ("chats", "Chats", ("session", "message", "inbox_item")),
    ("docs", "Docs", ("memory_doc", "skill")),
    ("run_logs", "Run logs", ("job", "run_event", "flow_run", "routine_run", "tool_call", "report", "audit_event")),
    ("knowledge", "Knowledge", ("kb_source", "kb_chunk")),
    ("exports", "Exports", ("data_export",)),
]

# Columns never exported.
_SECRET_COLUMNS: dict[str, tuple[str, ...]] = {
    "connector": ("secrets_enc",),
    "harness_account": ("token_enc",),
    "provider_key": ("key_enc",),
    "mcp_access_token": ("token_hash",),
    "mcp_server": ("token_enc",),
    "invite": ("token_hash",),
    "install_token": ("token_hash",),
    "helper": ("mcp_token_hash",),
    "data_export": ("content",),
}

# Tables included in an export (the company's own data).
_EXPORT_TABLES: tuple[str, ...] = (
    "channel", "folder", "goal", "session", "message", "inbox_item", "helper",
    "helper_access", "routine", "routine_run", "flow", "flow_run", "job", "report",
    "run_event", "proposal", "proposal_revision", "memory_doc", "skill", "kb_source",
    "connector", "harness_account", "mcp_access_token", "mcp_server", "safety_limit",
    "subscription", "invoice", "credit_ledger", "doit_payment", "wallet_settings",
    "invite", "member", "audit_event", "improvement", "tool_call",
)


def _table_exists(session: Any, table: str) -> bool:
    """True when ``table`` exists and carries a company_id column."""
    return bool(
        session.execute(
            text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t AND column_name = 'company_id'"
            ),
            {"t": table},
        ).scalar()
    )


def _table_bytes(session: Any, table: str, company_id: str) -> int:
    if not _table_exists(session, table):
        return 0
    try:
        val = session.execute(
            text(f"SELECT COALESCE(SUM(pg_column_size(t.*)), 0) FROM {table} t WHERE t.company_id = :cid"),
            {"cid": company_id},
        ).scalar()
        return int(val or 0)
    except Exception as exc:  # pragma: no cover — e.g. KB on a separate DB
        logger.debug("storage size for %s failed: %s", table, exc)
        session.rollback()
        return 0


def _quota_bytes(session: Any, company: Company) -> int | None:
    from omilo.billing.catalog import plan_features
    from omilo.models.billing import Plan

    plan = session.get(Plan, company.plan_id) if company.plan_id else None
    gb = plan_features(plan).get("storage_gb") if plan else None
    if gb is None:
        from omilo.control.factory import is_local_mode

        return None if is_local_mode() else 10 * 1024**3
    return int(gb) * 1024**3


@router.get("/data/storage")
def get_storage(ctx: RequestContext = Depends(get_context)) -> dict[str, Any]:
    """Storage used vs the plan: docs, files & artifacts and knowledge count;
    chats and run logs are free (segment ``counted: false``)."""
    from omilo.billing.storage import usage

    with SessionLocal() as session:
        company = session.get(Company, ctx.company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        return usage(session, company)


def _export_dict(e: DataExport) -> dict[str, Any]:
    return {
        "id": e.id,
        "status": e.status,
        "filename": e.filename,
        "size_bytes": e.size_bytes,
        "summary": e.summary or {},
        "error": e.error,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "expires_at": e.expires_at.isoformat() if e.expires_at else None,
    }


@router.get("/data/exports")
def list_exports(ctx: RequestContext = Depends(get_context)) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        rows = (
            session.query(DataExport)
            .filter(DataExport.company_id == ctx.company_id)
            .order_by(DataExport.created_at.desc())
            .limit(20)
            .all()
        )
        return [_export_dict(r) for r in rows if r.expires_at is None or r.expires_at > now]


def build_export_zip(session: Any, company_id: str) -> tuple[bytes, dict[str, int]]:
    """Return (zip bytes, {table: row_count}) for a company."""
    buf = io.BytesIO()
    summary: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        company = session.execute(
            text("SELECT row_to_json(c) FROM company c WHERE c.id = :cid"), {"cid": company_id}
        ).scalar()
        zf.writestr("company.json", json.dumps(company, indent=2, default=str))
        for table in _EXPORT_TABLES:
            if not _table_exists(session, table):
                continue
            rows = session.execute(
                text(f"SELECT row_to_json(t) FROM {table} t WHERE t.company_id = :cid"),
                {"cid": company_id},
            ).scalars().all()
            hidden = _SECRET_COLUMNS.get(table, ())
            clean = [{k: v for k, v in (r or {}).items() if k not in hidden} for r in rows]
            summary[table] = len(clean)
            zf.writestr(f"{table}.json", json.dumps(clean, indent=2, default=str))
        zf.writestr(
            "manifest.json",
            json.dumps(
                {
                    "company_id": company_id,
                    "exported_at": datetime.now(timezone.utc).isoformat(),
                    "tables": summary,
                    "format": "omilo-export/1",
                },
                indent=2,
            ),
        )
    return buf.getvalue(), summary


@router.post("/data/exports", status_code=201)
def create_export(
    _guard: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    export = DataExport(
        id=prefixed_id("exp"),
        company_id=ctx.company_id,
        requested_by=ctx.user_id,
        status="pending",
        filename=f"omilo-export-{now.strftime('%Y%m%d-%H%M')}.zip",
        expires_at=now + EXPORT_TTL,
    )
    with SessionLocal() as session:
        with session.begin():
            session.add(export)
        try:
            content, summary = build_export_zip(session, ctx.company_id)
            session.rollback()  # end the read transaction
            with session.begin():
                row = session.get(DataExport, export.id)
                row.content = content
                row.size_bytes = len(content)
                row.summary = summary
                row.status = "ready"
                out = _export_dict(row)
        except Exception as exc:
            logger.exception("data export failed for %s", ctx.company_id)
            session.rollback()
            with session.begin():
                row = session.get(DataExport, export.id)
                row.status = "failed"
                row.error = str(exc)[:500]
                out = _export_dict(row)
    from omilo import audit

    audit.record_ctx(ctx, type="data", action="exported", target="all company data")
    return out


@router.get("/data/exports/{export_id}/download")
def download_export(export_id: str, ctx: RequestContext = Depends(get_context)) -> Response:
    with SessionLocal() as session:
        row = session.get(DataExport, export_id)
        if row is None or row.company_id != ctx.company_id:
            raise HTTPException(status_code=404, detail="Export not found.")
        exp = row.expires_at
        if exp is not None and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if row.status != "ready" or row.content is None or (exp and exp < datetime.now(timezone.utc)):
            raise HTTPException(status_code=410, detail="This export is no longer available.")
        return Response(
            content=bytes(row.content),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{row.filename}"'},
        )
