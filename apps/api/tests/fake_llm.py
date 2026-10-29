"""A tiny fake LLM server for tests: Anthropic /v1/messages and OpenAI
/chat/completions, both streamed as SSE, so omilo.ai is exercised end to end
over real HTTP without any API key.

Behaviour (driven by the last user message):
- contains "APPROVE"  → first turn calls the ``request_action`` tool, the
                         second turn writes a short report
- contains "NOTE:"     → first turn calls ``save_note`` (+ text), then stops
- otherwise            → streams "Halo! " + "Saya siap membantu." as text
The server records every request body in ``server.requests``.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from typing import Any

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route


def _last_user_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            parts = [b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text"]
            if parts:
                return "\n".join(parts)
            return "__tool_result__"
    return ""


class FakeLLM:
    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.port = _free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        app = Starlette(routes=[
            Route("/v1/messages", self.anthropic, methods=["POST"]),
            Route("/chat/completions", self.openai, methods=["POST"]),
            Route("/v1/models", lambda r: JSONResponse({"data": [{"id": "claude-sonnet-5-5"}]})),
        ])
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning"))
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def start(self) -> "FakeLLM":
        self.thread.start()
        for _ in range(100):
            if self.server.started:
                return self
            time.sleep(0.05)
        raise RuntimeError("fake LLM did not start")

    def stop(self) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)

    # ── Anthropic ────────────────────────────────────────────────────────────
    async def anthropic(self, request: Request):
        body = await request.json()
        self.requests.append({"api": "anthropic", "headers": dict(request.headers), "body": body})
        if request.headers.get("x-api-key") != "sk-test-123":
            return JSONResponse({"type": "error", "error": {"message": "invalid x-api-key"}}, status_code=401)
        msgs = body.get("messages") or []
        last = _last_user_text(msgs)
        tool_names = {t.get("name") for t in body.get("tools") or []}

        def sse(ev: dict) -> str:
            return f"event: {ev['type']}\ndata: {json.dumps(ev)}\n\n"

        def gen():
            yield sse({"type": "message_start", "message": {"usage": {"input_tokens": 50}}})
            if "APPROVE" in last and "request_action" in tool_names:
                yield sse({"type": "content_block_start", "index": 0,
                           "content_block": {"type": "tool_use", "id": "tu_1", "name": "request_action", "input": {}}})
                args = {"type": "message", "title": "Send the promo to 120 customers",
                        "details": "WhatsApp blast: 'Diskon 20% minggu ini'", "risk": "medium"}
                js = json.dumps(args)
                for part in (js[:20], js[20:]):
                    yield sse({"type": "content_block_delta", "index": 0,
                               "delta": {"type": "input_json_delta", "partial_json": part}})
                yield sse({"type": "content_block_stop", "index": 0})
                yield sse({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 30}})
            elif "NOTE:" in last and "save_note" in tool_names:
                yield sse({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
                yield sse({"type": "content_block_delta", "index": 0,
                           "delta": {"type": "text_delta", "text": "Siap, saya catat. Siapa pelanggan utama kamu?"}})
                yield sse({"type": "content_block_stop", "index": 0})
                yield sse({"type": "content_block_start", "index": 1,
                           "content_block": {"type": "tool_use", "id": "tu_2", "name": "save_note", "input": {}}})
                yield sse({"type": "content_block_delta", "index": 1, "delta": {
                    "type": "input_json_delta",
                    "partial_json": json.dumps({"topic": "company", "content": "Saga builds Omilo, an AI office."})}})
                yield sse({"type": "content_block_stop", "index": 1})
                yield sse({"type": "content_block_start", "index": 2,
                           "content_block": {"type": "tool_use", "id": "tu_3", "name": "suggest_replies", "input": {}}})
                yield sse({"type": "content_block_delta", "index": 2, "delta": {
                    "type": "input_json_delta", "partial_json": json.dumps({"options": ["UMKM", "Startups"]})}})
                yield sse({"type": "content_block_stop", "index": 2})
                yield sse({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 40}})
            else:
                yield sse({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
                for piece in ("Halo! ", "Saya siap membantu."):
                    yield sse({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": piece}})
                yield sse({"type": "content_block_stop", "index": 0})
                yield sse({"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 12}})
            yield sse({"type": "message_stop"})

        return StreamingResponse(gen(), media_type="text/event-stream")

    # ── OpenAI-compatible ─────────────────────────────────────────────────────
    async def openai(self, request: Request):
        body = await request.json()
        self.requests.append({"api": "openai", "headers": dict(request.headers), "body": body})

        def gen():
            for piece in ("Hello ", "from GPT."):
                yield "data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": piece}}]}) + "\n\n"
            yield "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 20, "completion_tokens": 4}}) + "\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(gen(), media_type="text/event-stream")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def parse_sse(raw: str) -> list[tuple[str, Any]]:
    """[(event, data)] from a text/event-stream body."""
    out = []
    for frame in raw.split("\n\n"):
        ev, data = "", ""
        for line in frame.splitlines():
            if line.startswith("event:"):
                ev = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if ev or data:
            try:
                out.append((ev, json.loads(data) if data else None))
            except ValueError:
                out.append((ev, data))
    return out
