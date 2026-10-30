"""
Engine boundary types: TaskContext and EngineResult.

Ported from omilo-os. Contract between the LangGraph worker node
and whichever engine backend runs a turn.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


def _noop_emit(event: dict) -> None:  # pragma: no cover
    """Default no-op emit so TaskContext is usable without a real emitter."""
    pass


@dataclass
class TaskContext:
    """All context a worker engine needs for one turn."""

    company_id: str
    helper_id: str
    helper_name: str
    is_chief: bool
    job_id: str
    origin: str
    brief: str
    operator_note: str | None = None
    autonomy: str = "ask"
    goal_delivery: bool = False
    memory: str = ""
    emit: Callable[[dict], None] = field(default=_noop_emit)
    # sweep/team-analytics: the helper's standing instructions (job description +
    # Behavior tab settings), meant for the system prompt of real engines.
    instructions: str = ""
    # Per-task AI limit in tokens from the Behavior tab (None = no limit).
    task_token_cap: int | None = None


@dataclass
class EngineResult:
    """What an engine returns after running one turn."""

    text: str = ""
    pending_action: dict | None = None
    error: str | None = None
    cost_credits: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    suspended: bool = False
    defer: bool = False
