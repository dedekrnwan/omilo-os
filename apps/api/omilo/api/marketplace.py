"""Marketplace API endpoints.

Endpoints:
  GET  /v1/marketplace?category=&q=     → PieceCard[] (indexed catalog; global)
  POST /v1/marketplace/refresh           → {indexed, ok, invalid, errors[]}  (admin/owner only)
  POST /v1/connectors/install {piece_id} → Connector (status=needs_auth; per-company)

The catalog (Piece table) is GLOBAL — all companies see the same pieces.
Installing a piece is COMPANY-SCOPED — creates a Connector row via the
tenant-scoped session (RLS enforced).

Admin guard on /refresh: require_role("owner", "admin").
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from omilo.db import SessionLocal
from omilo.marketplace.index import index_pieces
from omilo.models.base import prefixed_id
from omilo.models.connectors import Connector
from omilo.models.pieces import Piece
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db, require_role

router = APIRouter(tags=["marketplace"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class InstallBody(BaseModel):
    piece_id: str


# ---------------------------------------------------------------------------
# Serialisers
# ---------------------------------------------------------------------------


def _piece_to_card(piece: Piece) -> dict[str, Any]:
    """Serialize a Piece row to PieceCard shape."""
    actions = piece.actions or []
    return {
        "id": piece.id,
        "label": piece.label,
        "category": piece.category,
        "description": piece.description,
        "auth_type": (piece.auth_descriptor or {}).get("type"),
        "action_count": len(actions),
        "logo": piece.logo,
        "status": piece.status,
    }


def _connector_to_dict(connector: Connector) -> dict[str, Any]:
    return {
        "id": connector.id,
        "company_id": connector.company_id,
        "source": connector.source,
        "piece_id": connector.piece_id,
        "slug": connector.slug,
        "label": connector.label,
        "kind": connector.kind,
        "status": connector.status,
        "enabled": connector.enabled,
        "approval": connector.approval,
        "created_at": connector.created_at.isoformat() if connector.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /v1/marketplace
# ---------------------------------------------------------------------------


@router.get("/marketplace")
def list_marketplace(
    category: str | None = None,
    q: str | None = None,
    include_invalid: bool = False,
    db: Session = Depends(get_tenant_db),
) -> list[dict]:
    """Return PieceCard[] from the indexed Piece catalog.

    The Piece table is GLOBAL so the tenant-scoped session still reads it
    (omilo_app has SELECT on the global piece table; FORCE RLS only applies to
    tenant tables).  We don't filter by company_id — the catalog is shared.

    Filters:
      category: exact match (case-insensitive)
      q: substring match over label OR description (case-insensitive)
      include_invalid: if true, include status="invalid" rows (default false)
    """
    stmt = select(Piece)
    if not include_invalid:
        stmt = stmt.where(Piece.status == "ok")
    if category:
        stmt = stmt.where(Piece.category.ilike(category))
    if q:
        stmt = stmt.where(
            Piece.label.ilike(f"%{q}%") | Piece.description.ilike(f"%{q}%")
        )
    pieces = db.execute(stmt).scalars().all()
    return [_piece_to_card(p) for p in pieces]


# ---------------------------------------------------------------------------
# POST /v1/marketplace/refresh  (admin/owner only)
# ---------------------------------------------------------------------------


@router.post("/marketplace/refresh")
def refresh_marketplace(
    _: None = Depends(require_role("owner", "admin")),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Re-index all piece.yaml manifests from PIECES_SOURCE.

    Uses the privileged superuser session (SessionLocal) because Piece is a
    GLOBAL table (no RLS).  Admin/owner role required.
    """
    with SessionLocal() as priv_db:
        with priv_db.begin():
            summary = index_pieces(priv_db)
    return summary


# ---------------------------------------------------------------------------
# POST /v1/connectors/install
# ---------------------------------------------------------------------------


@router.post("/connectors/install", status_code=status.HTTP_201_CREATED)
def install_connector(
    body: InstallBody,
    response: Response,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict:
    """Install a marketplace piece as a per-company Connector.

    Creates a Connector row with source="marketplace", piece_id from the body,
    status="needs_auth".

    Idempotent: if a Connector already exists for this company + piece_id
    (source="marketplace"), return it without creating a duplicate.

    Raises 404 if the piece does not exist or is not status="ok".
    """
    # Look up the Piece (global table — readable via tenant session)
    piece = db.get(Piece, body.piece_id)
    if piece is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Piece {body.piece_id!r} not found in catalog.",
        )
    if piece.status != "ok":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Piece {body.piece_id!r} is not installable (status={piece.status!r}).",
        )

    # Idempotency: check for existing connector for this company + piece
    existing = db.execute(
        select(Connector).where(
            Connector.company_id == ctx.company_id,
            Connector.piece_id == body.piece_id,
            Connector.source == "marketplace",
        )
    ).scalars().first()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return _connector_to_dict(existing)

    # Create the new connector
    connector = Connector(
        id=prefixed_id("con"),
        company_id=ctx.company_id,
        source="marketplace",
        piece_id=piece.id,
        slug=piece.id,
        label=piece.label,
        kind=piece.type,
        status="needs_auth",
        enabled=True,
        approval="ask",
        args={},
        secrets_enc={},
        scopes=[],
    )
    db.add(connector)
    db.flush()
    return _connector_to_dict(connector)
