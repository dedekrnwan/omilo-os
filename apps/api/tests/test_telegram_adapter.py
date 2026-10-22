"""Task 4: TelegramAdapter — connect/send/verify_inbound/consume_pairing.

Uses an in-memory SQLite engine (same pattern as test_channels_models.py) so
this runs without Postgres/Redis.  httpx calls are intercepted with respx.
"""
from __future__ import annotations

import json
import pytest
import respx
import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


# ---------------------------------------------------------------------------
# DB fixture (SQLite, no Postgres needed)
# ---------------------------------------------------------------------------

@pytest.fixture
def db(tmp_path):
    from omilo_api import models as _models  # noqa: F401 — registers ORM classes
    from omilo_api.db import Base

    eng = create_engine(f"sqlite:///{tmp_path}/telegram_test.db")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        yield s
    eng.dispose()


# ---------------------------------------------------------------------------
# Helpers: fake ChannelConnection objects
# ---------------------------------------------------------------------------

def _make_secrets(*, bot_token="TOK", secret_token="SEC", webhook_token="WTOK") -> str:
    """Return an encrypted secrets blob for use in a fake conn."""
    from omilo_api.security import encrypt

    return encrypt(json.dumps({
        "bot_token": bot_token,
        "secret_token": secret_token,
        "webhook_token": webhook_token,
    }))


class _FakeConn:
    """Minimal ChannelConnection stand-in for tests that don't need a real DB row."""

    def __init__(self, *, bot_token="TOK", secret_token="SEC", webhook_token="WTOK"):
        self.id = "conn-1"
        self.secrets_enc = _make_secrets(
            bot_token=bot_token,
            secret_token=secret_token,
            webhook_token=webhook_token,
        )


def _conn(*, token="TOK", secret="SEC", webhook="WTOK") -> _FakeConn:
    return _FakeConn(bot_token=token, secret_token=secret, webhook_token=webhook)


# ---------------------------------------------------------------------------
# respx mock helper
# ---------------------------------------------------------------------------

def _mock_httpx_router():
    """Return a respx Router that captures every POST and records calls."""
    return respx.MockRouter(assert_all_called=False)


# ---------------------------------------------------------------------------
# tests: connect
# ---------------------------------------------------------------------------

def _ok_response(url: str) -> httpx.Response:
    """Build an httpx.Response(200) with a request attached (required for raise_for_status)."""
    req = httpx.Request("POST", url)
    return httpx.Response(200, json={"ok": True}, request=req)


def test_connect_calls_setwebhook_and_returns_secrets(tmp_path, monkeypatch):
    """connect() must POST setWebhook and return webhook_token + pairing_code."""
    # Point settings at a clean temp dir so no stale keys interfere
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_SECRET_KEY", "test-secret-key-1234")

    # Invalidate the lru_cache so env overrides take effect
    from omilo_api.config import get_settings
    get_settings.cache_clear()

    calls: list[dict] = []

    def _fake_post(url, *, json=None, **kwargs):
        calls.append({"url": url, "json": json})
        return _ok_response(url)

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
    _PENDING_PAIRING.clear()

    a = TelegramAdapter()
    out = a.connect({"bot_token": "T", "mode": "control", "staff_id": "chief-of-staff"})

    # setWebhook must have been called
    assert len(calls) == 1
    url = calls[0]["url"]
    assert "setWebhook" in url
    # token must be in the path, not leaked elsewhere
    assert "api.telegram.org" in url

    # Return value must carry pairing info
    assert out["webhook_token"], "webhook_token must be non-empty"
    assert out["pairing_code"], "pairing_code must be non-empty"
    assert out["secrets"]["bot_token"] == "T"
    assert out["secrets"]["secret_token"]
    assert out["secrets"]["webhook_token"] == out["webhook_token"]

    # Pairing code must be registered in the in-process store
    assert _PENDING_PAIRING.get(out["webhook_token"]) == out["pairing_code"]

    _PENDING_PAIRING.clear()


