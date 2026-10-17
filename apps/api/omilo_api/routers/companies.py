"""Companies: list, create, switch, rename and archive. Every company is fully separate; only the login is shared."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from .. import company as C
from .. import services as S
from ..config import get_settings
from ..db import session_scope
from ..models import User
from ..security import current_user

router = APIRouter(prefix="/api/companies", tags=["companies"])


def _cookie(resp: Response, cid: str) -> None:
    cfg = get_settings()
    resp.set_cookie(C.COOKIE, cid, httponly=True, samesite="lax", secure=cfg.cookie_secure,
                    max_age=400 * 86400, path=(cfg.base_path or "") + "/")


@router.get("")
def list_companies(archived: bool = False, user: User = Depends(current_user)):
    rows = []
    for cid in C.ids(include_archived=archived):
        try:
            rows.append(C.summary(cid))
        except Exception as e:  # noqa: BLE001 - show a broken company instead of hiding it
            rows.append({"id": cid, "name": cid, "error": str(e)[:200], "inbox": 0, "running": 0, "onboarded": True, "archived": False})
    return {"current": C.current(), "companies": rows}


class NewCompany(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("")
def create_company(body: NewCompany, response: Response, user: User = Depends(current_user)):
    cid = C.create(body.name.strip())
    with session_scope(cid) as db:
        S.set_setting(db, "company_name", body.name.strip(), actor=user.id)
        S.audit(db, user.id, "company.create", cid)
    _cookie(response, cid)
    return C.summary(cid)


class Switch(BaseModel):
    id: str


@router.post("/switch")
def switch(body: Switch, response: Response, user: User = Depends(current_user)):
    if not C.exists(body.id):
        raise HTTPException(404, "no such company")
    _cookie(response, body.id)
    return C.summary(body.id)


class Patch(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    archived: bool | None = None


@router.patch("/{cid}")
def update(cid: str, body: Patch, response: Response, user: User = Depends(current_user)):
    if not C.exists(cid, include_archived=True):
        raise HTTPException(404, "no such company")
    if body.name is not None and body.name.strip():
        with session_scope(cid) as db:
            S.set_setting(db, "company_name", body.name.strip(), actor=user.id)
    if body.archived is not None:
        if body.archived and len(C.ids()) <= 1:
            raise HTTPException(400, "keep at least one company")
        try:
            C.set_archived(cid, body.archived)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if body.archived:
            with session_scope(cid) as db:  # an archived company does no work: pause it too
                S.set_setting(db, "paused", True, actor=user.id)
            if C.current() == cid:
                _cookie(response, C.MAIN)
    return C.summary(cid)
