"""MCP server — Role-2: per-agent native platform tools.

Endpoints:
  POST /v1/helpers/{id}/mcp-token   (admin/owner auth) → mint/regenerate token
  POST /v1/mcp                      (Bearer mcp_token) → JSON-RPC 2.0 dispatch

Auth protocol (POST /v1/mcp):
  Bearer token format: "{helper_id}.{secret}"
  Stored:  sha256(secret.encode()).hexdigest()  on Helper.mcp_token_hash
  Steps:
    1. Extract bearer.
    2. Split on "." → (helper_id, secret).
    3. Load Helper via privileged session (no company context yet).
    4. Verify sha256(secret) == Helper.mcp_token_hash.
    5. Open company-scoped session (SET LOCAL ROLE omilo_app + set_company).
    6. Dispatch JSON-RPC method.

Spec: docs/technical/05-mcp-surfaces.md §1, §3.
"""
from __future__ import annotations

import hashlib
import secrets
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.toolcall import ToolCall
from omilo.mcp.tools import TOOL_CATALOG, dispatch
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

router = APIRouter(tags=["mcp"])

_401 = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized.")


# ---------------------------------------------------------------------------
# Token utilities
# ---------------------------------------------------------------------------

def _mint_raw_token(helper_id: str) -> tuple[str, str]:
    """Mint a new raw MCP token and return (raw_token, token_hash).

    Token format: "{helper_id}.{secret}"
    Hash: sha256(secret.encode()).hexdigest()

    The raw token is returned once; the hash is stored on Helper.mcp_token_hash.
    Regenerating replaces the stored hash.
    """
    secret = secrets.token_urlsafe(32)
    raw = f"{helper_id}.{secret}"
    token_hash = hashlib.sha256(secret.encode()).hexdigest()
    return raw, token_hash


def _verify_token(raw_token: str) -> Helper | None:
    """Resolve a raw MCP token to its Helper.

    Uses a privileged (superuser) session — no company GUC set yet.
    Returns None on any verification failure; never raises.
    """
    if not raw_token or "." not in raw_token:
        return None

    # Format: "{helper_id}.{secret}"
    dot = raw_token.index(".")
    helper_id = raw_token[:dot]
    secret = raw_token[dot + 1:]

    if not helper_id or not secret:
        return None

    expected_hash = hashlib.sha256(secret.encode()).hexdigest()

    try:
        with SessionLocal() as session:
            with session.begin():
                helper = session.get(Helper, helper_id)
                if helper is None:
                    return None
                if not helper.mcp_token_hash:
                    return None
                if not secrets.compare_digest(helper.mcp_token_hash, expected_hash):
                    return None
                # Expunge so the object can be used after this session closes
                session.expunge(helper)
                return helper
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Dependency: tenant-scoped session from context
# ---------------------------------------------------------------------------

def _tenant_db_dep(ctx: RequestContext = Depends(get_context)):
    """FastAPI dependency: tenant-scoped session from RequestContext."""
    with SessionLocal() as session:
        with session.begin():
            session.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(session, ctx.company_id)
            yield session


# ---------------------------------------------------------------------------
# POST /v1/helpers/{id}/mcp-token  — mint/regenerate
# ---------------------------------------------------------------------------

@router.post("/helpers/{helper_id}/mcp-token")
def mint_mcp_token(
    helper_id: str,
    ctx: RequestContext = Depends(get_context),
    db: Session = Depends(_tenant_db_dep),
) -> dict:
    """Mint (or regenerate) the MCP token for a Helper.

    Returns the raw token ONCE.  The hash is stored; the raw token cannot be
    recovered — regenerating replaces the hash.

    Access: owner or admin only.
    """
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only owners and admins may mint MCP tokens.",
        )

    helper = db.get(Helper, helper_id)
    if helper is None or helper.company_id != ctx.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Helper not found.")

    raw_token, token_hash = _mint_raw_token(helper_id)
    helper.mcp_token_hash = token_hash
    db.flush()

    return {"token": raw_token}


# ---------------------------------------------------------------------------
# POST /v1/mcp  — JSON-RPC 2.0 endpoint
# ---------------------------------------------------------------------------

