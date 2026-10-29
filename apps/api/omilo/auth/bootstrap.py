"""Workspace bootstrap — seed the minimum rows a fresh company needs to work.

Every newly-created Company must have at least:
  1. A default Channel/Area ("General", is_default=True) so the UI has somewhere
     to land and goals/flows have a channel to attach to.
  2. A Chief Helper (is_chief=True, status="active") assigned to that default
     area, because goal-create (``goals_write._get_chief``), chat turns, and flow
     publish all require a Chief or return 409.

This is called from every signup path that CREATES a company:
  - ``POST /v1/auth/sign-up`` (auth/router.py)
  - Google OAuth new-user signup (auth/google.py ``_upsert_user``)

Invite-accept only JOINS an existing company, so it must NOT seed (the company
already has its Chief + area).

The caller must run this inside an open transaction using a privileged
(RLS-bypassing) ``SessionLocal`` session; ``company_id`` is stamped explicitly
on every row, mirroring the owner-Member insert that already happens there.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from omilo.models.agents import Helper
from omilo.models.base import prefixed_id
from omilo.models.workspace import Channel

# Default area name + accent for a fresh workspace.
DEFAULT_AREA_NAME = "General"
DEFAULT_AREA_ACCENT = "general"
# Chief defaults mirror the UI's expectation of a top-level coordinator.
CHIEF_NAME = "Chief"
CHIEF_ROLE = "Chief of Staff"


def seed_new_company(session: Session, company_id: str) -> tuple[Channel, Helper]:
    """Seed a default area + Chief Helper for a freshly-created company.

    Returns the created (channel, chief_helper).  Must be called inside an open
    transaction; the caller is responsible for the commit.  Rows are stamped
    with ``company_id`` explicitly so a privileged (RLS-bypassing) session
    inserts them correctly.
    """
    channel = Channel(
        id=prefixed_id("chn"),
        company_id=company_id,
        name=DEFAULT_AREA_NAME,
        accent=DEFAULT_AREA_ACCENT,
        is_default=True,
        agent_count=1,
        chat_count=0,
        open_items=0,
        context_scope="isolated",
    )
    session.add(channel)
    session.flush()

    chief = Helper(
        id=prefixed_id("hlp"),
        company_id=company_id,
        name=CHIEF_NAME,
        area=DEFAULT_AREA_ACCENT,
        role=CHIEF_ROLE,
        job_description="Coordinates work across the workspace and plans goals.",
        is_chief=True,
        engine={"type": "fake"},
        permissions=[],
        status="active",
        channel_ids=[channel.id],
    )
    session.add(chief)
    session.flush()

    return channel, chief
