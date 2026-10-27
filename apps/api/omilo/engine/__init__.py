"""
omilo.engine — Engine abstraction layer.

Public API:
    TaskContext, EngineResult  (re-exported from .context)
    Engine                     (Protocol)
    EngineNotConfigured        (Exception)
    get_engine(cfg)            (factory)
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from omilo.engine.context import TaskContext, EngineResult

__all__ = [
    "TaskContext",
    "EngineResult",
    "Engine",
    "EngineNotConfigured",
    "get_engine",
]


@runtime_checkable
class Engine(Protocol):
    """Contract: an engine takes a TaskContext and returns an EngineResult."""

    def run(self, ctx: TaskContext) -> EngineResult:
        ...


class EngineNotConfigured(Exception):
    """Raised when the requested engine type is valid but credentials/accounts are absent."""


def get_engine(cfg: dict) -> Engine:
    """
    Factory: return an Engine for the given configuration dict.

    cfg["type"] dispatch:
        "fake"          → FakeEngine (deterministic, no external calls; always works)
        "litellm"       → LiteLLMEngine if LITELLM_API_KEY / OPENAI_API_KEY set,
                          else raises EngineNotConfigured
        "anthropic"     → AnthropicEngine if ANTHROPIC_API_KEY / CLAUDE_API_KEY set,
                          else raises EngineNotConfigured
        "claude_code"   → Pool-backed ClaudeCodeEngine; raises EngineNotConfigured
                          if no eligible HarnessAccount in the pool
        anything else   → ValueError

    P1 behaviour is preserved: "fake" always works; "litellm"/"anthropic" raise
    EngineNotConfigured in test environments (no keys configured).
    """
    engine_type = cfg.get("type", "")

    if engine_type == "fake":
        from omilo.engine.fake import FakeEngine
        return FakeEngine()

    if engine_type == "litellm":
        # Import raises EngineNotConfigured if no key is set
        from omilo.engine.litellm_engine import LiteLLMEngine
        return LiteLLMEngine()

    if engine_type == "anthropic":
        # Import raises EngineNotConfigured if no key is set
        from omilo.engine.anthropic_engine import AnthropicEngine
        return AnthropicEngine()

    if engine_type == "claude_code":
        # Pool-backed engine: selects a HarnessAccount from the DB pool.
        # Raises EngineNotConfigured if no eligible account is found.
        from omilo.engine.claude_code_engine import ClaudeCodeEngine
        company_id = cfg.get("company_id", "")
        return ClaudeCodeEngine(company_id=company_id)

    raise ValueError(
        f"Unknown engine type '{engine_type}'. "
        "Valid types: 'fake', 'litellm', 'anthropic', 'claude_code'."
    )
