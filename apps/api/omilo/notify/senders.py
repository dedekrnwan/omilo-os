"""Build and send the event-driven notification emails (pen 01, 02, 03, 05).

Each ``send_*`` takes an id, loads what it needs in its own superuser session
(these run after the triggering transaction commits, off the request thread)
and hands one rendered mail per recipient to :func:`omilo.notify.core.deliver`.

  waitlist  — POST /v1/waitlist                      once per address
  welcome   — company onboarding completed           once per owner
  approval  — new pending Proposal                   once per proposal per owner
  alert     — job failed on connector auth, or a     once per connector per local day
              connector dropped out of "connected"
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.emails import templates as t
from omilo.emails.layout import Button
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.connectors import Connector
from omilo.models.execution import Job
from omilo.models.notify import WaitlistEntry
from omilo.models.tenancy import Company
from omilo.notify.core import (
    PREF_DECISION, PREF_FAILURE, app_url, clock, company_tz, deliver, first_name, owners,
    sign, wants_email,
)

ONE_TAP_TTL_S = 72 * 3600


def _links() -> t.Links:
    return t.Links.for_base(get_settings().frontend_base)


def helper_look(helper: Helper | None) -> str:
    """Mascot key for a helper: the Chief wears the crown, others their area."""
    if helper is None or helper.is_chief:
        return "brand"
    return helper.area or "brand"


# ── 01 · waitlist ────────────────────────────────────────────────────────────

def send_waitlist(entry_id: str) -> None:
    with SessionLocal() as s:
        entry = s.get(WaitlistEntry, entry_id)
        if entry is None or entry.unsubscribed_at is not None:
            return
        site = get_settings().site_url.rstrip("/")
        unsub = app_url("/v1/waitlist/unsubscribe/" + sign("waitlist-unsub", {"w": entry.id}, 400 * 86400))
        name = (entry.name or entry.email.split("@")[0]).split()[0]
        mail = t.render_waitlist(first_name=name, links=t.Links(app=site, unsubscribe=unsub),
                                 how_it_works_url=site)
        deliver(kind="waitlist", dedupe_key=f"waitlist:{entry.email.lower()}", to=entry.email, mail=mail)


# ── 02 · welcome ─────────────────────────────────────────────────────────────

def send_welcome(company_id: str) -> None:
    with SessionLocal() as s:
        company = s.get(Company, company_id)
        if company is None:
            return
        for user in owners(s, company_id):
            mail = t.render_welcome(first_name=first_name(user), company=company.name,
                                    timezone=company.timezone or "UTC", links=_links(),
                                    hire_url=app_url("/team"))
            deliver(kind="welcome", dedupe_key=f"welcome:{company_id}:{user.id}", to=user.email,
                    mail=mail, company_id=company_id)


# ── 03 · approval needed ─────────────────────────────────────────────────────

_FACT = re.compile(r"^\s*[-*]\s*\**([A-Za-z][\w /&'()-]{0,28}?)\**\s*:\s*(.+?)\s*$")
_MD = re.compile(r"[*_`#>]+")


def split_body(body_md: str) -> tuple[str, list[t.Fact]]:
    """Pull ``- Key: value`` bullet lines out as facts; the rest is the reasoning."""
    facts: list[t.Fact] = []
    prose: list[str] = []
    for line in (body_md or "").splitlines():
        m = _FACT.match(line)
        if m and len(facts) < 6:
            value = _MD.sub("", m.group(2)).strip()
            facts.append(t.Fact(m.group(1).strip(), value, mono=bool(re.search(r"\d", value))))
        elif line.strip():
            prose.append(_MD.sub("", line).strip(" -"))
    text = " ".join(prose)
    if len(text) > 420:
        text = text[:417].rsplit(" ", 1)[0] + "…"
    return text, facts


def one_tap_url(proposal_id: str, user_id: str, action: str) -> str:
    token = sign("one-tap", {"p": proposal_id, "u": user_id, "a": action}, ONE_TAP_TTL_S)
    return app_url(f"/v1/one-tap/{token}")


def send_approval(proposal_id: str) -> None:
    with SessionLocal() as s:
        p = s.get(Proposal, proposal_id)
        if p is None or (p.status or "pending") != "pending":
            return
        company = s.get(Company, p.company_id)
        if company is None:
            return
        helper = s.get(Helper, p.helper_id)
        name = helper.name if helper else "Your helper"
        reasoning, facts = split_body(p.body_md)
        tz = company_tz(company)
        for user in owners(s, p.company_id):
            if not wants_email(company, PREF_DECISION, user):
                continue
            mail = t.render_approval(
                helper=helper_look(helper), helper_name=name, company=company.name,
                kind="Proposal", waiting_since=clock(p.created_at, tz), question=p.title,
                reasoning=reasoning or "Details are in your Omilo inbox.", facts=facts,
                approve_url=one_tap_url(p.id, user.id, "approve"),
                reject_url=one_tap_url(p.id, user.id, "reject"),
                adjust_url=app_url("/inbox"), counterparty=None, links=_links(),
                expires_hours=ONE_TAP_TTL_S // 3600,
            )
            deliver(kind="approval", dedupe_key=f"approval:{p.id}:{user.id}", to=user.email,
                    mail=mail, company_id=p.company_id)


# ── 05 · critical alert ──────────────────────────────────────────────────────

AUTH_FAILURE = re.compile(
    r"invalid_grant|expired or revoked|token (?:has )?(?:been )?(?:expired|revoked)|"
    r"unauthori[sz]ed|\b401\b|re-?auth(?:enticate|orize)?\b|needs_auth|"
    r"invalid[_ ](?:credentials|token|api[_ ]key)|authentication failed",
    re.I,
)


def is_connector_auth_failure(error: str | None) -> bool:
    return bool(error and AUTH_FAILURE.search(error))


def _match_connector(s, company_id: str, error: str) -> Connector | None:
    low = error.lower()
    for c in s.execute(select(Connector).where(Connector.company_id == company_id)).scalars():
        if (c.slug and c.slug.lower() in low) or (c.label and c.label.lower() in low):
            return c
    return None


def _send_alert(s, company: Company, *, helper: Helper | None, connector: Connector | None,
                at: datetime, details: list[str]) -> None:
    tz = company_tz(company)
    label = connector.label if connector else "A connector"
    who = helper.name if helper else "Your helpers"
    verb = "is" if helper else "are"
    impacts: list[t.Impact] = []
    if helper is not None:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        stopped = s.execute(select(func.count()).select_from(Job).where(
            Job.company_id == company.id, Job.helper_id == helper.id, Job.status == "failed",
            Job.ended_at >= since)).scalar() or 0
        if stopped:
            impacts.append(t.Impact("repeat", f"{stopped} run{'s' if stopped != 1 else ''} stopped today",
                                    "Stopped", "red"))
        held = s.execute(select(func.count()).select_from(Proposal).where(
            Proposal.company_id == company.id, Proposal.helper_id == helper.id,
            Proposal.status == "pending")).scalar() or 0
        if held:
            impacts.append(t.Impact("mail", f"{held} waiting for your approval", "Held", "amber"))
        others = s.execute(select(func.count()).select_from(Helper).where(
            Helper.company_id == company.id, Helper.id != helper.id)).scalar() or 0
        if others:
            impacts.append(t.Impact("users", "Other helpers unaffected", "Running", "green"))
    reconnect = f"Reconnect {connector.label}" if connector else "Check connectors"
    mail = t.render_alert(
        company=company.name, helper=helper_look(helper), helper_name=helper.name if helper else "Chief of Staff",
        subject=f"Action needed: {label} disconnected — {who} {verb} blocked",
        preheader=f"Reconnect it so {who if helper else 'your helpers'} can carry on. Takes about a minute.",
        headline_text=f"{label} disconnected, so {who} {verb} blocked.",
        explanation=(f"{label} stopped accepting Omilo's sign-in at {clock(at, tz)}, so "
                     + (f"{who} stopped that run. " if helper else "anything that uses it is on hold. ")
                     + "This usually follows a password change or revoked access. Reconnect it and "
                     "the next run picks up from there."),
        at=f"Today · {clock(at, tz)}" if at.astimezone(tz).date() == datetime.now(tz).date() else clock(at, tz),
        impacts=impacts,
        primary=Button(reconnect, app_url("/control-panel/connectors")),
        secondary=Button("View run log", app_url("/analytics"), primary=False),
        details=details,
        signoff_role="Blocked · waiting on you" if helper else "Your Omilo helper",
        links=t.Links.for_base(get_settings().frontend_base),
    )
    day = at.astimezone(tz).date().isoformat()
    key = connector.slug if connector else "auth"
    for user in owners(s, company.id):
        if not wants_email(company, PREF_FAILURE, user):
            continue
        deliver(kind="alert", dedupe_key=f"alert:{company.id}:{key}:{day}:{user.id}", to=user.email,
                mail=mail, company_id=company.id)


def send_job_alert(job_id: str) -> None:
    with SessionLocal() as s:
        job = s.get(Job, job_id)
        if job is None or job.status != "failed" or not is_connector_auth_failure(job.error):
            return
        company = s.get(Company, job.company_id)
        if company is None:
            return
        connector = _match_connector(s, job.company_id, job.error or "")
        at = job.ended_at or datetime.now(timezone.utc)
        first = (job.error or "").strip().splitlines()[0][:200]
        where = f" · connector {connector.slug}" if connector else ""
        _send_alert(s, company, helper=s.get(Helper, job.helper_id), connector=connector, at=at,
                    details=[f"{job.id}{where} · {clock(at, company_tz(company))}", first])


def send_connector_alert(connector_id: str) -> None:
    with SessionLocal() as s:
        c = s.get(Connector, connector_id)
        if c is None or c.status not in ("needs_auth", "error") or not c.enabled:
            return
        company = s.get(Company, c.company_id)
        if company is None:
            return
        at = datetime.now(timezone.utc)
        _send_alert(s, company, helper=None, connector=c, at=at,
                    details=[f"connector {c.slug} · status {c.status} · {clock(at, company_tz(company))}"])
