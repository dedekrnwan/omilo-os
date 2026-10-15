"""Hermes (or any OpenAI-compatible agent server) as the engine.

Each staff agent points at its own Hermes profile's API server, e.g. base_url=http://hermes:8642/v1,
with the key in the environment variable named by `api_key_env` (default HERMES_API_KEY).
The Hermes profile must have the saga-os MCP server configured with this staff's token
(Staff screen -> "Connect engine" shows the exact snippet).
"""
import os

import httpx

from . import ChatContext, Engine, EngineResult, TaskContext
from .prompts import CHAT_SYSTEM, CONSTITUTION, task_message


class HermesEngine(Engine):
    type = "hermes"

    def _client(self, cfg: dict, timeout: float) -> tuple[httpx.AsyncClient, str]:
        base = (cfg.get("base_url") or "http://127.0.0.1:8642/v1").rstrip("/")
        key = os.environ.get(cfg.get("api_key_env") or "HERMES_API_KEY", "")
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        return httpx.AsyncClient(base_url=base, headers=headers, timeout=timeout), cfg.get("model") or "hermes-agent"

    async def _complete(self, cfg: dict, messages: list[dict], timeout: float, session: str) -> EngineResult:
        client, model = self._client(cfg, timeout)
        async with client:
            try:
                r = await client.post("/chat/completions", json={"model": model, "messages": messages, "stream": False},
                                      headers={"X-Hermes-Session-Id": session})
            except httpx.HTTPError as e:
                return EngineResult(error=f"engine unreachable: {e}")
            if r.status_code >= 400:
                return EngineResult(error=f"engine HTTP {r.status_code}: {r.text[:300]}")
            data = r.json()
        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
        usage = data.get("usage") or {}
        return EngineResult(text=text, tokens=int(usage.get("total_tokens") or 0))

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        cfg = ctx.engine_config
        msgs = [
            {"role": "system", "content": CONSTITUTION.format(name=ctx.staff_name, job=ctx.job or "(no job description yet)")},
            {"role": "user", "content": task_message(ctx)},
        ]
        return await self._complete(cfg, msgs, timeout=float(cfg.get("timeout_s") or 1800), session=f"task-{ctx.task_id}")

    async def chat(self, ctx: ChatContext) -> EngineResult:
        cfg = ctx.engine_config
        msgs = [{"role": "system", "content": CHAT_SYSTEM.format(
            name=ctx.staff_name, chief=", the Chief of Staff" if ctx.is_chief else "", context=ctx.context_note)}]
        for m in ctx.history[-30:]:
            msgs.append({"role": "user" if m["role"] == "owner" else "assistant", "content": m["text"]})
        return await self._complete(cfg, msgs, timeout=float(cfg.get("chat_timeout_s") or 300), session=f"thread-{ctx.thread_id}")

    async def health(self, cfg: dict) -> dict:
        base = (cfg.get("base_url") or "http://127.0.0.1:8642/v1").rstrip("/")
        root = base[:-3] if base.endswith("/v1") else base
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(root + "/health")
            return {"ok": r.status_code == 200, "detail": r.text[:200]}
        except httpx.HTTPError as e:
            return {"ok": False, "detail": str(e)}
