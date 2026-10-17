"""Claude Code from the harness pool as the engine.

Runs `claude -p` (stream-json) with a pool account's token, the omilo MCP server, the helper's job as an
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
from .prompts import CHAT_SYSTEM, CONSTITUTION, task_message, with_resources

SAFE_TOOLS = ["mcp__omilo", "WebSearch", "WebFetch", "Read", "Glob", "Grep", "TodoWrite", "Edit", "Write"]


def plan(cfg: dict, resources) -> tuple[dict, list[str], list[str]]:
    """MCP servers, allowed tools and extra flags for one run, from the helper's settings and what this run may use.

    - folders: every folder is added with --add-dir; read-only ones also get Edit/Write denied; a folder that allows
      terminal commands (or a helper with allow_shell) turns on Bash
    - connectors: all are connected; tools of 'auto' connectors (or one approved for this execution task) are allowed,
      'ask' connectors stay denied (dontAsk), so the helper must request_action and wait for the founder
    - attached files: their folders are added read-only
    """
    servers: dict = {"omilo": {"type": "http", "url": cfg["_mcp_url"], "headers": {"Authorization": f"Bearer {cfg['_mcp_token']}"}}}
    tools = list(SAFE_TOOLS)
    add_dirs: list[str] = []
    deny: list[str] = []
    shell = bool(cfg.get("allow_shell"))
    if resources is not None:
        for f in resources.folders:
            add_dirs.append(f["path"])
            if f["access"] != "write":
                deny += [f"Edit(/{f['path']}/**)", f"Write(/{f['path']}/**)"]
            shell = shell or bool(f.get("commands"))
        for c in resources.connectors:
            if c["kind"] == "stdio":
                servers[c["id"]] = {"command": c["command"], "args": c["args"], "env": c["env"]}
            elif c["kind"] == "piece":
                piece_url = cfg["_mcp_url"] + "/piece/" + c["id"]
                servers[c["id"]] = {"type": "http", "url": piece_url,
                                    "headers": {"Authorization": f"Bearer {cfg['_mcp_token']}"}}
            else:
                servers[c["id"]] = {"type": "http", "url": c["url"], "headers": c["headers"]}
            if c["approval"] == "auto" or c["id"] in resources.allow_connectors:
                tools.append(f"mcp__{c['id']}")
        for f in resources.files:
            d = str(Path(f["path"]).parent)
            if d not in add_dirs:
                add_dirs.append(d)
                deny += [f"Edit(/{d}/**)", f"Write(/{d}/**)"]
    if shell:
        tools.append("Bash")
        deny += SHELL_DENY
    extra: list[str] = []
    for d in add_dirs:
        extra += ["--add-dir", d]
    if deny:
        extra += ["--disallowedTools", *deny]
    return servers, tools, extra
# commands that change the world outside the folder (or cannot be undone) stay blocked even when commands are allowed:
# the helper asks the founder through request_action instead
SHELL_DENY = [f"Bash({c}:*)" for c in (
    "rm", "rmdir", "sudo", "git push", "git reset --hard", "git clean", "npm publish", "pnpm publish", "yarn publish", "twine upload",
    "docker push", "kubectl", "terraform apply", "terraform destroy", "vercel", "netlify deploy", "fly deploy", "flyctl deploy", "gh pr merge",
    "gh release", "ssh", "scp")]
STRIP_ENV = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OMILO_SECRET_KEY", "OMILO_DATABASE_URL", "OMILO_REDIS_URL", "CLAUDE_CODE_OAUTH_TOKEN")
URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+")


def _dirs(staff_id: str) -> tuple[Path, Path, Path]:
    base = get_settings().company_dir / "harness"
    config, runs, work = base / "config", base / "runs", get_settings().company_dir / "workspaces" / staff_id
    for d in (config, runs, work):
        d.mkdir(parents=True, exist_ok=True)
    return config, runs, work


class _Run:
    """Parse one stream-json run into events and a result."""

    def __init__(self, emit):
        self.emit, self.session, self.text, self.error = emit, None, "", ""
        self.tokens, self.cost, self.is_error, self.result_text = 0, 0.0, False, ""
        self.pending: dict[str, dict] = {}
        self.limits: list[dict] = []  # rate_limit_event infos: how much of each usage window this account has used

    def _browser(self, use: dict, out, out_text: str) -> None:
        """A real browser tool (the Playwright connector): follow the page it is on and its screenshots."""
        inp = use["input"] or {}
        url = inp.get("url") or ""
        if not url:
            m = re.search(r"Page URL: (\S+)", out_text) or re.search(r'"url":\s*"(https?://[^"]+)"', out_text)
            url = m.group(1) if m else ""
        title_m = re.search(r"Page Title: ([^\n\\]+)", out_text)
        image = None
        for blk in out if isinstance(out, list) else []:
            if isinstance(blk, dict) and blk.get("type") == "image":
                src = blk.get("source") or {}
                data, mime = (src.get("data") or blk.get("data")), (src.get("media_type") or blk.get("mimeType") or "image/png")
                if data:
                    image = _save_shot(data, mime)
        if url or image:
            self.last_url = url or getattr(self, "last_url", "")
            self.emit("browser", url=self.last_url, title=(title_m.group(1).strip() if title_m else self.last_url), image=image, via="browser")

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
                    if not name.startswith("mcp__omilo__"):  # Omilo's own tools are logged by its MCP server
                        self.emit("tool", id=b.get("id"), name=name, input=b.get("input") or {}, state="running")
        elif t == "user":
            for b in (ev.get("message") or {}).get("content") or []:
                if b.get("type") != "tool_result":
                    continue
                use = self.pending.pop(b.get("tool_use_id", ""), None) or {"name": "tool", "input": {}}
                if use["name"].startswith("mcp__omilo__"):
                    continue
                out = b.get("content")
                out_text = out if isinstance(out, str) else json.dumps(out)[:4000]
                self.emit("tool", id=b.get("tool_use_id"), name=use["name"], input=use["input"], output=out_text[:4000],
                          ok=not b.get("is_error"), state="done")
                if use["name"] in ("WebSearch", "WebFetch"):
                    asked = [use["input"]["url"]] if use["input"].get("url") else []
                    urls = list(dict.fromkeys(asked + URL_RE.findall(out_text)))[:8]
                    if urls:
                        self.emit("sources", items=[{"url": u, "title": u} for u in urls])
                        self.emit("browser", url=urls[0], title=use["input"].get("query") or urls[0], via=use["name"])
                elif "browser" in use["name"].lower() or "playwright" in use["name"].lower():
                    self._browser(use, out, out_text)
        elif t == "rate_limit_event":
            info = ev.get("rate_limit_info") or {}
            if isinstance(info, dict) and info:
                self.limits.append(info)
        elif t == "result":
            self.session = ev.get("session_id") or self.session
            u = ev.get("usage") or {}
            self.tokens += int(u.get("input_tokens") or 0) + int(u.get("output_tokens") or 0)
            self.cost += float(ev.get("total_cost_usd") or 0)
            self.is_error = bool(ev.get("is_error")) or ev.get("subtype", "success") != "success"
            self.result_text = str(ev.get("result") or "")
            if not self.is_error and self.result_text:
                self.text = self.result_text


def _save_shot(data_b64: str, mime: str) -> str | None:
    """A screenshot from the helper's browser: keep it as a file so the Browser panel can show it."""
    import base64

    from ..capabilities import save_bytes

    try:
        raw = base64.b64decode(data_b64)
        f = save_bytes("screenshot." + ("jpg" if "jpeg" in mime else "png"), raw)
        return f"{get_settings().base_path.rstrip('/')}/api/files/{f['id']}"
    except Exception:  # noqa: BLE001
        return None


