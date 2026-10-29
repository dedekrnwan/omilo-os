"""One streaming conversation turn with whichever AI the company connected.

``converse(cfg, system, history, tools=…, on_call=…)`` is an async generator
of plain dict events, the same for every provider:

    {"type": "text", "delta": str}                 reply text as it is written
    {"type": "activity", "label": str}             a tool / web step in progress
    {"type": "sources", "items": [{url, title}]}   pages the AI read
    {"type": "done", "text", "tokens_in", "tokens_out", "cost_usd", "model"}

Tools use one neutral shape — ``{"name", "description", "parameters"}`` (JSON
schema) — and ``on_call(name, args) -> str`` runs them. Providers:

- ``anthropic``      Messages API, streamed (SSE), native tool use, hosted
                     web_search / web_fetch when ``web=True``
- ``openai_compat``  /chat/completions, streamed — OpenAI, Gemini, OpenRouter,
                     Grok, DeepSeek, Groq, Mistral
- ``cli``            the owner's own signed-in CLI on this computer (Claude
                     Code streams with ``--output-format stream-json``; Codex,
                     Gemini CLI and OpenCode answer in one piece). Tools go
                     through a small JSON protocol since CLIs have no
                     function calling here.
- ``fake``           practice mode, deterministic, no network

Ported from omilo-os (engines/claude.py, engines/claude_code.py, interview.py).
"""
from __future__ import annotations

import asyncio
import json
import os
import random
import re
import shutil
import tempfile
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx

from omilo.ai.config import AiConfig

ToolFn = Callable[[str, dict], Awaitable[str]]

