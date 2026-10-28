"""One-time code / token helpers for the email-based auth flows.

Codes are numeric (6-digit) for human entry (email verify, magic sign-in,
two-factor); tokens are long url-safe strings for links (password reset,
invites).  Only sha256 hex digests are stored — never the raw value.

All functions take an open privileged ``Session`` and do NOT commit; the caller
owns the transaction.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from omilo.models.auth_codes import AuthCode
from omilo.models.base import prefixed_id


def hash_secret(raw: str) -> str:
    """sha256 hex digest of a raw code/token."""
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_numeric_code(digits: int = 6) -> str:
    """A zero-padded cryptographically-random numeric code."""
    return str(secrets.randbelow(10**digits)).zfill(digits)


def generate_url_token(nbytes: int = 32) -> str:
    """A url-safe random token for emailed links."""
    return secrets.token_urlsafe(nbytes)


def issue_code(
    session: Session,
    *,
    email: str,
    purpose: str,
    user_id: str | None = None,
    ttl_minutes: int = 10,
    raw: str | None = None,
) -> tuple[AuthCode, str]:
    """Create a fresh AuthCode, invalidating prior unconsumed ones of the same
    (email, purpose).  Returns (row, raw_value).  ``raw`` lets the caller supply
    a token (links) instead of the default numeric code.
    """
    now = datetime.now(timezone.utc)
    # One live code per (email, purpose): consume the older ones.
    session.query(AuthCode).filter(
        AuthCode.email == email,
        AuthCode.purpose == purpose,
        AuthCode.consumed_at.is_(None),
    ).update({AuthCode.consumed_at: now}, synchronize_session=False)

    value = raw if raw is not None else generate_numeric_code()
    row = AuthCode(
        id=prefixed_id("acd"),
        email=email,
        user_id=user_id,
        purpose=purpose,
        code_hash=hash_secret(value),
        expires_at=now + timedelta(minutes=ttl_minutes),
    )
    session.add(row)
    return row, value


def verify_code(
    session: Session,
    *,
    email: str,
    purpose: str,
    code: str,
) -> AuthCode | None:
    """Verify a numeric code addressed by (email, purpose).

    On success: marks the row consumed and returns it.
    On mismatch: increments ``attempts`` and returns None.
    On missing/expired/over-attempt: returns None.
    """
    now = datetime.now(timezone.utc)
    row = (
        session.query(AuthCode)
        .filter(
            AuthCode.email == email,
            AuthCode.purpose == purpose,
            AuthCode.consumed_at.is_(None),
        )
        .order_by(AuthCode.created_at.desc())
        .first()
    )
    if row is None or not row.is_usable(now):
        return None
    if not secrets.compare_digest(row.code_hash, hash_secret(code)):
        row.attempts += 1
        return None
    row.consumed_at = now
    return row


def verify_token(
    session: Session,
    *,
    purpose: str,
    token: str,
) -> AuthCode | None:
    """Verify a link token addressed by the token itself (no email in the link).

    On success: marks consumed and returns the row.  Else None.
    """
    now = datetime.now(timezone.utc)
    row = (
        session.query(AuthCode)
        .filter(
            AuthCode.purpose == purpose,
            AuthCode.code_hash == hash_secret(token),
            AuthCode.consumed_at.is_(None),
        )
        .first()
    )
    if row is None or not row.is_usable(now):
        return None
    row.consumed_at = now
    return row
