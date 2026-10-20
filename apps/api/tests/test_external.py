"""D3: Governed web search/fetch for agents.

Tests that:
  1. classify_action_tier maps outbound-write actions → "send_external"
  2. classify_action_tier maps web-read tools (WebSearch, WebFetch) → None / low (not escalated)
  3. An outbound-write action routed through should_escalate → escalates (True)
  4. A plain web-read action routed through should_escalate → does NOT escalate (permissive mode)
  5. A permitted staff's default tool set (SAFE_TOOLS) includes WebSearch + WebFetch (governed-read grant)
  6. manager_tool_filter (CoS goal-delivery runs) does NOT strip WebSearch/WebFetch (read stays)
  7. Any future web-write tool name added to _EXEC_TOOLS would be excluded from CoS runs (documented)

Self-contained: in-memory SQLite; no HTTP server required.
"""
from __future__ import annotations

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from omilo_api.db import Base
from omilo_api.models import Setting, Staff
from omilo_api.autonomy import classify_action_tier, should_escalate
from omilo_api.engines.claude_code import SAFE_TOOLS, _EXEC_TOOLS, manager_tool_filter


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def db():
    engine = sa.create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def _staff(db: Session, autonomy: str = "standard") -> Staff:
    st = Staff(
        id=f"helper-ext-{autonomy}",
        name="Ext Helper",
        engine={"type": "fake"},
        autonomy=autonomy,
    )
    db.add(st)
    db.flush()
    return st


def _action(tier: str | None = None, **overrides) -> dict:
    base: dict = {"tier": tier, "task_id": None, "spend_usd": None, "note": None}
    base.update(overrides)
    return base


# ===========================================================================
# 1. classify_action_tier — outbound-write → "send_external"
# ===========================================================================

@pytest.mark.parametrize("action_input", [
    # String inputs
    "send_external_email",
    "post_to_twitter",
    "publish_blog_post",
    "submit_form",
    "send_message",
    "email_customer",
    # Dict inputs
    {"type": "send_email", "tool": "Gmail"},
    {"type": "post_social", "platform": "twitter"},
    {"type": "publish", "target": "blog"},
    {"type": "submit_to_external", "url": "https://example.com"},
    {"name": "WebPost", "url": "https://api.example.com"},
])
def test_classify_action_tier_outbound_write_is_send_external(action_input):
    """Outbound-write actions classify as 'send_external'."""
    tier = classify_action_tier(action_input)
    assert tier == "send_external", (
        f"Expected 'send_external' for {action_input!r}, got {tier!r}"
    )


# ===========================================================================
# 2. classify_action_tier — web-read → None / not "send_external"
# ===========================================================================

@pytest.mark.parametrize("action_input", [
    # The two governed-read tools
    "WebSearch",
    "WebFetch",
    # Dict forms
    {"name": "WebSearch", "query": "market research"},
    {"name": "WebFetch", "url": "https://example.com"},
    # Tool-use style
    {"type": "web_search", "query": "trends"},
    {"type": "web_fetch", "url": "https://news.example.com"},
])
def test_classify_action_tier_web_read_is_not_send_external(action_input):
    """WebSearch/WebFetch (read-only) do NOT classify as 'send_external'."""
    tier = classify_action_tier(action_input)
    assert tier != "send_external", (
        f"WebSearch/WebFetch should not be 'send_external', got {tier!r} for {action_input!r}"
    )


@pytest.mark.parametrize("action_input", [
    "WebSearch",
    "WebFetch",
    {"name": "WebSearch"},
    {"name": "WebFetch"},
])
def test_classify_action_tier_web_read_returns_none_or_low(action_input):
    """WebSearch/WebFetch return None or a low tier (not escalated)."""
    tier = classify_action_tier(action_input)
    assert tier in (None, "low"), (
        f"Expected None or 'low' for {action_input!r}, got {tier!r}"
    )


# ===========================================================================
# 3. Outbound-write escalates through should_escalate
# ===========================================================================

def test_outbound_write_escalates(db):
    """An action with tier='send_external' must escalate (send_external is in default escalate_tiers)."""
    escalate, reason = should_escalate(db, None, _action(tier="send_external"))
    assert escalate is True
    assert reason == "send_external"