ANTHROPIC_VERSION = "2023-06-01"
WEB_TOOLS = [
    {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
    {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 10},
]
_RETRY_STATUS = {408, 409, 429, 500, 502, 503, 504, 529}
_TRIES = 3

# Rough list prices (USD per million tokens, input/output) for the cost estimate.
_PRICES = [
    ("opus", 5.0, 25.0), ("sonnet", 3.0, 15.0), ("haiku", 1.0, 5.0),
    ("gpt-5", 2.5, 10.0), ("mini", 0.4, 1.6), ("gemini", 1.25, 10.0),
]


class AiError(RuntimeError):
    """A provider problem, worded for the owner."""


def estimate_usd(model: str | None, tokens_in: int, tokens_out: int) -> float:
    m = (model or "").lower()
    for needle, pin, pout in _PRICES:
        if needle in m:
            return (tokens_in * pin + tokens_out * pout) / 1_000_000
    return (tokens_in * 1.0 + tokens_out * 3.0) / 1_000_000


def normalise_history(history: list[dict]) -> list[dict]:
    """[{role: user|assistant, content}] alternating, starting with user."""
    out: list[dict] = []
    for h in history:
        role = "assistant" if h.get("role") in ("assistant", "ai", "agent", "helper") else "user"
        text = str(h.get("content") if h.get("content") is not None else h.get("text") or "").strip()
        if not text:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n\n" + text
        else:
            out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


async def converse(
    cfg: AiConfig,
    system: str,
    history: list[dict],
    *,
    tools: list[dict] | None = None,
    on_call: ToolFn | None = None,
    web: bool = False,
    max_turns: int = 6,
    max_tokens: int = 2048,
    final_tools: set[str] | None = None,
    timeout: float = 180.0,
) -> AsyncIterator[dict]:
    """Stream one turn (with its tool loop). See the module docstring."""
    msgs = normalise_history(history)
    if not msgs:
        msgs = [{"role": "user", "content": "(Start the conversation.)"}]
    if cfg.provider == "anthropic":
        gen = _anthropic(cfg, system, msgs, tools or [], on_call, web, max_turns, max_tokens, final_tools or set(), timeout)
    elif cfg.provider == "openai_compat":
        gen = _openai(cfg, system, msgs, tools or [], on_call, max_turns, max_tokens, final_tools or set(), timeout)
    elif cfg.provider == "cli":
        gen = _cli(cfg, system, msgs, tools or [], on_call, web, max_turns, final_tools or set(), timeout)
    else:
        gen = _fake(system, msgs)
    async for ev in gen:
        yield ev


async def complete(cfg: AiConfig, system: str, history: list[dict], **kw: Any) -> dict:
    """Run ``converse`` to the end and return its ``done`` event."""
    done: dict = {"text": "", "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "model": None}
    async for ev in converse(cfg, system, history, **kw):
        if ev["type"] == "done":
            done = ev
    return done


def run_sync(coro_factory: Callable[[], Awaitable[Any]]) -> Any:
    """Run an async call from sync code (the job runner), even inside a running loop."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro_factory())
    box: dict[str, Any] = {}

    def worker() -> None:
        try:
            box["value"] = asyncio.run(coro_factory())
        except BaseException as e:  # noqa: BLE001 — re-raised in the caller
            box["error"] = e

    import threading

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join()
    if "error" in box:
        raise box["error"]
    return box.get("value")


# ── practice mode ────────────────────────────────────────────────────────────

async def _fake(system: str, msgs: list[dict]) -> AsyncIterator[dict]:
    last = msgs[-1]["content"] if msgs else ""
    text = ("I'm running in practice mode, so I can't really think yet. Connect an AI in "
            "Control panel → AI accounts (a Claude or OpenAI key, or Claude Code signed in on this "
            f"computer) and I'll answer properly.\n\nYou said: “{last[:300]}”")
    for chunk in re.findall(r"\S+\s*", text):
        yield {"type": "text", "delta": chunk}
    yield {"type": "done", "text": text, "tokens_in": 0, "tokens_out": 0, "cost_usd": 0.0, "model": "practice"}


# ── Anthropic ────────────────────────────────────────────────────────────────

def _anthropic_tools(tools: list[dict]) -> list[dict]:
    return [{"name": t["name"], "description": t.get("description", ""),
             "input_schema": t.get("parameters") or {"type": "object", "properties": {}}} for t in tools]


async def _post_stream(client: httpx.AsyncClient, url: str, body: dict, headers: dict):
    """Open a streaming POST with retries for transient failures (before any output)."""
    last = ""
    for attempt in range(_TRIES):
        try:
            req = client.build_request("POST", url, json=body, headers=headers)
            resp = await client.send(req, stream=True)
        except httpx.HTTPError as e:
            last = f"unreachable: {e}"
        else:
            if resp.status_code not in _RETRY_STATUS:
                return resp, ""
            last = f"{resp.status_code}: {(await resp.aread()).decode(errors='replace')[:300]}"
            await resp.aclose()
        if attempt < _TRIES - 1:
            await asyncio.sleep(min(8.0, 2 ** attempt) + random.uniform(0, 0.8))
    return None, last


async def _sse_lines(resp: httpx.Response) -> AsyncIterator[tuple[str, str]]:
    """(event, data) pairs from a text/event-stream response."""
    event, data = "", []
    async for line in resp.aiter_lines():
        if line == "":
            if data:
                yield event, "\n".join(data)
            event, data = "", []
        elif line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        yield event, "\n".join(data)


async def _anthropic(cfg, system, msgs, tools, on_call, web, max_turns, max_tokens, final_tools, timeout):
    if not cfg.key:
        raise AiError("No Claude API key yet. Add one in Control panel → AI accounts.")
    model = cfg.resolved_model()
    headers = {"x-api-key": cfg.key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    messages: list[dict] = [dict(m) for m in msgs]
    a_tools = _anthropic_tools(tools)
    use_web = web
    tin = tout = 0
    cost = 0.0
    texts: list[str] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=20)) as client:
        turn = 0
        while turn < max_turns:
            turn += 1
            body: dict[str, Any] = {
                "model": model, "max_tokens": max_tokens, "stream": True, "messages": messages,
                "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            }
            all_tools = a_tools + (WEB_TOOLS if use_web else [])
            if all_tools:
                body["tools"] = all_tools
            resp, err = await _post_stream(client, f"{cfg.base_url.rstrip('/')}/v1/messages", body, headers)
            if resp is None:
                raise AiError(f"Claude didn't answer ({err}). Try again in a moment.")
            if resp.status_code >= 400:
                detail = (await resp.aread()).decode(errors="replace")
                await resp.aclose()
                if resp.status_code == 400 and use_web and ("web_search" in detail or "web_fetch" in detail):
                    use_web = False  # hosted web tools are off for this Anthropic org: carry on without
                    turn -= 1
                    continue
                if resp.status_code in (401, 403):
                    raise AiError("Claude didn't accept the API key. Paste it again in Control panel → AI accounts.")
                if resp.status_code == 404 and "model" in detail:
                    raise AiError(f"Claude doesn't offer the model “{model}” on this key.")
                raise AiError(f"Claude API {resp.status_code}: {detail[:300]}")

            blocks: dict[int, dict] = {}
            partial: dict[int, str] = {}
            stop_reason = None
            turn_text = ""
            try:
                async for ev_name, data in _sse_lines(resp):
                    if not data or data == "[DONE]":
                        continue
                    try:
                        ev = json.loads(data)
                    except ValueError:
                        continue
                    t = ev.get("type") or ev_name
                    if t == "message_start":
                        u = (ev.get("message") or {}).get("usage") or {}
                        tin += int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0) \
                            + int(u.get("cache_creation_input_tokens") or 0)
                    elif t == "content_block_start":
                        i = ev.get("index", 0)
                        b = dict(ev.get("content_block") or {})
                        blocks[i] = b
                        bt = b.get("type")
                        if bt == "server_tool_use":
                            yield {"type": "activity", "label": "Searching the web…" if b.get("name") == "web_search" else "Reading a page…"}
                        elif bt in ("web_search_tool_result", "web_fetch_tool_result"):
                            c = b.get("content")
                            items = c if isinstance(c, list) else [c] if isinstance(c, dict) else []
                            srcs = [{"url": x.get("url"), "title": x.get("title") or x.get("url")}
                                    for x in items if isinstance(x, dict) and x.get("url")]
                            if srcs:
                                yield {"type": "sources", "items": srcs[:8]}
                        if bt in ("tool_use", "server_tool_use"):
                            partial[i] = ""
                    elif t == "content_block_delta":
                        i = ev.get("index", 0)
                        d = ev.get("delta") or {}
                        if d.get("type") == "text_delta" and d.get("text"):
                            blocks.setdefault(i, {"type": "text", "text": ""})
                            blocks[i]["text"] = blocks[i].get("text", "") + d["text"]
                            turn_text += d["text"]
                            yield {"type": "text", "delta": d["text"]}
                        elif d.get("type") == "input_json_delta":
                            partial[i] = partial.get(i, "") + (d.get("partial_json") or "")
                        elif d.get("type") == "thinking_delta":
                            pass
                    elif t == "content_block_stop":
                        i = ev.get("index", 0)
                        if i in partial and blocks.get(i, {}).get("type") in ("tool_use", "server_tool_use"):
                            try:
                                blocks[i]["input"] = json.loads(partial[i] or "{}")
                            except ValueError:
                                blocks[i]["input"] = {}
                    elif t == "message_delta":
                        stop_reason = (ev.get("delta") or {}).get("stop_reason") or stop_reason
                        u = ev.get("usage") or {}
                        tout += int(u.get("output_tokens") or 0)
                        srv = u.get("server_tool_use") or {}
                        cost += 0.01 * int(srv.get("web_search_requests") or 0)
                    elif t == "error":
                        raise AiError(f"Claude stopped: {(ev.get('error') or {}).get('message', 'unknown error')}")
            finally:
                await resp.aclose()

            content = [blocks[i] for i in sorted(blocks)]
            for b in content:  # server_tool_use inputs streamed as JSON too
                if b.get("type") in ("tool_use", "server_tool_use") and "input" not in b:
                    b["input"] = {}
            if turn_text.strip():
                texts.append(turn_text.strip())
            if stop_reason == "pause_turn":  # a long hosted web search: send it back to continue
                messages.append({"role": "assistant", "content": content})
                continue
            uses = [b for b in content if b.get("type") == "tool_use"]
            if stop_reason != "tool_use" or not uses or on_call is None:
                break
            messages.append({"role": "assistant", "content": content})
            results = []
            for b in uses:
                yield {"type": "activity", "label": _label_for(b.get("name", ""), b.get("input") or {})}
                try:
                    out = await on_call(b.get("name", ""), b.get("input") or {})
                    results.append({"type": "tool_result", "tool_use_id": b["id"], "content": str(out)[:20000]})
                except Exception as e:  # noqa: BLE001 — the model sees the failure and adapts
                    results.append({"type": "tool_result", "tool_use_id": b["id"], "content": f"error: {e}", "is_error": True})
            messages.append({"role": "user", "content": results})
            if turn_text.strip() and all(b.get("name") in final_tools for b in uses):
                break  # it already replied; the tools only saved things
    text = "\n\n".join(texts).strip()
    yield {"type": "done", "text": text, "tokens_in": tin, "tokens_out": tout,
           "cost_usd": cost + estimate_usd(model, tin, tout), "model": model}


# ── OpenAI-compatible ────────────────────────────────────────────────────────

async def _openai(cfg, system, msgs, tools, on_call, max_turns, max_tokens, final_tools, timeout):
    if not cfg.key:
        raise AiError(f"No {cfg.label} API key yet. Add one in Control panel → AI accounts.")
    model = cfg.resolved_model()
    headers = {"Authorization": f"Bearer {cfg.key}", "Content-Type": "application/json"}
    messages: list[dict] = [{"role": "system", "content": system}, *[dict(m) for m in msgs]]
    o_tools = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""),
                                                 "parameters": t.get("parameters") or {"type": "object", "properties": {}}}}
               for t in tools]
    tin = tout = 0
    texts: list[str] = []
    usage_opt = True
    tokens_key = "max_tokens"
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=20)) as client:
        turn = 0
        while turn < max_turns:
            turn += 1
            body: dict[str, Any] = {"model": model, "messages": messages, "stream": True, tokens_key: max_tokens}
            if usage_opt:
                body["stream_options"] = {"include_usage": True}
            if o_tools:
                body["tools"] = o_tools
            resp, err = await _post_stream(client, f"{cfg.base_url.rstrip('/')}/chat/completions", body, headers)
            if resp is None:
                raise AiError(f"{cfg.label} didn't answer ({err}). Try again in a moment.")
            if resp.status_code >= 400:
                detail = (await resp.aread()).decode(errors="replace")
                await resp.aclose()
                if resp.status_code == 400 and usage_opt and "stream_options" in detail:
                    usage_opt, turn = False, turn - 1
                    continue
                if resp.status_code == 400 and tokens_key == "max_tokens" and "max_completion_tokens" in detail:
                    tokens_key, turn = "max_completion_tokens", turn - 1  # newer OpenAI models
                    continue
                if resp.status_code in (401, 403):
                    raise AiError(f"{cfg.label} didn't accept the API key. Paste it again in Control panel → AI accounts.")
                if resp.status_code == 404 or (resp.status_code == 400 and "model" in detail.lower()):
                    better = await _openai_pick_model(client, cfg, headers)
                    if better and better != model:
                        model, turn = better, turn - 1
                        continue
                raise AiError(f"{cfg.label} API {resp.status_code}: {detail[:300]}")

            acc_text = ""
            calls: dict[int, dict] = {}
            try:
                async for _ev, data in _sse_lines(resp):
                    if not data or data.strip() == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    u = chunk.get("usage") or {}
                    if u:
                        tin += int(u.get("prompt_tokens") or 0)
                        tout += int(u.get("completion_tokens") or 0)
                    for ch in chunk.get("choices") or []:
                        delta = ch.get("delta") or {}
                        if delta.get("content"):
                            acc_text += delta["content"]
                            yield {"type": "text", "delta": delta["content"]}
                        for tc in delta.get("tool_calls") or []:
                            i = tc.get("index", 0)
                            slot = calls.setdefault(i, {"id": "", "name": "", "args": ""})
                            if tc.get("id"):
                                slot["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                slot["name"] = fn["name"]
                            if fn.get("arguments"):
                                slot["args"] += fn["arguments"]
            finally:
                await resp.aclose()
            if acc_text.strip():
                texts.append(acc_text.strip())
            parsed = []
            for i in sorted(calls):
                c = calls[i]
                try:
                    args = json.loads(c["args"] or "{}")
                except ValueError:
                    args = {}
                parsed.append({"id": c["id"] or f"call_{i}", "name": c["name"], "args": args})
            if not parsed or on_call is None:
                break
            messages.append({"role": "assistant", "content": acc_text or None,
                             "tool_calls": [{"id": c["id"], "type": "function",
                                             "function": {"name": c["name"], "arguments": json.dumps(c["args"])}}
                                            for c in parsed]})
            for c in parsed:
                yield {"type": "activity", "label": _label_for(c["name"], c["args"])}
                try:
                    out = await on_call(c["name"], c["args"])
                except Exception as e:  # noqa: BLE001
                    out = f"error: {e}"
                messages.append({"role": "tool", "tool_call_id": c["id"], "content": str(out)[:20000]})
            if acc_text.strip() and all(c["name"] in final_tools for c in parsed):
                break
    if tin == 0 and tout == 0:  # vendor sent no usage: estimate from characters
        tin = sum(len(str(m.get("content") or "")) for m in messages) // 4
        tout = sum(len(t) for t in texts) // 4
    text = "\n\n".join(texts).strip()
    yield {"type": "done", "text": text, "tokens_in": tin, "tokens_out": tout,
           "cost_usd": estimate_usd(model, tin, tout), "model": model}


async def _openai_pick_model(client: httpx.AsyncClient, cfg: AiConfig, headers: dict) -> str | None:
    """The configured default isn't offered: pick the best chat model this key lists."""
    try:
        r = await client.get(f"{cfg.base_url.rstrip('/')}/models", headers=headers)
        ids = [m.get("id", "") for m in (r.json().get("data") or [])] if r.status_code < 400 else []
    except (httpx.HTTPError, ValueError):
        return None
    prefs = {"openai": ["gpt-5", "gpt-4.1", "gpt-4o"], "gemini": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini"],
             "xai": ["grok-4", "grok-3", "grok"], "mistral": ["mistral-large", "mistral-medium", "mistral-small"]}
    for p in prefs.get(cfg.vendor, []):
        hit = next((i.removeprefix("models/") for i in ids if p in i and "embed" not in i and "audio" not in i), None)
        if hit:
            return hit
    return None


# ── local CLIs (the owner's own sign-in on this computer) ───────────────────

_CLI_BINS = {"claude-code": "claude", "codex": "codex", "gemini-cli": "gemini", "opencode": "opencode"}


def find_cli(vendor: str) -> str | None:
    name = _CLI_BINS.get(vendor)
    if not name:
        return None
    found = shutil.which(name)
    if found:
        return found
    for d in ("~/.claude/local", "~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "~/.npm-global/bin"):
        p = Path(os.path.expanduser(d)) / name
        if p.exists():
            return str(p)
    return None


def _cli_env() -> dict:
    env = {k: v for k, v in os.environ.items()
           if k not in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY",
                        "DATABASE_URL", "JWT_SECRET", "OMILO_SECRET_KEY")}
    env.pop("CLAUDE_CONFIG_DIR", None)  # the owner's own ~/.claude login must resolve
    return env


def _cli_cwd() -> str:
    d = Path(tempfile.gettempdir()) / "omilo-ai"
    d.mkdir(parents=True, exist_ok=True)
    return str(d)


def _transcript(msgs: list[dict]) -> str:
    if len(msgs) == 1:
        return msgs[0]["content"]
    past = "\n\n".join(f"{'Owner' if m['role'] == 'user' else 'You'}: {m['content']}" for m in msgs[:-1])
    return f"Conversation so far:\n{past}\n\nOwner: {msgs[-1]['content']}"


_JSON_PROTOCOL = ("\n\nAnswer with ONE JSON object only, no other text: "
                  '{"reply": "<what you say to the owner>", "calls": [{"name": "<tool>", "args": {...}}]}. '
                  "Leave calls empty when you need no tool. Tools you may call (name: JSON schema of args): ")


async def _run_cli(argv: list[str], timeout: float) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(*argv, cwd=_cli_cwd(), env=_cli_env(), stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                limit=8 * 1024 * 1024)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise AiError("The AI on this computer took too long to answer.") from None
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


def _claude_args(cli: str, prompt: str, system: str, web: bool, stream: bool, partial: bool, model: str | None,
                 max_turns: int) -> list[str]:
    allowed = ["WebSearch", "WebFetch"] if web else []
    argv = [cli, "-p", prompt, "--append-system-prompt", system, "--max-turns", str(max_turns),
            "--strict-mcp-config", "--settings", '{"disableAllHooks": true}',
            "--disallowedTools", "Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Task", "Agent", "Skill"]
    if allowed:
        argv += ["--allowedTools", *allowed]
    if stream:
        argv += ["--output-format", "stream-json", "--verbose"] + (["--include-partial-messages"] if partial else [])
    else:
        argv += ["--output-format", "json"]
    if model:
        argv += ["--model", model]
    return argv


async def _claude_stream(cli: str, cfg: AiConfig, system: str, prompt: str, web: bool, timeout: float,
                         partial: bool = True) -> AsyncIterator[dict]:
    """Claude Code headless run, streamed as text deltas (falls back when the CLI is older)."""
    argv = _claude_args(cli, prompt, system, web, True, partial, cfg.model, 8 if web else 2)
    proc = await asyncio.create_subprocess_exec(*argv, cwd=_cli_cwd(), env=_cli_env(), stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                limit=8 * 1024 * 1024)
    text, saw_delta, result = "", False, None
    tin = tout = 0
    cost = 0.0
    try:
        async def lines():
            assert proc.stdout
            async for raw in proc.stdout:
                yield raw.decode(errors="replace")

        async for line in _with_timeout(lines(), timeout):
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            t = ev.get("type")
            if t == "stream_event":
                se = ev.get("event") or {}
                d = se.get("delta") or {}
                if se.get("type") == "content_block_delta" and d.get("type") == "text_delta" and d.get("text"):
                    saw_delta = True
                    text += d["text"]
                    yield {"type": "text", "delta": d["text"]}
            elif t == "assistant":
                for b in (ev.get("message") or {}).get("content") or []:
                    if b.get("type") == "text" and b.get("text") and not saw_delta:
                        text += b["text"]
                        yield {"type": "text", "delta": b["text"]}
                    elif b.get("type") == "tool_use":
                        yield {"type": "activity", "label": _label_for(b.get("name", ""), b.get("input") or {})}
            elif t == "result":
                result = ev
                u = ev.get("usage") or {}
                tin = int(u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0)
                tout = int(u.get("output_tokens") or 0)
                cost = float(ev.get("total_cost_usd") or 0)
        code = await proc.wait()
        err = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
    finally:
        if proc.returncode is None:
            proc.kill()
            await proc.wait()
    if partial and code != 0 and "include-partial-messages" in err:
        async for ev in _claude_stream(cli, cfg, system, prompt, web, timeout, partial=False):
            yield ev
        return
    if result is not None and (result.get("is_error") or result.get("subtype", "success") != "success"):
        msg = str(result.get("result") or err or "the CLI returned an error")
        raise AiError(_cli_problem(msg))
    if code != 0 and not text:
        raise AiError(_cli_problem(err or f"exit code {code}"))
    final = str((result or {}).get("result") or text)
    if not text and final:
        yield {"type": "text", "delta": final}
    yield {"type": "done", "text": final.strip() or text.strip(), "tokens_in": tin, "tokens_out": tout,
           "cost_usd": cost, "model": (result or {}).get("model") or cfg.model or "claude-code"}


async def _with_timeout(agen, timeout: float):
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise AiError("The AI on this computer took too long to answer.")
        try:
            item = await asyncio.wait_for(agen.__anext__(), timeout=remaining)
        except StopAsyncIteration:
            return
        except TimeoutError:
            raise AiError("The AI on this computer took too long to answer.") from None
        yield item


def _cli_problem(msg: str) -> str:
    low = msg.lower()
    if "login" in low or "log in" in low or "auth" in low or "credential" in low:
        return "The AI on this computer isn't signed in. Open a terminal, run it once and sign in, then try again."
    if "limit" in low:
        return f"Your AI sign-in hit its usage limit: {msg[:200]}"
    return f"The AI on this computer failed: {msg[:300]}"


async def _cli_once(cfg: AiConfig, cli: str, prompt: str, system: str, timeout: float) -> str:
    """One non-streaming answer from any supported CLI."""
    v = cfg.vendor
    if v == "claude-code":
        code, out, err = await _run_cli(_claude_args(cli, prompt, system, False, False, False, cfg.model, 1), timeout)
        try:
            data = json.loads(out or "{}")
        except ValueError:
            data = {}
        if code != 0 or data.get("is_error"):
            raise AiError(_cli_problem(str(data.get("result") or err or f"exit code {code}")))
        return str(data.get("result") or "")
    full = f"{system}\n\n---\n\n{prompt}"
    if v == "codex":
        argv = [cli, "exec", "--skip-git-repo-check", full]
    elif v == "gemini-cli":
        argv = [cli, "-p", full]
    elif v == "opencode":
        argv = [cli, "run", full]
    else:
        raise AiError(f"{cfg.label} can't be used as Omilo's AI yet.")
    code, out, err = await _run_cli(argv, timeout)
    if code != 0:
        raise AiError(_cli_problem(err or out or f"exit code {code}"))
    return out.strip()


def _parse_json_reply(raw: str) -> tuple[str, list[dict]]:
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return (raw or "").strip(), []
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return (raw or "").strip(), []
    calls = [{"name": c.get("name"), "args": c.get("args") or {}} for c in data.get("calls") or []
             if isinstance(c, dict) and c.get("name")]
    return str(data.get("reply") or "").strip(), calls


async def _cli(cfg, system, msgs, tools, on_call, web, max_turns, final_tools, timeout):
    cli = find_cli(cfg.vendor)
    if not cli:
        raise AiError(f"{cfg.label}: the command isn't installed on the computer running Omilo.")
    prompt = _transcript(msgs)
    if not tools:
        if cfg.vendor == "claude-code":
            async for ev in _claude_stream(cli, cfg, system, prompt, web, timeout):
                yield ev
            return
        yield {"type": "activity", "label": "Thinking…"}
        text = await _cli_once(cfg, cli, prompt, system, timeout)
        yield {"type": "text", "delta": text}
        yield {"type": "done", "text": text, "tokens_in": len(prompt) // 4, "tokens_out": len(text) // 4,
               "cost_usd": 0.0, "model": cfg.vendor}
        return
    # Tools through a JSON protocol: the CLI answers {"reply", "calls"}; we run the calls and loop.
    shape = {t["name"]: t.get("parameters") or {} for t in tools}
    convo = prompt
    reply = ""
    yield {"type": "activity", "label": "Thinking…"}
    for _ in range(max_turns):
        raw = await _cli_once(cfg, cli, convo + _JSON_PROTOCOL + json.dumps(shape)[:6000], system, timeout)
        text, calls = _parse_json_reply(raw)
        reply = text or reply
        if not calls or on_call is None:
            break
        results = []
        for c in calls:
            yield {"type": "activity", "label": _label_for(c["name"], c["args"])}
            try:
                out = await on_call(c["name"], c["args"])
            except Exception as e:  # noqa: BLE001
                out = f"error: {e}"
            results.append(f"[{c['name']} result]\n{str(out)[:8000]}")
        if text and all(c["name"] in final_tools for c in calls):
            break
        convo = f"{convo}\n\nYou: {text}\n\n" + "\n\n".join(results)
    yield {"type": "text", "delta": reply}
    yield {"type": "done", "text": reply, "tokens_in": len(convo) // 4, "tokens_out": len(reply) // 4,
           "cost_usd": 0.0, "model": cfg.vendor}


def _label_for(name: str, args: dict) -> str:
    if name in ("read_website", "WebFetch", "web_fetch"):
        return f"Reading {args.get('url') or 'a page'}…"
    if name in ("WebSearch", "web_search"):
        return f"Searching the web for “{args.get('query') or ''}”…".replace(" for “”", "")
    if name in ("save_note", "update_profile"):
        return "Noting that down…"
    if name == "request_action":
        return "Preparing something for your approval…"
    return f"Using {name}…"
