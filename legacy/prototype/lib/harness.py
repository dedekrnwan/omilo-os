"""Harness adapters. A harness = the agent CLI that actually does the work for a loop run.

Add a new harness by adding an entry in config/settings.json -> "harnesses":
  - type "claude-code": Claude Code headless (`claude -p`), with an optional account pool.
  - type "command":     any CLI agent (Codex, OpenCode, Hermes, Aider, a custom Agent-SDK script...).
"""
import json
import os
import re
import signal
import subprocess
import time
from dataclasses import dataclass, field

RATE_LIMIT_RE = re.compile(
    r"usage limit|rate[ _-]?limit|limit (has been |was )?reached|\b429\b|exceeded your|out of (extra )?usage|quota",
    re.I,
)
AUTH_RE = re.compile(r"invalid api key|not logged in|please run /login|authentication|unauthorized|\b401\b", re.I)


@dataclass
class HarnessResult:
    status: str  # success | failed | timeout | rate_limited
    exit_code: int = None
    cost_usd: float = None
    num_turns: int = None
    session_id: str = None
    result_text: str = ""
    error: str = None
    duration_s: float = 0
    raw: dict = field(default_factory=dict)


def _run(argv, *, stdin_text, cwd, env, timeout_s, stdout_path, stderr_path):
    t0 = time.time()
    with open(stdout_path, "w") as out, open(stderr_path, "w") as err:
        p = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.PIPE, stdout=out, stderr=err,
                             text=True, start_new_session=True)
        try:
            p.communicate(stdin_text, timeout=timeout_s)
            timed_out = False
        except subprocess.TimeoutExpired:
            timed_out = True
            for sig in (signal.SIGTERM, signal.SIGKILL):
                try:
                    os.killpg(p.pid, sig)
                except ProcessLookupError:
                    break
                try:
                    p.wait(timeout=10)
                    break
                except subprocess.TimeoutExpired:
                    continue
    return p.returncode, timed_out, time.time() - t0


def _last_json(text):
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except Exception:
                continue
    return None


def _classify(rc, timed_out, stdout, stderr, data):
    blob = f"{stdout[-4000:]}\n{stderr[-4000:]}"
    if timed_out:
        return "timeout", "timed out"
    is_err = bool(data.get("is_error")) if data else rc != 0
    if rc != 0 or is_err:
        if RATE_LIMIT_RE.search(blob):
            return "rate_limited", "account hit its usage/rate limit"
        if AUTH_RE.search(blob):
            return "failed", "auth problem: log this account in again"
        msg = (data or {}).get("result") or stderr.strip().splitlines()[-1:] or [f"exit {rc}"]
        return "failed", (msg if isinstance(msg, str) else msg[0])[:500]
    return "success", None


class ClaudeCodeHarness:
    """`claude -p` headless. Prompt is sent on stdin; JSON result on stdout."""

    def __init__(self, name, cfg):
        self.name, self.cfg = name, cfg
        self.billing = cfg.get("billing", "subscription")

    def run(self, *, prompt, loop, run_dir, workdir, extra_dirs, account_path, env, timeout_s):
        argv = [self.cfg.get("bin", "claude"), "-p", "--output-format", "json",
                "--max-turns", str(loop.get("max_turns", 30))]
        if loop.get("model") or self.cfg.get("model"):
            argv += ["--model", loop.get("model") or self.cfg.get("model")]
        for d in extra_dirs:
            argv += ["--add-dir", str(d)]
        tools = loop.get("allowed_tools") or []
        if tools:
            argv += ["--allowedTools", ",".join(tools)]
        argv += self.cfg.get("extra_args", [])
        env = dict(env)
        if account_path:
            env["CLAUDE_CONFIG_DIR"] = account_path
        if self.billing == "subscription":
            env.pop("ANTHROPIC_API_KEY", None)  # make sure the subscription login is used
        rc, timed_out, dur = _run(argv, stdin_text=prompt, cwd=workdir, env=env, timeout_s=timeout_s,
                                  stdout_path=run_dir / "stdout.json", stderr_path=run_dir / "stderr.log")
        stdout = (run_dir / "stdout.json").read_text(errors="replace")
        stderr = (run_dir / "stderr.log").read_text(errors="replace")
        data = _last_json(stdout) or {}
        status, err = _classify(rc, timed_out, stdout, stderr, data)
        return HarnessResult(status=status, exit_code=rc, cost_usd=data.get("total_cost_usd"),
                             num_turns=data.get("num_turns"), session_id=data.get("session_id"),
                             result_text=data.get("result") or "", error=err, duration_s=round(dur, 1), raw=data)


class CommandHarness:
    """Generic CLI agent. argv items may use {prompt_file} {run_dir} {workdir} {model}.
    If "stdin": true the prompt is also piped on stdin. JSON on stdout is parsed if present
    (keys: total_cost_usd|cost_usd, num_turns, session_id, result, is_error)."""

    def __init__(self, name, cfg):
        self.name, self.cfg = name, cfg
        self.billing = cfg.get("billing", "api")

    def run(self, *, prompt, loop, run_dir, workdir, extra_dirs, account_path, env, timeout_s):
        pf = run_dir / "prompt.md"
        subs = {"prompt_file": str(pf), "run_dir": str(run_dir), "workdir": str(workdir),
                "model": loop.get("model") or self.cfg.get("model") or ""}
        argv = [a.format(**subs) for a in self.cfg["argv"]]
        env = dict(env)
        if account_path:
            env[self.cfg.get("account_env", "AGENT_HOME")] = account_path
        rc, timed_out, dur = _run(argv, stdin_text=prompt if self.cfg.get("stdin") else "", cwd=workdir, env=env,
                                  timeout_s=timeout_s, stdout_path=run_dir / "stdout.json",
                                  stderr_path=run_dir / "stderr.log")
        stdout = (run_dir / "stdout.json").read_text(errors="replace")
        stderr = (run_dir / "stderr.log").read_text(errors="replace")
        data = _last_json(stdout) or {}
        status, err = _classify(rc, timed_out, stdout, stderr, data)
        return HarnessResult(status=status, exit_code=rc,
                             cost_usd=data.get("total_cost_usd", data.get("cost_usd")),
                             num_turns=data.get("num_turns"), session_id=data.get("session_id"),
                             result_text=data.get("result") or stdout[-2000:], error=err,
                             duration_s=round(dur, 1), raw=data)


TYPES = {"claude-code": ClaudeCodeHarness, "command": CommandHarness}


def get_harness(name, cfg):
    t = cfg.get("type", name)
    if t not in TYPES:
        raise ValueError(f"unknown harness type '{t}' for harness '{name}'")
    return TYPES[t](name, cfg)
