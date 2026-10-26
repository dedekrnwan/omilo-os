"""Password hashing with argon2id (argon2-cffi).

Usage::

    h = hash_password("hunter2")
    verify_password("hunter2", h)   # True
    verify_password("wrong", h)     # False
"""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

_hasher = PasswordHasher()  # uses argon2id by default


def hash_password(password: str) -> str:
    """Return an argon2id hash of *password*."""
    return _hasher.hash(password)


def verify_password(password: str, hash: str) -> bool:
    """Return True iff *password* matches the stored argon2id *hash*."""
    try:
        return _hasher.verify(hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
