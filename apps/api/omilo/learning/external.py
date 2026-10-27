"""omilo.learning.external — Periodic external learning (relevance-gated, offline).

Design
------
A scheduled learning routine calls ``learn_external(db, helper)`` to help a
Helper get smarter from "external" reading — deterministically simulated for
P3 (no real network calls).

Algorithm
---------
1. **Topic selection** — derive candidate topic strings from ``helper.role`` +
   ``helper.job_description`` + the company's active Goals (titles).
   Deterministic: one topic per (role, goal title).

2. **Fetch** — ``_fake_fetch(topic)`` returns a small fixed set of
   ``{url, title, text}`` dicts derived from the topic.  One source whose text
   echoes the topic keywords (relevant); one with unrelated text (irrelevant).
   NO network I/O.

3. **Relevance gate** — ``_relevance_score(source, helper, goals)`` returns a
   float in [0, 1] via keyword overlap between the source text and
   (helper.role + goal titles).  Sources below threshold 0.2 are DROPPED and
   never stored.

4. **Distill & store (kept only)** — for each kept source:
   - ``index_source(db, kind='web', ref=url, …, meta={url, fetched_at, score})``
   - ``remember(db, helper.id, f"Learned: {title} ({url})")``
   Budget-capped: stop after ``budget`` kept sources.

5. **Safety** — this function NEVER creates Proposals, sends messages, or
   executes any side-effecting action.  External content is context only.

Returns
-------
``{"fetched": N, "kept": K, "dropped": D}``
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from omilo.kb.index import index_source
from omilo.memory.store import remember
from omilo.models.workspace import Goal


# ---------------------------------------------------------------------------
# Threshold
# ---------------------------------------------------------------------------

_RELEVANCE_THRESHOLD: float = 0.2


# ---------------------------------------------------------------------------
# Deterministic offline source library
# ---------------------------------------------------------------------------

# Each entry is a (url, title, body_template) tuple.
# The body_template may contain {topic} which is filled with the topic string.
# "relevant" sources contain the topic keywords; "irrelevant" sources do not.

_RELEVANT_SOURCES: list[dict[str, str]] = [
    {
        "url_template": "https://example-learn.com/articles/{slug}/best-practices",
        "title_template": "Best practices for {topic}",
        "text_template": (
            "This guide covers best practices for {topic}. "
            "Organisations that invest in {topic} strategies see measurable "
            "improvements. Key steps include planning, execution, and measurement "
            "of {topic} outcomes. Case studies show that {topic} initiatives "
            "can increase engagement by up to 40% when properly implemented. "
            "Teams responsible for {topic} should align with broader company goals."
        ),
    },
    {
        "url_template": "https://example-learn.com/guides/{slug}/growth-tips",
        "title_template": "{topic}: A Practical Growth Guide",
        "text_template": (
            "Practical growth tips related to {topic}. "
            "When planning a {topic} initiative, start with clear KPIs. "
            "The most successful {topic} programs share common traits: "
            "strong alignment with customer needs, data-driven iteration, "
            "and consistent team focus on {topic} objectives. "
            "Measuring {topic} success requires both quantitative and qualitative metrics."
        ),
    },
]

_IRRELEVANT_SOURCES: list[dict[str, str]] = [
    {
        "url_template": "https://unrelated-news.com/weather/{slug}-forecast",
        "title_template": "Weather forecast for the {slug} region",
        "text_template": (
            "Tomorrow's weather forecast shows partly cloudy skies with a high of 24°C. "
            "Meteorologists predict mild winds from the northwest throughout the morning. "
            "No precipitation is expected. Farmers in the region should plan accordingly "
            "for outdoor activities. The five-day outlook remains stable with minimal "
            "changes to temperature and humidity levels."
        ),
    },
]


def _slugify(text: str) -> str:
    """Convert topic to a URL-safe slug for use in fake URLs."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40]


def _fake_fetch(topic: str) -> list[dict[str, Any]]:
    """Return a deterministic list of fake {url, title, text} sources for a topic.

    Always returns at least one relevant source (text echoes topic keywords)
    and one irrelevant source (unrelated content).  No network I/O.

    Parameters
    ----------
    topic: Topic string derived from helper role or goal title.

    Returns
    -------
    list of dicts with keys: url, title, text
    """
    slug = _slugify(topic)
    sources: list[dict[str, Any]] = []

    # Relevant source (echoes the topic)
    for tmpl in _RELEVANT_SOURCES:
        sources.append(
            {
                "url": tmpl["url_template"].format(slug=slug),
                "title": tmpl["title_template"].format(topic=topic),
                "text": tmpl["text_template"].format(topic=topic),
            }
        )

    # Irrelevant sources (no topic content)
    for tmpl in _IRRELEVANT_SOURCES:
        sources.append(
            {
                "url": tmpl["url_template"].format(slug=slug),
                "title": tmpl["title_template"].format(slug=slug),
                "text": tmpl["text_template"],
            }
        )

    return sources


