"""Encrypt AI-account credentials at rest.

``HarnessAccount.token_enc`` used to hold the raw API key. New writes are
Fernet-encrypted with a key derived from ``JWT_SECRET`` (or
``OMILO_SECRET_KEY`` when set) and stored as ``fernet:<token>``. Reads accept
both shapes, so rows saved before this change keep working until they are
re-saved.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken

_PREFIX = "fernet:"


def _fernet() -> Fernet:
    from omilo.config import get_settings

    secret = os.environ.get("OMILO_SECRET_KEY") or get_settings().jwt_secret
    key = base64.urlsafe_b64encode(hashlib.sha256(("omilo-ai-accounts:" + secret).encode()).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    """Encrypt a credential for storage ('' stays '' — keyless local sessions)."""
    if not value:
        return ""
    if value.startswith(_PREFIX):
        return value
    return _PREFIX + _fernet().encrypt(value.encode()).decode()


def decrypt(stored: str | None) -> str:
    """Return the plain credential. Legacy plaintext rows are returned as-is."""
    if not stored:
        return ""
    if not stored.startswith(_PREFIX):
        return stored
    try:
        return _fernet().decrypt(stored[len(_PREFIX):].encode()).decode()
    except InvalidToken:
        return ""  # the server secret changed — the owner has to paste the key again


def hint(value: str) -> str:
    """'sk-ant-…a1b2' — what the UI may show."""
    if not value:
        return "Local session"
    return f"{value[:6]}…{value[-4:]}" if len(value) > 12 else "…****"
