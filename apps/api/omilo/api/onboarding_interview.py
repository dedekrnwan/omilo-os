"""Onboarding interview endpoints (step "Get to know you", "Check" and "Your team").

    GET  /v1/onboarding/interview          → {history, topic, notes, coverage, ai}
    POST /v1/onboarding/interview/stream   → SSE turn  {message, website?, restart?}
         events: activity {label} · text {delta} · note {topic, content}
                 done {history, topic, notes, coverage, options, ai} · error {message}
    PUT  /v1/onboarding/notes/{topic}      → edit one note (Check step)  {content}
    POST /v1/onboarding/team-plan          → {helpers: [...], by: ai|rules}

State is kept in ``company.settings["onboarding"]`` (see omilo.interview).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm.attributes import flag_modified

from omilo import interview as I
from omilo.ai import AiError
from omilo.ai.config import AiConfig, resolve
from omilo.db import SessionLocal, set_company
from omilo.models.tenancy import Company
from omilo.tenancy.context import RequestContext
from omilo.tenancy.deps import get_context

log = logging.getLogger(__name__)
router = APIRouter(tags=["onboarding-interview"])


class FileAttachment(BaseModel):
    name: str
    mime: str = "application/octet-stream"
    data: str  # base64-encoded bytes, no data-URI prefix


class TurnBody(BaseModel):
    message: str = ""
    website: str | None = None
    restart: bool = False
    file: FileAttachment | None = None


class NoteBody(BaseModel):
    content: str


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _load(ctx: RequestContext) -> tuple[dict, str, AiConfig]:
    with SessionLocal() as db, db.begin():
        db.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(db, ctx.company_id)
        company = db.get(Company, ctx.company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        st = ((company.settings or {}).get("onboarding") or {})
        state = {**I.empty_state(), **{k: v for k, v in st.items() if k in ("interview", "notes", "website", "suggested")}}
        state["interview"] = {**I.empty_state()["interview"], **(state.get("interview") or {})}
        cfg = resolve(db, ctx.company_id, None, tier="balanced")
        return state, company.name, cfg


def _save(ctx: RequestContext, state: dict) -> None:
    with SessionLocal() as db, db.begin():
        db.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(db, ctx.company_id)
        company = db.get(Company, ctx.company_id)
        settings = dict(company.settings or {})
        ob = dict(settings.get("onboarding") or {})
        ob.update({"interview": state["interview"], "notes": state["notes"], "website": state.get("website") or "",
                   "suggested": state.get("suggested") or []})
        settings["onboarding"] = ob
        company.settings = settings
        flag_modified(company, "settings")


def _took_min(interview: dict) -> int | None:
    """Minutes from the first to the latest answered turn (the Check step's 'Took 9 minutes')."""
    try:
        start = datetime.fromisoformat(interview["started_at"])
        end = datetime.fromisoformat(interview["last_at"])
    except (KeyError, TypeError, ValueError):
        return None
    return max(1, round((end - start).total_seconds() / 60))


def _view(state: dict, cfg: AiConfig, options: list[str] | None = None) -> dict:
    notes = state["notes"]
    return {"history": state["interview"]["history"], "topic": state["interview"].get("topic"),
            "notes": notes, "coverage": I.coverage(notes), "options": options or [],
            "website": state.get("website") or "",
            "suggested": [t for t in state.get("suggested") or [] if str(notes.get(t) or "").strip()],
            "took_min": _took_min(state["interview"]),
            "ai": {"label": cfg.label, "practice": cfg.is_fake}}


@router.get("/onboarding/interview")
async def get_interview(ctx: RequestContext = Depends(get_context)) -> dict:
    state, _name, cfg = await asyncio.to_thread(_load, ctx)
    return _view(state, cfg)


@router.post("/onboarding/interview/stream")
async def interview_stream(body: TurnBody, request: Request, ctx: RequestContext = Depends(get_context)):
    state, company_name, cfg = await asyncio.to_thread(_load, ctx)
    if body.restart:
        state = {**I.empty_state(), "notes": state["notes"]}  # keep notes already written
    message = body.message.strip()[:4000]
    website = (body.website or "").strip() or (I.find_url(message) if message and not cfg.is_fake else None)

    async def gen():
        hist = state["interview"]["history"]
        if not message and not website and not body.file and hist and hist[-1]["role"] == "ai":
            yield _sse("done", _view(state, cfg, hist[-1].get("options")))  # reopened: show where we were
            return
        # Size-check the attachment before anything else (base64 → raw byte estimate)
        if body.file:
            raw_size = len(body.file.data) * 3 // 4
            if raw_size > 10 * 1024 * 1024:
                yield _sse("error", {"message": "That file is over 10 MB — attach a smaller one."})
                return
        final: dict = {}
        try:
            async for ev in I.stream_turn(cfg, company_name, state, message, website=website,
                                          file=body.file.model_dump() if body.file else None):
                if ev["type"] == "text":
                    yield _sse("text", {"delta": ev["delta"]})
                elif ev["type"] == "activity":
                    yield _sse("activity", {"label": ev["label"]})
                elif ev["type"] == "note":
                    yield _sse("note", {"topic": ev["topic"], "content": ev["content"]})
                elif ev["type"] == "final":
                    final = ev
        except AiError as e:
            yield _sse("error", {"message": str(e)})
            return
        except Exception as e:  # noqa: BLE001
            log.exception("interview turn failed")
            yield _sse("error", {"message": f"Something went wrong: {str(e)[:200]}"})
            return
        if message or website or body.file:
            text = message or (f"📎 {body.file.name}" if body.file else f"Read {website}")
            entry: dict[str, Any] = {"role": "owner", "text": text}
            if body.file:
                entry["attachment"] = {"name": body.file.name}
            hist.append(entry)
        ai_entry: dict[str, Any] = {"role": "ai", "text": final["reply"], "options": final.get("options") or []}
        if final.get("practice"):
            ai_entry["topic"] = final["topic"]
        hist.append(ai_entry)
        now = datetime.now(timezone.utc).isoformat()
        started = state["interview"].get("started_at") or now
        state["interview"] = {"history": hist[-80:], "topic": final["topic"], "started_at": started,
                              "last_at": now if (message or website or body.file) else state["interview"].get("last_at") or now}
        state["notes"] = final["notes"]
        state["suggested"] = final.get("suggested", state.get("suggested") or [])
        if website:
            state["website"] = website
        await asyncio.to_thread(_save, ctx, state)
        yield _sse("done", _view(state, cfg, final.get("options")))

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.put("/onboarding/notes/{topic}")
async def put_note(topic: str, body: NoteBody, ctx: RequestContext = Depends(get_context)) -> dict:
    if topic not in (*I.TOPIC_IDS, "extra"):  # "extra": "Add something I missed" on the Check step
        raise HTTPException(status_code=404, detail="Unknown topic.")
    state, _name, cfg = await asyncio.to_thread(_load, ctx)
    content = body.content.strip()[:2000]
    # The owner wrote this note now — it's theirs, not Chief's suggestion.
    state["suggested"] = [t for t in state.get("suggested") or [] if t != topic]
    if content:
        state["notes"][topic] = content
    else:
        state["notes"].pop(topic, None)
    await asyncio.to_thread(_save, ctx, state)
    return _view(state, cfg)


@router.post("/onboarding/team-plan")
async def team_plan(ctx: RequestContext = Depends(get_context)) -> dict:
    state, company_name, cfg = await asyncio.to_thread(_load, ctx)
    plan = await I.plan_team(cfg, company_name, state["notes"])
    return plan


@router.get("/onboarding/company-profile-suggestion")
async def company_profile_suggestion(ctx: RequestContext = Depends(get_context)) -> dict:
    """Chief's guess at the "Your company" fields, from the interview notes.

    Best-effort: returns empty strings for anything it couldn't ground, so the
    form prefills what it can and the owner fills/corrects the rest. camelCase
    keys mirror the frontend ProfileForm.
    """
    state, company_name, cfg = await asyncio.to_thread(_load, ctx)
    sug = await I.suggest_profile(cfg, company_name, state["notes"])
    return {
        "industry": sug.get("industry", ""),
        "teamSize": sug.get("team_size", ""),
        "region": sug.get("region", ""),
        "currency": sug.get("currency", ""),
        "picRole": sug.get("pic_role", ""),
    }


@router.get("/onboarding/ai-status")
async def ai_status(ctx: RequestContext = Depends(get_context)) -> dict:
    """Is there an AI ready to run the interview (and the team)?

    ready     — a connected AI account (Cloud plans need your own key for now)
    reason    — what's missing, in plain words, when not ready
    """
    from omilo.ai.config import has_credits
    from omilo.control.factory import is_local_mode

    def check() -> dict:
        with SessionLocal() as db, db.begin():
            db.execute(text("SET LOCAL ROLE omilo_app"))
            set_company(db, ctx.company_id)
            cfg = resolve(db, ctx.company_id, None)
            credits = has_credits(db, ctx.company_id)
        local = is_local_mode()
        if cfg.pooled and not credits:
            return {"ready": False, "label": cfg.label, "pooled": True, "mode": "cloud",
                    "reason": "Omilo Cloud's AI has no allowance left this month. Connect your own key instead."}
        if cfg.is_fake:
            reason = ("Connect an AI: a Claude or OpenAI key, or Claude Code signed in on this computer." if local
                      else "Connect your company's AI key (Claude, OpenAI or another provider) to start.")
            return {"ready": False, "label": cfg.label, "pooled": False, "mode": "local" if local else "cloud",
                    "reason": reason}
        return {"ready": True, "label": cfg.label, "pooled": cfg.pooled, "mode": "local" if local else "cloud",
                "reason": None}

    return await asyncio.to_thread(check)
