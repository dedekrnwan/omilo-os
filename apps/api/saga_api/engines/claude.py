"""Claude (Anthropic API) as a built-in engine: the owner pastes an API key, nothing else to install.

Runs the agent loop inside Saga OS: the model gets the saga-os MCP tools (fetched over the real MCP
endpoint with the staff token, so policy and the tool log apply exactly as for Hermes), and every
tool_use is executed through MCP and returned as tool_result until the model stops.
"""
import os

import httpx

from . import ChatContext, Engine, EngineResult, TaskContext
from .fake import MCPClient
from .prompts import CHAT_SYSTEM, CONSTITUTION, task_message

API = "https://api.anthropic.com"
VERSION = "2023-06-01"
DEFAULT_MODEL = "claude-sonnet-5-5"
MAX_TURNS_TASK = 40
MAX_TURNS_CHAT = 8
CHAT_TOOLS = {"whoami", "get_context", "get_approved", "ask_founder", "post_message", "create_task", "update_kpi"}


def api_key(cfg: dict) -> str:
    """The key comes from Settings (stored encrypted), else ANTHROPIC_API_KEY."""
    if cfg.get("api_key"):
        return cfg["api_key"]
    from .. import services as S
    from ..db import session_scope

    with session_scope() as db:
        k = S.ai_api_key(db, "claude")
    return k or os.environ.get("ANTHROPIC_API_KEY", "")


def api_base(cfg: dict | None = None) -> str:
    return ((cfg or {}).get("base_url") or os.environ.get("SAGA_ANTHROPIC_BASE_URL") or API).rstrip("/")


def headers(key: str) -> dict:
    return {"x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json"}


async def list_models(key: str, base: str | None = None) -> dict:
    """Check a key and list the models it can use. Returns {ok, models: [{id, name}], error}."""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(f"{base or api_base()}/v1/models", params={"limit": 100}, headers=headers(key))
    except httpx.HTTPError as e:
        return {"ok": False, "error": f"Could not reach Anthropic: {e}"}
    if r.status_code in (401, 403):
        return {"ok": False, "error": "This key was not accepted. Copy it again from console.anthropic.com (it starts with sk-ant-)."}
    if r.status_code >= 400:
        return {"ok": False, "error": f"Anthropic answered {r.status_code}: {r.text[:200]}"}
    models = [{"id": m["id"], "name": m.get("display_name") or m["id"]} for m in r.json().get("data", [])]
    return {"ok": True, "models": models}


def pick_default(models: list[dict]) -> str:
    for m in models:
        if "sonnet" in m["id"]:
            return m["id"]
    return models[0]["id"] if models else DEFAULT_MODEL


class ClaudeEngine(Engine):
    type = "claude"

    async def _loop(self, cfg: dict, system: str, messages: list[dict], mcp: MCPClient | None,
                    allowed: set[str] | None, max_turns: int, timeout: float) -> EngineResult:
        key = api_key(cfg)
        if not key:
            return EngineResult(error="No Claude API key yet. Add one in Settings → AI.")
        base = api_base(cfg)
        model = cfg.get("model") if str(cfg.get("model") or "").startswith("claude") else DEFAULT_MODEL
        tools = []
        if mcp:
            tools = [{"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("inputSchema") or {"type": "object"}}
                     for t in await mcp.list_tools() if allowed is None or t["name"] in allowed]
        tokens, text = 0, ""
        async with httpx.AsyncClient(timeout=timeout) as c:
            for _ in range(max_turns):
                body = {"model": model, "max_tokens": int(cfg.get("max_tokens") or 8192), "system": system, "messages": messages}
                if tools:
                    body["tools"] = tools
                try:
                    r = await c.post(f"{base}/v1/messages", json=body, headers=headers(key))
                except httpx.HTTPError as e:
                    return EngineResult(error=f"Claude unreachable: {e}", tokens=tokens)
                if r.status_code >= 400:
                    return EngineResult(error=f"Claude API {r.status_code}: {r.text[:300]}", tokens=tokens)
                data = r.json()
                u = data.get("usage") or {}
                tokens += int(u.get("input_tokens") or 0) + int(u.get("output_tokens") or 0)
                content = data.get("content") or []
                text = "\n".join(b.get("text", "") for b in content if b.get("type") == "text").strip() or text
                uses = [b for b in content if b.get("type") == "tool_use"]
                if data.get("stop_reason") != "tool_use" or not uses or not mcp:
                    return EngineResult(text=text, tokens=tokens)
                messages.append({"role": "assistant", "content": content})
                results = []
                for b in uses:
                    out, err = await mcp.call_raw(b["name"], b.get("input") or {})
                    results.append({"type": "tool_result", "tool_use_id": b["id"], "content": out, **({"is_error": True} if err else {})})
                messages.append({"role": "user", "content": results})
        return EngineResult(text=text, tokens=tokens, error=f"stopped after {max_turns} steps without finishing")

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        cfg = ctx.engine_config
        if not ctx.mcp_token:
            return EngineResult(error="no MCP token for this helper: rotate it in Staff")
        system = CONSTITUTION.format(name=ctx.staff_name, job=ctx.job or "(no job description yet)")
        async with MCPClient(ctx.mcp_url, ctx.mcp_token) as m:
            return await self._loop(cfg, system, [{"role": "user", "content": task_message(ctx)}], m, None,
                                    int(cfg.get("max_turns") or MAX_TURNS_TASK), float(cfg.get("request_timeout_s") or 300))

    async def chat(self, ctx: ChatContext) -> EngineResult:
        cfg = ctx.engine_config
        system = CHAT_SYSTEM.format(name=ctx.staff_name, chief=", the Chief of Staff" if ctx.is_chief else "", context=ctx.context_note)
        msgs: list[dict] = []
        for h in ctx.history[-30:]:
            role = "user" if h["role"] == "owner" else "assistant"
            if msgs and msgs[-1]["role"] == role:  # the API wants alternating turns
                msgs[-1]["content"] += "\n\n" + h["text"]
            else:
                msgs.append({"role": role, "content": h["text"]})
        while msgs and msgs[0]["role"] != "user":
            msgs.pop(0)
        if not msgs:
            return EngineResult(text="")
        if not ctx.mcp_token:
            return await self._loop(cfg, system, msgs, None, None, 1, 120)
        async with MCPClient(ctx.mcp_url, ctx.mcp_token) as m:
            return await self._loop(cfg, system, msgs, m, CHAT_TOOLS, MAX_TURNS_CHAT, 120)

    async def health(self, cfg: dict) -> dict:
        key = api_key(cfg)
        if not key:
            return {"ok": False, "detail": "no Claude API key (Settings → AI)"}
        res = await list_models(key, api_base(cfg))
        return {"ok": res["ok"], "detail": f"Claude · {cfg.get('model') or DEFAULT_MODEL}" if res["ok"] else res["error"]}
