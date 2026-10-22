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

from omilo_api.autonomy import classify_action_tier, should_escalate
from omilo_api.db import Base
from omilo_api.engines.claude_code import _EXEC_TOOLS, SAFE_TOOLS, manager_tool_filter
from omilo_api.models import Staff

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


# ===========================================================================
# D4: self-directed learning into the KB
# ===========================================================================
# These tests use session_scope() (shared Postgres test DB, same as test_creation.py).
# They are intentionally isolated: every staff id is UUID-based; refs/kinds are unique per run.

import asyncio  # noqa: E402
import uuid as _uuid  # noqa: E402

from sqlalchemy import select as _select  # noqa: E402

from omilo_api import mcp_server as _mcp  # noqa: E402
from omilo_api import services as _S  # noqa: E402
from omilo_api.db import session_scope as _ss  # noqa: E402
from omilo_api.models import KbSource  # noqa: E402
from omilo_api.models import Staff as _Staff  # noqa: E402


def _make_learner() -> str:
    sid = "lrn-" + _uuid.uuid4().hex[:10]
    with _ss() as db:
        db.add(_Staff(
            id=sid,
            name="Learner Bot",
            role="researcher",
            is_chief=False,
            permissions={},
            autonomy="standard",
            status="active",
            engine={"type": "fake"},
        ))
        db.commit()
    return sid


async def _learn(staff_id: str, **args) -> dict:
    with _ss() as db:
        st = db.get(_Staff, staff_id)
        _, data = await _mcp.call_tool(db, st, "learn", args)
        return data


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# D4-1: learn writes a KB entry with correct meta (source, confidence, learned_by)
# ---------------------------------------------------------------------------

def test_learn_writes_kb_entry_with_meta():
    """learn() persists a finding to the KB and stores source+confidence+learned_by in meta."""
    sid = _make_learner()
    summary = "Python asyncio event loops must not be shared across threads in production code."
    url = f"https://docs.example.com/asyncio-{_uuid.uuid4().hex[:6]}"

    result = _run(_learn(sid, summary=summary, source_url=url, confidence="high"))
    assert result.get("ok") is True

    with _ss() as db:
        src = db.scalar(_select(KbSource).where(KbSource.ref == url))
    assert src is not None, "KbSource row should exist for the learned URL"
    assert src.meta["source"] == url
    assert src.meta["confidence"] == "high"
    assert src.meta["learned_by"] == sid


# ---------------------------------------------------------------------------
# D4-2: a second learn() with the same source_url UPSERTS (no duplicate row)
# ---------------------------------------------------------------------------

def test_learn_same_url_upserts_not_duplicates():
    """Calling learn() twice with the same source_url must not create two KbSource rows."""
    sid = _make_learner()
    url = f"https://example.com/upsert-{_uuid.uuid4().hex[:6]}"
    summary_v1 = "First version of the finding: Python GIL limits multi-core CPU use in CPython."
    summary_v2 = "Updated finding: Python GIL limits multi-core CPU use in CPython; use multiprocessing."

    _run(_learn(sid, summary=summary_v1, source_url=url, confidence="medium"))
    _run(_learn(sid, summary=summary_v2, source_url=url, confidence="high"))

    with _ss() as db:
        rows = list(db.scalars(_select(KbSource).where(KbSource.ref == url)))
    assert len(rows) == 1, f"Expected exactly 1 KbSource for ref={url!r}, got {len(rows)}"
    # Latest meta survives
    assert rows[0].meta["confidence"] == "high"


# ---------------------------------------------------------------------------
# D4-3: too-short summary is rejected
# ---------------------------------------------------------------------------

def test_learn_rejects_short_summary():
    """A summary shorter than MIN_LEARN_CHARS must be rejected."""
    from omilo_api.mcp_server import MIN_LEARN_CHARS
    sid = _make_learner()
    short = "x" * (MIN_LEARN_CHARS - 1)  # one char below the gate
    url = f"https://example.com/short-{_uuid.uuid4().hex[:6]}"

    with pytest.raises(_S.DomainError):
        _run(_learn(sid, summary=short, source_url=url))


# ---------------------------------------------------------------------------
# D4-4: web-sourced finding without source_url is rejected
# ---------------------------------------------------------------------------

def test_learn_rejects_web_finding_without_url():
    """A summary that references web content but has no source_url must be rejected."""
    sid = _make_learner()
    # Summary contains "https://" or web-indicative phrasing — gate checks source_url absent.
    summary = "According to the page at https://example.com, TLS 1.0 is deprecated and should be disabled on all servers."

    with pytest.raises(_S.DomainError):
        _run(_learn(sid, summary=summary))


# ---------------------------------------------------------------------------
# D4-5: internal reflection (no URL) is accepted and stored as note kind
# ---------------------------------------------------------------------------

def test_learn_internal_reflection_accepted_without_url():
    """A sufficiently long internal finding with no source_url must succeed and be stored as note kind."""
    sid = _make_learner()
    summary = "After running three A/B tests on subject lines, personalization tokens increased open rates by 12 percent."

    result = _run(_learn(sid, summary=summary, confidence="medium"))
    assert result.get("ok") is True

    with _ss() as db:
        rows = list(db.scalars(_select(KbSource).where(
            KbSource.staff_id == sid,
            KbSource.kind == "note",
        )))
    assert len(rows) >= 1
    matching = [r for r in rows if summary[:60] in r.title or summary[:60] in (r.meta or {}).get("source", "")]
    assert matching, "stored note not found"


# ---------------------------------------------------------------------------
# D4-6: web-sourced entry with URL is stored as web kind
# ---------------------------------------------------------------------------

def test_learn_web_finding_stored_as_web_kind():
    """A finding with a source_url is stored with kind='web'."""
    sid = _make_learner()
    url = f"https://example.com/web-kind-{_uuid.uuid4().hex[:6]}"
    summary = "Cloudflare Workers can serve responses in under 50ms globally due to edge colocation."

    _run(_learn(sid, summary=summary, source_url=url, confidence="unverified"))

    with _ss() as db:
        src = db.scalar(_select(KbSource).where(KbSource.ref == url))
    assert src is not None
    assert src.kind == "web"


# ---------------------------------------------------------------------------
# D4-7: learn is in TOOLS list (tool is declared)
# ---------------------------------------------------------------------------

def test_learn_tool_is_declared():
    """The 'learn' tool must appear in the MCP TOOLS list."""
    names = {t["name"] for t in _mcp.TOOLS}
    assert "learn" in names, f"'learn' missing from TOOLS: {sorted(names)}"
