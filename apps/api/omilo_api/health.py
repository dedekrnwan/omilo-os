"""Graduation nudge: tell light-tier users to migrate to Postgres once the knowledge base grows
past a soft threshold.

Public API
----------
GRADUATE_THRESHOLD : int
    Soft row-count limit; a sensible builder may tune this value.
graduate_hint() -> str | None
    Returns a one-line migration message when the install is in the light tier and the total
    number of KbChunk rows across all companies exceeds GRADUATE_THRESHOLD. Returns None in
    the full tier (never nudges) and None below the threshold.
_kb_chunk_total() -> int
    Internal helper that sums kb_chunk rows across all companies. Result is cached for ~300 s
    via the bus KV store so /healthz stays cheap. Any error is treated as 0 (never raises).
"""
from __future__ import annotations

import logging

log = logging.getLogger("omilo.health")

GRADUATE_THRESHOLD = 5000

# Bus cache key (global, not per-company)
_CACHE_KEY = "graduate:kbtotal"
_CACHE_TTL_S = 300


def _kb_chunk_total() -> int:
    """Sum of kb_chunk rows across ALL companies. Cached for _CACHE_TTL_S seconds."""
    from sqlalchemy import func, select

    from . import bus
    from . import company
    from .db import session_scope
    from .models import KbChunk

    # Check the in-process / Redis cache first
    try:
        cached = bus.get_json(_CACHE_KEY, cid="_")  # global key via a sentinel cid
        if cached is not None:
            return int(cached)
    except Exception:  # noqa: BLE001
        pass

    total = 0
    try:
        for _cid in company.each():
            try:
                with session_scope() as s:
                    n = s.scalar(select(func.count()).select_from(KbChunk)) or 0
                    total += n
            except Exception:  # noqa: BLE001 - one broken company must not fail the whole count
                pass
    except Exception:  # noqa: BLE001
        pass

    try:
        bus.set_json(_CACHE_KEY, total, ttl_s=_CACHE_TTL_S, cid="_")
    except Exception:  # noqa: BLE001
        pass

    return total


def graduate_hint() -> str | None:
    """Return a one-line nudge message or None.

    Rules:
    - Full tier: always None (cheap fast path, no DB touch).
    - Light tier below threshold: None.
    - Light tier above threshold: the migration message.
    """
    from .config import get_settings

    if get_settings().tier != "light":
        return None

    if _kb_chunk_total() > GRADUATE_THRESHOLD:
        return (
            "Your knowledge base is outgrowing the light tier — "
            "run `omilo migrate --to postgres` to move to Postgres + pgvector."
        )
    return None
