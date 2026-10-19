"""Self-tuning harness: AI seam and candidate-job proposal for helper self-improvement."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass

from sqlalchemy.orm import Session

log = logging.getLogger("omilo.tune")

from .config import get_settings
from .engines import ChatContext, get_engine
from .models import Staff
from .security import decrypt

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
DEFAULT_K = 2
TUNE_MAX_PER_WEEK = 2

# ---------------------------------------------------------------------------
# AI seam — the single engine call all tune functions go through
# ---------------------------------------------------------------------------

async def _ask_json(db: Session, staff: Staff, system: str, user: str) -> dict:
    """Run one engine chat call with a synthetic context; return the first JSON object
    from the result text, or {} on any parse failure. This is the stub seam for tests."""
    mcp_url = get_settings().mcp_url()
    mcp_token = decrypt(staff.mcp_token_enc)
    ctx = ChatContext(
        staff_id=staff.id,
        staff_name=staff.name,
        job=system,
        is_chief=staff.is_chief,
        thread_id="tune",
        scope="staff",
        history=[{"role": "owner", "text": user}],
        context_note="",
        mcp_url=mcp_url,
        mcp_token=mcp_token,
        engine_config=staff.engine or {},
        emit=lambda kind, **d: None,
        resources=None,
        shared=True,
    )
    try:
        res = await get_engine(ctx.engine_config).chat(ctx)
        text = res.text or ""
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            return json.loads(m.group(0))
    except Exception as e:  # noqa: BLE001
        log.warning("tune._ask_json failed: %s", e)
    return {}

# ---------------------------------------------------------------------------
# propose — K candidate full rewrites of a helper's job description
# ---------------------------------------------------------------------------

async def propose(db: Session, staff: Staff, k: int = DEFAULT_K) -> list[str]:
    """Return up to *k* candidate full-rewrite strings of *staff.job* (never the current job)."""
    system = (
        "You are a job-description improvement expert. "
        "Given the helper's current job description, generate fresh full rewrites. "
        'Return ONLY a JSON object: {"candidates": ["<rewrite 1>", "<rewrite 2>", ...]}'
    )
    user = (
        f"Current job description:\n{staff.job}\n\n"
        f"Write {k + 2} distinct full rewrites. "
        'Return JSON: {"candidates": [...]}'
    )
    data = await _ask_json(db, staff, system, user)
    candidates = data.get("candidates") or []
    current = (staff.job or "").strip()
    result: list[str] = []
    for c in candidates:
        if not isinstance(c, str):
            continue
        c = c.strip()
        if not c or c == current:
            continue
        result.append(c)
        if len(result) >= k:
            break
    return result


# ---------------------------------------------------------------------------
# ProbeResult — result of running a brief under one candidate job description
# ---------------------------------------------------------------------------

@dataclass
class ProbeResult:
    job: str
    text: str
    tokens: int
    cost_usd: float
    error: str


# ---------------------------------------------------------------------------
# probe — run a brief once per candidate job description, errors don't abort
# ---------------------------------------------------------------------------

async def compose(db: Session, staff: Staff, brief: str, probes: list[ProbeResult]) -> int:
    """Ask the AI judge to pick the winning probe; falls back to index 0 on any invalid reply.

    Builds a numbered list of each probe's output text, asks ``_ask_json`` for
    ``{"winner": <index>, "why": <str>}``, coerces the winner to int, and returns it
    only when ``0 <= winner < len(probes)`` AND that probe has no ``error``.
    Any malformed reply, out-of-range index, or errored probe falls back to 0.
    """
    numbered = "\n".join(
        f"[{i}] {p.text}" for i, p in enumerate(probes)
    )
    system = (
        "You are an expert evaluator of AI assistant outputs. "
        "Given a task brief and numbered candidate responses, choose the best one. "
        'Return ONLY a JSON object: {"winner": <index>, "why": "<reason>"}'
    )
    user = (
        f"Task brief:\n{brief}\n\n"
        f"Candidate responses:\n{numbered}\n\n"
        'Return JSON: {"winner": <index>, "why": "<reason>"}'
    )
    data = await _ask_json(db, staff, system, user)
    try:
        winner = int(data["winner"])
    except (TypeError, ValueError, KeyError):
        return 0
    if winner < 0 or winner >= len(probes):
        return 0
    if probes[winner].error:
        return 0
    return winner


async def probe(db: Session, staff: Staff, brief: str, jobs: list[str]) -> list[ProbeResult]:
    """Run *brief* under each candidate job description; return one ProbeResult per job in
    the same order. A run that raises or returns EngineResult.error yields a ProbeResult
    with that error and empty text — the batch never aborts."""
    mcp_url = get_settings().mcp_url()
    mcp_token = decrypt(staff.mcp_token_enc)
    results: list[ProbeResult] = []
    for job in jobs:
        ctx = ChatContext(
            staff_id=staff.id,
            staff_name=staff.name,
            job=job,
            is_chief=staff.is_chief,
            thread_id="tune",
            scope="staff",
            history=[{"role": "owner", "text": brief}],
            context_note="",
            mcp_url=mcp_url,
            mcp_token=mcp_token,
            engine_config=staff.engine or {},
            emit=lambda kind, **d: None,
            resources=None,
            shared=True,
        )
        try:
            res = await asyncio.wait_for(get_engine(ctx.engine_config).chat(ctx), timeout=600)
            if res.error:
                results.append(ProbeResult(job=job, text="", tokens=res.tokens, cost_usd=res.cost_usd, error=res.error))
            else:
                results.append(ProbeResult(job=job, text=res.text, tokens=res.tokens, cost_usd=res.cost_usd, error=""))
        except Exception as e:  # noqa: BLE001
            log.warning("tune.probe failed for job %r: %s", job, e)
            results.append(ProbeResult(job=job, text="", tokens=0, cost_usd=0.0, error=f"{type(e).__name__}: {e}"))
    return results
