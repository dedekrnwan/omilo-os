"""Weekly digest (pen 04): Monday 08:00 company-local, once per ISO week.

``run_due_digests(now)`` is safe to call as often as you like — the API runs it
every 5 minutes (``omilo.notify.loop``) and ``omilo-notify`` runs it once from
cron.  For every onboarded company whose local time is past Monday 08:00 it
summarises the *previous* ISO week and mails each owner once (EmailLog
dedupe).  A quiet week (no jobs, nothing waiting) sends nothing.

AI usage is shown in tokens (Job.tokens_in + tokens_out).
"""
from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from omilo.config import get_settings
from omilo.db import SessionLocal
from omilo.emails import templates as t
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.ai.usage import fmt_tokens
from omilo.models.execution import Job
from omilo.models.notify import EmailLog
from omilo.models.tenancy import Company
from omilo.notify.core import (
    PREF_WEEKLY, already_sent, app_url, company_tz, deliver, owners, set_sync, wants_email,
)
from omilo.notify.senders import helper_look

log = logging.getLogger("omilo.notify")

SEND_HOUR = 8  # local
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def rupiah(amount: float, short: bool = True) -> str:
    """Rp 228rb / Rp 1,2jt (short) or Rp 228.000 (long)."""
    n = round(amount)
    if not short or n < 1000:
        return "Rp " + f"{n:,}".replace(",", ".")
    if n < 1_000_000:
        return f"Rp {round(n / 1000)}rb"
    return f"Rp {n / 1_000_000:.1f}".replace(".", ",") + "jt"


def pct_delta(now: float, before: float) -> str:
    if before <= 0:
        return "new" if now > 0 else "—"
    d = round((now - before) / before * 100)
    return "—" if d == 0 else (f"+{d}%" if d > 0 else f"−{abs(d)}%")


def age(delta: timedelta) -> str:
    h = delta.total_seconds() / 3600
    return f"{max(1, round(h))}h" if h < 24 else f"{round(h / 24)}d"


def week_label(start_local: datetime) -> str:
    end = start_local + timedelta(days=6)
    wk = start_local.isocalendar().week
    if start_local.month == end.month:
        span = f"{start_local.day}–{end.day} {MONTHS[end.month - 1]}"
    else:
        span = f"{start_local.day} {MONTHS[start_local.month - 1][:3]} – {end.day} {MONTHS[end.month - 1][:3]}"
    return f"Week {wk} · {span}"


@dataclass
class Window:
    start: datetime  # UTC
    end: datetime
    start_local: datetime
    key: str  # ISO week being reported, e.g. 2026-W43


def previous_week(now: datetime, company: Company) -> tuple[Window, bool]:
    """The ISO week before ``now`` (company-local), and whether the digest is due."""
    tz = company_tz(company)
    local = now.astimezone(tz)
    this_monday = datetime.combine(local.date() - timedelta(days=local.weekday()), time(0), tz)
    start_local = this_monday - timedelta(days=7)
    due = local.weekday() > 0 or local.hour >= SEND_HOUR
    iso = start_local.isocalendar()
    return Window(start_local.astimezone(timezone.utc), this_monday.astimezone(timezone.utc),
                  start_local, f"{iso.year}-W{iso.week:02d}"), due


def _count_jobs(s, cid: str, status: str, a: datetime, b: datetime) -> int:
    return s.execute(select(func.count()).select_from(Job).where(
        Job.company_id == cid, Job.status == status, Job.ended_at >= a, Job.ended_at < b)).scalar() or 0


def _tokens(s, cid: str, a: datetime, b: datetime, helper_id: str | None = None) -> int:
    """AI tokens (in + out) used by the company's jobs that finished in [a, b)."""
    q = select(func.coalesce(func.sum(Job.tokens_in + Job.tokens_out), 0)).where(
        Job.company_id == cid, Job.ended_at >= a, Job.ended_at < b)
    if helper_id:
        q = q.where(Job.helper_id == helper_id)
    return int(s.execute(q).scalar() or 0)