class ClaudeCodeEngine(Engine):
    type = "claude-code"

    async def _once(self, cli: str, token: str, args: list[str], cwd: Path, config: Path, emit, timeout: float,
                    token_env: str = "CLAUDE_CODE_OAUTH_TOKEN") -> tuple[_Run, int, str]:
        env = {k: v for k, v in os.environ.items() if k not in STRIP_ENV}
        env.update({token_env: token, "CLAUDE_CONFIG_DIR": str(config)})
        if token_env == "ANTHROPIC_API_KEY" and os.environ.get("OMILO_ANTHROPIC_BASE_URL"):  # tests and proxies
            env["ANTHROPIC_BASE_URL"] = os.environ["OMILO_ANTHROPIC_BASE_URL"]
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
                   remember, resources=None) -> EngineResult:
        cli = H.find_cli()
        if not cli:
            return EngineResult(error="Claude Code is not installed. Settings → Harness → Install Claude Code.")
        config, runs, cwd = _dirs(staff_id)
        servers, tools, extra = plan(cfg, resources)
        if resources is not None and resources.folders:
            first_rw = next((f for f in resources.folders if f["access"] == "write"), None)
            if first_rw:
                cwd = Path(first_rw["path"])  # develop in the owner's project folder
        mcp_file = runs / f"{secrets.token_hex(8)}.json"
        mcp_file.write_text(json.dumps({"mcpServers": servers}))
        mcp_file.chmod(0o600)
        tried: set[str] = set()
        total = EngineResult()
        if cfg.get("auth") == "api":  # your Claude API key instead of the subscription pool: one run, billed to the key
            try:
                return await self._run_api(cli, cfg, system, prompt, session, emit, timeout, remember, tools, extra, mcp_file, cwd)
            finally:
                mcp_file.unlink(missing_ok=True)
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
                        "--allowedTools", *tools, *extra, "--max-turns", str(int(cfg.get("max_turns") or 60))]
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
                rejected = H.rejected_reset(run.limits)
                if problem and rejected is not None and not H.LIMIT_RE.search(problem):
                    problem = f"usage limit reached ({problem[:200]})"
                if not problem:
                    H.release(acc_id, ok=True, tokens=run.tokens, cost=run.cost, limits=run.limits)
                    total.text = run.text
                    return total
                if H.LIMIT_RE.search(problem):
                    H.release(acc_id, ok=False, limit=True, error=problem, resets_at=rejected or H.parse_reset(problem), tokens=run.tokens, cost=run.cost,
                              limits=run.limits)
                    emit("status", state="switching", account=label, reason="usage limit reached")
                    continue  # next account, same session: nothing is lost
                H.release(acc_id, ok=False, error=problem, tokens=run.tokens, cost=run.cost, limits=run.limits)
                if H.AUTH_RE.search(problem):
                    emit("status", state="switching", account=label, reason="account sign-in problem")
                    continue
                total.error = f"Claude Code: {problem[:400]}"
                total.text = run.text
                return total
        finally:
            mcp_file.unlink(missing_ok=True)

    async def _run_api(self, cli, cfg, system, prompt, session, emit, timeout, remember, tools, extra, mcp_file, cwd) -> EngineResult:
        key = api_key()
        if not key:
            return EngineResult(error="No Claude API key. Add it in Settings → AI.")
        config = get_settings().company_dir / "harness" / "api-config"
        config.mkdir(parents=True, exist_ok=True)
        emit("status", state="harness", account="your API key")
        args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--append-system-prompt", system,
                "--mcp-config", str(mcp_file), "--strict-mcp-config", "--permission-mode", "dontAsk",
                "--allowedTools", *tools, *extra, "--max-turns", str(int(cfg.get("max_turns") or 60))]
        if cfg.get("model"):
            args += ["--model", cfg["model"]]
        if session:
            args += ["--resume", session]
        run, code, err = await self._once(cli, key, args, cwd, config, emit, timeout, token_env="ANTHROPIC_API_KEY")
        if run.session and run.session != session:
            remember(run.session)
        problem = run.result_text if run.is_error else ("" if code == 0 and run.text else (err or f"exit code {code}"))
        res = EngineResult(tokens=run.tokens, cost_usd=run.cost, text=run.text)
        if problem:
            res.error = f"Claude Code: {problem[:400]}"
        return res

    async def run_task(self, ctx: TaskContext) -> EngineResult:
        if not ctx.mcp_token:
            return EngineResult(error="no MCP token for this helper: rotate it in Team")
        cfg = {**ctx.engine_config, "_mcp_url": ctx.mcp_url, "_mcp_token": ctx.mcp_token}
        system = with_resources(CONSTITUTION.format(name=ctx.staff_name, job=ctx.job or "(no job description yet)").replace(
            "(tools from the `omilo` MCP server)", "(tools from the `omilo` MCP server, named mcp__omilo__*)"), ctx.resources)
        session = _task_session(ctx.task_id)
        return await self._run(ctx.staff_id, cfg, system, task_message(ctx), session, ctx.emit,
                               float(cfg.get("timeout_s") or 1800), lambda s: ctx.emit("session", session_id=s), ctx.resources)

    async def chat(self, ctx: ChatContext) -> EngineResult:
        cfg = {**ctx.engine_config, "_mcp_url": ctx.mcp_url, "_mcp_token": ctx.mcp_token or ""}
        system = with_resources(CHAT_SYSTEM.format(name=ctx.staff_name, chief=", the Chief of Staff" if ctx.is_chief else "", context=ctx.context_note), ctx.resources)
        # a chat with several helpers: each turn starts fresh with the conversation so far (one helper's session would
        # not have seen the others' replies, and must not be resumed by another helper)
        session = None if ctx.shared else _thread_session(ctx.thread_id)
        last = ctx.history[-1]["text"] if ctx.history else ""
        if not session and len(ctx.history) > 1:  # first harness turn in an older chat: give it the conversation so far
            if ctx.shared:  # the other side's turns already say who wrote them
                past = "\n\n".join(h["text"] if h["role"] == "owner" else f"[You wrote]\n{h['text']}" for h in ctx.history[-20:-1])
                last = f"Conversation so far:\n{past}\n\n{last}"
            else:
                past = "\n".join(f"{'Founder' if h['role'] == 'owner' else 'You'}: {h['text']}" for h in ctx.history[-20:-1])
                last = f"Conversation so far:\n{past}\n\nFounder: {last}"
        save = (lambda s: None) if ctx.shared else (lambda s: _save_thread_session(ctx.thread_id, s))
        return await self._run(ctx.staff_id, cfg, system, last, session, ctx.emit, 600, save, ctx.resources)

    async def health(self, cfg: dict) -> dict:
        p = H.pool_summary()
        if not p["cli"]["path"]:
            return {"ok": False, "detail": "Claude Code not installed (Settings → Harness)"}
        if cfg.get("auth") == "api":
            return {"ok": bool(api_key()), "detail": "Claude Code · your API key" if api_key() else "no Claude API key (Settings → AI)"}
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


def api_key() -> str | None:
    """The company's Claude API key (Settings → AI), else ANTHROPIC_API_KEY."""
    from ..db import session_scope
    from ..services import ai_api_key

    with session_scope() as db:
        return ai_api_key(db, "claude") or os.environ.get("ANTHROPIC_API_KEY")
