"""Omilo transactional email — pen "Email Templates" layout, templates, delivery.

    from omilo.emails import send, templates
    send(to, templates.render_welcome(...))
"""
from __future__ import annotations

from omilo.emails.templates import RenderedEmail


def send(to: str, mail: RenderedEmail) -> None:
    """Deliver a rendered email through the active sender (SMTP, or a test capture)."""
    from omilo.mailer import get_email_sender

    get_email_sender().send(
        to, mail.subject, mail.text, mail.html, from_name=mail.from_name, images=mail.images,
    )


__all__ = ["RenderedEmail", "send"]
