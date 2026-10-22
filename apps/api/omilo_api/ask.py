"""Cross-surface retrieval for the ⌘K "Ask" command palette.

Gathers candidate answer-sources from four surfaces:
  - KB (knowledge base: docs, notes, files, jobs, chats, …)
  - Inbox (open InboxItems whose title/body match the query)
  - Plan (active Goals whose title/target match the query)
  - Docs (vault documents via docs.search)

Each hit is normalised into a ``Source`` TypedDict, merged, sorted by score
descending, and capped at *k*.

Each surface read is independently guarded in its own try/except, so a failing
surface never prevents the others from returning results.
"""
from __future__ import annotations

import logging
import re
import time
from typing import TypedDict

logger = logging.getLogger(__name__)

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from .engines import ChatContext, get_engine  # noqa: E402


class Source(TypedDict):
    title: str
    ref: str
    url: str | None
    surface: str   # "kb" | "inbox" | "plan" | "docs"
    score: float
    text: str


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _matches(q: str, *fields: str) -> bool:
    """Return True when at least one word from *q* appears in any of *fields*."""
    words = [w.lower() for w in re.split(r"\W+", q) if w]
    if not words:
        return True
    haystack = " ".join(f.lower() for f in fields)
    return any(w in haystack for w in words)


def _keyword_score(q: str, *fields: str) -> float:
    """Simple word-overlap score: fraction of query words present in fields."""
    words = [w.lower() for w in re.split(r"\W+", q) if w]
    if not words:
        return 0.0
    haystack = " ".join(f.lower() for f in fields)
    matched = sum(1 for w in words if w in haystack)
    return matched / len(words)


# ---------------------------------------------------------------------------
# Surface readers
# ---------------------------------------------------------------------------

def _kb_sources(db: Session, q: str, k: int) -> list[Source]:
    from . import kb

    result = kb.search(db, q, k, via="ask", log_it=False)
    out: list[Source] = []
    for r in result.get("results", []):
        out.append(Source(
            title=r.get("title") or "",
            ref=r.get("ref") or "",
            url=r.get("url"),
            surface="kb",
            score=float(r.get("score") or 0.0),
            text=r.get("text") or "",
        ))
    return out


def _inbox_sources(db: Session, q: str) -> list[Source]:
    from .models import InboxItem

    items = list(db.scalars(select(InboxItem).where(InboxItem.status == "open")))
    out: list[Source] = []
    for item in items:
        body = item.body or item.title
        if not _matches(q, item.title, body):
            continue
        score = _keyword_score(q, item.title, body)
        out.append(Source(
            title=item.title,
            ref=item.id,
            url=None,
            surface="inbox",
            score=score,
            text=body,
        ))
    return out


def _plan_sources(db: Session, q: str) -> list[Source]:
    from . import plan

    goals = plan.goals_for_prompt(db)
    out: list[Source] = []
    for g in goals:
        title = g.get("title") or ""
        target = g.get("target") or ""
        if not _matches(q, title, target):
            continue
        score = _keyword_score(q, title, target)
        out.append(Source(
            title=title,
            ref=g.get("id") or "",
            url=None,
            surface="plan",
            score=score,
            text=target or title,
        ))
    return out


