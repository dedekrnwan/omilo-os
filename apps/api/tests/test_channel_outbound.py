"""Task 3: deliver_outbound — outbound delivery hook in the worker.

Uses an in-memory SQLite engine so this runs without Postgres/Redis, like
test_channels_models.py does.
"""
import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from omilo_api.channels import registry
from omilo_api.channels.base import OutMessage, SendResult


# ------------------------------------------------------------------ DB fixture

@pytest.fixture
def db(tmp_path):
    from omilo_api import models as _models  # noqa: F401 — registers all ORM classes
    from omilo_api.db import Base

    eng = create_engine(f"sqlite:///{tmp_path}/outbound_test.db")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        yield s
    eng.dispose()


# ------------------------------------------------------------------ registry isolation

@pytest.fixture(autouse=True)
def _clear_registry():
    registry.reset()
    yield
    registry.reset()


# ------------------------------------------------------------------ fake adapters

class _FakeAdapter:
    kind = "telegram"

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def connect(self, config):
        return {}

    def disconnect(self, conn):
        pass

    def verify_inbound(self, conn, headers):
        return True

    def normalize_inbound(self, conn, raw):
        return []

    def classify_sender(self, conn, platform_user_id):
        return "member"

    def send(self, conn, target: str, message: OutMessage) -> SendResult:
        self.sent.append((target, message.text))
        return SendResult(ok=True)


class _FailingAdapter:
    kind = "telegram"

    def __init__(self, *, raise_exc=False):
        self._raise = raise_exc

    def connect(self, config):
        return {}

    def disconnect(self, conn):
        pass

    def verify_inbound(self, conn, headers):
        return True

    def normalize_inbound(self, conn, raw):
        return []

    def classify_sender(self, conn, platform_user_id):
        return "member"

    def send(self, conn, target: str, message: OutMessage) -> SendResult:
        if self._raise:
            raise RuntimeError("boom")
        return SendResult(ok=False, error="network error")


@pytest.fixture
def fake_adapter():
    a = _FakeAdapter()
    registry.register(a)
    return a


@pytest.fixture
def failing_adapter():
    a = _FailingAdapter(raise_exc=False)
    registry.register(a)
    return a


@pytest.fixture
def raising_adapter():
    a = _FailingAdapter(raise_exc=True)
    registry.register(a)
    return a


# ------------------------------------------------------------------ seed helpers

def _mk_thread(db, *, channel="web", staff_id="chief-of-staff"):
    from omilo_api.models import Thread

    th = Thread(scope="staff", staff_id=staff_id, channel=channel)
    db.add(th)
    db.commit()
    db.refresh(th)
    return th


def _mk_control_conn(db, *, staff_id="chief-of-staff", kind="telegram", owner_chat="<owner_chat>"):
    from omilo_api.models import ChannelConnection, ChannelIdentity

    conn = ChannelConnection(
        kind=kind,
        mode="control",
        staff_id=staff_id,
        webhook_token="wt-test",
        secrets_enc="",
        enabled=True,
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    identity = ChannelIdentity(
        connection_id=conn.id,
        platform_user_id=owner_chat,
        omilo_user_id="u-owner",
        role="owner",
    )
    db.add(identity)
    db.commit()
    return conn


@pytest.fixture
def seeded_control_conn(db):
    return _mk_control_conn(db)


# ------------------------------------------------------------------ helper to inspect secrets_enc

def _needs_reconnect(conn) -> bool:
    """Read the needs_reconnect flag from conn.secrets_enc (plain JSON, not encrypted in tests)."""
    import json
    from omilo_api.security import decrypt

    raw = decrypt(conn.secrets_enc) if conn.secrets_enc else None
    if not raw:
        return False
    try:
        return bool(json.loads(raw).get("needs_reconnect"))
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------------ tests

def test_reply_on_web_thread_does_not_deliver(db, fake_adapter):
    from omilo_api.worker import deliver_outbound

    th = _mk_thread(db, channel="web")
    deliver_outbound(db, th, "hi")
    assert fake_adapter.sent == []


def test_reply_on_telegram_thread_delivers(db, fake_adapter, seeded_control_conn):
    from omilo_api.worker import deliver_outbound

    th = _mk_thread(db, channel="telegram", staff_id="chief-of-staff")
    deliver_outbound(db, th, "done ✅")
    assert fake_adapter.sent == [("<owner_chat>", "done ✅")]


def test_send_failure_is_swallowed_and_flags(db, failing_adapter, seeded_control_conn):
    from omilo_api.worker import deliver_outbound

    th = _mk_thread(db, channel="telegram", staff_id="chief-of-staff")
    deliver_outbound(db, th, "x")   # must not raise

    # Reload conn from DB to see updated secrets_enc
    from omilo_api.models import ChannelConnection
    from sqlalchemy import select
    conn = db.scalar(
        select(ChannelConnection).where(
            ChannelConnection.mode == "control",
            ChannelConnection.staff_id == "chief-of-staff",
            ChannelConnection.enabled.is_(True),
        )
    )
    assert _needs_reconnect(conn) is True


def test_send_exception_is_swallowed_and_flags(db, raising_adapter, seeded_control_conn):
    from omilo_api.worker import deliver_outbound

    th = _mk_thread(db, channel="telegram", staff_id="chief-of-staff")
    deliver_outbound(db, th, "x")   # must not raise

    from omilo_api.models import ChannelConnection
    from sqlalchemy import select
    conn = db.scalar(
        select(ChannelConnection).where(
            ChannelConnection.mode == "control",
            ChannelConnection.staff_id == "chief-of-staff",
            ChannelConnection.enabled.is_(True),
        )
    )
    assert _needs_reconnect(conn) is True


def test_no_control_conn_does_not_deliver(db, fake_adapter):
    """Telegram thread with NO matching ChannelConnection → silent no-op."""
    from omilo_api.worker import deliver_outbound

    th = _mk_thread(db, channel="telegram", staff_id="no-such-staff")
    deliver_outbound(db, th, "hi")
    assert fake_adapter.sent == []


def test_no_owner_identity_does_not_deliver(db, fake_adapter):
    """Telegram thread with conn but no owner identity → silent no-op."""
    from omilo_api.worker import deliver_outbound
    from omilo_api.models import ChannelConnection

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="lone-staff",
        webhook_token="wt-lone",
        secrets_enc="",
        enabled=True,
    )
    db.add(conn)
    db.commit()

    th = _mk_thread(db, channel="telegram", staff_id="lone-staff")
    deliver_outbound(db, th, "hi")
    assert fake_adapter.sent == []


def test_disabled_conn_does_not_deliver(db, fake_adapter):
    """A disabled ChannelConnection is not used."""
    from omilo_api.worker import deliver_outbound
    from omilo_api.models import ChannelConnection, ChannelIdentity

    conn = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="staff-disabled",
        webhook_token="wt-dis",
        secrets_enc="",
        enabled=False,  # disabled!
    )
    db.add(conn)
    db.commit()
    db.add(ChannelIdentity(
        connection_id=conn.id,
        platform_user_id="99",
        omilo_user_id="u1",
        role="owner",
    ))
    db.commit()

    th = _mk_thread(db, channel="telegram", staff_id="staff-disabled")
    deliver_outbound(db, th, "hi")
    assert fake_adapter.sent == []
