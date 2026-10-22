"""Task 5: Telegram webhook ingress + control bridge.

TDD approach: four tests covering the key paths defined in the brief.

Seeding strategy
----------------
- Uses the shared live-server `owner` and `base_url` fixtures from conftest.
- Seeds ChannelConnection + ChannelIdentity directly into the DB via session_scope().
- Mocks adapter.verify_inbound so no real Telegram secret is needed, and mocks
  httpx.post so no real Telegram API calls are made.
- registry.reset() + register the real TelegramAdapter in an autouse fixture.

Company prefix
--------------
The `owner` fixture hits the MAIN company with no /co/<id>/ prefix.
CompanyMiddleware resolves company=main from the /api/channels/telegram/hook/{token}
path (no /co/ prefix → defaults to main), so the DB session targets co_main.
The seeded rows are also written to co_main via session_scope() (default = main).
"""
from __future__ import annotations

import json

import pytest

from omilo_api.channels import registry
from omilo_api.channels.telegram import TelegramAdapter, _PENDING_PAIRING
from omilo_api.db import session_scope
from omilo_api.models import ChannelConnection, ChannelIdentity, Message, Thread
from omilo_api.security import encrypt
from sqlalchemy import select

# ---------------------------------------------------------------------------
# Constants used across tests
# ---------------------------------------------------------------------------

WTOK = "test-webhook-token-abc123"
SECRET = "test-secret-token-xyz789"
STAFF_ID = "chief-of-staff"
OWNER_TG_ID = "99"
OMILO_USER_ID = "u-owner-test"
CODE123 = "CODE123"


def _make_secrets_enc() -> str:
    return encrypt(json.dumps({
        "bot_token": "FAKE_BOT_TOKEN",
        "secret_token": SECRET,
        "webhook_token": WTOK,
    }))


# ---------------------------------------------------------------------------
# Registry isolation + adapter registration
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _register_adapter():
    """Reset + register the real TelegramAdapter; clean up after."""
    registry.reset()
    registry.register(TelegramAdapter())
    yield
    registry.reset()


# ---------------------------------------------------------------------------
# DB seed fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def seeded_control_conn_and_pairing():
    """Seed a ChannelConnection + owner ChannelIdentity in the main company DB."""
    with session_scope() as db:
        # Remove any leftover row from a previous run
        old = db.scalar(
            select(ChannelConnection).where(ChannelConnection.webhook_token == WTOK)
        )
        if old:
            # delete identities first
            for ident in db.scalars(
                select(ChannelIdentity).where(ChannelIdentity.connection_id == old.id)
            ):
                db.delete(ident)
            db.delete(old)
            db.commit()

        conn = ChannelConnection(
            kind="telegram",
            mode="control",
            staff_id=STAFF_ID,
            webhook_token=WTOK,
            secrets_enc=_make_secrets_enc(),
            enabled=True,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)

        identity = ChannelIdentity(
            connection_id=conn.id,
            platform_user_id=OWNER_TG_ID,
            omilo_user_id=OMILO_USER_ID,
            role="owner",
        )
        db.add(identity)
        db.commit()

        conn_id = conn.id

    yield conn_id

    # Teardown: remove seed rows
    with session_scope() as db:
        for ident in db.scalars(
            select(ChannelIdentity).where(ChannelIdentity.connection_id == conn_id)
        ):
            db.delete(ident)
        old = db.get(ChannelConnection, conn_id)
        if old:
            db.delete(old)
        # Remove any threads created for this staff
        for th in db.scalars(
            select(Thread).where(Thread.staff_id == STAFF_ID, Thread.scope == "staff")
        ):
            for msg in db.scalars(select(Message).where(Message.thread_id == th.id)):
                db.delete(msg)
            db.delete(th)
        db.commit()


@pytest.fixture
def seeded_unpaired_conn():
    """Seed a ChannelConnection WITHOUT an owner identity (for pairing tests)."""
    # Register the pairing code in the in-process store
    _PENDING_PAIRING[WTOK] = CODE123

    with session_scope() as db:
        old = db.scalar(
            select(ChannelConnection).where(ChannelConnection.webhook_token == WTOK)
        )
        if old:
            for ident in db.scalars(
                select(ChannelIdentity).where(ChannelIdentity.connection_id == old.id)
            ):
                db.delete(ident)
            db.delete(old)
            db.commit()

        conn = ChannelConnection(
            kind="telegram",
            mode="control",
            staff_id=STAFF_ID,
            webhook_token=WTOK,
            secrets_enc=_make_secrets_enc(),
            enabled=True,
        )
        db.add(conn)
        db.commit()
        db.refresh(conn)
        conn_id = conn.id

    yield conn_id

    _PENDING_PAIRING.pop(WTOK, None)

    with session_scope() as db:
        for ident in db.scalars(
            select(ChannelIdentity).where(ChannelIdentity.connection_id == conn_id)
        ):
            db.delete(ident)
        old = db.get(ChannelConnection, conn_id)
        if old:
            db.delete(old)
        db.commit()


