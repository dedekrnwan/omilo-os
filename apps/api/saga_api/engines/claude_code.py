"""Claude Code from the harness pool as the engine.

Runs `claude -p` (stream-json) with a pool account's token, the saga-os MCP server, the helper's job as an
appended system prompt, and a safe tool allowlist. Every step is streamed into the live view. When the
account hits its usage limit, the run moves to another account and resumes the same session.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
from pathlib import Path

from .. import harness as H
from ..config import get_settings
from . import ChatContext, Engine, EngineResult, TaskContext
from .prompts import CHAT_SYSTEM, CONSTITUTION, task_message

SAFE_TOOLS = ["mcp__saga-os", "WebSearch", "WebFetch", "Read", "Glob", "Grep", "TodoWrite", "Edit", "Write"]
STRIP_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "HERMES_API_KEY", "SAGA_SECRET_KEY", "SAGA_DATABASE_URL", "CLAUDE_CODE_OAUTH_TOKEN")
URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+")


def _dirs(staff_id: str) -> tuple[Path, Path, Path]:
    base = get_settings().data_dir / "harness"
    config, runs, work = base / "config", base / "runs", get_settings().data_dir / "workspaces" / staff_id
    for d in (config, runs, work):
        d.mkdir(parents=True, exist_ok=True)
    return config, runs, work


class _Run:
    """Parse one stream-json run into events and a result."""

    def __init__(self, emit):
        self.emit, self.session, self.text, self.error = emit, None, "", ""
        self.tokens, self.cost, self.is_error, self.result_text = 0, 0.0, False, ""
        self.pending: dict[str, dict] = {}

    def line(self, raw: str) -> None:
        try:
            ev = json.loads(raw)
        except ValueError:
            return
        t = ev.get("type")
        if t == "system" and ev.get("subtype") == "init":
            self.session = ev.get("session_id") or self.session
            self.emit("session", session_id=self.session, model=ev.get("model"), tools=len(ev.get("tools") or []))
        elif t == "assistant":
            for b in (ev.get("message") or {}).get("content") or []:
                bt = b.get("type")
                if bt == "thinking" and b.get("thinking"):
                    self.emit("thinking", text=b["thinking"])
                elif bt == "text" and b.get("text", "").strip():
                    self.text = b["text"]
                    self.emit("text", text=b["text"])
                elif bt == "tool_use":
                    name = b.get("name", "tool")
                    self.pending[b.get("id", "")] = {"name": name, "input": b.get("input") or {}}
                    if not name.startswith("mcp__saga-os__"):  # Saga's own tools are logged by its MCP server
                        self.emit("tool", id=b.get("id"), name=name, input=b.get("input") or {}, state="running")
        elif t == "user":
            for b in (ev.get("message") or {}).get("content") or []:
                if b.get("type") != "tool_result":
                    continue
                use = self.pending.pop(b.get("tool_use_id", ""), None) or {"name": "tool", "input": {}}
                if use["name"].startswith("mcp__saga-os__"):
                    continue
                out = b.get("content")
                out_text = out if isinstance(out, str) else json.dumps(out)[:4000]
                self.emit("tool", id=b.get("tool_use_id"), name=use["name"], input=use["input"], output=out_text[:4000],
                          ok=not b.get("is_error"), state="done")
                if use["name"] in ("WebSearch", "WebFetch"):
                    urls = list(dict.fromkeys(URL_RE.findall(out_text) + ([use["input"].get("url")] if use["input"].get("url") else [])))[:8]
                    if urls:
                        self.emit("sources", items=[{"url": u, "title": u} for u in urls])
                        self.emit("browser", url=urls[0], title=use["input"].get("query") or urls[0])
        elif t == "result":
            self.session = ev.get("session_id") or self.session
            u = ev.get("usage") or {}
            self.tokens += int(u.get("input_tokens") or 0) + int(u.get("output_tokens") or 0)
            self.cost += float(ev.get("total_cost_usd") or 0)
            self.is_error = bool(ev.get("is_error")) or ev.get("subtype", "success") != "success"
            self.result_text = str(ev.get("result") or "")
            if not self.is_error and self.result_text:
                self.text = self.result_text


class ClaudeCodeEngine(Engine):
    type = "claude-code"

    async def _once(self, cli: str, token: str, args: list[str], cwd: Path, config: Path, emit, timeout: float) -> tuple[_Run, int, str]:
        env = {k: v for k, v in os.environ.items() if k not in STRIP_ENV}
        env.update({"CLAUDE_CODE_OAUTH_TOKEN": token, "CLAUDE_CONFIG_DIR": str(config)})
        proc = await asyncio.create_subprocess_exec(cli, *args, cwd=str(cwd), env=env, stdin=asyncio.subprocess.DEVNULL,
                                                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=8 * 1024 * 1024)
        run = _Run(emit)
        try:
            async def read():
                assert proc.stdout
                async for raw in proc.stdout:
                    run.line(raw.decode(errors="replace"))
            await asyncio.wait_for(read(), timeout=timeout)
            code = await proc.wait()
            err = (await proc.stderr.read()).decode(errors="replace") if proc.stderr else ""
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
        return run, code, err

    async def _run(self, staff_id: str, cfg: dict, system: str, prompt: str, session: str | None, emit, timeout: float,
                   remember) -> EngineResult:
        cli = H.find_cli()
        if not cli:
            return EngineResult(error="Claude Code is not installed. Settings → Harness → Install Claude Code.")
        config, runs, cwd = _dirs(staff_id)
        mcp_file = runs / f"{secrets.token_hex(8)}.json"
        mcp_file.write_text(json.dumps({"mcpServers": {"saga-os": {"type": "http", "url": cfg["_mcp_url"],
                                                                     "headers": {"Authorization": f"Bearer {cfg['_mcp_token']}"}}}}))
        mcp_file.chmod(0o600)
        tools = SAFE_TOOLS + (["Bash"] if cfg.get("allow_shell") else [])
        tried: set[str] = set()
        total = EngineResult()
        try:
            while True:
                picked = H.lease(exclude=tried)
                if not picked:
                    msg = "No Claude Code account is free right now (all cooling down, busy or none added). See Settings → Harness."
                    return EngineResult(error=msg, tokens=total.tokens, cost_usd=total.cost_usd, text=total.text)
                acc_id, label, token = picked
                tried.add(acc_id)
                emit("status", state="harness", account=label)
                args = ["-p", prompt if not session else (prompt if not tried - {acc_id} else "Continue exactly where you left off."),
                        "--output-format", "stream-json", "--verbose", "--append-system-prompt", system,
                        "--mcp-config", str(mcp_file), "--strict-mcp-config", "--permission-mode", "dontAsk",
                        "--allowedTools", *tools, "--max-turns", str(int(cfg.get("max_turns") or 60))]
                if cfg.get("model"):
                    args += ["--model", cfg["model"]]
                if session:
                    args += ["--resume", session]
                try:
                    run, code, err = await self._once(cli, token, args, cwd, config, emit, timeout)
                except TimeoutError:
                    H.release(acc_id, ok=False, error="timed out")
                    raise
                total.tokens += run.tokens
                total.cost_usd += run.cost
                if run.session and run.session != session:
                    session = run.session
                    remember(session)
                problem = run.result_text if run.is_error else ("" if code == 0 and run.text else (err or f"exit code {code}"))
                if not problem:
                    H.release(acc_id, ok=True, tokens=run.tokens, cost=run.cost)
                    total.text = run.text
                    return total
                if H.LIMIT_RE.search(problem):
                    H.release(acc_id, ok=False, limit=True, error=problem, resets_at=H.parse_reset(problem), tokens=run.tokens, cost=run.cost)
                    emit("status", state="switching", account=label, reason="usage limit reached")
                    continue  # next account, same session: nothing is lost
                H.release(acc_id, ok=False, error=problem, tokens=run.tokens, cost=run.cost)
                if H.AUTH_RE.search(problem):
                    emit("status", state="switching", account=label, reason="account sign-in problem")
                    continue
                total.error = f"Claude Code: {problem[:400]}"
                total.text = run.text
                return total
        finally:
            mcp_file.unlink(missing_ok=True)

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        if not ctx.mcp_token:
            return EngineResult(error="no MCP token for this helper: rotate it in Team")
        cfg = {**ctx.engine_config, "_mcp_url": ctx.mcp_url, "_mcp_token": ctx.mcp_token}
        system = CONSTITUTION.format(name=ctx.staff_name, job=ctx.job or "(no job description yet)").replace(
            "(tools from the `saga-os` MCP server)", "(tools from the `saga-os` MCP server, named mcp__saga-os__*)")
        session = _task_session(ctx.task_id)
        return await self._run(ctx.staff_id, cfg, system, task_message(ctx), session, ctx.emit,
                               float(cfg.get("timeout_s") or 1800), lambda s: ctx.emit("session", session_id=s))

    async def chat(self, ctx: ChatContext) -> EngineResult:
        cfg = {**ctx.engine_config, "_mcp_url": ctx.mcp_url, "_mcp_token": ctx.mcp_token or ""}
        system = CHAT_SYSTEM.format(name=ctx.staff_name, chief=", the Chief of Staff" if ctx.is_chief else "", context=ctx.context_note)
        session = _thread_session(ctx.thread_id)
        last = ctx.history[-1]["text"] if ctx.history else ""
        if not session and len(ctx.history) > 1:  # first harness turn in an older chat: give it the conversation so far
            past = "\n".join(f"{'Founder' if h['role'] == 'owner' else 'You'}: {h['text']}" for h in ctx.history[-20:-1])
            last = f"Conversation so far:\n{past}\n\nFounder: {last}"
        return await self._run(ctx.staff_id, cfg, system, last, session, ctx.emit, 600,
                               lambda s: _save_thread_session(ctx.thread_id, s))

    async def health(self, cfg: dict) -> dict:
        p = H.pool_summary()
        if not p["cli"]["path"]:
            return {"ok": False, "detail": "Claude Code not installed (Settings → Harness)"}
        return {"ok": p["ready"] > 0, "detail": f"Claude Code pool · {p['ready']}/{p['total']} accounts ready"}


def _task_session(task_id: str) -> str | None:
    from sqlalchemy import select

    from ..db import session_scope
    from ..models import RunEvent

    with session_scope() as db:
        ev = db.scalar(select(RunEvent).where(RunEvent.task_id == task_id, RunEvent.kind == "session").order_by(RunEvent.id.desc()))
        return (ev.data or {}).get("session_id") if ev else None


def _thread_session(thread_id: str) -> str | None:
    from ..db import session_scope
    from ..models import Thread

    with session_scope() as db:
        th = db.get(Thread, thread_id)
        return th.engine_session[3:] if th and (th.engine_session or "").startswith("cc:") else None


def _save_thread_session(thread_id: str, session: str) -> None:
    from ..db import session_scope
    from ..models import Thread

    with session_scope() as db:
        th = db.get(Thread, thread_id)
        if th:
            th.engine_session = f"cc:{session}"
