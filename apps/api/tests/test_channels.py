"""Tests for chat-mode channels (services.list_channels / create_channel / assign_goal_channel).

A channel is a home for goals, with staff members. Goals not in any channel surface under
`unassigned` so the chat rail can still show them.

Run with:
    cd apps/api && pytest tests/test_channels.py -v
"""
from sqlalchemy import select

from omilo_api import services as S
from omilo_api.db import session_scope
from omilo_api.models import Goal, Message, Staff, Thread


def _goal(db, title: str) -> Goal:
    g = Goal(title=title, status="active", position=0)
    db.add(g)
    db.flush()
    return g


def test_create_channel_with_goals_and_members(owner):
    with session_scope() as db:
        g1 = _goal(db, "100 paying neighbourhoods")
        g2 = _goal(db, "Launch the Pro plan")
        db.commit()
        g1_id, g2_id = g1.id, g2.id
        chief = db.scalar(select(Staff).where(Staff.is_chief.is_(True)))
        ch = S.create_channel(db, "Growth", emoji="🚀", member_ids=[chief.id] if chief else [], goal_ids=[g1_id])
        ch_id = ch.id

    with session_scope() as db:
        data = S.list_channels(db)
        chan = next((c for c in data["channels"] if c["id"] == ch_id), None)
        assert chan is not None, "created channel must appear in the list"
        assert chan["name"] == "Growth" and chan["emoji"] == "🚀"
        goal_ids_in_chan = {g["id"] for g in chan["goals"]}
        assert g1_id in goal_ids_in_chan, "assigned goal must be under its channel"
        # g2 was not assigned → must be in unassigned, not in the channel
        unassigned_ids = {g["id"] for g in data["unassigned"]}
        assert g2_id in unassigned_ids
        assert g2_id not in goal_ids_in_chan


def test_assign_and_unassign_goal(owner):
    with session_scope() as db:
        g = _goal(db, "Reply within 1 hour")
        db.commit()
        g_id = g.id
        ch = S.create_channel(db, "Support")
        ch_id = ch.id

    # assign → goal moves into the channel
    with session_scope() as db:
        S.assign_goal_channel(db, g_id, ch_id)
    with session_scope() as db:
        data = S.list_channels(db)
        chan = next(c for c in data["channels"] if c["id"] == ch_id)
        assert g_id in {x["id"] for x in chan["goals"]}
        assert g_id not in {x["id"] for x in data["unassigned"]}

    # unassign (channel_id=None) → goal returns to unassigned
    with session_scope() as db:
        S.assign_goal_channel(db, g_id, None)
    with session_scope() as db:
        data = S.list_channels(db)
        assert g_id in {x["id"] for x in data["unassigned"]}


def test_create_channel_requires_name(owner):
    import pytest
    with session_scope() as db:
        with pytest.raises(S.DomainError):
            S.create_channel(db, "   ")


def test_open_channel_thread_seeds_intro(owner):
    """POST /api/threads scope=channel opens the channel's conversation with a seeded intro."""
    with session_scope() as db:
        g = _goal(db, "Grow signups")
        db.commit()
        gid = g.id
        ch = S.create_channel(db, "Growth", goal_ids=[gid])
        ch_id = ch.id

    r = owner.post("/api/threads", json={"scope": "channel", "ref_id": ch_id})
    assert r.status_code == 200, r.text
    th_id = r.json()["id"]

    with session_scope() as db:
        th = db.get(Thread, th_id)
        assert th is not None and th.scope == "channel" and th.ref_id == ch_id
        msgs = list(db.scalars(select(Message).where(Message.thread_id == th_id)))
        assert len(msgs) >= 1, "channel thread must be seeded with an intro message"
