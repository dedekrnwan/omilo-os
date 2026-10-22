"""Telegram channel adapter — all Telegram specifics live here.

Nothing Telegram-specific (token-in-path, setWebhook, update shapes,
x-telegram-bot-api-secret-token) may leak into other modules.
"""
from __future__ import annotations

import hmac
import json
import logging
import secrets
from typing import TYPE_CHECKING

import httpx

from omilo_api.channels.base import ChannelAdapter, InboundEvent, OutMessage, SendResult

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pairing-code store
#
# MVP approach: in-process dict  {webhook_token -> pairing_code}.
# Single-use: the code is deleted after it is consumed.
#
# LIMITATION: does NOT survive process restarts and does NOT work in
# multi-process / multi-replica deployments.  A future iteration should
# move this to Redis (short TTL key) or a DB row with role="pending".
# ---------------------------------------------------------------------------
_PENDING_PAIRING: dict[str, str] = {}  # webhook_token -> pairing_code

_TELEGRAM_API = "https://api.telegram.org"


def _tg_url(token: str, method: str) -> str:
    """Build a Telegram Bot API URL with the token embedded in the path.

    The token MUST remain in the path, never in headers or logs.
    """
    return f"{_TELEGRAM_API}/bot{token}/{method}"


def _token_from_conn(conn) -> str | None:
    """Extract and decrypt the bot token from a ChannelConnection.

    Returns None (and logs a warning) if the secrets cannot be read.
    Never logs the token value itself.
    """
    from omilo_api.security import decrypt

    raw = decrypt(conn.secrets_enc)
    if not raw:
        log.warning("channel_connection %s: failed to decrypt secrets_enc", conn.id)
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        log.warning("channel_connection %s: secrets_enc is not valid JSON", conn.id)
        return None
    token = data.get("bot_token")
    if not token:
        log.warning("channel_connection %s: no bot_token in secrets", conn.id)
    return token or None


def _secret_from_conn(conn) -> str | None:
    """Extract the secret_token from a ChannelConnection's decrypted secrets."""
    from omilo_api.security import decrypt

    raw = decrypt(conn.secrets_enc)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    return data.get("secret_token")


