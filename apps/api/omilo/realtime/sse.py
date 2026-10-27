"""omilo.realtime.sse — SSE event stream endpoint.

Route: GET /v1/stream

Auth (same scheme as WS):
  Accepts a JWT via:
  1. Query param:          ?token=<jwt>  (browser-friendly)
  2. Authorization header: Bearer <jwt>

  Resolves user + company membership.  Returns 401 if:
  - token is missing / invalid / expired
  - the user has no Member row in the resolved company

Response:
  Content-Type: text/event-stream
  Each event is formatted as an SSE frame:

      event: <type>
      id: <id>
      data: <json>

  A heartbeat comment (`: heartbeat`) is sent every ~20 s to keep the
  connection alive through proxies.

Company isolation:
  The stream subscribes to ``broker`` for the authed company ONLY.
  Events for other tenants are never delivered here.
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from jwt.exceptions import PyJWTError

from omilo.auth.tokens import decode_token
from omilo.db import SessionLocal
from omilo.models.tenancy import Member, User
from omilo.realtime.events import broker

router = APIRouter(tags=["realtime"])

_401 = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing authentication credentials.",
    headers={"WWW-Authenticate": "Bearer"},
)

# Heartbeat interval in seconds — keeps connection alive through load balancers
_HEARTBEAT_INTERVAL = 20.0


# ---------------------------------------------------------------------------
# Auth helper (mirrors ws.py's _resolve_ws_auth)
# ---------------------------------------------------------------------------

def _resolve_sse_auth(token: str | None) -> tuple[str, str]:
    """Decode the JWT and verify membership.

    Returns (user_id, company_id) on success.
    Raises HTTPException(401) on any failure.
    """
    if not token:
        raise _401

    try:
        claims = decode_token(token)
    except PyJWTError:
        raise _401

    user_id: str = claims.get("sub", "")
    company_id: str = claims.get("cmp", "")

    if not user_id or not company_id:
        raise _401

    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise _401
        member = (
            session.query(Member)
            .filter_by(company_id=company_id, user_id=user_id)
            .first()
        )
        if member is None:
            raise _401

    return user_id, company_id


# ---------------------------------------------------------------------------
# SSE frame formatting
# ---------------------------------------------------------------------------

def _sse_frame(event: dict[str, Any]) -> str:
    """Format a dict as an SSE frame string.

    Emits:
        event: <type>
        id: <id>
        data: <json>
        (blank line)
    """
    parts: list[str] = []
    if "type" in event:
        parts.append(f"event: {event['type']}")
    if "id" in event:
        parts.append(f"id: {event['id']}")
    parts.append(f"data: {json.dumps(event)}")
    parts.append("")  # trailing blank line
    return "\n".join(parts) + "\n"


def _sse_comment(text: str) -> str:
    """Format a keepalive comment."""
    return f": {text}\n\n"


# ---------------------------------------------------------------------------
# Stream generator
# ---------------------------------------------------------------------------

async def _event_stream(company_id: str) -> AsyncGenerator[str, None]:
    """Yield SSE frames for *company_id* events, with periodic heartbeats."""
    sub = broker.subscribe(company_id)
    heartbeat_task: asyncio.Task | None = None

    # Use an asyncio Queue as the merge point for events and heartbeats.
    merged: asyncio.Queue[str | None] = asyncio.Queue()

    async def _pump_events() -> None:
        """Forward broker events to the merged queue as SSE frames."""
        try:
            async for ev in sub:
                await merged.put(_sse_frame(ev))
        except asyncio.CancelledError:
            pass
        finally:
            await merged.put(None)  # sentinel — close the stream

    async def _heartbeat_loop() -> None:
        """Send a keepalive comment every _HEARTBEAT_INTERVAL seconds."""
        try:
            while True:
                await asyncio.sleep(_HEARTBEAT_INTERVAL)
                await merged.put(_sse_comment("heartbeat"))
        except asyncio.CancelledError:
            pass

    event_task = asyncio.create_task(_pump_events())
    heartbeat_task = asyncio.create_task(_heartbeat_loop())

    try:
        while True:
            item = await merged.get()
            if item is None:
                break
            yield item
    except (GeneratorExit, asyncio.CancelledError):
        pass
    finally:
        event_task.cancel()
        if heartbeat_task is not None:
            heartbeat_task.cancel()
        await sub.aclose()


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@router.get("/stream")
async def sse_stream(
    request: Request,
    token: str | None = Query(default=None),
) -> StreamingResponse:
    """Open a per-company SSE stream.

    Auth: JWT via ?token= query param OR Authorization: Bearer header.
    401 on missing/invalid token or no membership.

    Yields ``{type, id, data}`` events as SSE frames, plus periodic heartbeat
    comments.  Events are company-scoped — the subscriber only receives events
    published for their company.
    """
    # Resolve token: query param first, then Authorization header
    bearer_token = token
    if bearer_token is None:
        auth_header = (
            request.headers.get("Authorization")
            or request.headers.get("authorization")
        )
        if auth_header and auth_header.startswith("Bearer "):
            bearer_token = auth_header[7:]

    _user_id, company_id = _resolve_sse_auth(bearer_token)

    return StreamingResponse(
        _event_stream(company_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx: disable buffering
            "Connection": "keep-alive",
        },
    )
