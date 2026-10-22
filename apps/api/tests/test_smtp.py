"""Tests for company-level SMTP config + test-send endpoints.

All smtplib calls are monkeypatched — NO real email is ever sent.
"""
import json

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SMTP_CFG = {
    "host": "smtp.example.com",
    "port": 587,
    "security": "tls",
    "username": "user@example.com",
    "password": "s3cr3t",
    "from_addr": "noreply@example.com",
}


# ---------------------------------------------------------------------------
# Fake smtplib shims
# ---------------------------------------------------------------------------

class _FakeSMTP:
    """Recording fake for smtplib.SMTP (and SMTP_SSL)."""

    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs
        self.sent = []

    def starttls(self, **_):
        pass

    def login(self, *_):
        pass

    def send_message(self, msg):
        self.sent.append(msg)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


class _ErrorSMTP:
    """A fake that raises on construction (simulates connection failure)."""

    def __init__(self, *args, **kwargs):
        raise OSError("connection refused")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_put_then_get_smtp_hides_password(owner, monkeypatch):
    """PUT config with a password → GET response has has_password=True and NO plaintext."""
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    r = owner.put("/api/settings/smtp", json=_SMTP_CFG)
    assert r.status_code == 200, r.text

    r = owner.get("/api/settings/smtp")
    assert r.status_code == 200, r.text
    data = r.json()

    assert data["has_password"] is True
    # The raw password must NOT appear anywhere in the response
    assert "s3cr3t" not in json.dumps(data)
    # The response must not contain a "password" key with a value
    assert "password" not in data or data.get("password") is None


def test_put_smtp_encrypts_password(owner, monkeypatch):
    """After PUT the Setting row must store the encrypted (Fernet) token, not plaintext."""
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    r = owner.put("/api/settings/smtp", json=_SMTP_CFG)
    assert r.status_code == 200, r.text

    from omilo_api import security
    from omilo_api.db import session_scope
    from omilo_api.services import get_setting

    with session_scope() as db:
        raw = get_setting(db, "smtp")

    assert raw is not None, "Setting['smtp'] must exist after PUT"
    stored_enc = raw.get("password_enc")
    assert stored_enc is not None, "password_enc must be present in stored dict"
    assert stored_enc != "s3cr3t", "stored value must NOT be the plaintext password"
    # Decrypting must yield the original plaintext
    assert security.decrypt(stored_enc) == "s3cr3t"