def _docs_sources(db: Session, q: str, k: int) -> list[Source]:
    from . import docs

    hits = docs.search(db, q, limit=k)
    out: list[Source] = []
    for h in hits:
        score = float(h.get("score") or 0.0)
        # docs.search returns integer word-count scores; normalise to 0–1
        # by scaling with a reasonable cap so they're comparable to inbox/plan.
        # A score of 10 (e.g. keyword appears twice in title) maps to ~0.8.
        normalised = min(score / 12.0, 1.0) if score > 0 else 0.0
        out.append(Source(
            title=h.get("title") or "",
            ref=h.get("path") or "",
            url=None,
            surface="docs",
            score=normalised,
            text=h.get("snippet") or "",
        ))
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def retrieve(db: Session, q: str, k: int = 8) -> list[Source]:
    """Query all four surfaces and return the top-*k* Sources by score desc.

    Each surface is read independently; a failure in one surface is silently
    swallowed so the others still contribute results.
    """
    all_sources: list[Source] = []

    try:
        all_sources.extend(_kb_sources(db, q, k))
    except Exception:  # noqa: BLE001
        logger.debug("ask retrieve: kb failed", exc_info=True)

    try:
        all_sources.extend(_inbox_sources(db, q))
    except Exception:  # noqa: BLE001
        logger.debug("ask retrieve: inbox failed", exc_info=True)

    try:
        all_sources.extend(_plan_sources(db, q))
    except Exception:  # noqa: BLE001
        logger.debug("ask retrieve: plan failed", exc_info=True)

    try:
        all_sources.extend(_docs_sources(db, q, k))
    except Exception:  # noqa: BLE001
        logger.debug("ask retrieve: docs failed", exc_info=True)

    all_sources.sort(key=lambda s: s["score"], reverse=True)
    return all_sources[:k]


# ---------------------------------------------------------------------------
# answer — grounded chat over retrieved sources (Task 2)
# ---------------------------------------------------------------------------

class NoEngineError(Exception):
    """Raised when no usable engine config is available for the company."""


def _render_sources(sources: list[Source]) -> str:
    """Render sources into a grounding block appended to the owner message."""
    if not sources:
        return ""
    lines = ["\n\n[Context — retrieved sources]\n"]
    for i, s in enumerate(sources, 1):
        lines.append(f"[{i}] {s['title']} ({s['surface']}): {s['text'][:400]}")
    return "\n".join(lines)


async def answer(db: Session, q: str) -> dict:
    """Retrieve sources, build a synthetic ChatContext, call the engine, return a grounded answer.

    Returns::

        {"answer": str, "sources": list[Source], "tokens": int, "cost_usd": float, "ms": int}

    Raises ``NoEngineError`` when no usable engine config can be resolved so the
    HTTP route can map it cleanly to a 503.
    """
    from . import services as S
    from .config import get_settings
    from .security import decrypt

    # --- Resolve the engine config the same way tune.py does: use the Chief of Staff ---
    staff = S.chief(db)
    engine_config: dict = (staff.engine or {}) if staff else {}

    if not engine_config or not engine_config.get("type"):
        raise NoEngineError("No AI engine configured for this company")

    mcp_url = get_settings().mcp_url()
    mcp_token = decrypt(staff.mcp_token_enc) if staff and staff.mcp_token_enc else None

    # --- Retrieve grounding sources ---
    sources = retrieve(db, q)

    # --- Build the grounded owner message ---
    grounded_text = q + _render_sources(sources)

    ctx = ChatContext(
        staff_id=staff.id if staff else "ask",
        staff_name=staff.name if staff else "Assistant",
        job="You are a helpful assistant. Answer the user's question based on the provided context.",
        is_chief=True,
        thread_id="ask",
        scope="staff",
        history=[{"role": "owner", "text": grounded_text}],
        context_note="",
        mcp_url=mcp_url,
        mcp_token=mcp_token,
        engine_config=engine_config,
        emit=lambda kind, **d: None,
        resources=None,
        shared=True,
    )

    t0 = time.monotonic()
    try:
        res = await get_engine(engine_config).chat(ctx)
    except Exception as exc:  # noqa: BLE001
        raise NoEngineError(f"Engine unavailable: {exc}") from exc
    elapsed_ms = int((time.monotonic() - t0) * 1000)

    if res.error:
        raise NoEngineError(f"Engine returned an error: {res.error}")

    return {
        "answer": res.text,
        "sources": list(sources),
        "tokens": res.tokens,
        "cost_usd": res.cost_usd,
        "ms": elapsed_ms,
    }
