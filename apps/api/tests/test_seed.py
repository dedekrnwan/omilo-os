"""TDD — Task 8: Demo seeder reproducing UI fixtures.

Test plan:
1. Run seed_demo() and assert row counts match fixtures.ts exactly.
2. Spot-check specific ids and field values (ch-general, g-passkeys, task-1, etc.).
3. Run seed_demo() twice and assert idempotency (counts unchanged).

Fixture counts (from fixtures.ts):
  channels = 4
  goals    = 10
  folders  = 10
  sessions = 32
  messages = 16
  inbox    =  9
"""
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select, text

from omilo.db import SessionLocal
from omilo.models.tenancy import Company, Member, User
from omilo.models.workspace import Channel, Folder, Goal
from omilo.models.chat import ChatSession, Message
from omilo.models.inbox import InboxItem
from tests.utils import run_alembic

# ---------------------------------------------------------------------------
# Expected fixture counts (must match fixtures.ts exactly)
# ---------------------------------------------------------------------------

EXPECTED_CHANNELS = 4
EXPECTED_GOALS    = 10
EXPECTED_FOLDERS  = 10
EXPECTED_SESSIONS = 32
EXPECTED_MESSAGES = 16
EXPECTED_INBOX    = 9

DEMO_CMP_ID = "cmp_demo"


# ---------------------------------------------------------------------------
# Session-scoped fixture: ensure schema is up
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module", autouse=True)
def ensure_schema_for_seed():
    """Ensure migrations are at head before running seed tests."""
    result = run_alembic("upgrade", "head")
    assert result.returncode == 0, (
        f"alembic upgrade head failed:\n{result.stdout}\n{result.stderr}"
    )
    yield


# ---------------------------------------------------------------------------
# Count helper (privileged — as superuser omilo, filtered by company_id)
# ---------------------------------------------------------------------------

def _count(model, company_id: str = DEMO_CMP_ID) -> int:
    with SessionLocal() as db:
        return db.scalar(
            select(func.count()).select_from(model).where(
                model.company_id == company_id
            )
        )


def _count_global(model) -> int:
    with SessionLocal() as db:
        return db.scalar(select(func.count()).select_from(model))


# ---------------------------------------------------------------------------
# Step 1: Failing test — import seed_demo which doesn't exist yet
# ---------------------------------------------------------------------------

def test_seed_demo_importable():
    """seed_demo must exist in omilo.seed.run."""
    from omilo.seed.run import seed_demo  # noqa: F401


def test_seed_demo_creates_company():
    """seed_demo() must create cmp_demo company."""
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        cmp = db.get(Company, DEMO_CMP_ID)
    assert cmp is not None, "Company 'cmp_demo' not found"
    assert cmp.name == "Omilo Demo"
    assert cmp.timezone == "Asia/Jakarta"


def test_seed_demo_creates_owner_user():
    """seed_demo() must create demo@omilo.app user with a password hash."""
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "demo@omilo.app"))
    assert user is not None, "User demo@omilo.app not found"
    assert user.password_hash is not None
    assert len(user.password_hash) > 0


def test_seed_demo_creates_owner_member():
    """seed_demo() must create a Member linking demo@omilo.app to cmp_demo."""
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "demo@omilo.app"))
        member = db.scalar(
            select(Member).where(
                Member.company_id == DEMO_CMP_ID,
                Member.user_id == user.id,
            )
        )
    assert member is not None, "Member for demo@omilo.app in cmp_demo not found"
    assert member.role == "owner"


# ---------------------------------------------------------------------------
# Counts
# ---------------------------------------------------------------------------

def test_channel_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(Channel) == EXPECTED_CHANNELS, (
        f"Expected {EXPECTED_CHANNELS} channels, got {_count(Channel)}"
    )


def test_goal_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(Goal) == EXPECTED_GOALS, (
        f"Expected {EXPECTED_GOALS} goals, got {_count(Goal)}"
    )


