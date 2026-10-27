"""
FakeEngine — deterministic, no external calls, no DB/network.

Used for tests, demos, and local dev without LLM credentials.
Same input always produces the same output (pure function behaviour).
"""
from __future__ import annotations

from omilo.engine.context import TaskContext, EngineResult

# Sentinel prefix → (action_type, risk)
_SENTINELS: list[tuple[str, str, str]] = [
    ("SEND:",   "message",   "medium"),
    ("SPEND:",  "spend",     "high"),
    ("DEPLOY:", "deploy",    "high"),
    ("NOTE:",   "doc_write", "low"),
]


def _parse_sentinel(brief: str) -> dict | None:
    """
    Scan brief lines for a known sentinel prefix.
    Returns a pending_action dict or None.
    First matching line wins (top-to-bottom).
    """
    for line in brief.splitlines():
        stripped = line.strip()
        for prefix, action_type, risk in _SENTINELS:
            if stripped.startswith(prefix):
                rest = stripped[len(prefix):].strip()
                if action_type == "message":
                    payload = {"text": rest}
                elif action_type == "spend":
                    payload = {"amount": rest}
                elif action_type == "deploy":
                    payload = {"what": rest}
                else:  # doc_write
                    payload = {"text": rest}
                return {"type": action_type, "risk": risk, "payload": payload}
    return None


class FakeEngine:
    """
    Deterministic fake engine for testing and local development.

    Behaviour:
    - Emits a thinking event then a text event via ctx.emit.
    - Scans ctx.brief for side-effect sentinels and returns a pending_action.
    - token counts are len-based (deterministic, small).
    - cost_credits always 0.
    - No randomness, no network, no DB.
    """

    def run(self, ctx: TaskContext) -> EngineResult:
        first_line = ctx.brief.splitlines()[0] if ctx.brief else "(empty)"
        reply = f"[fake] handled: {first_line}"

        # Emit thinking event
        ctx.emit({"kind": "thinking", "data": {"text": "planning"}})

        # Emit text event
        ctx.emit({"kind": "text", "data": {"text": reply}})

        pending_action = _parse_sentinel(ctx.brief)

        tokens_in = len(ctx.brief)
        tokens_out = len(reply)

        return EngineResult(
            text=reply,
            pending_action=pending_action,
            error=None,
            cost_credits=0,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            suspended=False,
            defer=False,
        )
