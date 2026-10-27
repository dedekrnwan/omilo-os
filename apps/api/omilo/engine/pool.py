"""
omilo.engine.pool — Account pool selection and lifecycle helpers.

Provides:
    WARN_THRESHOLD     int — pct_window percentage above which an account is near_limit.
    select_account     DB query: pick the LRU ready account with headroom.
    mark_limited       Transition an account to cooling with a cooldown_until timestamp.
    classify           Pure helper: derive status label from pct_window.

All logic is unit-testable with seeded HarnessAccount rows; no real CLI calls.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from omilo.models.accounts import HarnessAccount

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WARN_THRESHOLD: int = 85          # pct_window % at/above which an account is near_limit
COOLDOWN_DURATION: timedelta = timedelta(hours=1)  # default cooldown window


# ---------------------------------------------------------------------------
# classify — pure helper
# ---------------------------------------------------------------------------


def classify(account: HarnessAccount) -> str:
    """Derive the logical status for an account from its pct_window.

    This is used by POST /v1/ai-accounts/check to reclassify accounts whose
    utilisation has changed since they were last refreshed.

    Rules:
        - status in ("cooling", "error")             → unchanged (cooling/error)
        - pct_window >= WARN_THRESHOLD                → "near_limit"
        - otherwise                                   → "ready"
    """
    if account.status in ("cooling", "error"):
        return account.status
    if account.pct_window >= WARN_THRESHOLD:
        return "near_limit"
    return "ready"


# ---------------------------------------------------------------------------
# select_account — LRU pool selection
# ---------------------------------------------------------------------------


def select_account(
    db: Session,
    *,
    company_id: str,
    harness: str,
) -> HarnessAccount | None:
    """Pick the best eligible account from the pool for the given harness.

    Eligibility rules (in priority order):
        1. status == "ready" AND pct_window < WARN_THRESHOLD  (primary pool)
        2. Among eligible accounts, select the one with the oldest last_used_at
           (LRU); accounts with last_used_at=None are treated as never-used
           and are most eligible.
        3. Accounts with status in ("cooling", "error") are never picked.
        4. Accounts with pct_window >= WARN_THRESHOLD are near_limit — skipped
           for primary selection; if NO primary account has headroom, return
           None (defer) rather than picking a near_limit as last resort.
           (The spec says near_limit CAN be used as last resort but defaults to
           None/defer per the brief's "default: return None (defer)".)

    Returns:
        HarnessAccount if an eligible account exists, else None.
    """
    # Primary pool: ready + below threshold
    # Use Python ordering because last_used_at=None must sort as "oldest" (smallest)
    candidates = (
        db.query(HarnessAccount)
        .filter(
            HarnessAccount.company_id == company_id,
            HarnessAccount.harness == harness,
            HarnessAccount.status == "ready",
            HarnessAccount.pct_window < WARN_THRESHOLD,
        )
        .all()
    )

    if not candidates:
        return None

    # LRU: None last_used_at → most eligible (treat as epoch 0)
    def _lru_key(acc: HarnessAccount):
        if acc.last_used_at is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        ts = acc.last_used_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts

    candidates.sort(key=_lru_key)
    return candidates[0]


# ---------------------------------------------------------------------------
# mark_limited — reactive hard-limit handler
# ---------------------------------------------------------------------------


def mark_limited(db: Session, account: HarnessAccount) -> None:
    """Transition an account to cooling with a cooldown_until timestamp.

    Sets:
        account.status        = "cooling"
        account.cooldown_until = now + COOLDOWN_DURATION

    The caller is responsible for committing the transaction (this function
    mutates the ORM object; the caller's session.begin() context manager
    commits on exit).
    """
    now = datetime.now(timezone.utc)
    account.status = "cooling"
    account.cooldown_until = now + COOLDOWN_DURATION
    db.flush()
