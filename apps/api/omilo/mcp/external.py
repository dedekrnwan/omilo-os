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
       actor=f"external:{label}") — same dispatch + gate path as Role-2
       (/v1/mcp, actor="agent").

SCOPE_TOOLS: single mapping of scope name → tool names it unlocks.
  whoami is ALWAYS allowed regardless of scopes.

Spec: docs/technical/05-mcp-surfaces.md §6 (Role-3 external MCP).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.mcp_token import McpAccessToken
from omilo.models.toolcall import ToolCall
from omilo.mcp.tools import TOOL_CATALOG, get_connector_tools_for_helper
from omilo.mcp._dispatch import run_tool_for  # shared with Role-2 server.py

router = APIRouter(tags=["mcp-external"])
logger = logging.getLogger(__name__)


def _unauthorized() -> HTTPException:
    """Return a fresh 401 HTTPException instance.

    A factory is used (rather than a shared singleton) so each raise site
    gets its own instance — re-raising the same HTTPException object across
    requests is safe in FastAPI but a factory makes intent explicit.
    """
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized.")


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
    except Exception as exc:
        logger.warning(
            "mcp_external: failed to log refused ToolCall for actor=%r tool=%r: %s",
            actor,
            tool_name,
            exc,
        )
        # Logging must never crash the caller


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
        raise _unauthorized()

    raw_token = auth_header[len("Bearer "):]
    token_row = verify_access_token(raw_token, now=now)
    if token_row is None:
        raise _unauthorized()

    # ── 2. Load the acted-as Helper via privileged session ────────────────────
    helper: Helper | None = None
    try:
        with SessionLocal() as priv_db:
            with priv_db.begin():
                helper = priv_db.get(Helper, token_row.helper_id)
                if helper is None:
                    raise _unauthorized()
                priv_db.expunge(helper)
    except HTTPException:
        raise
    except Exception:
        raise _unauthorized()

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

        # In-scope: call the shared run_tool_for path (also used by /v1/mcp, actor="agent")
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