class TelegramAdapter:
    """Telegram Bot API channel adapter.

    All Telegram-specific logic (token-in-path, setWebhook, update shapes,
    x-telegram-bot-api-secret-token header) is encapsulated here.
    """

    kind = "telegram"

    # ------------------------------------------------------------------
    # connect
    # ------------------------------------------------------------------

    def connect(self, config: dict) -> dict:
        """Register a Telegram bot and set up its webhook.

        config must contain:
            bot_token  — the Telegram Bot API token (kept secret, never logged)
            mode       — "control" | "notify" | "both"
            staff_id   — which Omilo helper handles this channel

        Returns a dict with:
            secrets        — {bot_token, secret_token, webhook_token} to be
                             encrypted and stored in ChannelConnection.secrets_enc
            webhook_token  — the URL token (also in secrets, surfaced for the route)
            pairing_code   — short one-time code the owner sends via /start
            deep_link      — https://t.me/<bot>?start=<code> the owner can tap
        """
        from omilo_api.company import prefix
        from omilo_api.config import get_settings

        bot_token = config["bot_token"]
        webhook_token = secrets.token_urlsafe(32)
        secret_token = secrets.token_urlsafe(32)
        pairing_code = secrets.token_urlsafe(8)

        public_url = get_settings().public_url.rstrip("/")
        company_prefix = prefix()
        hook_url = f"{public_url}{company_prefix}/api/channels/telegram/hook/{webhook_token}"

        # POST setWebhook — token in path, never in logs
        resp = httpx.post(
            _tg_url(bot_token, "setWebhook"),
            json={"url": hook_url, "secret_token": secret_token},
        )
        resp.raise_for_status()

        # Store pairing code in the in-process store (keyed by webhook_token)
        _PENDING_PAIRING[webhook_token] = pairing_code

        # Deep link: bot username may not be in config; use placeholder if absent
        bot_username = config.get("bot_username") or "your_bot"
        deep_link = f"https://t.me/{bot_username}?start={pairing_code}"

        return {
            "secrets": {
                "bot_token": bot_token,
                "secret_token": secret_token,
                "webhook_token": webhook_token,
            },
            "webhook_token": webhook_token,
            "pairing_code": pairing_code,
            "deep_link": deep_link,
        }

    # ------------------------------------------------------------------
    # disconnect
    # ------------------------------------------------------------------

    def disconnect(self, conn) -> None:
        """Remove the webhook and invalidate any pending pairing code."""
        token = _token_from_conn(conn)
        if token:
            try:
                httpx.post(_tg_url(token, "deleteWebhook"))
            except Exception:  # noqa: BLE001
                log.warning("channel_connection %s: deleteWebhook failed", conn.id)

        from omilo_api.security import decrypt

        raw = decrypt(conn.secrets_enc) if conn.secrets_enc else None
        if raw:
            try:
                data = json.loads(raw)
                wt = data.get("webhook_token")
                if wt:
                    _PENDING_PAIRING.pop(wt, None)
            except (ValueError, TypeError):
                pass

    # ------------------------------------------------------------------
    # send
    # ------------------------------------------------------------------

    def send(self, conn, target: str, message: OutMessage) -> SendResult:
        """Send a message to a Telegram chat.

        The bot token is embedded in the path per Telegram Bot API convention.
        """
        token = _token_from_conn(conn)
        if not token:
            return SendResult(ok=False, error="could not read bot token from connection")

        payload: dict = {"chat_id": target, "text": message.text}

        if message.buttons:
            payload["reply_markup"] = {
                "inline_keyboard": [
                    [{"text": b, "callback_data": b} for b in message.buttons]
                ]
            }

        try:
            resp = httpx.post(_tg_url(token, "sendMessage"), json=payload)
        except Exception as exc:  # noqa: BLE001
            log.error("channel send transport error: %s", exc)
            return SendResult(ok=False, error=str(exc))

        if resp.is_success:
            return SendResult(ok=True)
        return SendResult(ok=False, error=f"telegram {resp.status_code}: {resp.text[:200]}")

    # ------------------------------------------------------------------
    # verify_inbound
    # ------------------------------------------------------------------

    def verify_inbound(self, conn, headers: dict) -> bool:
        """Constant-time check of the x-telegram-bot-api-secret-token header."""
        # Normalise header keys to lower-case for case-insensitive lookup
        lower = {k.lower(): v for k, v in headers.items()}
        incoming = lower.get("x-telegram-bot-api-secret-token", "")

        stored = _secret_from_conn(conn)
        if not stored:
            return False

        return hmac.compare_digest(incoming, stored)

    # ------------------------------------------------------------------
    # normalize_inbound
    # ------------------------------------------------------------------

    def normalize_inbound(self, conn, raw: dict) -> list[InboundEvent]:
        """Parse a Telegram Update into a list of InboundEvents."""
        events: list[InboundEvent] = []

        msg = raw.get("message") or raw.get("edited_message")
        if not msg:
            return events

        chat = msg.get("chat", {})
        from_user = msg.get("from", {})
        platform_user_id = str(from_user.get("id", ""))
        first = from_user.get("first_name", "")
        last = from_user.get("last_name", "")
        sender_display = f"{first} {last}".strip() or platform_user_id
        text = msg.get("text", "")

        events.append(
            InboundEvent(
                connection_id=conn.id,
                kind="message",
                platform_user_id=platform_user_id,
                sender_display=sender_display,
                role="member",  # refined by classify_sender after lookup
                thread_key=str(chat.get("id", "")),
                text=text,
                payload=raw,
            )
        )
        return events

    # ------------------------------------------------------------------
    # classify_sender
    # ------------------------------------------------------------------

    def classify_sender(self, conn, platform_user_id: str) -> str:
        """Return the role for a given Telegram user (owner/member/unknown)."""
        # Delegate to the DB-side lookup in the route layer; default to member.
        return "member"

    # ------------------------------------------------------------------
    # consume_pairing
    # ------------------------------------------------------------------

    def consume_pairing(
        self,
        db: "Session",
        code: str,
        platform_user_id: str,
        omilo_user_id: str,
        connection_id: str,
    ) -> bool:
        """Validate a one-time pairing code and create the owner ChannelIdentity.

        Returns True if the code was valid and unused, False otherwise.
        On success the code is invalidated immediately (single-use).
        """
        from omilo_api.models import ChannelConnection, ChannelIdentity
        from sqlalchemy import select

        # Retrieve the webhook_token for this connection to look up the code
        conn = db.get(ChannelConnection, connection_id)
        if not conn:
            return False

        from omilo_api.security import decrypt
        raw = decrypt(conn.secrets_enc)
        if not raw:
            return False
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return False

        webhook_token = data.get("webhook_token")
        if not webhook_token:
            return False

        stored_code = _PENDING_PAIRING.get(webhook_token)
        if not stored_code or not hmac.compare_digest(stored_code, code):
            return False

        # Invalidate immediately (single-use)
        del _PENDING_PAIRING[webhook_token]

        # Create the owner identity
        identity = ChannelIdentity(
            connection_id=connection_id,
            platform_user_id=platform_user_id,
            omilo_user_id=omilo_user_id,
            role="owner",
        )
        db.add(identity)
        db.commit()
        return True
