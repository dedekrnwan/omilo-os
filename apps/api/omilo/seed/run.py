"""Demo seeder — creates the cmp_demo company and all UI fixture rows.

Entry point: ``omilo-seed`` console script (wired in pyproject.toml).

Design notes
------------
- Idempotent: uses SQLAlchemy's ``session.merge()`` (upsert by PK) so
  re-running never creates duplicates or raises unique-constraint errors.
- Privileged: uses the superuser ``SessionLocal`` directly — NOT the tenant-
  scoped ``get_db`` dependency — so RLS is bypassed.  The seeder sets
  ``company_id`` explicitly on every tenant row.
- ISO timestamps: message ``created_at`` strings are parsed to
  timezone-aware ``datetime`` objects before insertion.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone

from omilo.auth.passwords import hash_password
from omilo.db import SessionLocal
from omilo.models.chat import ChatSession, Message
from omilo.models.inbox import InboxItem
from omilo.models.tenancy import Company, Member, User
from omilo.models.workspace import Channel, Folder, Goal
from omilo.seed.fixtures import (
    CHANNELS,
    DEMO_COMPANY,
    DEMO_MEMBER,
    DEMO_USER,
    FOLDERS,
    GOALS,
    INBOX_ITEMS,
    MESSAGES,
    SESSIONS,
)

DEMO_CMP_ID = "cmp_demo"


def _parse_iso(ts: str) -> datetime:
    """Parse an ISO-8601 UTC string into a timezone-aware datetime."""
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def seed_demo() -> Company:
    """Create (or idempotently upsert) the demo company and all fixture rows.

    Returns the Company ORM object.
    """
    with SessionLocal() as db:
        with db.begin():
            # ── Company ───────────────────────────────────────────────────────
            company = db.merge(
                Company(
                    id=DEMO_COMPANY["id"],
                    name=DEMO_COMPANY["name"],
                    color=DEMO_COMPANY["color"],
                    timezone=DEMO_COMPANY["timezone"],
                )
            )

            # ── Owner User ───────────────────────────────────────────────────
            # Check if user already exists to avoid re-hashing on every run.
            existing_user = db.get(User, DEMO_USER["id"])
            if existing_user is None:
                password_hash = hash_password(DEMO_USER["password"])
            else:
                password_hash = existing_user.password_hash

            db.merge(
                User(
                    id=DEMO_USER["id"],
                    email=DEMO_USER["email"],
                    name=DEMO_USER["name"],
                    password_hash=password_hash,
                )
            )
            # Flush so Member FK to user.id is satisfied.
            db.flush()

            # ── Owner Member ─────────────────────────────────────────────────
            db.merge(
                Member(
                    id=DEMO_MEMBER["id"],
                    company_id=DEMO_CMP_ID,
                    user_id=DEMO_USER["id"],
                    role=DEMO_MEMBER["role"],
                )
            )

            # ── Channels ─────────────────────────────────────────────────────
            for row in CHANNELS:
                db.merge(
                    Channel(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        name=row["name"],
                        accent=row["accent"],
                        is_default=row.get("is_default"),
                        agent_count=row["agent_count"],
                        chat_count=row["chat_count"],
                        open_items=row["open_items"],
                    )
                )
            # Flush so FKs from goals/folders/sessions are satisfied.
            db.flush()

            # ── Goals ────────────────────────────────────────────────────────
            for row in GOALS:
                db.merge(
                    Goal(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        channel_id=row["channel_id"],
                        title=row["title"],
                        progress=row["progress"],
                    )
                )

            # ── Folders ──────────────────────────────────────────────────────
            for row in FOLDERS:
                db.merge(
                    Folder(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        channel_id=row["channel_id"],
                        name=row["name"],
                        count=row["count"],
                    )
                )
            # Flush so sessions can reference folder ids.
            db.flush()

            # ── Sessions ─────────────────────────────────────────────────────
            for row in SESSIONS:
                db.merge(
                    ChatSession(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        title=row["title"],
                        channel_id=row.get("channel_id"),
                        folder_id=row.get("folder_id"),
                        updated=row["updated"],
                        unread=row.get("unread"),
                        goal=row.get("goal"),
                        participants=row.get("participants"),
                    )
                )
            # Flush so messages can reference session ids.
            db.flush()

            # ── Messages ─────────────────────────────────────────────────────
            for row in MESSAGES:
                created_at = _parse_iso(row["created_at"])
                db.merge(
                    Message(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        session_id=row["session_id"],
                        author=row["author"],
                        content=row["content"],
                        created_at=created_at,
                        system=row.get("system"),
                        attachment=row.get("attachment"),
                        actions=row.get("actions"),
                    )
                )

            # ── Inbox items ──────────────────────────────────────────────────
            for row in INBOX_ITEMS:
                created_at = _parse_iso(row["created_at"])
                db.merge(
                    InboxItem(
                        id=row["id"],
                        company_id=DEMO_CMP_ID,
                        title=row["title"],
                        summary=row.get("summary", ""),
                        session_id=row["session_id"],
                        channel_id=row["channel_id"],
                        kind=row["kind"],
                        status=row["status"],
                        created_at=created_at,
                        asker=row["asker"],
                        asker_area=row["asker_area"],
                        asked_ago=row.get("asked_ago"),
                        needs_you=row.get("needs_you"),
                        proposals=row.get("proposals"),
                        actions=row.get("actions"),
                        reassurance=row.get("reassurance"),
                        compact=row.get("compact"),
                        progress=row.get("progress"),
                        meta=row.get("meta"),
                    )
                )

    return company


# ---------------------------------------------------------------------------
# Console script entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Entry point for the ``omilo-seed`` console script."""
    print("omilo-seed: seeding demo company …")
    company = seed_demo()
    print(f"  company   : {company.id} — {company.name}")
    print(f"  user      : {DEMO_USER['email']}")
    print(f"  channels  : {len(CHANNELS)}")
    print(f"  goals     : {len(GOALS)}")
    print(f"  folders   : {len(FOLDERS)}")
    print(f"  sessions  : {len(SESSIONS)}")
    print(f"  messages  : {len(MESSAGES)}")
    print(f"  inbox     : {len(INBOX_ITEMS)}")
    print("omilo-seed: done.")
    sys.exit(0)


if __name__ == "__main__":
    main()
