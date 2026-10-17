import base64
import datetime as dt
import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_auth_db
from .models import AuthToken, Staff, User, now

_ph = PasswordHasher()
COOKIE = "omilo_session"


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def verify_password(pw: str, h: str) -> bool:
    try:
        return _ph.verify(h, pw)
    except VerifyMismatchError:
        return False


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def new_token(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def issue_token(db: Session, user: User, kind: str, name: str = "") -> str:
    raw = new_token("sgs" if kind == "session" else "sga")
    expires = now() + dt.timedelta(days=get_settings().session_days) if kind == "session" else None
    db.add(AuthToken(user_id=user.id, kind=kind, name=name, token_hash=sha256(raw), expires_at=expires))
    db.commit()
    return raw


def _bearer(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    return auth[7:].strip() if auth.lower().startswith("bearer ") else None


def current_user(request: Request, db: Session = Depends(get_auth_db)) -> User:
    raw = _bearer(request) or request.cookies.get(COOKIE)
    if not raw:
        raise HTTPException(401, "not signed in")
    tok = db.scalar(select(AuthToken).where(AuthToken.token_hash == sha256(raw)))
    if not tok:
        raise HTTPException(401, "invalid token")
    exp = tok.expires_at
    if exp is not None and exp.replace(tzinfo=exp.tzinfo or dt.UTC) < now():
        raise HTTPException(401, "session expired")
    # CSRF: browser (cookie) requests that change state must carry our header, which other sites can't send
    if not _bearer(request) and request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-omilo") != "1":
        raise HTTPException(403, "missing X-Omilo header")
    tok.last_used_at = now()
    db.commit()
    user = db.get(User, tok.user_id)
    if not user:
        raise HTTPException(401, "user gone")
    return user


def staff_from_mcp_token(db: Session, raw: str | None) -> Staff | None:
    if not raw:
        return None
    return db.scalar(select(Staff).where(Staff.mcp_token_hash == sha256(raw)))


def _fernet() -> Fernet:
    key = hashlib.sha256(("omilo-vault:" + get_settings().resolved_secret()).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(s: str) -> str:
    return _fernet().encrypt(s.encode()).decode()


def decrypt(s: str | None) -> str | None:
    if not s:
        return None
    try:
        return _fernet().decrypt(s.encode()).decode()
    except InvalidToken:
        return None
