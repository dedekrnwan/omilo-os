"""Rendering tests for the pen "Email Templates" system (no DB, no SMTP)."""
from __future__ import annotations

import re
from email import message_from_bytes

import pytest

from omilo import mailer
from omilo.emails import layout, send
from omilo.emails.preview import samples

ALL = samples()


@pytest.mark.parametrize("name", sorted(ALL))
def test_renders_email_safe_html(name):
    mail = ALL[name]
    html = mail.html
    assert html.startswith("<!doctype html>")
    assert mail.subject and mail.preheader and mail.from_name and mail.text.strip()
    # Gmail strips SVG and <style> layout — the body must be tables + inline styles.
    assert "<svg" not in html
    assert "display:flex" not in html and "display:grid" not in html
    assert 'width="600"' in html
    # Shared shell: brand header and the Saga address line in the footer.
    assert "Omilo · Saga OS — open source AI staff · Jakarta, Indonesia" in html
    # Every inline image the HTML references is attached, and nothing extra.
    cids = set(re.findall(r"cid:([a-z0-9-]+@omilo)", html))
    assert cids and cids == set(mail.images)
    assert all(data[:8] == b"\x89PNG\r\n\x1a\n" for data in mail.images.values())
    # Comfortably under Gmail's 102 KB clipping limit.
    assert len(html.encode()) < 60_000


def test_helpers_sign_their_own_mail():
    assert ALL["03-approval"].from_name == "Sales via Omilo"
    assert ALL["02-welcome"].from_name == "Chief of Staff via Omilo"
    assert ALL["05-alert"].from_name == "Omilo alerts"
    assert ALL["01-waitlist"].from_name == "Omilo"
    assert "mascot-sales@omilo" in ALL["03-approval"].images
    assert "mascot-support-worried@omilo" in ALL["05-alert"].images


def test_user_text_is_escaped():
    from omilo.emails import templates as t

    mail = t.render_invite(link="https://x/?a=1&b=2", company="<Acme & Co>", inviter_name="R",
                           role="member", links=t.Links.for_base("https://app"))
    assert "<Acme" not in mail.html and "&lt;Acme &amp; Co&gt;" in mail.html
    assert 'href="https://x/?a=1&amp;b=2"' in mail.html


def test_codes_and_links_stay_in_plain_text():
    assert "482913" in ALL["10-verify-email"].text
    assert "token=x" in ALL["13-password-reset"].text


def test_unknown_mascot_falls_back_to_chief():
    assert "cid:mascot-brand@omilo" in layout.mascot("nobody", 32)


def test_smtp_message_carries_inline_images(monkeypatch):
    """SmtpEmailSender builds multipart/related with each cid attached inline."""
    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def ehlo(self): pass
        def starttls(self, **k): pass
        def login(self, *a): pass
        def send_message(self, msg): sent["msg"] = msg

    class S:
        smtp_host, smtp_port, smtp_user, smtp_password = "smtp.test", 587, None, None
        smtp_from, smtp_from_name, smtp_ssl, smtp_starttls = "helpers@omilo.app", "Omilo", False, False

    monkeypatch.setattr(mailer, "get_settings", lambda: S)
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    mailer.set_email_sender(None)
    try:
        send("rina@test.example", ALL["02-welcome"])
    finally:
        mailer.set_email_sender(None)

    msg = message_from_bytes(sent["msg"].as_bytes())
    assert msg["From"] == "Chief of Staff via Omilo <helpers@omilo.app>"
    cids = {p["Content-ID"] for p in msg.walk() if p.get_content_type() == "image/png"}
    assert cids == {f"<{c}>" for c in ALL["02-welcome"].images}
    assert any(p.get_content_type() == "multipart/related" for p in msg.walk())