def test_connect_webhook_url_contains_webhook_token(tmp_path, monkeypatch):
    """The URL posted to setWebhook must embed the webhook_token."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_SECRET_KEY", "test-secret-key-1234")
    monkeypatch.setenv("OMILO_PUBLIC_URL", "https://example.com")

    # Invalidate the lru_cache so OMILO_PUBLIC_URL override takes effect
    from omilo_api.config import get_settings
    get_settings.cache_clear()

    calls: list[dict] = []

    def _fake_post(url, *, json=None, **kwargs):
        calls.append({"url": url, "json": json})
        return _ok_response(url)

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
    _PENDING_PAIRING.clear()

    a = TelegramAdapter()
    out = a.connect({"bot_token": "T", "mode": "control", "staff_id": "s"})

    hook_url = calls[0]["json"]["url"]
    assert out["webhook_token"] in hook_url
    assert "example.com" in hook_url
    assert "/api/channels/telegram/hook/" in hook_url

    _PENDING_PAIRING.clear()


# ---------------------------------------------------------------------------
# tests: send
# ---------------------------------------------------------------------------

def test_send_puts_token_in_path(monkeypatch):
    """send() must POST to https://api.telegram.org/bot<TOKEN>/sendMessage (brief-style test)."""
    from omilo_api.channels.base import OutMessage

    calls: list[dict] = []

    def _fake_post(url, *, json=None, **kwargs):
        calls.append({"url": url, "json": json})
        return httpx.Response(200, json={"ok": True})

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    result = a.send(_conn(token="TOK"), "4242", OutMessage(text="hi", buttons=None))

    assert calls[-1]["url"] == "https://api.telegram.org/botTOK/sendMessage"
    assert calls[-1]["json"]["chat_id"] == "4242"
    assert calls[-1]["json"]["text"] == "hi"
    assert result.ok is True


def test_send_with_buttons_includes_inline_keyboard(monkeypatch):
    """send() with buttons must include reply_markup with inline_keyboard."""
    from omilo_api.channels.base import OutMessage

    calls: list[dict] = []

    def _fake_post(url, *, json=None, **kwargs):
        calls.append({"url": url, "json": json})
        return httpx.Response(200, json={"ok": True})

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    a.send(_conn(token="TOK"), "99", OutMessage(text="pick one", buttons=["Yes", "No"]))

    payload = calls[-1]["json"]
    assert "reply_markup" in payload
    kb = payload["reply_markup"]["inline_keyboard"]
    assert len(kb) == 1
    labels = [btn["text"] for btn in kb[0]]
    assert labels == ["Yes", "No"]


def test_send_returns_error_on_4xx(monkeypatch):
    """send() should return SendResult(ok=False) on a non-2xx response."""
    from omilo_api.channels.base import OutMessage

    def _fake_post(url, *, json=None, **kwargs):
        return httpx.Response(400, json={"ok": False, "description": "bad request"})

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    result = a.send(_conn(token="TOK"), "99", OutMessage(text="hi"))

    assert result.ok is False
    assert result.error


def test_send_catches_transport_error(monkeypatch):
    """send() must swallow transport exceptions and return SendResult(ok=False)."""
    from omilo_api.channels.base import OutMessage

    def _fake_post(url, *, json=None, **kwargs):
        raise httpx.ConnectError("connection refused")

    import omilo_api.channels.telegram as tg_mod
    monkeypatch.setattr(tg_mod.httpx, "post", _fake_post)

    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    result = a.send(_conn(token="TOK"), "99", OutMessage(text="hi"))

    assert result.ok is False
    assert result.error


# ---------------------------------------------------------------------------
# tests: verify_inbound
# ---------------------------------------------------------------------------

def test_verify_inbound_rejects_bad_secret():
    """verify_inbound must return True on match, False on mismatch."""
    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    assert a.verify_inbound(_conn(secret="S"), {"x-telegram-bot-api-secret-token": "S"}) is True
    assert a.verify_inbound(_conn(secret="S"), {"x-telegram-bot-api-secret-token": "X"}) is False


def test_verify_inbound_missing_header_is_false():
    """verify_inbound returns False when the header is absent."""
    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    assert a.verify_inbound(_conn(secret="S"), {}) is False


