"""AI usage in tokens — the unit for every AI budget and limit in Omilo.

AI is billed per token: by the company's own provider (bring your own key)
today, by Omilo's AI partner later. So budgets, caps and analytics count
tokens (input + output) from each Job, whichever engine ran it.

    job_tokens(job)                         tokens one job used
    month_start()                           first instant of this UTC month
    tokens_used(db, company_id, since=…,    sum over jobs, optionally per helper
                helper_ids=…, flow_run_ids=…)
    fmt_tokens(n)                           "1,2 jt token" style short label (English: "1.2M tokens")
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from sqlalchemy import func


def job_tokens(job: Any) -> int:
    return int(getattr(job, "tokens_in", 0) or 0) + int(getattr(job, "tokens_out", 0) or 0)


def month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def tokens_used(
    db: Any,
    company_id: str,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    helper_ids: Iterable[str] | None = None,
    flow_run_ids: Iterable[str] | None = None,
) -> int:
    """Tokens (in + out) used by the company's jobs since *since* (default: this month)."""
    from omilo.models.execution import Job

    q = db.query(func.coalesce(func.sum(Job.tokens_in + Job.tokens_out), 0)).filter(
        Job.company_id == company_id,
        Job.created_at >= (since or month_start()),
    )
    if until is not None:
        q = q.filter(Job.created_at < until)
    if helper_ids is not None:
        q = q.filter(Job.helper_id.in_(list(helper_ids)))
    if flow_run_ids is not None:
        ids = list(flow_run_ids)
        if not ids:
            return 0
        q = q.filter(Job.flow_run_id.in_(ids))
    return int(q.scalar() or 0)


def positive_tokens(v: Any) -> int | None:
    """A token limit from settings/JSON — 2000000, "2M", "500k", "2.000.000" — else None (= no limit)."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        n = int(v)
        return n if n > 0 else None
    s = str(v).strip().lower().replace(" ", "").replace("tokens", "").replace("token", "")
    mult = 1
    for suffix, m in (("k", 1_000), ("rb", 1_000), ("m", 1_000_000), ("jt", 1_000_000), ("b", 1_000_000_000)):
        if s.endswith(suffix):
            s, mult = s[: -len(suffix)], m
            break
    try:
        n = int(round(float(s.replace(",", ".")) * mult)) if mult != 1 else int(s.replace(".", "").replace(",", ""))
    except ValueError:
        return None
    return n if n > 0 else None


def fmt_tokens(n: int) -> str:
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}".rstrip("0").rstrip(".") + "M tokens"
    if n >= 1_000:
        return f"{n / 1_000:.1f}".rstrip("0").rstrip(".") + "k tokens"
    return f"{n} tokens"
