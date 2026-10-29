"""POST /v1/sessions/{id}/messages/stream — a chat turn streamed over SSE.

Body: {"content": str, "model"?: str}

Events (``text/event-stream``):
    event: user      data: <MessageDTO>               the owner's message, saved
    event: helper    data: {name, area, helperId}     who is answering
    event: activity  data: {label}                    searching the web, reading a page…
    event: sources   data: {items: [{url, title}]}
    event: text      data: {delta}                    the reply, as it is written
    event: done      data: {message: <MessageDTO>, jobId}
    event: error     data: {error, message: <MessageDTO>, jobId}   (the error note is saved too)

The turn runs on the company's connected AI (omilo.ai). The owner's message is
saved before the AI starts, the reply when it ends (also when the browser goes
away mid-answer, with what was written so far). Each turn is recorded as a
``Job`` (origin ``chat``) so analytics, usage and the Results panel see it, and
``message.created`` is published on ``/v1/stream`` for other open tabs.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from omilo.ai import AiError, converse
from omilo.ai.config import resolve
from omilo.ai.prompts import chat_system
from omilo.api.chat_write import _message_dto, _pick_helper
from omilo.db import SessionLocal, set_company
from omilo.engine.real import engine_type_for, usd_to_credits
from omilo.models.base import prefixed_id
from omilo.models.chat import ChatSession, Message
from omilo.models.execution import Job
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

log = logging.getLogger(__name__)
router = APIRouter(tags=["chat-stream"])

HISTORY = 30


class StreamBody(BaseModel):
    content: str
    model: str | None = None


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _tenant(db, company_id: str) -> None:
    db.execute(text("SET LOCAL ROLE omilo_app"))
    set_company(db, company_id)


def _prepare(ctx: RequestContext, session_id: str, body: StreamBody) -> dict:
    """Save the owner's message and collect everything the AI needs (one short transaction)."""
    from omilo.loop.behavior import build_helper_instructions

    with SessionLocal() as db, db.begin():
        _tenant(db, ctx.company_id)
        sess = db.get(ChatSession, session_id)
        if sess is None or sess.deleted_at is not None or (
            sess.kind == "chief_private" and sess.owner_user_id != ctx.user_id
        ):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found.")
        if body.model:
            sess.model = body.model
        past = (
            db.query(Message).filter(Message.session_id == session_id)
            .order_by(Message.created_at.desc()).limit(HISTORY).all()
        )
        op = Message(
            id=prefixed_id("msg"), company_id=ctx.company_id, session_id=session_id,
            author={"kind": "you", "name": "You"}, content=body.content.strip(),
            created_at=datetime.now(timezone.utc),
        )
        db.add(op)
        db.flush()
        helper = _pick_helper(db, sess, ctx.company_id)
        company = db.get(Company, ctx.company_id)
        cfg = resolve(db, ctx.company_id, helper, tier="balanced").with_model(body.model or sess.model)
        if cfg.pooled:
            from omilo.ai.config import has_credits

            if not has_credits(db, ctx.company_id):
                raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED,
                                    detail="Omilo Cloud's AI has no allowance left. Connect your own AI key in Control panel → AI engine.")
        history = [
            {"role": "user" if (m.author or {}).get("kind") == "you" else "assistant", "content": m.content or ""}
            for m in reversed(past)
        ] + [{"role": "user", "content": op.content}]
        return {
            "op": _message_dto(op),
            "helper": {"id": helper.id, "name": helper.name, "area": helper.area},
            "system": chat_system(helper, company, instructions=build_helper_instructions(helper),
                                  web=cfg.provider in ("anthropic", "cli")),
            "history": history,
            "cfg": cfg,
            "brief": op.content,
        }


