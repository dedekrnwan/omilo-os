"""
P1-T2: Engine abstraction + fake engine — TDD test suite.

RED → implement → GREEN.
"""
from __future__ import annotations

import pytest
from dataclasses import dataclass, field
from typing import Callable


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ctx(brief: str = "Do a thing", emit: Callable | None = None):
    """Minimal TaskContext factory for tests."""
    from omilo.engine.context import TaskContext

    captured: list[dict] = []

    def default_emit(event: dict) -> None:
        captured.append(event)

    return TaskContext(
        company_id="co-1",
        helper_id="hlp-1",
        helper_name="Alice",
        is_chief=False,
        job_id="job-1",
        origin="routine",
        brief=brief,
        operator_note=None,
        autonomy="ask",
        goal_delivery=False,
        memory="",
        emit=emit if emit is not None else default_emit,
    ), captured


# ---------------------------------------------------------------------------
# (a) Plain brief → text set, no pending_action, ≥2 emit events
# ---------------------------------------------------------------------------

class TestFakeEnginePlainBrief:
    def test_text_is_non_empty(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.text, "EngineResult.text must be non-empty"

    def test_no_pending_action(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.pending_action is None

    def test_emit_at_least_two_events(self):
        from omilo.engine.fake import FakeEngine
        ctx, captured = _make_ctx("Summarise today's tasks")
        FakeEngine().run(ctx)
        assert len(captured) >= 2, f"Expected ≥2 events, got {len(captured)}"

    def test_emit_thinking_then_text(self):
        from omilo.engine.fake import FakeEngine
        ctx, captured = _make_ctx("Summarise today's tasks")
        FakeEngine().run(ctx)
        kinds = [e["kind"] for e in captured]
        assert "thinking" in kinds
        assert "text" in kinds

    def test_error_is_none(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.error is None

    def test_suspended_false(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.suspended is False

    def test_defer_false(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.defer is False

    def test_cost_credits_zero(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Summarise today's tasks")
        result = FakeEngine().run(ctx)
        assert result.cost_credits == 0


# ---------------------------------------------------------------------------
# (b) SEND: sentinel → pending_action type=message, risk=medium
# ---------------------------------------------------------------------------

class TestFakeEngineSendSentinel:
    BRIEF = "Reply to the customer\nSEND: hi there"

    def test_pending_action_is_set(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx(self.BRIEF)
        result = FakeEngine().run(ctx)
        assert result.pending_action is not None

    def test_type_is_message(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx(self.BRIEF)
        result = FakeEngine().run(ctx)
        assert result.pending_action["type"] == "message"

    def test_risk_is_medium(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx(self.BRIEF)
        result = FakeEngine().run(ctx)
        assert result.pending_action["risk"] == "medium"

    def test_payload_text(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx(self.BRIEF)
        result = FakeEngine().run(ctx)
        assert result.pending_action["payload"]["text"] == "hi there"


# ---------------------------------------------------------------------------
# (c) SPEND: / DEPLOY: → risk high;  NOTE: → doc_write low
# ---------------------------------------------------------------------------

class TestFakeEngineSentinelRisks:
    def test_spend_type_and_risk(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Budget work\nSPEND: 100")
        result = FakeEngine().run(ctx)
        assert result.pending_action is not None
        assert result.pending_action["type"] == "spend"
        assert result.pending_action["risk"] == "high"
        assert result.pending_action["payload"]["amount"] == "100"

    def test_deploy_type_and_risk(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Release it\nDEPLOY: prod-v2")
        result = FakeEngine().run(ctx)
        assert result.pending_action is not None
        assert result.pending_action["type"] == "deploy"
        assert result.pending_action["risk"] == "high"
        assert result.pending_action["payload"]["what"] == "prod-v2"

    def test_note_type_and_risk(self):
        from omilo.engine.fake import FakeEngine
        ctx, _ = _make_ctx("Write it down\nNOTE: meeting summary")
        result = FakeEngine().run(ctx)
        assert result.pending_action is not None
        assert result.pending_action["type"] == "doc_write"
        assert result.pending_action["risk"] == "low"
        assert result.pending_action["payload"]["text"] == "meeting summary"


# ---------------------------------------------------------------------------
# (d) Determinism: two runs with same ctx yield equal results
# ---------------------------------------------------------------------------

class TestFakeEngineDeterminism:
    def test_same_brief_same_result(self):
        from omilo.engine.fake import FakeEngine

        brief = "Do the same thing"
        ctx1, _ = _make_ctx(brief)
        ctx2, _ = _make_ctx(brief)

        r1 = FakeEngine().run(ctx1)
        r2 = FakeEngine().run(ctx2)

        assert r1.text == r2.text
        assert r1.tokens_in == r2.tokens_in
        assert r1.tokens_out == r2.tokens_out
        assert r1.pending_action == r2.pending_action

    def test_same_sentinel_same_pending_action(self):
        from omilo.engine.fake import FakeEngine

        brief = "Do x\nSEND: hello world"
        ctx1, _ = _make_ctx(brief)
        ctx2, _ = _make_ctx(brief)

        r1 = FakeEngine().run(ctx1)
        r2 = FakeEngine().run(ctx2)

        assert r1.pending_action == r2.pending_action


# ---------------------------------------------------------------------------
# (e) Factory: get_engine dispatch
# ---------------------------------------------------------------------------

class TestGetEngineFactory:
    def test_fake_returns_fake_engine(self):
        from omilo.engine import get_engine
        from omilo.engine.fake import FakeEngine
        engine = get_engine({"type": "fake"})
        assert isinstance(engine, FakeEngine)

    def test_litellm_raises_not_configured(self):
        from omilo.engine import get_engine, EngineNotConfigured
        with pytest.raises(EngineNotConfigured):
            get_engine({"type": "litellm"})

    def test_anthropic_raises_not_configured(self):
        from omilo.engine import get_engine, EngineNotConfigured
        with pytest.raises(EngineNotConfigured):
            get_engine({"type": "anthropic"})

    def test_unknown_raises_value_error(self):
        from omilo.engine import get_engine
        with pytest.raises(ValueError):
            get_engine({"type": "unknown-engine"})

    def test_engine_protocol_run_method(self):
        """FakeEngine satisfies the Engine Protocol (has .run)."""
        from omilo.engine import get_engine
        engine = get_engine({"type": "fake"})
        assert callable(getattr(engine, "run", None))


# ---------------------------------------------------------------------------
# (f) TaskContext / EngineResult dataclass shape
# ---------------------------------------------------------------------------

class TestDataclassShape:
    def test_task_context_fields(self):
        from omilo.engine.context import TaskContext
        ctx, _ = _make_ctx()
        assert ctx.company_id == "co-1"
        assert ctx.helper_id == "hlp-1"
        assert ctx.helper_name == "Alice"
        assert ctx.is_chief is False
        assert ctx.job_id == "job-1"
        assert ctx.origin == "routine"
        assert ctx.operator_note is None
        assert ctx.autonomy == "ask"
        assert ctx.goal_delivery is False
        assert ctx.memory == ""
        assert callable(ctx.emit)

    def test_engine_result_defaults(self):
        from omilo.engine.context import EngineResult
        r = EngineResult()
        assert r.text == ""
        assert r.pending_action is None
        assert r.error is None
        assert r.cost_credits == 0
        assert r.tokens_in == 0
        assert r.tokens_out == 0
        assert r.suspended is False
        assert r.defer is False