def build_digest(s, company: Company, w: Window, now: datetime) -> t.RenderedEmail | None:
    cid = company.id
    prev_a = w.start - timedelta(days=7)

    done = _count_jobs(s, cid, "done", w.start, w.end)
    failed = _count_jobs(s, cid, "failed", w.start, w.end)
    done_before = _count_jobs(s, cid, "done", prev_a, w.start)
    used = _tokens(s, cid, w.start, w.end)
    used_before = _tokens(s, cid, prev_a, w.start)

    waiting_rows = s.execute(select(Proposal.created_at).where(
        Proposal.company_id == cid, Proposal.status == "pending")).scalars().all()
    waiting = len(waiting_rows)
    if done + failed == 0 and waiting == 0:
        return None

    oldest = age(now - min(waiting_rows)) if waiting_rows else None
    stats = [
        t.Stat("Jobs finished", str(done), pct_delta(done, done_before),
               "green" if done >= done_before and done else "neutral"),
        t.Stat("Waiting on you", str(waiting), f"oldest {oldest}" if oldest else "all clear",
               "amber" if waiting else "green"),
        t.Stat("AI tokens", fmt_tokens(used).replace(" tokens", ""), pct_delta(used, used_before), "neutral"),
    ]

    # Summary sentence: success rate + how fast decisions were made.
    total = done + failed
    parts = [f"{done} of {total} jobs succeeded ({round(done / total * 100)}%)." if total else ""]
    decided = s.execute(select(Proposal.created_at, Proposal.decided_at).where(
        Proposal.company_id == cid, Proposal.decided_at >= w.start, Proposal.decided_at < w.end,
        Proposal.decided_by.like("operator:%"))).all()
    if decided:
        mins = sum((d - c).total_seconds() for c, d in decided) / len(decided) / 60
        took = f"{round(mins)} minutes" if mins < 90 else f"{round(mins / 60)} hours"
        parts.append(f"You answered {len(decided)} decision{'s' if len(decided) != 1 else ''} "
                     f"in about {took} on average.")
    summary = " ".join(p for p in parts if p) or f"{waiting} decisions are waiting for you."

    # Busiest helpers: most jobs finished or failed in the week.
    rows = s.execute(
        select(Job.helper_id, func.count(), func.coalesce(func.sum(Job.tokens_in + Job.tokens_out), 0))
        .where(Job.company_id == cid, Job.status.in_(("done", "failed")),
               Job.ended_at >= w.start, Job.ended_at < w.end)
        .group_by(Job.helper_id).order_by(func.count().desc()).limit(3)
    ).all()
    helpers = {h.id: h for h in s.execute(select(Helper).where(Helper.company_id == cid)).scalars()}
    busiest = []
    for hid, jobs, tokens in rows:
        h = helpers.get(hid)
        busiest.append(t.HelperWeek(helper_look(h), h.name if h else "Helper", int(jobs), "",
                                    fmt_tokens(int(tokens))))

    # What got approved, per helper.
    approved: list[str] = []
    per = Counter()
    ok = Counter()
    for hid, status in s.execute(select(Proposal.helper_id, Proposal.status).where(
            Proposal.company_id == cid, Proposal.decided_at >= w.start, Proposal.decided_at < w.end)).all():
        per[hid] += 1
        ok[hid] += status in ("approved", "executing", "done")
    for hid, n in per.most_common(3):
        name = helpers[hid].name if hid in helpers else "Helper"
        approved.append(f"{name} · {ok[hid]} of {n} proposal{'s' if n != 1 else ''} approved")

    # Budget warning: first helper past 80% of its monthly budget.
    budget_note = None
    month_start = datetime.combine(now.astimezone(company_tz(company)).date().replace(day=1), time(0),
                                   company_tz(company)).astimezone(timezone.utc)
    for h in helpers.values():
        if not h.budget_tokens_month:
            continue
        h_used = _tokens(s, cid, month_start, now, h.id)
        share = h_used / h.budget_tokens_month
        if share >= 0.8:
            budget_note = f"{h.name} is at {round(share * 100)}% of its monthly budget."
            errors = Counter((e or "").strip().splitlines()[0][:80] for e in s.execute(
                select(Job.error).where(Job.company_id == cid, Job.helper_id == h.id, Job.status == "failed",
                                        Job.ended_at >= w.start, Job.ended_at < w.end)).scalars() if e)
            if errors:
                err, n = errors.most_common(1)[0]
                if n > 1:
                    budget_note += f" Most common failure: {err} ({n}×)."
            break

    top = busiest[0].name if busiest else None
    pre = " · ".join(x for x in [
        f"{waiting} waiting on you" if waiting else "Nothing waiting on you",
        f"{top} was the busiest helper" if top else "",
        f"{fmt_tokens(used)} used",
    ] if x)
    return t.render_digest(
        company=company.name, week_label=week_label(w.start_local), stats=stats, summary=summary,
        busiest=busiest, approved=approved, budget_note=budget_note, waiting=waiting,
        monitor_url=app_url("/analytics"), inbox_url=app_url("/inbox"),
        links=t.Links.for_base(get_settings().frontend_base),
        subject_tail=f"{done} job{'s' if done != 1 else ''} finished", preheader=pre,
    )


def _mark_quiet(company_id: str, key: str) -> None:
    with SessionLocal() as s, s.begin():
        s.execute(insert(EmailLog).values(
            id=prefixed_id("eml"), company_id=company_id, kind="digest", dedupe_key=key,
            to_email="", status="skipped", error="quiet week",
        ).on_conflict_do_nothing(index_elements=["dedupe_key"]))


def run_due_digests(now: datetime | None = None) -> int:
    """Send every digest that is due.  Returns how many emails went out."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    with SessionLocal() as s:
        companies = s.execute(select(Company).where(Company.onboarded_at.is_not(None))).scalars().all()
        for company in companies:
            try:
                w, due = previous_week(now, company)
                quiet_key = f"digest:{company.id}:{w.key}:quiet"
                if not due or already_sent(s, quiet_key):
                    continue
                people = [u for u in owners(s, company.id)
                          if wants_email(company, PREF_WEEKLY, u)
                          and not already_sent(s, f"digest:{company.id}:{w.key}:{u.id}")]
                if not people:
                    continue
                mail = build_digest(s, company, w, now)
                if mail is None:
                    _mark_quiet(company.id, quiet_key)
                    continue
                for u in people:
                    if deliver(kind="digest", dedupe_key=f"digest:{company.id}:{w.key}:{u.id}",
                               to=u.email, mail=mail, company_id=company.id) == "sent":
                        sent += 1
            except Exception:
                log.exception("digest for %s failed", company.id)
    return sent


def main() -> None:
    """``omilo-notify``: send due weekly digests once (for cron)."""
    logging.basicConfig(level=logging.INFO)
    set_sync(True)
    print(f"omilo-notify: sent {run_due_digests()} digest email(s)")
