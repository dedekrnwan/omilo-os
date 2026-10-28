"""
omilo.engine — Engine abstraction layer.

Public API:
    TaskContext, EngineResult              (re-exported from .context)
    Engine                                 (Protocol)
    EngineNotConfigured                    (Exception)
    PooledInferenceUnavailableLocal        (Exception — P6b local mode)
    get_engine(cfg)                        (factory)
"""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from omilo.engine.context import TaskContext, EngineResult
from omilo.control.factory import is_local_mode

__all__ = [
    "TaskContext",
    "EngineResult",
    "Engine",
    "EngineNotConfigured",
    "PooledInferenceUnavailableLocal",
    "get_engine",
    "is_local_mode",
]


@runtime_checkable
class Engine(Protocol):
    """Contract: an engine takes a TaskContext and returns an EngineResult."""

    def run(self, ctx: TaskContext) -> EngineResult:
        ...


class EngineNotConfigured(Exception):
    """Raised when the requested engine type is valid but credentials/accounts are absent."""


class PooledInferenceUnavailableLocal(Exception):
    """Raised when a pooled/cloud-billed engine (e.g. litellm) is requested in local mode.

    In local mode (OMILO_MODE=local) pooled cloud inference is not available —
    the installation is fully air-gap-capable and only BYO keys / local models
    are supported.  Switch to hybrid mode (OMILO_MODE=hybrid) to connect this
    install to Omilo Cloud and use pooled AI credits.
    """


# Engine types that consume credits (cloud/pooled path) — refused in local mode.
# Mirrors billing.meter._CLOUD_ENGINE_TYPES.
_POOLED_ENGINE_TYPES = frozenset({"litellm"})


def get_engine(cfg: dict) -> Engine:
    """
    Factory: return an Engine for the given configuration dict.

    cfg["type"] dispatch:
        "fake"          → FakeEngine (deterministic, no external calls; always works)
        "litellm"       → In LOCAL mode: raises PooledInferenceUnavailableLocal.
                          Otherwise: LiteLLMEngine if LITELLM_API_KEY / OPENAI_API_KEY
                          set, else raises EngineNotConfigured.
        "anthropic"     → AnthropicEngine if ANTHROPIC_API_KEY / CLAUDE_API_KEY set,
                          else raises EngineNotConfigured
        "claude_code"   → Pool-backed ClaudeCodeEngine; raises EngineNotConfigured
                          if no eligible HarnessAccount in the pool
        anything else   → ValueError

    P1 behaviour is preserved: "fake" always works; "litellm"/"anthropic" raise
    EngineNotConfigured in test environments (no keys configured).

    P6b LOCAL MODE: pooled/credit-consuming engines (litellm) are refused with
    PooledInferenceUnavailableLocal before any credentials are checked.
    BYO engines (anthropic, claude_code, fake) run normally.
    """
    engine_type = cfg.get("type", "")

    # ── LOCAL MODE: refuse pooled/credit-consuming engines (P6b) ─────────────
    if engine_type in _POOLED_ENGINE_TYPES and is_local_mode():
        raise PooledInferenceUnavailableLocal(
            f"Pooled cloud inference (engine_type={engine_type!r}) is not available "
            "in local mode (OMILO_MODE=local). "
            "Use your own LLM keys (anthropic) or a local model (claude_code), "
            "or switch to hybrid mode (OMILO_MODE=hybrid) to connect to Omilo Cloud "
            "and use pooled AI credits."
        )

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
