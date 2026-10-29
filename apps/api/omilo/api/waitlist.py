"""Waitlist (pen 01): the landing page posts here.

  POST /v1/waitlist {email, name?, note?, source?}  → {ok: true}   (public)
  GET  /v1/waitlist/unsubscribe/{token}             → confirmation page
  POST /v1/waitlist/unsubscribe/{token}             → unsubscribed page

Always answers ``{ok: true}`` for a well-formed address, whether or not it was
already on the list (no enumeration).  The confirmation email goes out once per
address.  Allow the landing origin in CORS_ORIGINS if it calls this from the
browser.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.dialects.postgresql import insert

from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.models.base import prefixed_id
from omilo.models.notify import WaitlistEntry
from omilo.notify.core import app_url, dispatch, unsign
from omilo.notify.pages import page

router = APIRouter(tags=["waitlist"])

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")


class JoinBody(BaseModel):
    email: str = Field(max_length=254)
    name: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, max_length=120)


@router.post("/waitlist")
def join(body: JoinBody) -> dict:
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    with SessionLocal() as s, s.begin():
        new_id = s.execute(
            insert(WaitlistEntry).values(
                id=prefixed_id("wl"), email=email, name=(body.name or "").strip() or None,
                note=body.note, source=body.source,
            ).on_conflict_do_nothing(index_elements=["email"]).returning(WaitlistEntry.id)
        ).scalar()
    if new_id and get_settings().notify_enabled:
        from omilo.notify.senders import send_waitlist

        dispatch(send_waitlist, new_id)
    return {"ok": True}


def _entry_id(token: str) -> str | None:
    data = unsign("waitlist-unsub", token)
    return data.get("w") if data else None


@router.get("/waitlist/unsubscribe/{token}", response_class=HTMLResponse)
def unsubscribe_confirm(token: str) -> HTMLResponse:
    if not _entry_id(token):
        return page("This link has expired", "Reply to any Omilo email and we'll take you off the list.",
                    status_code=410)
    return page("Leave the waitlist?", "We won't email you about Omilo again.",
                post_to=app_url(f"/v1/waitlist/unsubscribe/{token}"), post_label="Unsubscribe")


@router.post("/waitlist/unsubscribe/{token}", response_class=HTMLResponse)
def unsubscribe(token: str) -> HTMLResponse:
    entry_id = _entry_id(token)
    if not entry_id:
        return page("This link has expired", "Reply to any Omilo email and we'll take you off the list.",
                    status_code=410)
    with SessionLocal() as s, s.begin():
        entry = s.get(WaitlistEntry, entry_id)
        if entry is not None and entry.unsubscribed_at is None:
            entry.unsubscribed_at = datetime.now(timezone.utc)
    return page("You're off the list", "You won't get any more waitlist emails from Omilo.")
