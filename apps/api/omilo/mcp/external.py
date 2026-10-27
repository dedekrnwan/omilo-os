"""MCP external endpoint — Role-3: scoped external client access.

Endpoint:
  POST /v1/x/mcp  (Bearer McpAccessToken raw) → JSON-RPC 2.0 dispatch

Auth protocol (POST /v1/x/mcp):
  Bearer token: the raw secret returned once at mint time.
  Stored: sha256(raw.encode()).hexdigest() on McpAccessToken.token_hash.
  Steps:
    1. Extract bearer.
    2. sha256(raw) → look up McpAccessToken by token_hash via a privileged
       (superuser) session.
    3. Check is_active(now) — revoked/expired → 401.
    4. Update last_used_at (best-effort, in the privileged session).
    5. Load the acted-as Helper (privileged session, no company GUC yet).
    6. For tools/list: build full catalog, filter to allowed set.
    7. For tools/call: if tool not in allowed set → JSON-RPC error +
       log a refused ToolCall; else → run_tool_for(helper, name, args,
       actor=f"external:{label}") — same dispatch + gate path as Role-2.

SCOPE_TOOLS: single mapping of scope name → tool names it unlocks.
  whoami is ALWAYS allowed regardless of scopes.

Spec: docs/technical/05-mcp-surfaces.md §6 (Role-3 external MCP).
"""
from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.mcp_token import McpAccessToken
from omilo.models.toolcall import ToolCall
from omilo.mcp.tools import TOOL_CATALOG, dispatch, get_connector_tools_for_helper

router = APIRouter(tags=["mcp-external"])

_401 = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized.")

# ---------------------------------------------------------------------------
# SCOPE_TOOLS: scope name → set of tool names it unlocks.
# whoami is NOT here because it is ALWAYS allowed unconditionally.
# ---------------------------------------------------------------------------

SCOPE_TOOLS: dict[str, set[str]] = {
    "identity": {"whoami"},
    "goals": {"goals_list"},
    "routines": {"routines_list"},
    "flows": {"flows_list"},
    "docs": {"recall", "remember"},
    "skills": {"skills_list", "skill_read", "skill_save", "skill_publish"},
    "propose": {"propose"},
    # "connectors" is handled dynamically (compiled connector tools for the helper)
}

_ALWAYS_ALLOWED: set[str] = {"whoami"}


def _allowed_native_tools(scopes: list[str]) -> set[str]:
    """Return the set of native tool names allowed for the given scopes.

    whoami is always present. Connector tools are not included here —
    they are added dynamically when "connectors" scope is present.
    """
    allowed = set(_ALWAYS_ALLOWED)
    for scope in scopes:
        if scope in SCOPE_TOOLS:
            allowed |= SCOPE_TOOLS[scope]
    return allowed


# ---------------------------------------------------------------------------
# verify_access_token
# ---------------------------------------------------------------------------


def verify_access_token(raw: str, *, now: datetime) -> McpAccessToken | None:
    """Verify a raw McpAccessToken and return the active row or None.

    Hashes the raw secret, looks it up via a privileged (superuser) session
    across all tenants (no company GUC), checks is_active(now), and updates
    last_used_at best-effort. Returns an expunged McpAccessToken or None.
    """
    if not raw:
        return None

    token_hash = hashlib.sha256(raw.encode()).hexdigest()

    try:
        with SessionLocal() as session:
            with session.begin():
                # Privileged lookup — no RLS / company GUC set (superuser session)
                row = (
                    session.query(McpAccessToken)
                    .filter_by(token_hash=token_hash)
                    .first()
                )
                if row is None:
                    return None
                if not row.is_active(now):
                    return None

                # Update last_used_at best-effort (inside this same transaction)
                row.last_used_at = now
                session.flush()  # Materialise the UPDATE before expunge

                # Expunge so the object survives after session closes
                session.expunge(row)
                return row
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Shared run_tool_for (used by both Role-2 server.py and this endpoint)
# ---------------------------------------------------------------------------

def run_tool_for(
    helper: Helper,
    tool_name: str,
    arguments: dict,
    *,
    actor: str,
) -> tuple[Any, str]:
    """Open a company-scoped session, dispatch to the tool, log ToolCall.

    Returns (result, decision). Raises on fatal errors (caller handles them).
    This is the single-sourced path shared by /v1/mcp and /v1/x/mcp.
    """
    started_at = time.monotonic()
    company_id = helper.company_id

    with SessionLocal() as db:
        with db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)

            helper_here = db.get(Helper, helper.id)
            if helper_here is None:
                raise RuntimeError("Helper not found in tenant session")

            result, decision = dispatch(tool_name, arguments, db, helper_here)

            duration_ms = int((time.monotonic() - started_at) * 1000)
            tc = ToolCall(
                id=prefixed_id("tc"),
                company_id=company_id,
                helper_id=helper.id,
                job_id=None,
                tool=tool_name,
                decision=decision,
                detail={"tool": tool_name},
                duration_ms=duration_ms,
                actor=actor,
                at=datetime.now(timezone.utc),
            )
            db.add(tc)

    return result, decision


