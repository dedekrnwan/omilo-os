"""Notification email triggers (omilo.notify) — pen "Email Templates" 01–05.

Mail is captured (CapturingEmailSender) and notification work runs inline
(``notify.core.set_sync``) so each trigger can be asserted right after the
commit that causes it.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from omilo import mailer
from omilo.db import SessionLocal, set_company
from omilo.mailer import CapturingEmailSender
from omilo.models.agents import Helper
from omilo.models.approvals import Proposal
from omilo.models.base import prefixed_id
from omilo.models.billing import CreditLedger
from omilo.models.connectors import Connector
from omilo.models.execution import Job
from omilo.models.notify import EmailLog, WaitlistEntry
from omilo.models.tenancy import Company
from omilo.notify import core, digest, hooks, senders


@pytest.fixture(autouse=True)
def _no_kb_recall(monkeypatch):
    """KB recall isn't under test here (and needs Postgres' snowball dictionary)."""
    monkeypatch.setattr("omilo.loop.runner._assemble_memory", lambda *a, **k: "")


@pytest.fixture
def outbox():
    sender = CapturingEmailSender()
    mailer.set_email_sender(sender)
    core.set_sync(True)
    hooks.install()
    yield sender
    core.set_sync(False)
    mailer.set_email_sender(None)


class _tenant:
    def __init__(self, company_id: str):
        self.cid = company_id

    def __enter__(self):
        self.s = SessionLocal()
        self.t = self.s.begin()
        self.s.execute(text("SET LOCAL ROLE omilo_app"))
        set_company(self.s, self.cid)
        return self.s

    def __exit__(self, exc_type, *_):
        (self.t.rollback if exc_type else self.t.commit)()
        self.s.close()


async def _sign_up(client, name="Rina Wijaya"):
    email = f"ntf_{uuid.uuid4().hex[:8]}@test.example"
    r = await client.post("/v1/auth/sign-up", json={"email": email, "name": name, "password": "testP4ss!"})
    assert r.status_code == 201, r.text
    token = r.json()["session"]["access"]
    me = (await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})).json()
    return email, token, me["company"]["id"]


def _set_company(company_id: str, **fields) -> None:
    with SessionLocal() as s, s.begin():
        c = s.get(Company, company_id)
        for k, v in fields.items():
            setattr(c, k, v)


def _chief(company_id: str) -> Helper:
    with SessionLocal() as s:
        return s.execute(select(Helper).where(Helper.company_id == company_id, Helper.is_chief)).scalar_one()


def _email_on(label: str, on: bool = True) -> dict:
    return {"notifications": {"matrix": [{"label": label, "channels": {"email": on}}]}}


def _mails(outbox, to: str) -> list:
    return [m for m in outbox.outbox if m.to == to]


# ── 01 · waitlist ────────────────────────────────────────────────────────────

async def test_waitlist_join_sends_once_and_unsubscribes(async_client, outbox):
    email = f"Wait_{uuid.uuid4().hex[:6]}@Test.example"
    for _ in range(2):
        r = await async_client.post("/v1/waitlist", json={"email": email, "name": "Rina", "source": "landing"})
        assert r.status_code == 200 and r.json() == {"ok": True}
    sent = _mails(outbox, email.lower())
    assert len(sent) == 1
    m = sent[0]
    assert m.subject == "You're on the Omilo waitlist" and m.from_name == "Omilo"
    assert "Hi Rina" in m.html and "mascot-sales@omilo" in m.images

    token = re.search(r"/v1/waitlist/unsubscribe/([\w.-]+)", m.html).group(1)
    page = await async_client.get(f"/v1/waitlist/unsubscribe/{token}")
    assert page.status_code == 200 and "Leave the waitlist?" in page.text
    done = await async_client.post(f"/v1/waitlist/unsubscribe/{token}")
    assert done.status_code == 200 and "off the list" in done.text
    with SessionLocal() as s:
        assert s.execute(select(WaitlistEntry.unsubscribed_at)
                         .where(WaitlistEntry.email == email.lower())).scalar() is not None


async def test_waitlist_rejects_bad_email(async_client, outbox):
    r = await async_client.post("/v1/waitlist", json={"email": "not-an-email"})
    assert r.status_code == 422
    assert (await async_client.get("/v1/waitlist/unsubscribe/forged.token")).status_code == 410


# ── 02 · welcome ─────────────────────────────────────────────────────────────

async def test_welcome_sent_when_onboarding_completes(async_client, outbox):
    email, token, cid = await _sign_up(async_client)
    assert not _mails(outbox, email), "nothing should go out at sign-up"
    _set_company(cid, name="Sahabat Warga", timezone="Asia/Jakarta")
    h = {"Authorization": f"Bearer {token}"}
    for _ in range(2):  # idempotent endpoint → still one email
        assert (await async_client.post("/v1/company/onboard", headers=h)).status_code == 200
    sent = _mails(outbox, email)
    assert len(sent) == 1
    m = sent[0]
    assert m.subject.startswith("Welcome to Omilo") and m.from_name == "Chief of Staff via Omilo"
    assert "Hi Rina," in m.html and "Sahabat Warga · Asia/Jakarta" in m.html


# ── 03 · approval needed + one-tap ───────────────────────────────────────────

def _make_proposal(cid: str, helper_id: str) -> str:
    from omilo.loop.runner import start_job

    with _tenant(cid) as db:
        job = start_job(db, company_id=cid, helper_id=helper_id, origin="chat",
                        brief="Reply\nSEND: Offer Toko Maju 10% to close this week")
        assert job.status == "waiting"
        return db.execute(select(Proposal.id).where(Proposal.job_id == job.id)).scalar_one()


async def test_approval_off_by_default(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, autonomy_default="ask")
    _make_proposal(cid, _chief(cid).id)
    assert not [m for m in _mails(outbox, email) if "approval" in m.subject]


async def test_approval_email_and_one_tap_approve(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, autonomy_default="ask", name="Sahabat Warga", timezone="Asia/Jakarta",
                 settings=_email_on("Needs your decision"))
    pid = _make_proposal(cid, _chief(cid).id)

    sent = [m for m in _mails(outbox, email) if "needs your approval" in m.subject]
    assert len(sent) == 1
    m = sent[0]
    assert "WIB" in m.html and "Nothing happens until you approve." in m.html
    assert "Approve this message?" in m.html and "“Offer Toko Maju 10% to close this week”" in m.html
    assert "Payload" not in m.html
    approve = re.search(r'href="[^"]*/v1/one-tap/([\w.-]+)"[^>]*>Approve<', m.html).group(1)
    reject = re.search(r'href="[^"]*/v1/one-tap/([\w.-]+)"[^>]*>Reject<', m.html).group(1)

    # GET only shows a confirmation — link scanners can't approve.
    page = await async_client.get(f"/v1/one-tap/{approve}")
    assert page.status_code == 200 and "<form method=\"post\"" in page.text
    with SessionLocal() as s:
        assert s.get(Proposal, pid).status == "pending"

    done = await async_client.post(f"/v1/one-tap/{approve}")
    assert done.status_code == 200 and "Approved" in done.text
    with SessionLocal() as s:
        p = s.get(Proposal, pid)
        assert p.status == "done" and p.decided_by.startswith("operator:usr_") and p.execution_job_id

    again = await async_client.post(f"/v1/one-tap/{reject}")
    assert "Already approved" in again.text


async def test_one_tap_reject_and_bad_tokens(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, autonomy_default="ask", settings=_email_on("Needs your decision"))
    pid = _make_proposal(cid, _chief(cid).id)
    m = [m for m in _mails(outbox, email) if "needs your approval" in m.subject][0]
    reject = re.search(r'href="[^"]*/v1/one-tap/([\w.-]+)"[^>]*>Reject<', m.html).group(1)

    body, mac = reject.rsplit(".", 1)
    forged = body + "." + ("A" if mac[0] != "A" else "B") + mac[1:]
    assert (await async_client.post(f"/v1/one-tap/{forged}")).status_code == 410

    assert "Rejected" in (await async_client.post(f"/v1/one-tap/{reject}")).text
    with SessionLocal() as s:
        assert s.get(Proposal, pid).status == "rejected"


def test_signed_tokens_expire_and_bind_purpose():
    tok = core.sign("one-tap", {"p": "prp_x"}, ttl_s=60)
    assert core.unsign("one-tap", tok)["p"] == "prp_x"
    assert core.unsign("waitlist-unsub", tok) is None
    assert core.unsign("one-tap", core.sign("one-tap", {"p": "x"}, ttl_s=-1)) is None


def test_split_body_pulls_facts():
    text_, facts = senders.split_body(
        "They've asked twice about bulk pricing.\n\n- Customer: Toko Maju · Bandung\n- **Discount**: 10% · Rp 3.600.000")
    assert text_ == "They've asked twice about bulk pricing."
    assert [(f.key, f.value, f.mono) for f in facts] == [
        ("Customer", "Toko Maju · Bandung", False), ("Discount", "10% · Rp 3.600.000", True)]


def test_split_body_understands_runner_format():
    body = "**Type:** message\n**Risk:** medium\n\n**Payload:**\n\n- **text:** Offer Toko Maju 10%\n- **to_name:** Budi"
    text_, facts = senders.split_body(body)
    assert text_ == "“Offer Toko Maju 10%”"
    assert [(f.key, f.value) for f in facts] == [("Risk", "medium"), ("To name", "Budi")]


# ── 05 · critical alert ──────────────────────────────────────────────────────

def _fail_job(cid: str, helper_id: str, error: str) -> str:
    with _tenant(cid) as db:
        job = Job(id=prefixed_id("job"), company_id=cid, helper_id=helper_id, origin="routine",
                  brief="Answer new tickets", status="running", checkpoint={},
                  started_at=datetime.now(timezone.utc))
        db.add(job)
        db.flush()
        job.status = "failed"
        job.error = error
        job.ended_at = datetime.now(timezone.utc)
        return job.id


async def test_alert_on_connector_auth_failure_once_per_day(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, name="Sahabat Warga", timezone="Asia/Jakarta")
    chief = _chief(cid)
    with _tenant(cid) as db:
        db.add(Connector(id=prefixed_id("con"), company_id=cid, source="piece", slug="gmail",
                         label="Gmail", kind="mcp", status="connected"))
    _fail_job(cid, chief.id, "gmail: invalid_grant: Token has been expired or revoked.")
    _fail_job(cid, chief.id, "gmail: invalid_grant: Token has been expired or revoked.")
    _fail_job(cid, chief.id, "Timeout talking to the model")  # not an auth failure

    alerts = [m for m in _mails(outbox, email) if m.subject.startswith("Action needed")]
    assert len(alerts) == 1
    m = alerts[0]
    assert m.subject == f"Action needed: Gmail disconnected — {chief.name} is blocked"
    assert m.from_name == "Omilo alerts" and "Reconnect Gmail" in m.html
    assert "invalid_grant" in m.html and "mascot-brand@omilo" in m.images


async def test_alert_when_connector_drops(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    con_id = prefixed_id("con")
    with _tenant(cid) as db:
        db.add(Connector(id=con_id, company_id=cid, source="piece", slug="drive",
                         label="Google Drive", kind="mcp", status="connected"))
    with _tenant(cid) as db:
        db.get(Connector, con_id).status = "needs_auth"
    alerts = [m for m in _mails(outbox, email) if m.subject.startswith("Action needed")]
    assert [a.subject for a in alerts] == ["Action needed: Google Drive disconnected — your helpers are blocked"]


async def test_alert_respects_preference(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, settings=_email_on("Flow failed", False))
    _fail_job(cid, _chief(cid).id, "401 Unauthorized from slack")
    assert not _mails(outbox, email)


def test_auth_failure_classifier():
    yes = ["invalid_grant", "Token has been expired or revoked", "HTTP 401", "Unauthorized",
           "needs_auth", "invalid_api_key"]
    no = ["Timeout", "rate limit (429)", "refused by SafetyLimit", None]
    assert all(senders.is_connector_auth_failure(e) for e in yes)
    assert not any(senders.is_connector_auth_failure(e) for e in no)


# ── 04 · weekly digest ───────────────────────────────────────────────────────

def _monday(tz_offset_h: int, hour: int) -> datetime:
    """A Monday at ``hour`` local (for a fixed-offset zone), as UTC."""
    today = datetime.now(timezone.utc).date()
    monday = today - timedelta(days=today.weekday())
    local = datetime(monday.year, monday.month, monday.day, hour, tzinfo=timezone(timedelta(hours=tz_offset_h)))
    return local.astimezone(timezone.utc)


async def test_weekly_digest_monday_8am_once(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, name="Sahabat Warga", timezone="Asia/Jakarta",
                 onboarded_at=datetime.now(timezone.utc) - timedelta(days=30))
    chief = _chief(cid)
    now = _monday(7, 9)
    last_week = now - timedelta(days=3)
    with _tenant(cid) as db:
        for i, status in enumerate(["done"] * 4 + ["failed"]):
            db.add(Job(id=prefixed_id("job"), company_id=cid, helper_id=chief.id, origin="routine",
                       brief="b", status=status, checkpoint={}, tokens_in=1000, tokens_out=500,
                       cost_credits=200, error="Zendesk rate limit" if status == "failed" else None,
                       ended_at=last_week + timedelta(minutes=i)))
            db.add(CreditLedger(id=prefixed_id("led"), company_id=cid, delta=-200, balance_after=0,
                                reason="job", helper_id=chief.id, credits_charged=200, at=last_week))
    # Settle the failed job's alert so only digest mail is left to inspect.
    outbox.outbox.clear()

    assert digest.run_due_digests(_monday(7, 7)) == 0  # 07:00 WIB — not yet
    assert digest.run_due_digests(now) >= 1
    assert digest.run_due_digests(now + timedelta(minutes=5)) == 0  # once per ISO week

    m = [x for x in _mails(outbox, email) if x.subject.startswith("Your week in Omilo")]
    assert len(m) == 1
    m = m[0]
    assert m.subject == "Your week in Omilo · 4 jobs finished"
    assert "4 of 5 jobs succeeded (80%)." in m.html
    assert "Rp 50rb" in m.html  # 1 000 credits × Rp 50 (billing.catalog.IDR_PER_CREDIT)
    assert chief.name in m.html and m.from_name == "Chief of Staff via Omilo"


async def test_quiet_week_sends_nothing(async_client, outbox):
    email, _t, cid = await _sign_up(async_client)
    _set_company(cid, onboarded_at=datetime.now(timezone.utc) - timedelta(days=30), timezone="UTC")
    digest.run_due_digests(_monday(0, 9))
    assert not [m for m in _mails(outbox, email) if m.subject.startswith("Your week")]
    with SessionLocal() as s:
        assert s.execute(select(EmailLog.status).where(EmailLog.company_id == cid,
                                                       EmailLog.kind == "digest")).scalar() == "skipped"


def test_digest_formatting():
    assert digest.rupiah(228_000) == "Rp 228rb"
    assert digest.rupiah(228_000, short=False) == "Rp 228.000"
    assert digest.rupiah(1_250_000) == "Rp 1,2jt"
    assert digest.pct_delta(128, 114) == "+12%"
    assert digest.pct_delta(96, 100) == "−4%"
    assert digest.pct_delta(5, 0) == "new"
    assert digest.week_label(datetime(2026, 10, 12)) == "Week 42 · 12–18 October"


# ── delivery ─────────────────────────────────────────────────────────────────

def test_deliver_is_at_most_once_and_releases_without_smtp(outbox, monkeypatch):
    from omilo.emails.preview import samples

    mail = samples()["02-welcome"]
    key = f"test:{uuid.uuid4().hex}"
    assert core.deliver(kind="welcome", dedupe_key=key, to="a@test.example", mail=mail) == "sent"
    assert core.deliver(kind="welcome", dedupe_key=key, to="a@test.example", mail=mail) == "duplicate"

    mailer.set_email_sender(None)  # real SMTP sender, no SMTP_HOST → 503
    monkeypatch.setattr(mailer, "get_settings", lambda: type("S", (), {"smtp_host": None})())
    key2 = f"test:{uuid.uuid4().hex}"
    assert core.deliver(kind="welcome", dedupe_key=key2, to="a@test.example", mail=mail) == "skipped"
    with SessionLocal() as s:
        assert not core.already_sent(s, key2)  # claim released, retried once SMTP exists


# ── per-person email preferences (Control panel → Notifications) ────────────

def test_wants_email_prefers_the_persons_own_matrix():
    from types import SimpleNamespace

    from omilo.notify.core import PREF_DECISION, PREF_WEEKLY, wants_email

    company = SimpleNamespace(settings={"notifications": {"matrix": [
        {"label": "Needs your decision", "channels": {"email": True}},
    ]}})
    off = SimpleNamespace(preferences={"notifications": {"matrix": [
        {"label": "Needs your decision", "channels": {"email": False}},
    ]}})
    unset = SimpleNamespace(preferences={})
    assert wants_email(company, PREF_DECISION, off) is False      # person said no
    assert wants_email(company, PREF_DECISION, unset) is True     # company fallback
    assert wants_email(company, PREF_DECISION) is True            # no person given
    assert wants_email(SimpleNamespace(settings={}), PREF_WEEKLY, unset) is PREF_WEEKLY[1]  # UI default