def test_folder_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(Folder) == EXPECTED_FOLDERS, (
        f"Expected {EXPECTED_FOLDERS} folders, got {_count(Folder)}"
    )


def test_session_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(ChatSession) == EXPECTED_SESSIONS, (
        f"Expected {EXPECTED_SESSIONS} sessions, got {_count(ChatSession)}"
    )


def test_message_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(Message) == EXPECTED_MESSAGES, (
        f"Expected {EXPECTED_MESSAGES} messages, got {_count(Message)}"
    )


def test_inbox_count():
    from omilo.seed.run import seed_demo
    seed_demo()
    assert _count(InboxItem) == EXPECTED_INBOX, (
        f"Expected {EXPECTED_INBOX} inbox items, got {_count(InboxItem)}"
    )


# ---------------------------------------------------------------------------
# Spot-checks
# ---------------------------------------------------------------------------

def test_channel_ch_general():
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        ch = db.get(Channel, "ch-general")
    assert ch is not None, "Channel 'ch-general' not found"
    assert ch.name == "General"
    assert ch.is_default is True
    assert ch.chat_count == 31
    assert ch.company_id == DEMO_CMP_ID


def test_goal_g_passkeys():
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        g = db.get(Goal, "g-passkeys")
    assert g is not None, "Goal 'g-passkeys' not found"
    assert g.progress == 40
    assert g.channel_id == "ch-engineering"
    assert g.company_id == DEMO_CMP_ID


def test_session_sess_passkey():
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        s = db.get(ChatSession, "sess-passkey")
    assert s is not None, "Session 'sess-passkey' not found"
    assert s.title == "Passkey rollout plan"
    assert s.channel_id == "ch-engineering"
    assert s.folder_id == "f-q4"
    assert s.updated == "now"
    assert s.goal == "Passwordless login by Q4"
    assert s.company_id == DEMO_CMP_ID
    # participants is a list stored as JSONB
    assert isinstance(s.participants, list)
    assert len(s.participants) == 2


def test_inbox_task_1():
    """inbox-passkey-tasks (the first 'needs you' card) must exist."""
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        item = db.get(InboxItem, "inbox-passkey-tasks")
    assert item is not None, "InboxItem 'inbox-passkey-tasks' not found"
    assert item.needs_you is True
    assert item.kind == "decision"
    assert item.channel_id == "ch-engineering"
    assert item.company_id == DEMO_CMP_ID
    assert isinstance(item.proposals, list)
    assert len(item.proposals) == 3


def test_message_created_at_is_datetime():
    """Messages store createdAt as proper timestamptz (not a string)."""
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        msg = db.get(Message, "msg-pk-1")
    assert msg is not None, "Message 'msg-pk-1' not found"
    assert isinstance(msg.created_at, datetime), (
        f"expected datetime, got {type(msg.created_at)}"
    )


def test_folder_f_q4():
    from omilo.seed.run import seed_demo
    seed_demo()
    with SessionLocal() as db:
        f = db.get(Folder, "f-q4")
    assert f is not None, "Folder 'f-q4' not found"
    assert f.name == "Q4 Launch"
    assert f.channel_id == "ch-engineering"
    assert f.count == 6


# ---------------------------------------------------------------------------
# Idempotency: run seed_demo() twice, counts must not change
# ---------------------------------------------------------------------------

def test_seed_idempotency():
    """Running seed_demo() twice must not create duplicates."""
    from omilo.seed.run import seed_demo
    seed_demo()
    seed_demo()

    assert _count(Channel) == EXPECTED_CHANNELS
    assert _count(Goal) == EXPECTED_GOALS
    assert _count(Folder) == EXPECTED_FOLDERS
    assert _count(ChatSession) == EXPECTED_SESSIONS
    assert _count(Message) == EXPECTED_MESSAGES
    assert _count(InboxItem) == EXPECTED_INBOX