def _finish(ctx: RequestContext, session_id: str, prep: dict, reply: str, done: dict, error: str | None) -> dict:
    """Save the reply (or the error) and the Job record; publish message.created."""
    helper = prep["helper"]
    cfg = prep["cfg"]
    now = datetime.now(timezone.utc)
    with SessionLocal() as db, db.begin():
        _tenant(db, ctx.company_id)
        job = Job(
            id=prefixed_id("job"), company_id=ctx.company_id, helper_id=helper["id"], origin="chat",
            brief=prep["brief"][:4000], session_id=session_id, status="failed" if error and not reply else "done",
            cost_credits=usd_to_credits(float(done.get("cost_usd") or 0)),
            tokens_in=int(done.get("tokens_in") or 0), tokens_out=int(done.get("tokens_out") or 0),
            attempts=1, checkpoint={}, result_text=reply[:20000] or None,
            error=(error or None), started_at=prep.get("started_at") or now, ended_at=now,
        )
        job.engine_type = engine_type_for(cfg)
        db.add(job)
        content = reply.strip() or (f"I couldn't answer just now: {error}" if error else "(no answer)")
        msg = Message(
            id=prefixed_id("msg"), company_id=ctx.company_id, session_id=session_id,
            author={"kind": "helper", "name": helper["name"], "area": helper["area"]},
            content=content, created_at=now,
        )
        db.add(msg)
        db.flush()
        if cfg.pooled:  # Omilo Cloud's AI: charge the turn in credits
            from omilo.billing.meter import meter_job

            try:
                meter_job(db, job)
            except Exception:  # noqa: BLE001 — never lose the reply over metering
                log.exception("metering chat turn failed")
        dto = _message_dto(msg)
    try:
        from omilo.realtime.events import broker

        broker.publish(ctx.company_id, {"type": "message.created", "id": dto.get("id"),
                                        "data": {"sessionId": session_id, "message": dto}})
    except Exception:  # noqa: BLE001 — realtime fan-out is best effort
        log.debug("broker publish failed", exc_info=True)
    return {"message": dto, "jobId": job.id}


_RUNNING: set[asyncio.Task] = set()  # keep strong refs to in-flight turns


async def _run_turn(ctx: RequestContext, session_id: str, prep: dict, queue: asyncio.Queue) -> None:
    """Run the AI turn, forward events to the queue, then save the reply. Never raises."""
    reply, done, error = "", {}, None
    try:
        async for ev in converse(prep["cfg"], prep["system"], prep["history"],
                                 web=prep["cfg"].provider in ("anthropic", "cli"),
                                 max_turns=6, max_tokens=4096, timeout=300):
            if ev["type"] == "text":
                reply += ev["delta"]
                queue.put_nowait(("text", {"delta": ev["delta"]}))
            elif ev["type"] == "activity":
                queue.put_nowait(("activity", {"label": ev["label"]}))
            elif ev["type"] == "sources":
                queue.put_nowait(("sources", {"items": ev["items"]}))
            elif ev["type"] == "done":
                done = ev
                reply = ev.get("text") or reply
    except AiError as e:
        error = str(e)
    except Exception as e:  # noqa: BLE001
        log.exception("chat turn failed")
        error = f"Something went wrong: {str(e)[:200]}"
    try:
        saved = await asyncio.to_thread(_finish, ctx, session_id, prep, reply, done, error)
        queue.put_nowait(("error", {**saved, "error": error}) if error else ("done", saved))
    except Exception:  # noqa: BLE001
        log.exception("saving the chat reply failed")
        queue.put_nowait(("error", {"error": "The reply couldn't be saved.", "message": None}))
    finally:
        queue.put_nowait((None, None))


@router.post("/sessions/{session_id}/messages/stream")
async def stream_message(
    session_id: str,
    body: StreamBody,
    request: Request,
    ctx: RequestContext = Depends(get_context),
) -> StreamingResponse:
    if not body.content.strip():
        raise HTTPException(status_code=422, detail="Write a message first.")
    prep = await asyncio.to_thread(_prepare, ctx, session_id, body)
    prep["started_at"] = datetime.now(timezone.utc)

    # The turn runs as its own task: it finishes and saves the reply even when the
    # browser goes away mid-answer (tab closed, navigation, React StrictMode).
    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(_run_turn(ctx, session_id, prep, queue))
    _RUNNING.add(task)
    task.add_done_callback(_RUNNING.discard)

    async def gen():
        yield _sse("user", prep["op"])
        yield _sse("helper", {"helperId": prep["helper"]["id"], "name": prep["helper"]["name"],
                              "area": prep["helper"]["area"], "ai": prep["cfg"].label})
        while True:
            event, data = await queue.get()
            if event is None:
                return
            yield _sse(event, data)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
