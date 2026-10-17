from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import services as S
from ..config import get_settings
from ..db import get_auth_db, get_db
from ..models import AuthToken, User
from ..security import COOKIE, current_user, hash_password, issue_token, sha256, verify_password
from ..serialize import iso

router = APIRouter(prefix="/api", tags=["auth"])


class OwnerIn(BaseModel):
    email: EmailStr
    name: str = ""
    password: str = Field(min_length=10)
    company_name: str = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str
    token_name: str | None = None  # set by the CLI: returns an API token instead of a cookie


def _set_cookie(resp: Response, raw: str):
    cfg = get_settings()
    resp.set_cookie(COOKIE, raw, httponly=True, samesite="lax", secure=cfg.cookie_secure,
                    max_age=cfg.session_days * 86400, path=(cfg.base_path or "") + "/")


@router.get("/setup")
def setup_status(db: Session = Depends(get_db), auth_db: Session = Depends(get_auth_db)):
    has_owner = bool(auth_db.scalar(select(func.count()).select_from(User)))
    return {"needs_owner": not has_owner, "company_name": S.get_setting(db, "company_name", ""),
            "onboarded": bool(S.get_setting(db, "onboarded", False)), "version": "0.3.0"}


@router.post("/setup/owner")
def create_owner(body: OwnerIn, response: Response, db: Session = Depends(get_auth_db)):
    if db.scalar(select(func.count()).select_from(User)):
        raise HTTPException(409, "the owner already exists; sign in instead")
    u = User(email=body.email.lower(), name=body.name, password_hash=hash_password(body.password), role="owner")
    db.add(u)
    db.commit()
    if body.company_name:
        S.set_setting(db, "company_name", body.company_name, actor=u.id)
    S.audit(db, u.id, "owner.create", u.id)
    db.commit()
    _set_cookie(response, issue_token(db, u, "session", "browser"))
    return {"id": u.id, "email": u.email}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_auth_db)):
    u = db.scalar(select(User).where(User.email == body.email.lower()))
    if not u or not verify_password(body.password, u.password_hash):
        S.audit(db, "anonymous", "login.failed", body.email.lower(), ip=request.client.host if request.client else "")
        db.commit()
        raise HTTPException(401, "wrong email or password")
    S.audit(db, u.id, "login", u.id, ip=request.client.host if request.client else "", kind="api" if body.token_name else "session")
    db.commit()
    if body.token_name:
        return {"token": issue_token(db, u, "api", body.token_name)}
    _set_cookie(response, issue_token(db, u, "session", "browser"))
    return {"ok": True}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    raw = request.cookies.get(COOKIE)
    if raw and (tok := db.scalar(select(AuthToken).where(AuthToken.token_hash == sha256(raw)))):
        db.delete(tok)
        db.commit()
    response.delete_cookie(COOKIE, path=(get_settings().base_path or "") + "/")
    return {"ok": True}


@router.get("/auth/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "name": user.name, "role": user.role}


@router.get("/auth/tokens")
def list_tokens(db: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    rows = db.scalars(select(AuthToken).where(AuthToken.user_id == user.id, AuthToken.kind == "api"))
    return [{"id": t.id, "name": t.name, "created_at": iso(t.created_at), "last_used_at": iso(t.last_used_at)} for t in rows]


@router.delete("/auth/tokens/{tid}")
def revoke_token(tid: str, db: Session = Depends(get_auth_db), user: User = Depends(current_user)):
    t = db.get(AuthToken, tid)
    if not t or t.user_id != user.id:
        raise HTTPException(404, "not found")
    db.delete(t)
    S.audit(db, user.id, "token.revoke", tid)
    db.commit()
    return {"ok": True}