def test_smtp_test_send_invokes_smtplib(owner, monkeypatch):
    """POST /test with a configured server → 200 and the fake's send_message was called."""
    import smtplib
    sent_messages = []

    class _CaptureSMTP(_FakeSMTP):
        def send_message(self, msg):
            sent_messages.append(msg)

    monkeypatch.setattr(smtplib, "SMTP", _CaptureSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _CaptureSMTP)

    # Ensure config is set first
    r = owner.put("/api/settings/smtp", json=_SMTP_CFG)
    assert r.status_code == 200, r.text

    r = owner.post("/api/settings/smtp/test", json={"to": "recipient@example.com"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert len(sent_messages) == 1, "send_message must be called exactly once"


def test_smtp_test_send_error_is_400(owner, monkeypatch):
    """When smtplib raises on connect → POST /test returns 400 (not 500)."""
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _ErrorSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _ErrorSMTP)

    # Ensure config is set (so we get past the "not configured" guard)
    r = owner.put("/api/settings/smtp", json=_SMTP_CFG)
    assert r.status_code == 200, r.text

    r = owner.post("/api/settings/smtp/test", json={})
    assert r.status_code == 400, r.text


# ---------------------------------------------------------------------------
# Task 2: email notification channel
# ---------------------------------------------------------------------------

def _owner_user_id(owner):
    """Return the user id of the test owner."""
    r = owner.get("/api/notify")
    assert r.status_code == 200, r.text
    # The owner fixture calls /api/setup/owner with email owner@example.com.
    # We need the user id to call email_pending directly.
    from omilo_api.db import session_scope
    from omilo_api.models import User
    with session_scope() as db:
        u = db.query(User).filter(User.email == "owner@example.com").first()
        assert u is not None, "owner user not found"
        return u.id


def _seed_smtp(owner):
    """PUT SMTP config via the API (real path: sets the encrypted password in DB)."""
    import smtplib
    # We need smtplib available so PUT doesn't blow up — monkeypatching happens in each test,
    # but for seeding we do it inline and restore.
    orig_smtp = smtplib.SMTP
    orig_ssl = smtplib.SMTP_SSL
    smtplib.SMTP = _FakeSMTP
    smtplib.SMTP_SSL = _FakeSMTP
    try:
        r = owner.put("/api/settings/smtp", json=_SMTP_CFG)
        assert r.status_code == 200, r.text
    finally:
        smtplib.SMTP = orig_smtp
        smtplib.SMTP_SSL = orig_ssl


def test_email_channel_in_config(owner):
    """GET /api/notify → channels includes 'email'; a kind's prefs dict includes an 'email' key."""
    r = owner.get("/api/notify")
    assert r.status_code == 200, r.text
    data = r.json()
    assert "email" in data["channels"], f"channels missing 'email': {data['channels']}"
    # All kinds should have an 'email' sub-key in prefs
    for kind, flags in data["prefs"]["kinds"].items():
        assert "email" in flags, f"kind '{kind}' prefs missing 'email' key: {flags}"


def test_email_pending_sends_when_enabled_and_configured(owner, monkeypatch):
    """SMTP configured + email pref True + matching Notice → email_pending sends 1 email + Notification row."""
    import asyncio
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    _seed_smtp(owner)

    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api import smtp
    from omilo_api.db import session_scope
    from omilo_api.models import Notice, Notification, Setting

    uid = _owner_user_id(owner)

    # Enable email for "inbox" kind
    with session_scope() as db:
        N.set_prefs(db, uid, {"kinds": {"inbox": {"email": True}}})

    # Record send_email calls without actually sending
    sent_calls = []

    def _record(db, to, subject, body):
        sent_calls.append({"to": to, "subject": subject, "body": body})

    monkeypatch.setattr(smtp, "send_email", _record)

    # Seed a push_cursor so email_pending can find fresh notices
    with session_scope() as db:
        cur = db.get(Setting, "email_cursor")
        if cur is None:
            # Seed it just before we add our notice so the notice is "fresh"
            from omilo_api.notify import latest_id
            db.add(Setting(key="email_cursor", value=latest_id(db)))
        # Add a Notice for inbox kind
        n = Notice(kind="inbox", title="Test approval needed", body="Please approve", url="/", tag="test-email-1", level="decision", who="bot")
        db.add(n)

    # Run email_pending
    count = asyncio.run(
        N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", "")
    )

    assert count >= 1, f"expected at least 1 sent, got {count}"
    assert len(sent_calls) >= 1, f"send_email not called; calls={sent_calls}"
    assert sent_calls[0]["to"] == "owner@example.com"

    with session_scope() as db:
        row = db.query(Notification).filter(
            Notification.channel == "email",
            Notification.action == "sent",
            Notification.user_id == uid,
        ).first()
        assert row is not None, "Notification(channel='email', action='sent') not found"


def test_email_pending_defers_held_then_sends(owner, monkeypatch):
    """Quiet-hours hold: email_pending sends 0 but backlogs the notice; clear quiet → sends it."""
    import asyncio
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    _seed_smtp(owner)

    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api import smtp
    from omilo_api.db import session_scope
    from omilo_api.models import Notice, Setting

    uid = _owner_user_id(owner)

    # Enable email for inbox and set quiet hours covering the full day (00:00–23:59)
    with session_scope() as db:
        N.set_prefs(db, uid, {"kinds": {"inbox": {"email": True}}, "quiet": {"on": True, "start": "00:00", "end": "23:59"}})

    sent_calls = []

    def _record(db, to, subject, body):
        sent_calls.append({"to": to, "subject": subject})

    monkeypatch.setattr(smtp, "send_email", _record)

    # Seed cursor and a fresh notice
    with session_scope() as db:
        from omilo_api.notify import latest_id
        cur = db.get(Setting, "email_cursor")
        if cur:
            cur.value = latest_id(db)
        else:
            db.add(Setting(key="email_cursor", value=latest_id(db)))
        n = Notice(kind="inbox", title="Held approval request", body="body", url="/", tag="test-held-1", level="decision", who="bot")
        db.add(n)

    # First call: user is in quiet hours → 0 sent, notice deferred to backlog
    count1 = asyncio.run(N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", ""))
    assert count1 == 0, f"expected 0 while quiet, got {count1}"
    assert sent_calls == [], f"no email should be sent during quiet hours; calls={sent_calls}"

    with session_scope() as db:
        ob = db.get(Setting, f"email_overflow:{uid}")
        assert ob is not None and ob.value, f"notice must be in email_overflow backlog; ob={ob}"
        _backlog_ids = ob.value

    # Clear quiet hours
    with session_scope() as db:
        N.set_prefs(db, uid, {"quiet": {"on": False}})

    # Second call: quiet is off → backlogged notice is sent
    count2 = asyncio.run(N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", ""))
    assert count2 >= 1, f"expected at least 1 sent after quiet cleared, got {count2}"
    assert len(sent_calls) >= 1, f"send_email should be called after quiet ends; calls={sent_calls}"

    # Backlog must be drained
    with session_scope() as db:
        ob2 = db.get(Setting, f"email_overflow:{uid}")
        assert not (ob2 and ob2.value), f"backlog should be empty after send; value={ob2.value if ob2 else None}"


def test_email_pending_noop_when_smtp_unconfigured(owner, monkeypatch):
    """email pref True but NO SMTP config → email_pending returns 0, send_email NOT called, no exception."""
    import asyncio

    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api import smtp
    from omilo_api.db import session_scope
    from omilo_api.models import Notice, Setting
    from omilo_api.services import set_setting

    uid = _owner_user_id(owner)

    # Enable email for inbox
    with session_scope() as db:
        N.set_prefs(db, uid, {"kinds": {"inbox": {"email": True}}})

    # Remove SMTP config so host is empty
    with session_scope() as db:
        set_setting(db, "smtp", {})

    sent_calls = []

    def _record(db, to, subject, body):
        sent_calls.append({"to": to})

    monkeypatch.setattr(smtp, "send_email", _record)

    # Seed a fresh notice so email_pending would send if SMTP were configured
    with session_scope() as db:
        cur = db.get(Setting, "email_cursor")
        from omilo_api.notify import latest_id
        if cur:
            cur.value = latest_id(db)
        else:
            db.add(Setting(key="email_cursor", value=latest_id(db)))
        n = Notice(kind="inbox", title="Unconfigured SMTP test", body="body", url="/", tag="test-noop", level="decision", who="bot")
        db.add(n)

    count = asyncio.run(
        N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", "")
    )

    assert count == 0, f"expected 0, got {count}"
    assert sent_calls == [], f"send_email must NOT be called; calls={sent_calls}"


def test_email_pending_respects_pref_off(owner, monkeypatch):
    """SMTP configured but email pref False for the kind → no email sent."""
    import asyncio
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    _seed_smtp(owner)

    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api import smtp
    from omilo_api.db import session_scope
    from omilo_api.models import Notice, Setting

    uid = _owner_user_id(owner)

    # Explicitly turn email OFF for inbox
    with session_scope() as db:
        N.set_prefs(db, uid, {"kinds": {"inbox": {"email": False}}})

    sent_calls = []

    def _record(db, to, subject, body):
        sent_calls.append({"to": to})

    monkeypatch.setattr(smtp, "send_email", _record)

    with session_scope() as db:
        cur = db.get(Setting, "email_cursor")
        from omilo_api.notify import latest_id
        if cur:
            cur.value = latest_id(db)
        else:
            db.add(Setting(key="email_cursor", value=latest_id(db)))
        n = Notice(kind="inbox", title="Pref-off test", body="body", url="/", tag="test-pref-off", level="decision", who="bot")
        db.add(n)

    count = asyncio.run(
        N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", "")
    )

    assert count == 0, f"expected 0, got {count}"
    assert sent_calls == [], f"send_email must NOT be called; calls={sent_calls}"


def test_email_pending_send_failure_advances_cursor_no_duplicate(owner, monkeypatch):
    """SmtpError during send → cursor still advances; second call does NOT replay the same notice."""
    import asyncio
    import smtplib
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)

    _seed_smtp(owner)

    from omilo_api import company as C
    from omilo_api import notify as N
    from omilo_api import smtp
    from omilo_api.db import session_scope
    from omilo_api.models import Notice, Setting

    uid = _owner_user_id(owner)

    # Enable email for inbox
    with session_scope() as db:
        N.set_prefs(db, uid, {"kinds": {"inbox": {"email": True}}})

    # Patch send_email to always raise SmtpError
    call_count = []

    def _always_fail(db, to, subject, body):
        call_count.append(1)
        raise smtp.SmtpError("simulated SMTP failure")

    monkeypatch.setattr(smtp, "send_email", _always_fail)

    # Place cursor just before a fresh notice
    with session_scope() as db:
        from omilo_api.notify import latest_id
        cur = db.get(Setting, "email_cursor")
        if cur:
            cur.value = latest_id(db)
        else:
            db.add(Setting(key="email_cursor", value=latest_id(db)))
        n = Notice(kind="inbox", title="Failure advance test", body="body", url="/", tag="test-fail-advance", level="decision", who="bot")
        db.add(n)

    # First call: send_email raises, but email_pending must return 0 (not raise) and advance cursor
    count1 = asyncio.run(
        N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", "")
    )
    assert count1 == 0, f"expected 0 sent (all failed), got {count1}"
    assert len(call_count) >= 1, "send_email should have been attempted at least once"

    # Second call: cursor already advanced, so the same notice must NOT be retried
    calls_before_2nd = len(call_count)
    count2 = asyncio.run(
        N.email_pending(session_scope, lambda: session_scope(C.MAIN), "", "")
    )
    assert count2 == 0, f"expected 0 on 2nd call (no new notices), got {count2}"
    assert len(call_count) == calls_before_2nd, (
        f"send_email was called again on 2nd run — cursor was NOT advanced: {call_count}"
    )
