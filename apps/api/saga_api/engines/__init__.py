"""Engines do the thinking. The gateway only needs two calls from them: run a task, answer a chat."""
from collections.abc import Callable
from dataclasses import dataclass, field


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
    if t in ("hermes", "openai"):
        from .hermes import HermesEngine

        return HermesEngine()
    if t in ("claude", "anthropic"):
        from .claude import ClaudeEngine

        return ClaudeEngine()
    if t == "claude-code":
        from .claude_code import ClaudeCodeEngine

        return ClaudeCodeEngine()
    if t == "fake":
        from .fake import FakeEngine

        return FakeEngine()
    raise ValueError(f"unknown engine type '{t}'")