@pytest.mark.parametrize("outbound_name", [
    "send_external_email",
    "post_to_twitter",
    "publish_blog_post",
])
def test_outbound_write_classified_and_escalates(db, outbound_name):
    """classify_action_tier + should_escalate pipeline: outbound write MUST escalate."""
    tier = classify_action_tier(outbound_name)
    assert tier == "send_external"
    # Build the action dict the way a caller would
    action = _action(tier=tier)
    escalate, reason = should_escalate(db, None, action)
    assert escalate is True, f"outbound write {outbound_name!r} must escalate; got escalate={escalate}, reason={reason!r}"


# ===========================================================================
# 4. Web-read does NOT escalate (permissive mode, no other triggers)
# ===========================================================================

def test_web_read_does_not_escalate(db):
    """WebSearch / WebFetch read actions must NOT escalate in permissive mode."""
    for tool_name in ("WebSearch", "WebFetch"):
        tier = classify_action_tier(tool_name)
        # tier should be None or "low" — not in escalate_tiers
        action = _action(tier=tier)
        escalate, reason = should_escalate(db, None, action)
        assert escalate is False, (
            f"{tool_name} must not escalate; got escalate={escalate}, reason={reason!r}"
        )


def test_web_read_action_dict_does_not_escalate(db):
    """A WebFetch action dict must not escalate in permissive mode with no other triggers."""
    tier = classify_action_tier({"name": "WebFetch", "url": "https://example.com"})
    action = _action(tier=tier)
    escalate, reason = should_escalate(db, None, action)
    assert escalate is False


# ===========================================================================
# 5. Governed-read grant — SAFE_TOOLS includes WebSearch + WebFetch
# ===========================================================================

def test_safe_tools_includes_web_search():
    """WebSearch is in SAFE_TOOLS (governed-read grant)."""
    assert "WebSearch" in SAFE_TOOLS, f"WebSearch missing from SAFE_TOOLS: {SAFE_TOOLS}"


def test_safe_tools_includes_web_fetch():
    """WebFetch is in SAFE_TOOLS (governed-read grant)."""
    assert "WebFetch" in SAFE_TOOLS, f"WebFetch missing from SAFE_TOOLS: {SAFE_TOOLS}"


# ===========================================================================
# 6. CoS goal-delivery run: WebSearch/WebFetch NOT excluded by manager_tool_filter
# ===========================================================================

def test_cos_goal_delivery_keeps_web_read():
    """manager_tool_filter for a CoS goal-delivery run must NOT strip WebSearch or WebFetch."""
    tools = list(SAFE_TOOLS)
    filtered = manager_tool_filter(tools, is_chief=True, goal_delivery=True)
    assert "WebSearch" in filtered, "WebSearch must remain after manager_tool_filter for CoS goal-delivery"
    assert "WebFetch" in filtered, "WebFetch must remain after manager_tool_filter for CoS goal-delivery"


def test_cos_goal_delivery_strips_exec_tools():
    """manager_tool_filter strips _EXEC_TOOLS (Bash, Write, Edit, etc.) for CoS goal-delivery runs."""
    tools = list(SAFE_TOOLS) + ["Bash"]  # Bash may not always be in SAFE_TOOLS (only when shell=True)
    filtered = manager_tool_filter(tools, is_chief=True, goal_delivery=True)
    for exec_tool in _EXEC_TOOLS:
        assert exec_tool not in filtered, f"{exec_tool} must be stripped in CoS goal-delivery run"


def test_non_cos_run_keeps_exec_tools():
    """manager_tool_filter does NOT strip tools for a non-CoS run."""
    tools = ["WebSearch", "WebFetch", "Bash", "Write", "Edit"]
    filtered = manager_tool_filter(tools, is_chief=False, goal_delivery=True)
    assert filtered == tools


def test_cos_non_goal_run_keeps_exec_tools():
    """manager_tool_filter does NOT strip tools for a CoS admin (non-goal-delivery) run."""
    tools = ["WebSearch", "WebFetch", "Bash", "Write", "Edit"]
    filtered = manager_tool_filter(tools, is_chief=True, goal_delivery=False)
    assert filtered == tools


# ===========================================================================
# 7. _EXEC_TOOLS documents the web-write exclusion boundary
# ===========================================================================

def test_exec_tools_does_not_contain_web_search():
    """WebSearch is NOT an exec-class tool — it must not be in _EXEC_TOOLS."""
    assert "WebSearch" not in _EXEC_TOOLS


def test_exec_tools_does_not_contain_web_fetch():
    """WebFetch is NOT an exec-class tool — it must not be in _EXEC_TOOLS."""
    assert "WebFetch" not in _EXEC_TOOLS