def test_verify_inbound_case_insensitive_header():
    """Header lookup must be case-insensitive."""
    from omilo_api.channels.telegram import TelegramAdapter

    a = TelegramAdapter()
    # Mixed-case header key should still match
    assert a.verify_inbound(_conn(secret="S"), {"X-Telegram-Bot-Api-Secret-Token": "S"}) is True


# ---------------------------------------------------------------------------
# tests: consume_pairing
# ---------------------------------------------------------------------------

def test_consume_pairing_valid_code_creates_identity(db, tmp_path, monkeypatch):
    """A valid pairing code binds a ChannelIdentity with role=owner."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_SECRET_KEY", "test-secret-key-5678")

    from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
    from omilo_api.models import ChannelConnection, ChannelIdentity
    from omilo_api.security import encrypt
    from sqlalchemy import select

    webhook_token = "WH-TOKEN-TEST"
    pairing_code = "CODE123"
    secrets_blob = encrypt(json.dumps({
        "bot_token": "BOT",
        "secret_token": "SEC",
        "webhook_token": webhook_token,
    }))

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="s1",
        webhook_token=webhook_token,
        secrets_enc=secrets_blob,
        enabled=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    _PENDING_PAIRING[webhook_token] = pairing_code

    a = TelegramAdapter()
    result = a.consume_pairing(
        db,
        pairing_code,
        platform_user_id="tg-user-99",
        omilo_user_id="omilo-u-1",
        connection_id=conn.id,
    )

    assert result is True
    identity = db.scalar(
        select(ChannelIdentity).where(ChannelIdentity.connection_id == conn.id)
    )
    assert identity is not None
    assert identity.platform_user_id == "tg-user-99"
    assert identity.omilo_user_id == "omilo-u-1"
    assert identity.role == "owner"
    # Code must be consumed
    assert webhook_token not in _PENDING_PAIRING

    _PENDING_PAIRING.clear()


def test_consume_pairing_wrong_code_returns_false(db, tmp_path, monkeypatch):
    """A wrong pairing code returns False and creates no identity."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_SECRET_KEY", "test-secret-key-5678")

    from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
    from omilo_api.models import ChannelConnection
    from omilo_api.security import encrypt

    webhook_token = "WH-WRONG-TEST"
    secrets_blob = encrypt(json.dumps({
        "bot_token": "BOT",
        "secret_token": "SEC",
        "webhook_token": webhook_token,
    }))

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="s2",
        webhook_token=webhook_token,
        secrets_enc=secrets_blob,
        enabled=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    _PENDING_PAIRING[webhook_token] = "RIGHT-CODE"

    a = TelegramAdapter()
    result = a.consume_pairing(
        db,
        "WRONG-CODE",
        platform_user_id="tg-user-99",
        omilo_user_id="omilo-u-1",
        connection_id=conn.id,
    )

    assert result is False
    # Code must NOT be consumed
    assert _PENDING_PAIRING.get(webhook_token) == "RIGHT-CODE"

    _PENDING_PAIRING.clear()


def test_consume_pairing_second_use_returns_false(db, tmp_path, monkeypatch):
    """A consumed pairing code cannot be used again."""
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OMILO_SECRET_KEY", "test-secret-key-5678")

    from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
    from omilo_api.models import ChannelConnection
    from omilo_api.security import encrypt

    webhook_token = "WH-REUSE-TEST"
    pairing_code = "ONE-TIME"
    secrets_blob = encrypt(json.dumps({
        "bot_token": "BOT",
        "secret_token": "SEC",
        "webhook_token": webhook_token,
    }))

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="s3",
        webhook_token=webhook_token,
        secrets_enc=secrets_blob,
        enabled=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    _PENDING_PAIRING[webhook_token] = pairing_code

    a = TelegramAdapter()
    # First use: succeeds
    assert a.consume_pairing(db, pairing_code, "u1", "ou1", conn.id) is True
    # Second use: must fail
    assert a.consume_pairing(db, pairing_code, "u2", "ou2", conn.id) is False

    _PENDING_PAIRING.clear()
