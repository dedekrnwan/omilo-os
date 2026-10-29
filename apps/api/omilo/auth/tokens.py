"""JWT token creation and decoding.

JWT claims: sub=user_id, cmp=company_id, role, exp.

Default algorithm: HS256 with Settings.jwt_secret (existing behavior preserved).
RS256 (optional): when OMILO_JWT_PRIVATE_KEY / OMILO_JWT_PUBLIC_KEY is set,
encode() signs RS256 and decode_token() verifies RS256 ONLY — no HS256 fallback.
Accepting exactly one algorithm per configuration eliminates JWT algorithm-confusion
attacks (an HS256-forged token is rejected when RS256 is configured).

JWKS: get_jwks() returns the RS256 public key as a JWKS dict when configured,
else {"keys": []}.
"""
from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from jwt.exceptions import PyJWTError

from omilo.config import get_settings


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _kid_from_public_pem(public_pem: str) -> str:
    """Derive a stable key-id from the SHA-256 of the public PEM bytes."""
    digest = hashlib.sha256(public_pem.encode()).hexdigest()
    return digest[:16]


def _b64url_uint(n: int) -> str:
    """Encode a big integer as base64url (for JWK n/e fields)."""
    byte_length = (n.bit_length() + 7) // 8
    raw = n.to_bytes(byte_length, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def make_access_token(
    user_id: str,
    company_id: str,
    role: str,
    ttl_s: int | None = None,
    method: str | None = None,
) -> tuple[str, datetime]:
    """Sign and return (token, expires_at) for the given user/company/role.

    When OMILO_JWT_PRIVATE_KEY is configured → signs with RS256 (kid header set).
    Otherwise → HS256 with jwt_secret (default, existing behavior unchanged).

    Args:
        user_id:    The user's id (sub claim).
        company_id: The active company (cmp claim).
        role:       The member's role in that company.
        ttl_s:      Optional access-token lifetime in seconds. Defaults to
                    ``Settings.jwt_access_ttl_s`` (the short session TTL). Pass a
                    larger value for "keep me signed in" (e.g. 30 days).
        method:     How the person signed in (password | google | …); stored
                    on the tracked sign-in session (sweep/control).

    Returns:
        (access_token, expires_at) — expires_at is a UTC-aware datetime.
    """
    settings = get_settings()
    now = datetime.now(tz=timezone.utc)
    ttl = settings.jwt_access_ttl_s if ttl_s is None else ttl_s
    expires_at = now + timedelta(seconds=ttl)
    # sweep/control — every token gets a session id (devices list / sign out).
    from omilo.models.base import prefixed_id

    sid = prefixed_id("usn")
    payload = {
        "sub": user_id,
        "cmp": company_id,
        "role": role,
        "exp": expires_at,
        "iat": now,
        "sid": sid,
    }

    private_key_pem: str | None = getattr(settings, "omilo_jwt_private_key", None)
    public_key_pem: str | None = getattr(settings, "omilo_jwt_public_key", None)

    if private_key_pem:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        private_key = load_pem_private_key(private_key_pem.encode(), password=None)
        kid = _kid_from_public_pem(public_key_pem or private_key_pem)
        token = jwt.encode(
            payload,
            private_key,  # type: ignore[arg-type]
            algorithm="RS256",
            headers={"kid": kid},
        )
    else:
        token = jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

    from omilo.auth.sessions import create_session_row

    create_session_row(sid, user_id, company_id, expires_at, method=method)
    return token, expires_at


def _rs256_enabled() -> bool:
    """Return True when at least one RS256 key (private or public) is configured."""
    settings = get_settings()
    return bool(
        getattr(settings, "omilo_jwt_private_key", None)
        or getattr(settings, "omilo_jwt_public_key", None)
    )


def decode_token(token: str) -> dict:
    """Decode and validate a JWT access token.

    The accepted algorithm is UNAMBIGUOUS based on configuration:
    - RS256 key configured → RS256 ONLY, no HS256 fallback (prevents algorithm-confusion).
    - No RS256 key configured → HS256 only (default / dev behavior unchanged).

    Returns the decoded claims dict.
    Raises jwt.PyJWTError (including ExpiredSignatureError) on any failure.
    """
    settings = get_settings()
    public_key_pem: str | None = getattr(settings, "omilo_jwt_public_key", None)

    if _rs256_enabled():
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        # Public key may not be set when only the private key is present;
        # derive it from the private key in that case.
        if public_key_pem:
            public_key = load_pem_public_key(public_key_pem.encode())
        else:
            from cryptography.hazmat.primitives.serialization import (
                load_pem_private_key,
            )
            private_key_pem: str = getattr(settings, "omilo_jwt_private_key")
            public_key = load_pem_private_key(private_key_pem.encode(), password=None).public_key()
        # RS256 ONLY — no HS256 fallback; an HS256-forged token is rejected here.
        return jwt.decode(token, public_key, algorithms=["RS256"])  # type: ignore[arg-type]
    else:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])


def get_jwks() -> dict:
    """Return the RS256 public key as a JWKS dict, or {"keys": []} if not configured.

    The returned structure is a JSON Web Key Set (JWKS) compatible with the
    standard RFC 7517 format.  Usable by remote clients to verify JWTs offline.

    Returns:
        {"keys": [{kty, n, e, kid, alg, use}]} or {"keys": []} if no RS key set.
    """
    settings = get_settings()
    public_key_pem: str | None = getattr(settings, "omilo_jwt_public_key", None)
    private_key_pem: str | None = getattr(settings, "omilo_jwt_private_key", None)

    # Try public key first, then derive from private
    pem_to_use = public_key_pem
    if not pem_to_use and private_key_pem:
        # Derive public key from private
        from cryptography.hazmat.primitives.serialization import (
            load_pem_private_key,
            Encoding,
            PublicFormat,
        )
        priv = load_pem_private_key(private_key_pem.encode(), password=None)
        pem_to_use = priv.public_key().public_bytes(
            encoding=Encoding.PEM,
            format=PublicFormat.SubjectPublicKeyInfo,
        ).decode()

    if not pem_to_use:
        return {"keys": []}

    from cryptography.hazmat.primitives.serialization import load_pem_public_key
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

    public_key = load_pem_public_key(pem_to_use.encode())
    if not isinstance(public_key, RSAPublicKey):
        return {"keys": []}

    # `public_key` is already an RSAPublicKey — call public_numbers() directly.
    # (RSAPublicKey has no .public_key() method; only private keys do.)
    pub_numbers = public_key.public_numbers()
    kid = _kid_from_public_pem(pem_to_use)

    return {
        "keys": [
            {
                "kty": "RSA",
                "alg": "RS256",
                "use": "sig",
                "kid": kid,
                "n": _b64url_uint(pub_numbers.n),
                "e": _b64url_uint(pub_numbers.e),
            }
        ]
    }
