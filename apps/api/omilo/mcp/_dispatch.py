"""MCP shared dispatch — single source of truth for tenant-scoped tool execution.

Both /v1/mcp (Role-2, actor="agent") and /v1/x/mcp (Role-3, actor="external:<label>")
call run_tool_for() here.  Neither endpoint duplicates the session-open / dispatch /
ToolCall-log sequence.

Public surface:
  run_tool_for(helper, tool_name, arguments, *, actor) -> (result, decision)
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.toolcall import ToolCall
from omilo.mcp.tools import dispatch

logger = logging.getLogger(__name__)


def run_tool_for(
    helper: Helper,
    tool_name: str,
    arguments: dict,
    *,
    actor: str,
) -> tuple[Any, str]:
    """Open a company-scoped session, dispatch to the tool, log ToolCall.

    Called by:
      - /v1/mcp   (Role-2, server.py)  with actor="agent"
      - /v1/x/mcp (Role-3, external.py) with actor="external:<label>"

    Returns (result, decision). Raises on fatal errors (caller converts to JSON-RPC
    error response and logs a separate error ToolCall via _log_tool_call_error).
    Errors from dispatch (KeyError for unknown tool, any Exception for runtime
    failures) propagate upward — callers are expected to catch them.
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
