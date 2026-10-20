"""Tests for company-level SMTP config + test-send endpoints.

All smtplib calls are monkeypatched — NO real email is ever sent.
"""
import json

import pytest

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
