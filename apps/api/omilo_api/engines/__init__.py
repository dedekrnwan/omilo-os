"""Engines do the thinking. The gateway only needs two calls from them: run a task, answer a chat."""
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class TaskContext:
    staff_id: str
    staff_name: str
    job: str
    is_chief: bool
    task_id: str
    origin: str
    brief: str
    founder_note: str
    checkpoint: dict | None
    proposal: dict | None
    mcp_url: str
    mcp_token: str | None
    engine_config: dict = field(default_factory=dict)
    emit: Callable[..., None] = field(default=lambda kind, **d: None)  # live progress (events.Emitter)
    resources: Any = None  # capabilities.Resources: folders, connectors, skills, files
    memory: str = ""  # lessons, last runs of this job, recent decisions (memory.brief_for)


@dataclass
class ChatContext:
    staff_id: str
    staff_name: str
    job: str
    is_chief: bool
    thread_id: str
    scope: str
    history: list[dict]  # [{"role": "owner"|"agent", "text": ...}] oldest first; last is the new owner message
    context_note: str
    mcp_url: str
    mcp_token: str | None
    engine_config: dict = field(default_factory=dict)
    emit: Callable[..., None] = field(default=lambda kind, **d: None)
    resources: Any = None
    shared: bool = False  # several helpers talk in this thread: start fresh each turn, don't resume a private session


@dataclass
class EngineResult:
    text: str = ""
    error: str = ""
    cost_usd: float = 0.0
    tokens: int = 0


class Engine:
    type: str = "base"

    async def run_task(self, ctx: TaskContext) -> EngineResult:  # pragma: no cover - interface
        raise NotImplementedError

    async def chat(self, ctx: ChatContext) -> EngineResult:  # pragma: no cover - interface
        raise NotImplementedError

    async def health(self, config: dict) -> dict:
        return {"ok": True}


def get_engine(config: dict) -> Engine:
    t = (config or {}).get("type", "fake")
    if t in ("hermes", "openai"):  # Hermes was removed: such helpers are moved to Claude Code on start-up
        from .claude_code import ClaudeCodeEngine

        return ClaudeCodeEngine()
    if t in ("claude", "anthropic"):
        from .claude import ClaudeEngine

        return ClaudeEngine()
    if t == "claude-code":
        from .claude_code import ClaudeCodeEngine

        return ClaudeCodeEngine()
    if t == "fake":
        from .fake import FakeEngine

        return FakeEngine()
    if t == "litellm":
        from .litellm_engine import LiteLLMEngine

        return LiteLLMEngine()
    if t == "graph":
        # Lazy import: graph.engine imports from this package, so importing it at
        # module scope would create a cycle. Resolving it only here keeps startup clean.
        from ..graph.engine import GraphEngine

        return GraphEngine()
    raise ValueError(f"unknown engine type '{t}'")
