"""Transactional email sender (SMTP) — a control-plane feature.

The auth flows that must reach the user by email — email verification,
magic-code sign-in, password reset, team invites, two-step codes — deliver
mail through this module.

Provider-agnostic: point the ``SMTP_*`` settings at any relay (Resend,
SendGrid, Mailgun, Postmark, SES, Gmail, …).  When ``smtp_host`` is unset the
sender raises a clear 503 rather than silently dropping mail.

Testing: install a :class:`CapturingEmailSender` with :func:`set_email_sender`
so tests can assert on the outbox without touching the network.
"""
from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from fastapi import HTTPException, status

from omilo.config import get_settings


@dataclass
class SentEmail:
    """A record of one delivered (or captured) message."""

    to: str
    subject: str
    text: str
    html: str | None = None
    from_name: str | None = None


class EmailSender:
    """Port: deliver one transactional email."""

    def send(
        self,
        to: str,
        subject: str,
        text: str,
        html: str | None = None,
        from_name: str | None = None,
    ) -> None:
        raise NotImplementedError


class SmtpEmailSender(EmailSender):
    """Real SMTP delivery via stdlib ``smtplib`` (STARTTLS or implicit TLS)."""

    def send(
        self,
        to: str,
        subject: str,
        text: str,
        html: str | None = None,
        from_name: str | None = None,
    ) -> None:
        s = get_settings()
        if not s.smtp_host:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email delivery is not configured. Set SMTP_HOST (and credentials).",
            )

        from_addr = s.smtp_from or s.smtp_user
        if not from_addr:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email delivery is not configured. Set SMTP_FROM or SMTP_USER.",
            )

        display = from_name or s.smtp_from_name
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = f"{display} <{from_addr}>" if display else from_addr
        msg["To"] = to
        msg.set_content(text)
        if html:
            msg.add_alternative(html, subtype="html")

        try:
            if s.smtp_ssl:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, context=context, timeout=15) as server:
                    if s.smtp_user:
                        server.login(s.smtp_user, s.smtp_password or "")
                    server.send_message(msg)
            else:
                with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15) as server:
                    server.ehlo()
                    if s.smtp_starttls:
                        server.starttls(context=ssl.create_default_context())
                        server.ehlo()
                    if s.smtp_user:
                        server.login(s.smtp_user, s.smtp_password or "")
                    server.send_message(msg)
        except (smtplib.SMTPException, OSError) as exc:
            # Surface delivery failures as a 502 so the caller knows the code/link
            # was NOT sent (vs a silent success that strands the user).
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not send the email. Please try again shortly.",
            ) from exc


class CapturingEmailSender(EmailSender):
    """Test double — records messages in ``outbox`` instead of sending."""

    def __init__(self) -> None:
        self.outbox: list[SentEmail] = []

    def send(
        self,
        to: str,
        subject: str,
        text: str,
        html: str | None = None,
        from_name: str | None = None,
    ) -> None:
        self.outbox.append(
            SentEmail(to=to, subject=subject, text=text, html=html, from_name=from_name)
        )

    def last_to(self, to: str) -> SentEmail | None:
        for m in reversed(self.outbox):
            if m.to == to:
                return m
        return None


# ── module-level sender (swappable for tests) ─────────────────────────────────

_sender: EmailSender | None = None


def get_email_sender() -> EmailSender:
    """Return the active sender (defaults to real SMTP)."""
    global _sender
    if _sender is None:
        _sender = SmtpEmailSender()
    return _sender


def set_email_sender(sender: EmailSender | None) -> None:
    """Override the active sender (tests) — pass ``None`` to reset to SMTP."""
    global _sender
    _sender = sender
