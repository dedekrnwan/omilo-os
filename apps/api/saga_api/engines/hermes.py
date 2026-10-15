"""Hermes (or any OpenAI-compatible agent server) as the engine.

Each staff agent points at its own Hermes profile's API server, e.g. base_url=http://hermes:8642/v1,
with the key in the environment variable named by `api_key_env` (default HERMES_API_KEY).
The Hermes profile must have the saga-os MCP server configured with this staff's token
(Staff screen -> "Connect engine" shows the exact snippet).
"""
import asyncio
import json
import os

import httpx

from . import ChatContext, Engine, EngineResult, TaskContext
from .prompts import CHAT_SYSTEM, CONSTITUTION, task_message


class HermesEngine(Engine):
    type = "hermes"

    def _client(self, cfg: dict, timeout: float) -> tuple[httpx.AsyncClient, str]:
        base = (cfg.get("base_url") or "http://127.0.0.1:8642/v1").rstrip("/")
        key = ""
        if cfg.get("api_key_enc"):
            from ..security import decrypt

            key = decrypt(cfg["api_key_enc"]) or ""
        key = key or os.environ.get(cfg.get("api_key_env") or "HERMES_API_KEY", "")
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        return httpx.AsyncClient(base_url=base, headers=headers, timeout=timeout), cfg.get("model") or "hermes-agent"

    async def _wait_ready(self, cfg: dict, seconds: float = 90) -> bool:
        """A gateway Saga OS just started needs a few seconds before it answers."""
        end = asyncio.get_event_loop().time() + seconds
        while True:
            if (await self.health(cfg))["ok"]:
                return True
            if asyncio.get_event_loop().time() > end:
                return False
            await asyncio.sleep(2)

    async def _complete(self, cfg: dict, messages: list[dict], timeout: float, session: str, emit=None) -> EngineResult:
        """Streams the answer so the workspace can show it as it is written; falls back to a plain JSON reply."""
        emit = emit or (lambda kind, **d: None)
        if cfg.get("managed") and not await self._wait_ready(cfg):
            return EngineResult(error="Hermes did not start. See Settings → AI → Hermes log.")
        client, model = self._client(cfg, timeout)
        text, reasoning, tokens = "", "", 0
        last_emit = 0.0
        loop = asyncio.get_event_loop()
        async with client:
            try:
                async with client.stream("POST", "/chat/completions", json={"model": model, "messages": messages, "stream": True},
                                         headers={"X-Hermes-Session-Id": session}) as r:
                    if r.status_code >= 400:
                        body = (await r.aread()).decode(errors="replace")
                        return EngineResult(error=f"engine HTTP {r.status_code}: {body[:300]}")
                    if "text/event-stream" not in r.headers.get("content-type", ""):
                        data = json.loads(await r.aread())
                        text = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
                        tokens = int((data.get("usage") or {}).get("total_tokens") or 0)
                    else:
                        async for line in r.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            payload = line[5:].strip()
                            if payload == "[DONE]":
                                break
                            try:
                                chunk = json.loads(payload)
                            except ValueError:
                                continue
                            if chunk.get("usage"):
                                tokens = int(chunk["usage"].get("total_tokens") or tokens)
                            delta = ((chunk.get("choices") or [{}])[0].get("delta") or {})
                            text += delta.get("content") or ""
                            reasoning += delta.get("reasoning_content") or delta.get("reasoning") or ""
                            if loop.time() - last_emit > 1.5 and (text or reasoning):
                                last_emit = loop.time()
                                emit("draft", text=text[-4000:], thinking=reasoning[-2000:])
            except httpx.HTTPError as e:
                return EngineResult(error=f"engine unreachable: {e}")
        if reasoning:
            emit("thinking", text=reasoning)
        if text.startswith(("API call failed", "Error: ")) or "Provider returned an empty stream" in text[:200]:
            return EngineResult(error=f"Hermes could not reach the AI: {text[:300]}", tokens=tokens)
        return EngineResult(text=text, tokens=tokens)

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        cfg = ctx.engine_config
        msgs = [
            {"role": "system", "content": CONSTITUTION.format(name=ctx.staff_name, job=ctx.job or "(no job description yet)")},
            {"role": "user", "content": task_message(ctx)},
        ]
        return await self._complete(cfg, msgs, timeout=float(cfg.get("timeout_s") or 1800), session=f"task-{ctx.task_id}", emit=ctx.emit)

    async def chat(self, ctx: ChatContext) -> EngineResult:
        cfg = ctx.engine_config
        msgs = [{"role": "system", "content": CHAT_SYSTEM.format(
            name=ctx.staff_name, chief=", the Chief of Staff" if ctx.is_chief else "", context=ctx.context_note)}]
        for m in ctx.history[-30:]:
            msgs.append({"role": "user" if m["role"] == "owner" else "assistant", "content": m["text"]})
        return await self._complete(cfg, msgs, timeout=float(cfg.get("chat_timeout_s") or 300), session=f"thread-{ctx.thread_id}", emit=ctx.emit)

    async def health(self, cfg: dict) -> dict:
        base = (cfg.get("base_url") or "http://127.0.0.1:8642/v1").rstrip("/")
        root = base[:-3] if base.endswith("/v1") else base
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(root + "/health")
            return {"ok": r.status_code == 200, "detail": r.text[:200]}
        except httpx.HTTPError as e:
            return {"ok": False, "detail": str(e)}
