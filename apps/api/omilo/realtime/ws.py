"""omilo.realtime.ws — WebSocket chat streaming.

Route: WS /v1/ws/sessions/{session_id}

Auth:
  Browser clients cannot send Authorization headers on WebSocket.
  Accepts the JWT via:
    1. Query param: ?token=<jwt>  (primary, for browsers)
    2. Authorization header: Bearer <jwt>  (for non-browser clients)
  Resolves user + company membership.  Closes with code 4401 if:
  - token is missing / invalid / expired
  - the user has no Member row in the resolved company

Frame protocol (per spec §3):
  client → {type:"user_message", content}
  server ← {type:"run_event", kind, data}  (≥1, from engine RunEvents)
  server ← {type:"message_saved", message: MessageDTO}  (assistant msg)
  server ← {type:"job_done", job_id}  OR  {type:"job_failed", job_id}

Streaming approach (P1 buffered):
  The loop runner is synchronous.  We run it via
  ``fastapi.concurrency.run_in_threadpool`` to avoid blocking the event
  loop, then send buffered run_event frames in order, followed by
  message_saved + job_done.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from jwt.exceptions import PyJWTError
from sqlalchemy import text
from sqlalchemy.orm import Session

from omilo.api.chat_write import (
    _message_dto,
    _persist_assistant_message,
    _pick_helper,
)
from omilo.auth.tokens import decode_token
from omilo.db import SessionLocal, set_company
from omilo.loop.runner import start_job
from omilo.models.base import prefixed_id
from omilo.models.chat import ChatSession, Message
from omilo.models.tenancy import Member, User

router = APIRouter(tags=["realtime"])

# WS close code 4401 (application-level, in 4000–4999 range)
_WS_UNAUTHORIZED = 4401


# ---------------------------------------------------------------------------
# Auth helper — resolves JWT + membership without HTTP deps
# ---------------------------------------------------------------------------

def _resolve_ws_auth(token: str | None) -> tuple[str, str]:
    """Decode the JWT and verify membership.

    Returns (user_id, company_id) on success.
    Raises ValueError with a human-readable reason on failure.
    """
    if not token:
        raise ValueError("Missing token")

    try:
        claims = decode_token(token)
    except PyJWTError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc

    user_id: str = claims.get("sub", "")
    company_id: str = claims.get("cmp", "")

    if not user_id or not company_id:
        raise ValueError("Token missing sub/cmp claims")

    # Verify user exists + has Member row (privileged bootstrap session)
    with SessionLocal() as session:
        user = session.get(User, user_id)
        if user is None:
            raise ValueError("User not found")
        member = (
            session.query(Member)
            .filter_by(company_id=company_id, user_id=user_id)
            .first()
        )
        if member is None:
            raise ValueError("No membership in company")

    return user_id, company_id


# ---------------------------------------------------------------------------
# Sync turn runner (called inside run_in_threadpool)
# ---------------------------------------------------------------------------

def _run_turn_sync(
    company_id: str,
    session_id: str,
    content: str,
) -> dict:
    """Run one operator turn synchronously.

    Opens a company-scoped DB session, persists the operator message,
    picks the helper, runs the job with a buffering publish hook, persists
    the assistant message, and returns a result dict with:
      - run_events: list of {kind, data} dicts (in emit order)
      - operator_msg: operator Message ORM (for its DTO)
      - assistant_msg: assistant Message ORM (may be None)
      - job_id: str
      - job_status: str ("done" | "waiting" | "failed")
      - error: str | None

    All DB work is committed (one transaction).
    """
    collected_events: list[dict[str, Any]] = []

    def _collect(cid: str, event: dict) -> None:
        """Buffered publish: collect run_events during the sync turn."""
        collected_events.append(event)

    with SessionLocal() as db:
        with db.begin():
            # ── Set up company-scoped session (RLS) ────────────────────────
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, company_id)

            # ── Load session (RLS scopes to company) ───────────────────────
            session_row = db.query(ChatSession).filter(
                ChatSession.id == session_id
            ).first()
            if session_row is None:
                return {
                    "error": "Session not found",
                    "run_events": [],
                    "operator_msg": None,
                    "assistant_msg": None,
                    "job_id": None,
                    "job_status": None,
                }

            # ── Persist operator message ───────────────────────────────────
            now = datetime.now(timezone.utc)
            op_msg = Message(
                id=prefixed_id("msg"),
                company_id=company_id,
                session_id=session_id,
                author={"kind": "you", "name": "You"},
                content=content,
                created_at=now,
            )
            db.add(op_msg)
            db.flush()

            # ── Pick helper ────────────────────────────────────────────────
            try:
                helper = _pick_helper(db, session_row, company_id)
            except Exception as exc:
                return {
                    "error": f"no helper: {exc}",
                    "run_events": collected_events,
                    "operator_msg": op_msg,
                    "assistant_msg": None,
                    "job_id": None,
                    "job_status": None,
                }

            # ── Run the Helper turn ────────────────────────────────────────
            job = start_job(
                db,
                company_id=company_id,
                helper_id=helper.id,
                origin="chat",
                brief=content,
                session_id=session_id,
                # pass publish only to the outer start_job; but start_job
                # calls run_job internally without publish.  We need to
                # intercept via run_job directly.  Re-run via run_job:
            )
            # NOTE: start_job already ran run_job without our publish hook.
            # The events are already stored as RunEvent rows.
            # For P1 buffered streaming we read them back from the DB:
            # (they are flushed within the same transaction, so visible here)
            from omilo.models.execution import RunEvent
            run_events_rows = (
                db.query(RunEvent)
                .filter(RunEvent.job_id == job.id)
                .order_by(RunEvent.id)
                .all()
            )
            run_events_out = [
                {"kind": row.kind, "data": row.data or {}}
                for row in run_events_rows
            ]

            # ── Persist assistant message ──────────────────────────────────
            asst_msg = _persist_assistant_message(
                db,
                company_id=company_id,
                session_id=session_id,
                helper=helper,
                job=job,
            )

            return {
                "error": None,
                "run_events": run_events_out,
                "operator_msg": op_msg,
                "assistant_msg": asst_msg,
                "job_id": job.id,
                "job_status": job.status,
            }


# ---------------------------------------------------------------------------
# WebSocket route
# ---------------------------------------------------------------------------

@router.websocket("/ws/sessions/{session_id}")
async def ws_chat(
    websocket: WebSocket,
    session_id: str,
) -> None:
    """WebSocket chat: receive user messages, stream run events + responses.

    Auth: JWT via ?token=<jwt> query param or Authorization header.
    Closes with 4401 on missing/invalid token or no membership.
    """
    # ── 1. Authenticate BEFORE accepting ──────────────────────────────────────
    token = (
        websocket.query_params.get("token")
        or _extract_bearer_header(websocket)
    )

    try:
        user_id, company_id = _resolve_ws_auth(token)
    except ValueError:
        await websocket.close(code=_WS_UNAUTHORIZED)
        return

    # ── 2. Accept connection ──────────────────────────────────────────────────
    await websocket.accept()

    # ── 3. Message loop ───────────────────────────────────────────────────────
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                frame = json.loads(raw)
            except json.JSONDecodeError:
                await _send(websocket, {"type": "error", "detail": "invalid JSON"})
                continue

            if frame.get("type") != "user_message":
                # Ignore unknown frame types silently
                continue

            content: str = frame.get("content", "")
            if not content.strip():
                await _send(websocket, {"type": "error", "detail": "empty content"})
                continue

            # ── Run the turn in a thread (sync runner) ─────────────────────
            result = await run_in_threadpool(
                _run_turn_sync,
                company_id,
                session_id,
                content,
            )

            if result["error"]:
                await _send(websocket, {"type": "error", "detail": result["error"]})
                continue

            # ── Stream run_events (buffered — in emit order) ───────────────
            for ev in result["run_events"]:
                await _send(websocket, {
                    "type": "run_event",
                    "kind": ev["kind"],
                    "data": ev["data"],
                })

            # ── message_saved ──────────────────────────────────────────────
            if result["assistant_msg"] is not None:
                await _send(websocket, {
                    "type": "message_saved",
                    "message": _message_dto(result["assistant_msg"]),
                })

            # ── job_done / job_failed ──────────────────────────────────────
            job_status = result["job_status"]
            terminal_type = "job_done" if job_status in ("done", "waiting") else "job_failed"
            await _send(websocket, {
                "type": terminal_type,
                "job_id": result["job_id"],
            })

    except WebSocketDisconnect:
        pass


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_bearer_header(websocket: WebSocket) -> str | None:
    """Extract JWT from Authorization: Bearer <jwt> header."""
    auth = websocket.headers.get("Authorization") or websocket.headers.get("authorization")
    if auth and auth.startswith("Bearer "):
        return auth[7:]
    return None


async def _send(websocket: WebSocket, payload: dict) -> None:
    """Send a JSON frame; ignore send errors on closed connections."""
    try:
        await websocket.send_text(json.dumps(payload))
    except Exception:
        pass