@router.post("/mcp")
async def mcp_endpoint(request: Request) -> dict:
    """JSON-RPC 2.0 MCP endpoint.

    Auth: Authorization: Bearer <mcp_token>
    Token format: "{helper_id}.{secret}"

    Supported methods:
      tools/list  → catalog of available tools
      tools/call  → {name, arguments} → dispatch to tool handler

    Every tools/call logs a ToolCall row.
    Returns JSON-RPC 2.0 response: {jsonrpc, id, result} or {jsonrpc, id, error}.
    """
    # ── 1. Parse bearer ──────────────────────────────────────────────────────
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise _401

    raw_token = auth_header[len("Bearer "):]
    helper = _verify_token(raw_token)
    if helper is None:
        raise _401

    # ── 2. Parse JSON-RPC body ────────────────────────────────────────────────
    try:
        body = await request.json()
    except Exception:
        return _jsonrpc_error(None, -32700, "Parse error")

    rpc_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params") or {}

    # ── 3. Dispatch ───────────────────────────────────────────────────────────
    if method == "tools/list":
        return _jsonrpc_ok(rpc_id, {"tools": TOOL_CATALOG})

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}
        return await _run_tool(helper, tool_name, arguments, rpc_id)

    return _jsonrpc_error(rpc_id, -32601, f"Method not found: {method!r}")


async def _run_tool(
    helper: Helper,
    tool_name: str,
    arguments: dict,
    rpc_id: Any,
) -> dict:
    """Dispatch to a tool handler inside a company-scoped DB session.

    Logs a ToolCall row for every invocation (success or error).
    """
    started_at = time.monotonic()
    company_id = helper.company_id
    decision = "error"
    detail: dict = {}
    result: Any = None

    try:
        with SessionLocal() as db:
            with db.begin():
                # Drop to non-superuser + set company GUC → FORCE RLS applies
                db.execute(text("SET LOCAL ROLE omilo_app"))
                set_company(db, company_id)

                # Reload Helper in this session (was expunged from auth session)
                helper_here = db.get(Helper, helper.id)
                if helper_here is None:
                    raise RuntimeError("Helper not found in tenant session")

                result, decision = dispatch(tool_name, arguments, db, helper_here)
                detail = {"tool": tool_name}

                # Log ToolCall inside the same transaction
                duration_ms = int((time.monotonic() - started_at) * 1000)
                tc = ToolCall(
                    id=prefixed_id("tc"),
                    company_id=company_id,
                    helper_id=helper.id,
                    job_id=None,
                    tool=tool_name,
                    decision=decision,
                    detail=detail,
                    duration_ms=duration_ms,
                    at=datetime.now(timezone.utc),
                )
                db.add(tc)

    except KeyError as exc:
        duration_ms = int((time.monotonic() - started_at) * 1000)
        _log_tool_call_error(company_id, helper.id, tool_name, str(exc), duration_ms)
        return _jsonrpc_error(rpc_id, -32601, f"Unknown tool: {tool_name!r}")

    except Exception as exc:
        duration_ms = int((time.monotonic() - started_at) * 1000)
        _log_tool_call_error(company_id, helper.id, tool_name, str(exc), duration_ms)
        return _jsonrpc_error(rpc_id, -32603, f"Internal error: {exc}")

    return _jsonrpc_ok(rpc_id, result)


def _log_tool_call_error(
    company_id: str,
    helper_id: str,
    tool_name: str,
    error_msg: str,
    duration_ms: int,
) -> None:
    """Best-effort ToolCall error log in a separate transaction."""
    try:
        with SessionLocal() as db:
            with db.begin():
                db.execute(text("SET LOCAL ROLE omilo_app"))
                set_company(db, company_id)
                tc = ToolCall(
                    id=prefixed_id("tc"),
                    company_id=company_id,
                    helper_id=helper_id,
                    job_id=None,
                    tool=tool_name,
                    decision="error",
                    detail={"error": error_msg},
                    duration_ms=duration_ms,
                    at=datetime.now(timezone.utc),
                )
                db.add(tc)
    except Exception:
        pass  # Error logging must never crash the caller


# ---------------------------------------------------------------------------
# JSON-RPC helpers
# ---------------------------------------------------------------------------

def _jsonrpc_ok(rpc_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}


def _jsonrpc_error(rpc_id: Any, code: int, message: str) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "error": {"code": code, "message": message},
    }