# ---------------------------------------------------------------------------
# Relevance gate
# ---------------------------------------------------------------------------

_STOPWORDS: frozenset[str] = frozenset(
    {
        # common English function words — these appear in both relevant and
        # irrelevant text and add noise to the keyword-overlap score
        "the", "and", "for", "with", "that", "this", "from", "are", "was",
        "has", "have", "had", "its", "can", "but", "not", "all", "one",
        "when", "they", "both", "each", "also", "our", "their", "which",
        "been", "more", "into", "out", "than", "some", "most", "per",
        "see", "key", "new", "any", "how", "what", "who", "where", "such",
    }
)


def _tokenize(text: str) -> set[str]:
    """Extract meaningful lowercase alphabetic tokens (length >= 4, no stopwords)."""
    return {
        w
        for w in re.findall(r"[a-z]{4,}", text.lower())
        if w not in _STOPWORDS
    }


def _relevance_score(
    source: dict[str, Any],
    helper: Any,
    goals: list[Any],
) -> float:
    """Deterministic relevance score via keyword overlap.

    Computes Jaccard-like overlap between the source text tokens and the
    union of tokens from (helper.role + helper.job_description + goal titles).

    Returns a float in [0, 1].  0.0 if either set is empty.

    Parameters
    ----------
    source: dict with at least 'text' key.
    helper: Helper ORM object (has .role, .job_description attributes).
    goals:  List of Goal ORM objects (each has .title).
    """
    # Build the "query" token set from helper context + goals
    context_parts: list[str] = []
    if helper.role:
        context_parts.append(helper.role)
    if helper.job_description:
        context_parts.append(helper.job_description)
    for g in goals:
        if g.title:
            context_parts.append(g.title)

    context_tokens = _tokenize(" ".join(context_parts))
    # Score on body text only — titles often contain slug/topic echoes that
    # inflate the score for irrelevant sources (especially templated ones).
    source_tokens = _tokenize(source.get("text", ""))

    if not context_tokens or not source_tokens:
        return 0.0

    # Overlap = |intersection| / |context_tokens| (recall-oriented)
    overlap = context_tokens & source_tokens
    return len(overlap) / len(context_tokens)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def learn_external(
    db: Session,
    helper: Any,
    *,
    budget: int = 3,
) -> dict[str, int]:
    """Relevance-gated external learning for a Helper (offline/deterministic).

    Company-scoped: uses the tenant db session (RLS GUC already set by caller).
    Never creates Proposals or any side-effecting action — context only.

    Parameters
    ----------
    db:     Tenant-scoped SQLAlchemy Session (RLS set to helper's company).
    helper: Helper ORM object (must have .id, .role, .job_description).
    budget: Maximum number of sources to keep per run (default 3).

    Returns
    -------
    dict with keys:
        fetched: total sources fetched (before filtering)
        kept:    sources that passed the relevance gate and were stored
        dropped: sources that failed the relevance gate (not stored)
    """
    # ── 1. Topic selection ─────────────────────────────────────────────────────
    topics: list[str] = []

    # Role is always a topic
    if helper.role:
        topics.append(helper.role)

    # Company's active goals (RLS-scoped automatically)
    goals = db.query(Goal).filter_by(status="active").all()
    for goal in goals:
        if goal.title:
            topics.append(goal.title)

    # ── 2. Fetch + gate + store ────────────────────────────────────────────────
    fetched_count = 0
    kept_count = 0
    dropped_count = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    seen_urls: set[str] = set()

    for topic in topics:
        if kept_count >= budget:
            break

        sources = _fake_fetch(topic)
        fetched_count += len(sources)

        for source in sources:
            url = source["url"]

            # Deduplicate across topics
            if url in seen_urls:
                fetched_count -= 1  # Don't double-count seen duplicates
                continue
            seen_urls.add(url)

            # ── 3. Relevance gate ───────────────────────────────────────────────
            score = _relevance_score(source, helper, goals)

            if score < _RELEVANCE_THRESHOLD:
                # DROP — not stored
                dropped_count += 1
                continue

            # ── 4. Budget check ─────────────────────────────────────────────────
            if kept_count >= budget:
                # Over budget — treat remaining as dropped to preserve accuracy
                dropped_count += 1
                continue

            # ── 5. Distill & store ──────────────────────────────────────────────
            index_source(
                db,
                kind="web",
                ref=url,
                title=source["title"],
                body=source["text"],
                helper_id=helper.id,
                meta={
                    "url": url,
                    "fetched_at": now_iso,
                    "score": round(score, 4),
                    "topic": topic,
                },
            )

            remember(
                db,
                helper.id,
                f"Learned: {source['title']} ({url})",
            )

            kept_count += 1

    return {
        "fetched": fetched_count,
        "kept": kept_count,
        "dropped": dropped_count,
    }
