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
    """Raised when the requested engine type is valid but not yet implemented."""


def get_engine(cfg: dict) -> Engine:
    """
    Factory: return an Engine for the given configuration dict.

    cfg["type"] dispatch:
        "fake"              → FakeEngine (deterministic, no external calls)
        "litellm"           → EngineNotConfigured (P4)
        "anthropic"         → EngineNotConfigured (P4)
        anything else       → ValueError
    """
    engine_type = cfg.get("type", "")

    if engine_type == "fake":
        from omilo.engine.fake import FakeEngine
        return FakeEngine()

    if engine_type in ("litellm", "anthropic"):
        raise EngineNotConfigured(
            f"engine '{engine_type}' not configured in P1; will be wired in P4"
        )

    raise ValueError(
        f"Unknown engine type '{engine_type}'. "
        "Valid types: 'fake', 'litellm', 'anthropic'."
    )