# ---------------------------------------------------------------------------
# Helper: clear dedup set for WTOK connection before each test
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _clear_seen_updates():
    """Clear the in-process dedup set so update_ids don't bleed between tests."""
    from omilo_api.routers.channels import _SEEN_UPDATES
    _SEEN_UPDATES.clear()
    yield
    _SEEN_UPDATES.clear()


# ---------------------------------------------------------------------------
# Helpers to inspect the DB state
# ---------------------------------------------------------------------------

def _staff_thread():
    """Return the first staff-scope thread for STAFF_ID, or None."""
    with session_scope() as db:
        return db.scalar(
            select(Thread).where(Thread.scope == "staff", Thread.staff_id == STAFF_ID)
        )


def _last_message(th_id: str):
    """Return the most-recent Message for thread th_id."""
    with session_scope() as db:
        rows = list(db.scalars(
            select(Message).where(Message.thread_id == th_id).order_by(Message.at.asc())
        ))
        return rows[-1] if rows else None


def _no_new_owner_message() -> bool:
    """Return True if there is NO owner-role message in the staff thread."""
    with session_scope() as db:
        th = db.scalar(
            select(Thread).where(Thread.scope == "staff", Thread.staff_id == STAFF_ID)
        )
        if th is None:
            return True
        msgs = list(db.scalars(
            select(Message).where(Message.thread_id == th.id, Message.role == "owner")
        ))
        return len(msgs) == 0


def _is_paired(platform_user_id: str) -> bool:
    """Return True if there's a ChannelIdentity with role=owner for this user."""
    with session_scope() as db:
        conn = db.scalar(
            select(ChannelConnection).where(ChannelConnection.webhook_token == WTOK)
        )
        if conn is None:
            return False
        identity = db.scalar(
            select(ChannelIdentity).where(
                ChannelIdentity.connection_id == conn.id,
                ChannelIdentity.platform_user_id == platform_user_id,
                ChannelIdentity.role == "owner",
            )
        )
        return identity is not None


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_owner_message_posts_to_agent_thread(owner, seeded_control_conn_and_pairing):
    """An owner message creates a staff thread message with role=owner, channel=telegram,
    and sets awaiting_reply=True on the thread."""
    r = owner.post(
        f"/api/channels/telegram/hook/{WTOK}",
        headers={"X-Telegram-Bot-Api-Secret-Token": SECRET},
        json={
            "update_id": 1,
            "message": {
                "from": {"id": int(OWNER_TG_ID)},
                "chat": {"id": int(OWNER_TG_ID)},
                "text": "how are refunds?",
            },
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    th = _staff_thread()
    assert th is not None, "a staff thread should have been created"
    assert th.channel == "telegram", f"expected channel=telegram, got {th.channel}"
    assert th.awaiting_reply is True, "thread.awaiting_reply should be True"

    msg = _last_message(th.id)
    assert msg is not None, "a message should have been posted"
    assert msg.role == "owner", f"expected role=owner, got {msg.role}"
    assert msg.channel == "telegram", f"expected message.channel=telegram, got {msg.channel}"
    assert msg.text == "how are refunds?"


def test_stranger_is_ignored(owner, seeded_control_conn_and_pairing):
    """A message from an unknown (non-owner) user is silently ignored (no write, 200 ok)."""
    r = owner.post(
        f"/api/channels/telegram/hook/{WTOK}",
        headers={"X-Telegram-Bot-Api-Secret-Token": SECRET},
        json={
            "update_id": 2,
            "message": {
                "from": {"id": 7},
                "chat": {"id": 7},
                "text": "hello",
            },
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert _no_new_owner_message(), "stranger's message must not produce an owner-role message"


def test_bad_secret_rejected(owner, seeded_control_conn_and_pairing):
    """A wrong X-Telegram-Bot-Api-Secret-Token header must return 403."""
    r = owner.post(
        f"/api/channels/telegram/hook/{WTOK}",
        headers={"X-Telegram-Bot-Api-Secret-Token": "WRONG"},
        json={
            "update_id": 3,
            "message": {"from": {"id": int(OWNER_TG_ID)}, "text": "x"},
        },
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_start_code_pairs(owner, seeded_unpaired_conn):
    """/start <code> message triggers consume_pairing and creates the owner identity."""
    r = owner.post(
        f"/api/channels/telegram/hook/{WTOK}",
        headers={"X-Telegram-Bot-Api-Secret-Token": SECRET},
        json={
            "update_id": 4,
            "message": {
                "from": {"id": int(OWNER_TG_ID)},
                "chat": {"id": int(OWNER_TG_ID)},
                "text": f"/start {CODE123}",
            },
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    assert _is_paired(OWNER_TG_ID) is True, "owner identity should have been created after /start pairing"
