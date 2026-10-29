"""Transactional email for the auth flows.

Each helper renders a template from :mod:`omilo.emails.templates` (pen "Email
Templates" system) and delivers it through the active sender.  OTP mails are
code-first; link mails (reset, invite) are button-first.  All are signed by
the Chief of Staff.
"""
from __future__ import annotations

from omilo.config import get_settings
from omilo.emails import send
from omilo.emails import templates as t


def _links() -> t.Links:
    return t.Links.for_base(get_settings().frontend_base)


def send_verify_email(to: str, code: str) -> None:
    send(to, t.render_verify_email(code=code, links=_links()))


def send_signin_code(to: str, code: str) -> None:
    send(to, t.render_signin_code(code=code, links=_links()))


def send_two_factor_code(to: str, code: str) -> None:
    send(to, t.render_two_factor_code(code=code, links=_links()))


def send_password_reset(to: str, link: str) -> None:
    send(to, t.render_password_reset(link=link, links=_links()))


def send_invite(to: str, link: str, company_name: str, inviter_name: str | None, role: str) -> None:
    send(to, t.render_invite(link=link, company=company_name, inviter_name=inviter_name,
                             role=role, links=_links()))
