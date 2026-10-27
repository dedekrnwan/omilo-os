"""Marketplace indexer — parse omilo-pieces manifests and upsert Piece rows.

Usage::

    from omilo.db import SessionLocal
    from omilo.marketplace.index import index_pieces

    with SessionLocal() as db:
        with db.begin():
            summary = index_pieces(db)

``index_pieces`` uses the privileged superuser session (no RLS) because Piece
is a GLOBAL table (no company_id, no tenant isolation policy).  Pass a
SessionLocal session — NOT a tenant-scoped one.

The function is idempotent: re-running updates existing rows in place.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from omilo.config import get_settings
from omilo.models.pieces import Piece

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

_VALID_TYPES = {"piece", "mcp"}
_VALID_RUNTIMES = {"http", "engine"}
_VALID_APPROVALS = {"auto", "ask"}


def _validate_manifest(data: dict) -> list[str]:
    """Return a list of error strings; empty list means valid."""
    errors: list[str] = []

    piece_type = data.get("type", "piece")

    # Required top-level fields for ALL piece types
    for field in ("id", "label", "category", "description"):
        if not data.get(field):
            errors.append(f"missing required field: {field!r}")

    if piece_type not in _VALID_TYPES:
        errors.append(f"type must be one of {sorted(_VALID_TYPES)}, got {piece_type!r}")

    runtime = data.get("runtime", "http")
    if runtime not in _VALID_RUNTIMES:
        errors.append(
            f"runtime must be one of {sorted(_VALID_RUNTIMES)}, got {runtime!r}"
        )

    # Must have at least actions[] or mcp block
    has_actions = bool(data.get("actions"))
    has_mcp = bool(data.get("mcp"))
    if not has_actions and not has_mcp:
        errors.append("piece must declare at least one action or an mcp block")

    # Type-specific validation
    if piece_type == "piece":
        auth = data.get("auth") or {}
        if not isinstance(auth, dict):
            errors.append("auth must be a mapping")
        else:
            if not auth.get("type"):
                errors.append("auth.type is required")
            # For oauth2 pieces, provider and scopes must be present
            if auth.get("type") == "oauth2":
                if not auth.get("provider"):
                    errors.append("auth.provider is required for oauth2")
                if not auth.get("scopes"):
                    errors.append("auth.scopes is required for oauth2")

    elif piece_type == "mcp":
        mcp = data.get("mcp") or {}
        if not isinstance(mcp, dict):
            errors.append("mcp block must be a mapping")
        else:
            url = mcp.get("url", "")
            if not url or not str(url).startswith("https://"):
                errors.append("mcp.url must be an absolute https:// URL")

    # Validate triggers if present
    triggers = data.get("triggers")
    if triggers is not None:
        if not isinstance(triggers, list):
            errors.append("triggers must be a list")
        else:
            for i, trigger in enumerate(triggers):
                if not isinstance(trigger, dict):
                    errors.append(f"triggers[{i}] must be a mapping")
                    continue
                if not trigger.get("name"):
                    errors.append(f"triggers[{i}].name is required")
                if not trigger.get("event"):
                    errors.append(f"triggers[{i}].event is required")

    return errors


# ---------------------------------------------------------------------------
# Indexer
# ---------------------------------------------------------------------------


def index_pieces(
    db: Session,
    source_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Parse all piece.yaml manifests under source_dir and upsert Piece rows.

    Args:
        db: An open SQLAlchemy session with an active transaction.
            Must be the privileged superuser session (SessionLocal),
            NOT a tenant-scoped session — Piece is a GLOBAL table.
        source_dir: Path to the directory containing ``<slug>/piece.yaml``
            manifests.  Defaults to settings.pieces_source.

    Returns:
        A summary dict::

            {
                "indexed": int,   # total manifests attempted
                "ok": int,        # rows with status "ok"
                "invalid": int,   # rows with status "invalid"
                "errors": [...],  # list of {id, reasons} for invalid entries
            }
    """
    settings = get_settings()
    source = Path(source_dir) if source_dir is not None else Path(settings.pieces_source)
    source = source.resolve()

    logger.info("index_pieces: scanning %s", source)

    summary: dict[str, Any] = {
        "indexed": 0,
        "ok": 0,
        "invalid": 0,
        "errors": [],
    }

    manifest_paths = sorted(source.glob("*/piece.yaml"))

    for manifest_path in manifest_paths:
        slug_dir = manifest_path.parent.name
        summary["indexed"] += 1

        # --- Parse YAML ---
        try:
            raw = manifest_path.read_text(encoding="utf-8")
            data = yaml.safe_load(raw)
            if not isinstance(data, dict):
                raise ValueError("manifest is not a YAML mapping")
        except Exception as exc:
            # Unparseable YAML — use the directory name as the slug
            _upsert_piece(
                db,
                piece_id=slug_dir,
                row={
                    "label": slug_dir,
                    "category": "",
                    "description": "",
                    "type": "piece",
                    "runtime": "http",
                    "auth_descriptor": {},
                    "actions": [],
                    "mcp": None,
                    "triggers": [],
                    "logo": None,
                    "status": "invalid",
                    "errors": [f"YAML parse error: {exc}"],
                },
            )
            summary["invalid"] += 1
            summary["errors"].append({"id": slug_dir, "reasons": [f"YAML parse error: {exc}"]})
            continue

        # --- Determine slug ---
        piece_id = data.get("id") or slug_dir

        # --- Validate ---
        validation_errors = _validate_manifest(data)

        if validation_errors:
            _upsert_piece(
                db,
                piece_id=piece_id,
                row={
                    "label": data.get("label") or piece_id,
                    "category": data.get("category") or "",
                    "description": data.get("description") or "",
                    "type": data.get("type", "piece"),
                    "runtime": data.get("runtime", "http"),
                    "auth_descriptor": _map_auth(data),
                    "actions": data.get("actions") or [],
                    "mcp": data.get("mcp"),
                    "triggers": data.get("triggers") or [],
                    "logo": data.get("logo"),
                    "status": "invalid",
                    "errors": validation_errors,
                },
            )
            summary["invalid"] += 1
            summary["errors"].append({"id": piece_id, "reasons": validation_errors})
        else:
            _upsert_piece(
                db,
                piece_id=piece_id,
                row={
                    "label": data["label"],
                    "category": data["category"],
                    "description": data["description"],
                    "type": data.get("type", "piece"),
                    "runtime": data.get("runtime", "http"),
                    "auth_descriptor": _map_auth(data),
                    "actions": data.get("actions") or [],
                    "mcp": data.get("mcp"),
                    "triggers": data.get("triggers") or [],
                    "logo": data.get("logo"),
                    "status": "ok",
                    "errors": [],
                },
            )
            summary["ok"] += 1

    logger.info(
        "index_pieces: indexed=%d ok=%d invalid=%d",
        summary["indexed"],
        summary["ok"],
        summary["invalid"],
    )
    return summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _map_auth(data: dict) -> dict:
    """Extract the auth block from a manifest dict into auth_descriptor."""
    auth = data.get("auth")
    if auth and isinstance(auth, dict):
        return dict(auth)
    return {}


def _upsert_piece(db: Session, piece_id: str, row: dict) -> None:
    """Insert or update a Piece row. Idempotent."""
    existing = db.get(Piece, piece_id)
    if existing is None:
        piece = Piece(id=piece_id, **row)
        db.add(piece)
    else:
        for k, v in row.items():
            setattr(existing, k, v)
        db.flush()
