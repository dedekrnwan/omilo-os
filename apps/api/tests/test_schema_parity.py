"""Test_schema_parity: verify each read DTO matches the exact key set declared
in src/core/domain/types.ts.

Strategy: build model-like objects in memory (no DB), validate into DTOs,
dump with by_alias=True, exclude_none=True, and assert exact key sets.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

# ── DTOs under test ──────────────────────────────────────────────────────────
from omilo.schemas.read import (
    ChannelDTO,
    FolderDTO,
    GoalDTO,
    SessionDTO,
    MessageDTO,
    InboxItemDTO,
)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


# ────────────────────────────────────────────────────────────────────────────
# Channel
# ────────────────────────────────────────────────────────────────────────────

class TestChannelDTO:
    # contextScope is always present (default "isolated", never None)
    REQUIRED_KEYS = {"id", "name", "accent", "agentCount", "chatCount", "openItems", "contextScope"}

    def test_without_is_default(self):
        """isDefault must be absent when not set."""
        dto = ChannelDTO(
            id="ch_1",
            name="General",
            accent="general",
            is_default=None,
            agent_count=2,
            chat_count=5,
            open_items=3,
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.REQUIRED_KEYS
        assert "isDefault" not in dumped

    def test_with_is_default(self):
        """isDefault must appear when True."""
        dto = ChannelDTO(
            id="ch_1",
            name="General",
            accent="general",
            is_default=True,
            agent_count=2,
            chat_count=5,
            open_items=3,
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.REQUIRED_KEYS | {"isDefault"}
        assert dumped["isDefault"] is True

    def test_zero_counts_not_dropped(self):
        """Required numeric fields with value 0 must not be dropped."""
        dto = ChannelDTO(
            id="ch_1",
            name="General",
            accent="general",
            agent_count=0,
            chat_count=0,
            open_items=0,
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert dumped["agentCount"] == 0
        assert dumped["chatCount"] == 0
        assert dumped["openItems"] == 0


# ────────────────────────────────────────────────────────────────────────────
# Folder
# ────────────────────────────────────────────────────────────────────────────

class TestFolderDTO:
    EXPECTED_KEYS = {"id", "channelId", "name", "count"}

    def test_exact_keys(self):
        dto = FolderDTO(id="fld_1", channel_id="ch_1", name="Archive", count=7)
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.EXPECTED_KEYS

    def test_count_zero_not_dropped(self):
        dto = FolderDTO(id="fld_1", channel_id="ch_1", name="Empty", count=0)
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert dumped["count"] == 0


# ────────────────────────────────────────────────────────────────────────────
# Goal
# ────────────────────────────────────────────────────────────────────────────

class TestGoalDTO:
    EXPECTED_KEYS = {"id", "channelId", "title", "progress"}

    def test_exact_keys(self):
        dto = GoalDTO(id="goal_1", channel_id="ch_1", title="Launch v2", progress=50)
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.EXPECTED_KEYS

    def test_progress_zero_not_dropped(self):
        """Regression guard: progress=0 is required and must survive exclude_none."""
        dto = GoalDTO(id="goal_1", channel_id="ch_1", title="Not started", progress=0)
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert "progress" in dumped
        assert dumped["progress"] == 0

    def test_optional_sweep_fields(self):
        """sweep/goals-routines optional fields use camelCase keys."""
        dto = GoalDTO(
            id="goal_1", channel_id="ch_1", title="Launch v2", progress=50,
            status="on_track", target="v2 live", due="2026-12-31",
            measured_by="Signups", helper_ids=["hlp_1"], period="2026-Q4",
            session_id="ses_1", status_set_by="user",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.EXPECTED_KEYS | {
            "status", "target", "due", "measuredBy", "helperIds", "period",
            "sessionId", "statusSetBy",
        }


# ────────────────────────────────────────────────────────────────────────────
# Session (→ SessionDTO)
# ────────────────────────────────────────────────────────────────────────────

class TestSessionDTO:
    REQUIRED_KEYS = {"id", "title", "updated"}

    def test_minimal(self):
        """Only required fields: id, title, updated."""
        dto = SessionDTO(id="s_1", title="New chat", updated="now")
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.REQUIRED_KEYS

    def test_all_optional_present(self):
        dto = SessionDTO(
            id="s_1",
            title="Chat about onboarding",
            channel_id="ch_1",
            folder_id="fld_1",
            updated="2h",
            unread=True,
            goal="Passwordless login by Q4",
            participants=[{"name": "Chief", "area": "ops"}],
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        expected = self.REQUIRED_KEYS | {"channelId", "folderId", "unread", "goal", "participants"}
        assert set(dumped.keys()) == expected
        assert dumped["participants"] == [{"name": "Chief", "area": "ops"}]

    def test_optional_absent_when_none(self):
        dto = SessionDTO(id="s_2", title="Quick check", updated="Yesterday")
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        for optional_key in ("channelId", "folderId", "unread", "goal", "participants"):
            assert optional_key not in dumped


# ────────────────────────────────────────────────────────────────────────────
# Message
# ────────────────────────────────────────────────────────────────────────────

class TestMessageDTO:
    REQUIRED_KEYS = {"id", "sessionId", "author", "content", "createdAt"}

    def _make_author(self, **kwargs) -> dict:
        base = {"kind": "helper", "name": "Chief"}
        base.update(kwargs)
        return base

    def test_minimal(self):
        dto = MessageDTO(
            id="msg_1",
            session_id="s_1",
            author=self._make_author(),
            content="Hello!",
            created_at=_now(),
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.REQUIRED_KEYS

    def test_created_at_is_iso_string(self):
        dto = MessageDTO(
            id="msg_1",
            session_id="s_1",
            author=self._make_author(),
            content="Hi",
            created_at=_now(),
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert isinstance(dumped["createdAt"], str)
        assert "2026" in dumped["createdAt"]

    def test_with_attachment(self):
        dto = MessageDTO(
            id="msg_2",
            session_id="s_1",
            author=self._make_author(role="Chief of Staff"),
            content="See attached",
            created_at=_now(),
            system=None,
            attachment={"title": "Q4 Report", "meta": "2 pages"},
            actions=None,
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert "attachment" in dumped
        assert dumped["attachment"] == {"title": "Q4 Report", "meta": "2 pages"}
        assert "system" not in dumped
        assert "actions" not in dumped

    def test_without_attachment(self):
        dto = MessageDTO(
            id="msg_3",
            session_id="s_1",
            author=self._make_author(),
            content="No attachment",
            created_at=_now(),
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert "attachment" not in dumped

    def test_with_system_and_actions(self):
        dto = MessageDTO(
            id="msg_4",
            session_id="s_1",
            author=self._make_author(),
            content="Chief added Dev to this chat",
            created_at=_now(),
            system=True,
            actions=[{"label": "Approve", "primary": True}],
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert dumped["system"] is True
        assert dumped["actions"] == [{"label": "Approve", "primary": True}]

    def test_no_server_only_fields(self):
        """company_id and raw column created_at column naming must not leak."""
        dto = MessageDTO(
            id="msg_5",
            session_id="s_1",
            author=self._make_author(),
            content="Test",
            created_at=_now(),
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert "companyId" not in dumped
        assert "company_id" not in dumped


# ────────────────────────────────────────────────────────────────────────────
# InboxItem
# ────────────────────────────────────────────────────────────────────────────

class TestInboxItemDTO:
    REQUIRED_KEYS = {
        "id", "title", "summary", "sessionId", "channelId",
        "kind", "status", "createdAt", "asker", "askerArea",
    }

    def test_minimal(self):
        dto = InboxItemDTO(
            id="inbox_1",
            title="Approve deployment",
            summary="Deploy to prod?",
            session_id="s_1",
            channel_id="ch_1",
            kind="decision",
            status="pending",
            created_at=_now(),
            asker="Chief",
            asker_area="ops",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert set(dumped.keys()) == self.REQUIRED_KEYS

    def test_created_at_is_iso_string(self):
        dto = InboxItemDTO(
            id="inbox_1",
            title="Test",
            summary="Sum",
            session_id="s_1",
            channel_id="ch_1",
            kind="update",
            status="done",
            created_at=_now(),
            asker="Chief",
            asker_area="dev",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert isinstance(dumped["createdAt"], str)
        assert "2026" in dumped["createdAt"]

    def test_all_optional_fields(self):
        dto = InboxItemDTO(
            id="inbox_2",
            title="Big decision",
            summary="We need to decide",
            session_id="s_1",
            channel_id="ch_1",
            kind="decision",
            status="running",
            created_at=_now(),
            asker="Chief",
            asker_area="ops",
            asked_ago="2m ago",
            needs_you=True,
            proposals=[{"who": "Chief", "area": "ops", "text": "Do X", "due": "Friday"}],
            actions=[{"label": "Approve", "primary": True, "icon": "check"}],
            reassurance="Safe to approve",
            compact=False,
            progress={"step": 2, "total": 5, "elapsed": "1m"},
            meta="1m 50s · 5 sources",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        expected = self.REQUIRED_KEYS | {
            "askedAgo", "needsYou", "proposals", "actions",
            "reassurance", "compact", "progress", "meta",
        }
        assert set(dumped.keys()) == expected

    def test_optional_absent_when_none(self):
        dto = InboxItemDTO(
            id="inbox_3",
            title="Simple update",
            summary="FYI",
            session_id="s_1",
            channel_id="ch_1",
            kind="update",
            status="done",
            created_at=_now(),
            asker="Chief",
            asker_area="brand",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        for optional_key in ("askedAgo", "needsYou", "proposals", "actions",
                             "reassurance", "compact", "progress", "meta"):
            assert optional_key not in dumped

    def test_no_server_only_fields(self):
        dto = InboxItemDTO(
            id="inbox_4",
            title="T",
            summary="S",
            session_id="s_1",
            channel_id="ch_1",
            kind="mention",
            status="pending",
            created_at=_now(),
            asker="Chief",
            asker_area="finance",
        )
        dumped = dto.model_dump(by_alias=True, exclude_none=True)
        assert "companyId" not in dumped
        assert "company_id" not in dumped
