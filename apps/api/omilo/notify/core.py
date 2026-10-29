"""Shared plumbing for notification emails.

- :func:`deliver` — at-most-once send keyed by ``dedupe_key`` (EmailLog row is
  claimed *before* sending).  Never raises: a mail problem must not break the
  request or job that triggered it.
- :func:`dispatch` — run work off the request thread (a small thread pool), or
  inline when :func:`set_sync` is on (tests, CLI).
- :func:`owners`, :func:`wants_email` — who receives company mail, and the
  Control panel → Notifications matrix that can switch a kind off.
- :func:`sign` / :func:`unsign` — HMAC-signed, expiring tokens for one-tap
  links (approve/reject, waitlist unsubscribe).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.notify import EmailLog
from omilo.models.tenancy import Company, Member, User

log = logging.getLogger("omilo.notify")

# ── dispatch ──────────────────────────────────────────────────────────────────

_pool: ThreadPoolExecutor | None = None
_sync = False


def set_sync(on: bool) -> None:
    """Run notification work inline instead of on the thread pool (tests, CLI)."""
    global _sync
    _sync = on


def dispatch(fn: Callable[..., Any], *args: Any) -> None:
    def _safe() -> None:
        try:
            fn(*args)
        except Exception:  # pragma: no cover - defensive; work fns already swallow
            log.exception("notification task %s failed", getattr(fn, "__name__", fn))

    if _sync:
        _safe()
        return
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="omilo-notify")
    _pool.submit(_safe)


# ── delivery ──────────────────────────────────────────────────────────────────

def _smtp_missing(exc: Exception) -> bool:
    return getattr(exc, "status_code", None) == 503


def deliver(*, kind: str, dedupe_key: str, to: str, mail: Any,
            company_id: str | None = None) -> str:
    """Send ``mail`` once per ``dedupe_key``.  Returns sent|duplicate|failed|skipped.

    ``skipped`` means email isn't configured (no SMTP); the claim is released
    so the mail can go out once SMTP is set up.
    """
    from omilo.emails import send

    with SessionLocal() as s, s.begin():
        claimed = s.execute(
            insert(EmailLog)
            .values(id=prefixed_id("eml"), company_id=company_id, kind=kind,
                    dedupe_key=dedupe_key, to_email=to, subject=mail.subject, status="sending")
            .on_conflict_do_nothing(index_elements=["dedupe_key"])
            .returning(EmailLog.id)
        ).scalar()
    if claimed is None:
        return "duplicate"

    status, error = "sent", None
    try:
        send(to, mail)
    except Exception as exc:  # never propagate
        if _smtp_missing(exc):
            status = "skipped"
        else:
            status, error = "failed", str(getattr(exc, "detail", exc))[:500]
            log.warning("%s email to %s failed: %s", kind, to, error)

    with SessionLocal() as s, s.begin():
        row = s.get(EmailLog, claimed)
        if status == "skipped":
            s.delete(row)  # release the claim; retry once SMTP is configured
        else:
            row.status, row.error = status, error
            row.sent_at = datetime.now(timezone.utc) if status == "sent" else None
    return status


def already_sent(s: Session, dedupe_key: str) -> bool:
    return s.execute(select(EmailLog.id).where(EmailLog.dedupe_key == dedupe_key)).first() is not None


# ── recipients + preferences ─────────────────────────────────────────────────

def owners(s: Session, company_id: str) -> list[User]:
    """Owners of the company — the people "You own the … workspace" mail goes to."""
    return list(
        s.execute(
            select(User).join(Member, Member.user_id == User.id)
            .where(Member.company_id == company_id, Member.role == "owner")
            .order_by(Member.created_at)
        ).scalars()
    )


# Control panel → Notifications rows, and their Email default (mirrors the UI).
PREF_DECISION = ("Needs your decision", False)
PREF_FAILURE = ("Flow failed", True)
PREF_WEEKLY = ("Weekly brief", True)


def _matrix_choice(settings: dict | None, label: str) -> bool | None:
    matrix = ((settings or {}).get("notifications") or {}).get("matrix") or []
    for row in matrix:
        if isinstance(row, dict) and row.get("label") == label:
            email = (row.get("channels") or {}).get("email")
            return None if email is None else bool(email)
    return None


def wants_email(company: Company, pref: tuple[str, bool], user: User | None = None) -> bool:
    """Does this person want this email?

    Control panel → Notifications is saved per person (``user.preferences``);
    company settings are the older, company-wide fallback, then the UI default.
    """
    label, default = pref
    if user is not None:
        mine = _matrix_choice(getattr(user, "preferences", None), label)
        if mine is not None:
            return mine
    shared = _matrix_choice(company.settings, label)
    return default if shared is None else shared


def first_name(user: User) -> str:
    return (user.name or user.email.split("@")[0]).split()[0]


def company_tz(company: Company) -> ZoneInfo:
    try:
        return ZoneInfo(company.timezone or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def clock(dt: datetime, tz: ZoneInfo) -> str:
    """'09:14 WIB' — local time with the zone abbreviation."""
    local = dt.astimezone(tz)
    abbr = local.strftime("%Z")
    if abbr.startswith(("+", "-")):  # zones without a letter abbreviation
        abbr = f"UTC{abbr[:3]}"
    return f"{local:%H:%M} {abbr}"


def app_url(path: str = "") -> str:
    return get_settings().frontend_base.rstrip("/") + path


# ── signed tokens ─────────────────────────────────────────────────────────────

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _mac(purpose: str, body: str) -> str:
    key = hashlib.sha256(("omilo-notify:" + get_settings().jwt_secret).encode()).digest()
    return _b64(hmac.new(key, f"{purpose}.{body}".encode(), hashlib.sha256).digest()[:24])


def sign(purpose: str, payload: dict, ttl_s: int) -> str:
    body = _b64(json.dumps({**payload, "exp": int(time.time()) + ttl_s},
                           separators=(",", ":")).encode())
    return f"{body}.{_mac(purpose, body)}"


def unsign(purpose: str, token: str) -> dict | None:
    """Payload if the token is authentic and unexpired, else None."""
    try:
        body, mac = token.rsplit(".", 1)
        if not hmac.compare_digest(mac, _mac(purpose, body)):
            return None
        data = json.loads(_unb64(body))
        return data if data.get("exp", 0) >= time.time() else None
    except Exception:
        return None
