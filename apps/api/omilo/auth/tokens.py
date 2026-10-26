"""JWT token creation and decoding.

JWT claims: sub=user_id, cmp=company_id, role, exp.
Algorithm: HS256 with Settings.jwt_secret.
TTL: Settings.jwt_access_ttl_s.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import PyJWTError

from omilo.config import get_settings


def make_access_token(user_id: str, company_id: str, role: str) -> tuple[str, datetime]:
    """Sign and return (token, expires_at) for the given user/company/role.

    Args:
        user_id:    The user's id (sub claim).
        company_id: The active company (cmp claim).
        role:       The member's role in that company.

    Returns:
        (access_token, expires_at) — expires_at is a UTC-aware datetime.
    """
    settings = get_settings()
    now = datetime.now(tz=timezone.utc)
    expires_at = now + timedelta(seconds=settings.jwt_access_ttl_s)
    payload = {
        "sub": user_id,
        "cmp": company_id,
        "role": role,
        "exp": expires_at,
        "iat": now,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    return token, expires_at


def decode_token(token: str) -> dict:
    """Decode and validate a JWT access token.

    Returns the decoded claims dict.
    Raises jwt.PyJWTError (including ExpiredSignatureError) on any failure.
    """
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
