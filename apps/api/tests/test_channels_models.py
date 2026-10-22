"""Task 1: ChannelConnection, ChannelIdentity models + Thread.channel column.

Uses an in-memory SQLite engine (same pattern as test_kbchunk_sqlite_schema.py)
so this test runs without Postgres and without the shared conftest server.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


@pytest.fixture
def db(tmp_path):
    from omilo_api import models as _models  # noqa: F401 — registers all ORM classes with Base
    from omilo_api.db import Base

    eng = create_engine(f"sqlite:///{tmp_path}/channels_test.db")
    Base.metadata.create_all(eng)
    with Session(eng) as s:
        yield s
    eng.dispose()


def test_channel_models_round_trip(db):
    from omilo_api.models import ChannelConnection, ChannelIdentity, Thread

    c = ChannelConnection(
        kind="telegram",
        mode="control",
        staff_id="chief-of-staff",
        webhook_token="wtok",
        secrets_enc="enc",
        enabled=True,
    )
    db.add(c)
    db.commit()
    db.add(
        ChannelIdentity(
            connection_id=c.id,
            platform_user_id="99",
            omilo_user_id="u1",
            role="owner",
        )
    )
    db.commit()
    assert db.get(ChannelConnection, c.id).mode == "control"
    assert Thread(scope="staff", staff_id="x").channel == "web"   # default
