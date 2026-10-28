"""Transactional email bodies for the auth flows.

Each helper renders the shared Omilo email layout (pen "Email Templates") and
hands it to the active :func:`omilo.mailer.get_email_sender`.  OTP mails are
code-first (the 6-digit block is the focus); link mails (reset, invite) are
button-first.  All are signed by the Chief of Staff, matching the design.
"""
from __future__ import annotations

from omilo.auth.email_layout import button, code_block, render_email
from omilo.mailer import get_email_sender

_FROM = "Chief of Staff via Omilo"


def _send(to: str, subject: str, text: str, html: str) -> None:
    get_email_sender().send(to, subject, text, html, from_name=_FROM)


def send_verify_email(to: str, code: str) -> None:
    text = (
        f"Confirm your email for Omilo.\n\n"
        f"Your 6-digit code is: {code}\n\n"
        f"It expires in 10 minutes. If you didn't sign up, ignore this email."
    )
    html = render_email(
        preheader=f"Your code is {code} — expires in 10 minutes.",
        headline="Confirm your email",
        paragraphs=["Enter this 6-digit code to confirm your email address is yours."],
        focal=code_block(code),
        note="Expires in 10 minutes. If you didn't sign up, you can ignore this email.",
    )
    _send(to, "Confirm your email · Omilo", text, html)


def send_signin_code(to: str, code: str) -> None:
    text = (
        f"Your Omilo sign-in code is: {code}\n\n"
        f"It expires in 10 minutes. If you didn't request it, ignore this email."
    )
    html = render_email(
        preheader=f"Your sign-in code is {code} — expires in 10 minutes.",
        headline="Your sign-in code",
        paragraphs=["Use this 6-digit code to sign in to Omilo."],
        focal=code_block(code),
        note="Expires in 10 minutes. If you didn't request it, you can ignore this email.",
    )
    _send(to, "Your sign-in code · Omilo", text, html)


def send_two_factor_code(to: str, code: str) -> None:
    text = (
        f"Your Omilo two-step verification code is: {code}\n\n"
        f"It expires in 10 minutes."
    )
    html = render_email(
        preheader=f"Your verification code is {code} — expires in 10 minutes.",
        headline="Two-step verification",
        paragraphs=["Enter this 6-digit code to finish signing in."],
        focal=code_block(code),
        note="Expires in 10 minutes.",
    )
    _send(to, "Your verification code · Omilo", text, html)


def send_password_reset(to: str, link: str) -> None:
    text = (
        f"Reset your Omilo password.\n\n"
        f"Open this link to choose a new one (valid for 30 minutes):\n{link}\n\n"
        f"If you didn't request this, ignore this email — your password is unchanged."
    )
    html = render_email(
        preheader="Choose a new password — the link works for 30 minutes.",
        headline="Reset your password",
        paragraphs=["Click the button to choose a new password. The link works for 30 minutes."],
        focal=button("Set a new password", link),
        note="If you didn't request this, ignore this email — your password is unchanged.",
    )
    _send(to, "Reset your password · Omilo", text, html)


def send_invite(to: str, link: str, company_name: str, inviter_name: str | None, role: str) -> None:
    who = f"{inviter_name} invited you" if inviter_name else "You've been invited"
    text = (
        f"{who} to join {company_name} on Omilo as a {role}.\n\n"
        f"Accept your invite (valid for 7 days):\n{link}"
    )
    html = render_email(
        preheader=f"{who} to join {company_name} as a {role}.",
        headline=f"Join {company_name}",
        paragraphs=[f"{who} to join {company_name} on Omilo. You'll come in as a {role}."],
        focal=button("Accept invite", link),
        note="This invite expires in 7 days.",
        company=company_name,
    )
    _send(to, f"Join {company_name} on Omilo", text, html)