def _log_refused_tool_call(
    company_id: str,
    helper_id: str,
    tool_name: str,
    actor: str,
) -> None:
    """Best-effort log of a scope-refused ToolCall in its own transaction."""
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
                    decision="refused",
                    detail={"reason": "out_of_scope"},
                    duration_ms=0,
                    actor=actor,
                    at=datetime.now(timezone.utc),
                )
                db.add(tc)
    except Exception:
        pass  # Logging must never crash the caller


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


# ---------------------------------------------------------------------------
# POST /v1/x/mcp — external JSON-RPC 2.0 endpoint
# ---------------------------------------------------------------------------


@router.post("/x/mcp")
async def external_mcp_endpoint(request: Request) -> dict:
    """JSON-RPC 2.0 external MCP endpoint (Role-3).

    Auth: Authorization: Bearer <raw McpAccessToken>

    Supported methods:
      tools/list  → scope-filtered catalog
      tools/call  → scope-checked dispatch (out-of-scope → JSON-RPC error)

    Every in-scope tools/call logs ToolCall(actor="external:<label>").
    Out-of-scope calls log ToolCall(decision="refused", actor="external:<label>").
    """
    now = datetime.now(timezone.utc)

    # ── 1. Extract + verify bearer ────────────────────────────────────────────
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise _401

    raw_token = auth_header[len("Bearer "):]
    token_row = verify_access_token(raw_token, now=now)
    if token_row is None:
        raise _401

    # ── 2. Load the acted-as Helper via privileged session ────────────────────
    helper: Helper | None = None
    try:
        with SessionLocal() as priv_db:
            with priv_db.begin():
                helper = priv_db.get(Helper, token_row.helper_id)
                if helper is None:
                    raise _401
                priv_db.expunge(helper)
    except HTTPException:
        raise
    except Exception:
        raise _401

    label: str = token_row.label
    scopes: list[str] = list(token_row.scopes or [])
    actor = f"external:{label}"

    # ── 3. Parse JSON-RPC body ────────────────────────────────────────────────
    try:
        body = await request.json()
    except Exception:
        return _jsonrpc_error(None, -32700, "Parse error")

    rpc_id = body.get("id")
    method = body.get("method", "")
    params = body.get("params") or {}

    # ── 4. Compute allowed tool set for this token ────────────────────────────
    allowed_native = _allowed_native_tools(scopes)

    # Connector tools: only if "connectors" scope is present
    connector_tools: list[dict] = []
    if "connectors" in scopes:
        try:
            with SessionLocal() as db:
                with db.begin():
                    db.execute(text("SET LOCAL ROLE omilo_app"))
                    set_company(db, helper.company_id)
                    helper_here = db.get(Helper, helper.id)
                    if helper_here is not None:
                        connector_tools = get_connector_tools_for_helper(db, helper_here)
        except Exception:
            pass

    connector_tool_names: set[str] = {t["name"] for t in connector_tools}
    allowed_all: set[str] = allowed_native | connector_tool_names

    # ── 5. Dispatch ───────────────────────────────────────────────────────────
    if method == "tools/list":
        # Build full catalog + connector tools, then filter to allowed set
        all_tools = TOOL_CATALOG + connector_tools
        filtered = [t for t in all_tools if t["name"] in allowed_all]
        return _jsonrpc_ok(rpc_id, {"tools": filtered})

    if method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments") or {}

        # Scope check: is this tool in the allowed set?
        if tool_name not in allowed_all:
            # Log a refused ToolCall for audit
            _log_refused_tool_call(helper.company_id, helper.id, tool_name, actor)
            return _jsonrpc_error(
                rpc_id,
                -32601,
                f"Tool {tool_name!r} is not permitted by this token's scopes.",
            )

        # In-scope: call the shared run_tool_for path
        try:
            result, _decision = run_tool_for(
                helper, tool_name, arguments, actor=actor
            )
        except KeyError:
            return _jsonrpc_error(rpc_id, -32601, f"Unknown tool: {tool_name!r}")
        except Exception as exc:
            return _jsonrpc_error(rpc_id, -32603, f"Internal error: {exc}")

        return _jsonrpc_ok(rpc_id, result)

    return _jsonrpc_error(rpc_id, -32601, f"Method not found: {method!r}")
