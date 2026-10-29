"""Sign-in session tracking (sweep/control).

Access tokens are stateless JWTs.  To let people see their devices and sign
one out, every issued token carries a ``sid`` claim and a ``UserSession``
row; ``get_current_user`` rejects tokens whose session was revoked.

Request metadata (User-Agent, client IP) for the session row is captured by a
tiny middleware into a contextvar, so ``make_access_token`` call sites don't
need to pass the request around.
"""
from __future__ import annotations

import contextvars
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

_request_meta: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "omilo_request_meta", default=None
)

# last_seen_at is refreshed at most this often (avoid a write per request).
LAST_SEEN_THROTTLE = timedelta(minutes=5)


def set_request_meta(user_agent: str | None, ip: str | None) -> contextvars.Token:
    return _request_meta.set({"user_agent": user_agent, "ip": ip})


def reset_request_meta(token: contextvars.Token) -> None:
    _request_meta.reset(token)


async def request_meta_middleware(request, call_next):  # type: ignore[no-untyped-def]
    """Starlette HTTP middleware: remember UA + IP for session rows."""
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or (
        request.client.host if request.client else None
    )
    tok = set_request_meta(request.headers.get("user-agent"), ip)
    try:
        return await call_next(request)
    finally:
        reset_request_meta(tok)


def create_session_row(
    sid: str,
    user_id: str,
    company_id: str | None,
    expires_at: datetime,
    method: str | None = None,
) -> None:
    """Insert the UserSession row for a freshly issued token. Never raises."""
    try:
        from omilo.db import SessionLocal
        from omilo.models.control import UserSession

        meta = _request_meta.get() or {}
        with SessionLocal() as session:
            with session.begin():
                session.add(
                    UserSession(
                        id=sid,
                        user_id=user_id,
                        company_id=company_id,
                        method=method,
                        user_agent=(meta.get("user_agent") or None),
                        ip=(meta.get("ip") or None),
                        last_seen_at=datetime.now(timezone.utc),
                        expires_at=expires_at,
                    )
                )
    except Exception as exc:  # pragma: no cover — tracking is best-effort
        logger.warning("session row insert failed for user %s: %s", user_id, exc)


def check_session(session, sid: str | None) -> bool:  # type: ignore[no-untyped-def]
    """Return False when ``sid`` names a revoked session; bump last_seen_at.

    Tokens without a ``sid`` (issued before session tracking) and sids with no
    row are accepted — tracking must never lock people out.
    """
    if not sid:
        return True
    from omilo.models.control import UserSession

    row = session.get(UserSession, sid)
    if row is None:
        return True
    if row.revoked_at is not None:
        return False
    now = datetime.now(timezone.utc)
    last = row.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is None or now - last > LAST_SEEN_THROTTLE:
        row.last_seen_at = now
    return True
