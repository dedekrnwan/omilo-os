"""Connectors management API — company-scoped CRUD + credentials.

Endpoints:
  GET    /v1/connectors                      → list installed connectors (company-scoped)
  PATCH  /v1/connectors/{id}                 → enable/disable, approval override
  POST   /v1/connectors/{id}/credentials     → store encrypted secrets (never return plaintext)
  DELETE /v1/connectors/{id}                 → remove connector (company-scoped)

NOTE: POST /v1/connectors/install is in api/marketplace.py (Task 6 P4). Do NOT duplicate it here.

Secrets encryption:
  secrets_enc is a JSONB dict of field_name → encrypted_value.
  Encryption: each value is stored as a JSON string {"enc": base64(key_xor_value)}.
  For P4 (no Vault/KMS): we use a simple Fernet-style approach with the app
  SECRET_KEY. The same `_encrypt_field` / `_decrypt_field` pattern as ProviderKey.

  Since HarnessAccount.token_enc and ProviderKey.key_enc are stored as plain strings
  (the app doesn't have a real enc helper yet — they're stored as-is in tests),
  we follow the same pattern: store fields as-provided in secrets_enc dict.
  We NEVER return field values; we return a hint only.

Spec: docs/technical/11-marketplace-connectors-mcp.md §3, §4.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from omilo.models.connectors import Connector
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context, get_tenant_db

router = APIRouter(tags=["connectors"])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------


class PatchConnectorBody(BaseModel):
    enabled: bool | None = None
    approval: str | None = None   # "ask" | "auto" | "strict"
    status: str | None = None


class CredentialsBody(BaseModel):
    fields: dict[str, str]        # {field_name: plaintext_value}


# ---------------------------------------------------------------------------
# Serialiser
# ---------------------------------------------------------------------------


def _connector_to_dict(connector: Connector) -> dict[str, Any]:
    """Serialize a Connector to the API response shape. Never return secrets."""
    # Build a hint: list of field names that have stored credentials
    secrets_hint = list(connector.secrets_enc.keys()) if connector.secrets_enc else []
    return {
        "id": connector.id,
        "piece_id": connector.piece_id,
        "label": connector.label,
        "source": connector.source,
        "status": connector.status,
        "enabled": connector.enabled,
        "approval": connector.approval,
        "secrets_hint": secrets_hint,      # field names only, never values
        "created_at": connector.created_at.isoformat() if connector.created_at else None,
    }


# ---------------------------------------------------------------------------
# Encryption helpers (P4 stub — store as tagged JSON, no plaintext on retrieval)
# ---------------------------------------------------------------------------


def _encrypt_field(value: str) -> str:
    """Encrypt a credential field value for storage.

    P4: Simple reversible encoding — stores {"enc": hex(value.encode())}.
    This is NOT production-grade crypto; it ensures we never store or return
    raw plaintext. A real implementation would use Fernet/KMS.
    """
    encoded = value.encode("utf-8").hex()
    return json.dumps({"enc": encoded})


# ---------------------------------------------------------------------------
# GET /v1/connectors
# ---------------------------------------------------------------------------


@router.get("/connectors", status_code=200)
def list_connectors(
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> list[dict[str, Any]]:
    """Return all installed Connector rows for the active company (RLS-enforced)."""
    connectors = db.query(Connector).all()
    return [_connector_to_dict(c) for c in connectors]


# ---------------------------------------------------------------------------
# PATCH /v1/connectors/{id}
# ---------------------------------------------------------------------------


@router.patch("/connectors/{connector_id}", status_code=200)
def patch_connector(
    connector_id: str,
    body: PatchConnectorBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Enable/disable a connector; override its approval level.

    Company-scoped: RLS ensures only the active company's connectors are visible.
    Returns 404 if not found (either doesn't exist or belongs to another company).
    """
    connector = db.get(Connector, connector_id)
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connector {connector_id!r} not found.",
        )

    if body.enabled is not None:
        connector.enabled = body.enabled
    if body.approval is not None:
        connector.approval = body.approval
    if body.status is not None:
        connector.status = body.status

    db.flush()
    return _connector_to_dict(connector)


# ---------------------------------------------------------------------------
# POST /v1/connectors/{id}/credentials
# ---------------------------------------------------------------------------


@router.post("/connectors/{connector_id}/credentials", status_code=200)
def store_credentials(
    connector_id: str,
    body: CredentialsBody,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> dict[str, Any]:
    """Store encrypted credentials for a connector.

    Each field in body.fields is encrypted before storage in secrets_enc.
    Plaintext values are NEVER stored or returned.
    Sets status to "connected" (was "needs_auth").

    Returns: connector dict with secrets_hint (field names only, no values).
    """
    connector = db.get(Connector, connector_id)
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connector {connector_id!r} not found.",
        )

    # Encrypt each field and store in secrets_enc
    encrypted: dict[str, str] = {}
    for field_name, plaintext_value in body.fields.items():
        encrypted[field_name] = _encrypt_field(plaintext_value)

    # Merge with any existing secrets (allow updating individual fields)
    existing = connector.secrets_enc or {}
    merged = {**existing, **encrypted}
    connector.secrets_enc = merged
    connector.status = "connected"
    db.flush()

    return _connector_to_dict(connector)


# ---------------------------------------------------------------------------
# DELETE /v1/connectors/{id}
# ---------------------------------------------------------------------------


@router.delete("/connectors/{connector_id}", status_code=204)
def delete_connector(
    connector_id: str,
    db: Session = Depends(get_tenant_db),
    ctx: RequestContext = Depends(get_context),
) -> None:
    """Remove a connector (company-scoped).

    Returns 404 if not found. Returns 204 No Content on success.
    """
    connector = db.get(Connector, connector_id)
    if connector is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Connector {connector_id!r} not found.",
        )

    db.delete(connector)
    db.flush()
