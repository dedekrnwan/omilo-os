"""Vendor-agnostic agent loop via LiteLLM.

Runs the same turn-loop shape as claude.py (model call → MCP tool calls →
tool results → repeat until the model stops) but through litellm.acompletion(),
so any of the 8 registered providers works with one code path.

Task 3 will add run_task / chat / health wrappers and wire this into get_engine().
"""
from __future__ import annotations

import json
import os

import litellm

from . import Engine, EngineResult
from .fake import MCPClient
from . import providers as P

# Standard environment variable names per provider (fallback when no cfg key and no DB key).
_PROVIDER_ENV: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "xai": "XAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    # TODO(task-3): Bedrock also needs AWS_SECRET_ACCESS_KEY + AWS_DEFAULT_REGION passed as litellm kwargs
    "bedrock": "AWS_ACCESS_KEY_ID",
    "groq": "GROQ_API_KEY",
}


def mcp_tools_to_openai(tools: list[dict]) -> list[dict]:
    """Convert MCP tool descriptors to the OpenAI function-call format.

    MCP shape: {"name": ..., "description": ..., "inputSchema": {...}}
    OpenAI shape: {"type": "function", "function": {"name": ..., "description": ..., "parameters": {...}}}
    """
    result = []
    for t in tools:
        result.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t.get("description") or "",
                "parameters": t.get("inputSchema") or {"type": "object"},
            },
        })
    return result


def _key_from_db(pid: str) -> str | None:
    """Try to load the stored API key for provider *pid* from the DB.  Returns None on any failure."""
    try:
        from .. import services as S
        from ..db import session_scope

        with session_scope() as db:
            return S.ai_api_key(db, pid)
    except Exception:  # noqa: BLE001 — DB may be unavailable in tests
        return None


def resolve_key(cfg: dict, pid: str) -> str:
    """Resolve the API key for provider *pid*.

    Precedence:
    1. cfg["api_key"] (caller-supplied)
    2. DB-stored key via services.ai_api_key
    3. Standard environment variable for the provider
    4. Empty string (caller must check and return an error result)
    """
    if cfg.get("api_key"):
        return cfg["api_key"]
    db_key = _key_from_db(pid)
    if db_key:
        return db_key
    env_var = _PROVIDER_ENV.get(pid, f"{pid.upper()}_API_KEY")
    return os.environ.get(env_var, "")


def _sum_tokens(usage) -> int:
    """Sum all token fields from a litellm usage object defensively.

    LiteLLM usage has prompt_tokens + completion_tokens.  For cache-aware
    providers (Anthropic, Gemini) it may also surface cache_read_input_tokens
    and cache_creation_input_tokens either directly on the usage object or
    nested under prompt_tokens_details.  Guard every field: missing attrs or
    None values default to 0.
    """
    def _g(obj, *attrs):
        for a in attrs:
            v = getattr(obj, a, None) if not isinstance(obj, dict) else obj.get(a)
            if v is not None:
                return int(v)
        return 0

    total = _g(usage, "prompt_tokens") + _g(usage, "completion_tokens")

    # Direct fields (most providers)
    total += _g(usage, "cache_read_input_tokens")
    total += _g(usage, "cache_creation_input_tokens")

    # Nested under prompt_tokens_details (some versions).
    # Assumption: a provider surfaces cached tokens either directly OR nested, not both — so this
    # won't double-count as long as a provider only populates one path.
    details = getattr(usage, "prompt_tokens_details", None) or {}
    if hasattr(details, "__getitem__") or hasattr(details, "__dict__"):
        total += _g(details, "cached_tokens", "cache_read_input_tokens")

    return total


class LiteLLMEngine(Engine):
    type = "litellm"

    async def _loop(
        self,
        cfg: dict,
        system: str,
        messages: list[dict],
        mcp: MCPClient | None,
        allowed: set[str] | None,
        max_turns: int,
        timeout: float,
        emit=None,
    ) -> EngineResult:
        emit = emit or (lambda kind, **d: None)

        # --- Resolve provider ---
        pid = cfg.get("provider", "")
        prov = P.get_provider(pid)
        if prov is None:
            return EngineResult(error=f"Unknown provider '{pid}'. Check Settings → AI.")

        model = P.litellm_model(prov, cfg.get("model"), cfg.get("tier"))

        # --- Resolve API key ---
        key = resolve_key(cfg, pid)
        if not key:
            return EngineResult(error=f"No API key for '{pid}'. Add one in Settings → AI.")

        # --- Build MCP tools in OpenAI format ---
        oai_tools: list[dict] = []
        if mcp:
            raw_tools = await mcp.list_tools()
            filtered = [t for t in raw_tools if allowed is None or t["name"] in allowed]
            oai_tools = mcp_tools_to_openai(filtered)

        # --- Build system message ---
        # For cache-supporting providers, wrap system in a content-block list with
        # cache_control so the stable prefix is cached across turns.
        if prov.supports_cache:
            system_payload: list[dict] | str = [
                {"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}
            ]
        else:
            system_payload = system

        tokens, text, cost = 0, "", 0.0
        msgs = [{"role": "system", "content": system_payload}] + list(messages)

        for _ in range(max_turns):
            call_kwargs: dict = {
                "model": model,
                "messages": msgs,
                "max_tokens": int(cfg.get("max_tokens") or 8192),
                "api_key": key,
                "timeout": timeout,
            }
            if oai_tools:
                call_kwargs["tools"] = oai_tools

            try:
                resp = await litellm.acompletion(**call_kwargs)
            except Exception as e:  # noqa: BLE001
                return EngineResult(error=f"{pid} unreachable: {e}", tokens=tokens, cost_usd=cost)

            # --- Token accounting ---
            if resp.usage is not None:
                tokens += _sum_tokens(resp.usage)

            # --- Cost accounting ---
            try:
                turn_cost = litellm.completion_cost(completion_response=resp) or 0.0
                cost += turn_cost
            except Exception:  # noqa: BLE001 — unknown models raise; treat as 0
                pass

            msg = resp.choices[0].message
            if msg.content:
                text = msg.content if isinstance(msg.content, str) else str(msg.content)

            tool_calls = msg.tool_calls  # list[ToolCall] or None
            if not tool_calls or not mcp:
                # No tool calls (or no MCP client) → model is done
                return EngineResult(text=text, tokens=tokens, cost_usd=cost)

            # --- Append assistant turn with tool calls ---
            # Serialize to a plain dict so the next messages list stays JSON-safe.
            # Use "" instead of None for content: Mistral and Groq reject null content fields.
            assistant_msg: dict = {"role": "assistant", "content": msg.content or "", "tool_calls": [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ]}
            msgs.append(assistant_msg)

            # --- Execute each tool call and append results ---
            for tc in tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except (json.JSONDecodeError, TypeError):
                    args = {}
                out, is_error = await mcp.call_raw(name, args)
                emit("tool", name=name, input=args, ok=not is_error)
                msgs.append({"role": "tool", "tool_call_id": tc.id, "content": out})

        return EngineResult(
            text=text,
            tokens=tokens,
            cost_usd=cost,
            error=f"stopped after {max_turns} steps without finishing",
        )
