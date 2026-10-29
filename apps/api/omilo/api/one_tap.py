"""One-tap approve/reject from the "needs your approval" email (pen 03).

  GET  /v1/one-tap/{token}  → confirmation page (no side effects)
  POST /v1/one-tap/{token}  → approve or reject, then a result page

The token is HMAC-signed for one user, one proposal and one action, and
expires after 72 hours.  GET never acts, so mail scanners and link previews
that fetch the URL can't approve anything; the person presses the button.

The decision runs through the same handlers as the inbox
(``omilo.api.approvals``) inside a tenant-scoped (RLS) session, and is
recorded as ``operator:<user>`` — only if that user is still an owner or
admin of the company.
"""
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
from sqlalchemy import select, text

from omilo.db import SessionLocal, set_company
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.tenancy import Member
from omilo.notify.core import app_url, unsign
from omilo.notify.pages import page
from omilo.tenancy.context import RequestContext

router = APIRouter(tags=["notify"])

_DONE = {"approved": "approved", "executing": "approved", "done": "approved",
         "rejected": "rejected", "changes_requested": "sent back for changes", "failed": "approved"}


def _invalid() -> HTMLResponse:
    return page("This link has expired",
                "One-tap links work for 72 hours. You can still decide from your Omilo inbox.",
                action_url=app_url("/inbox"), action_label="Open inbox", status_code=410)


def _load(token: str):
    data = unsign("one-tap", token)
    if not data or data.get("a") not in ("approve", "reject"):
        return None
    with SessionLocal() as s:
        p = s.get(Proposal, data["p"])
        if p is None:
            return None
        role = s.execute(select(Member.role).where(
            Member.company_id == p.company_id, Member.user_id == data["u"])).scalar()
        if role not in ("owner", "admin"):
            return None
        helper = s.get(Helper, p.helper_id)
        return data, p, role, (helper.name if helper else "Your helper")


@router.get("/one-tap/{token}", response_class=HTMLResponse)
def confirm(token: str) -> HTMLResponse:
    loaded = _load(token)
    if loaded is None:
        return _invalid()
    data, p, _role, helper = loaded
    if p.status != "pending":
        return page(f"Already {_DONE.get(p.status, p.status)}", p.title,
                    action_url=app_url("/inbox"), action_label="Open inbox")
    verb = "Approve" if data["a"] == "approve" else "Reject"
    msg = (f"{helper} will go ahead as soon as you approve." if verb == "Approve"
           else f"{helper} won't do this, and nothing is sent.")
    return page(f"{verb}: {p.title}", msg, post_to=app_url(f"/v1/one-tap/{token}"),
                post_label=verb, secondary=("Open in Omilo", app_url("/inbox")))


@router.post("/one-tap/{token}", response_class=HTMLResponse)
def act(token: str) -> HTMLResponse:
    loaded = _load(token)
    if loaded is None:
        return _invalid()
    data, p, role, helper = loaded
    from omilo.api.approvals import ApproveBody, RejectBody, approve_proposal, reject_proposal

    ctx = RequestContext(user_id=data["u"], company_id=p.company_id, role=role)
    with SessionLocal() as db, db.begin():
        db.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(db, p.company_id)
        current = db.get(Proposal, p.id)
        if current is None:
            return _invalid()
        if current.status != "pending":
            return page(f"Already {_DONE.get(current.status, current.status)}", current.title,
                        action_url=app_url("/inbox"), action_label="Open inbox")
        if data["a"] == "approve":
            approve_proposal(p.id, ApproveBody(note="Approved from email"), db, ctx, None)
            title, msg = "Approved", f"{helper} is going ahead: {current.title}"
        else:
            reject_proposal(p.id, RejectBody(note=""), db, ctx)
            title, msg = "Rejected", f"{helper} won't do this: {current.title}"
    return page(title, msg, action_url=app_url("/inbox"), action_label="Open inbox")
