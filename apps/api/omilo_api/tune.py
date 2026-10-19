"""Self-tuning harness: AI seam and candidate-job proposal for helper self-improvement."""
from __future__ import annotations

import json
import re

from sqlalchemy.orm import Session

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
    except Exception:  # noqa: BLE001
        pass
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
