"""Company-level SMTP configuration and email sending.

Passwords are stored encrypted via security.encrypt/decrypt (Fernet).
NO plaintext password is ever returned to callers.
"""
from __future__ import annotations

import smtplib
from email.message import EmailMessage

from sqlalchemy.orm import Session

from . import security
from .services import get_setting, set_setting

_SMTP_KEY = "smtp"
_VALID_SECURITY = {"none", "tls", "ssl"}

_DEFAULTS: dict = {
    "host": "",
    "port": 587,
    "security": "tls",
    "username": "",
    "from_addr": "",
}


class SmtpError(Exception):
    """Raised for SMTP misconfiguration or send failures."""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_config(db: Session) -> dict:
    """Return the stored SMTP config WITHOUT the password.

    Returns sensible empty defaults when no config has been saved yet.
    ``has_password`` is True when an encrypted password is stored.
    """
    raw: dict = get_setting(db, _SMTP_KEY) or {}
    return {
        "host": raw.get("host", _DEFAULTS["host"]),
        "port": raw.get("port", _DEFAULTS["port"]),
        "security": raw.get("security", _DEFAULTS["security"]),
        "username": raw.get("username", _DEFAULTS["username"]),
        "from_addr": raw.get("from_addr", _DEFAULTS["from_addr"]),
        "has_password": bool(raw.get("password_enc")),
    }


def set_config(db: Session, cfg: dict) -> None:
    """Validate *cfg* and persist it.

    If ``cfg["password"]`` is a non-empty string, encrypt and store it.
    If it is omitted or empty, preserve the previously-stored encrypted password.
    Raises SmtpError on invalid input.
    """
    host = cfg.get("host", "")
    if not host:
        raise SmtpError("host must not be empty")

    port = cfg.get("port", 587)
    try:
        port = int(port)
    except (TypeError, ValueError):
        raise SmtpError("port must be an integer")

    sec = cfg.get("security", "tls")
    if sec not in _VALID_SECURITY:
        raise SmtpError(f"security must be one of: {', '.join(sorted(_VALID_SECURITY))}")

    # Load existing row so we can preserve the encrypted password when the caller
    # does not supply a new one.
    existing: dict = get_setting(db, _SMTP_KEY) or {}

    stored: dict = {
        "host": host,
        "port": port,
        "security": sec,
        "username": cfg.get("username", ""),
        "from_addr": cfg.get("from_addr", ""),
    }

    pw = cfg.get("password")
    if pw and isinstance(pw, str) and pw.strip():
        stored["password_enc"] = security.encrypt(pw)
    elif existing.get("password_enc"):
        stored["password_enc"] = existing["password_enc"]

    # set_setting audits + commits
    set_setting(db, _SMTP_KEY, stored)


def send_email(db: Session, to: str, subject: str, body: str) -> None:
    """Send a plain-text email using the stored SMTP config.

    Raises SmtpError if the config is incomplete or if sending fails.
    Always uses timeout=10.
    """
    raw: dict = get_setting(db, _SMTP_KEY) or {}
    host = raw.get("host", "")

    if not host:
        raise SmtpError("SMTP not configured")

    password_enc = raw.get("password_enc")
    pw: str | None = None
    if password_enc:
        pw = security.decrypt(password_enc)

    sec = raw.get("security", "tls")
    port = raw.get("port", 587)
    username = raw.get("username", "")
    from_addr = raw.get("from_addr", "")

    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if sec == "ssl":
            with smtplib.SMTP_SSL(host, port, timeout=10) as conn:
                if username and pw:
                    conn.login(username, pw)
                conn.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=10) as conn:
                if sec == "tls":
                    conn.starttls()
                if username and pw:
                    conn.login(username, pw)
                conn.send_message(msg)
    except SmtpError:
        raise
    except Exception as exc:
        raise SmtpError(str(exc)) from exc


def test_send(db: Session, to: str) -> None:
    """Send a canned test message to *to*.  SmtpError propagates to the caller."""
    send_email(
        db,
        to=to,
        subject="Omilo SMTP test",
        body="This is a test message sent by Omilo to verify your SMTP configuration.",
    )
