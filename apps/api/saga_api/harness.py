"""The harness pool: Claude Code subscriptions the helpers share.

Each account is a long-lived token from `claude setup-token` (stored encrypted). When a helper runs on the
pool, Saga OS picks the least recently used healthy account; when an account hits its usage limit it cools
down and the run continues on another account, resuming the same Claude Code session, so no work is lost.
"""
from __future__ import annotations

import datetime as dt
import os
import re
import shutil
import subprocess
import threading
from pathlib import Path

from sqlalchemy import select

from .config import get_settings
from .db import session_scope
from .models import HarnessAccount, now
from .security import decrypt, encrypt

TOKEN_RE = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{20,}$")
LIMIT_RE = re.compile(r"usage limit|limit reached|rate limit|too many requests|quota|overloaded|resets? (at|in)", re.I)
AUTH_RE = re.compile(r"invalid api key|unauthori[sz]ed|authentication|expired|revoked|401|please run /login|oauth token", re.I)
DEFAULT_COOLDOWN = dt.timedelta(hours=1)
MAX_PARALLEL_PER_ACCOUNT = int(os.environ.get("SAGA_HARNESS_PARALLEL", "2"))
NPM_PACKAGE = "@anthropic-ai/claude-code"


# ------------------------------------------------------------------ the Claude Code CLI
def tools_dir() -> Path:
    return get_settings().data_dir / "harness-tools"


def find_cli() -> str | None:
    env = os.environ.get("SAGA_CLAUDE_BIN")
    if env and Path(env).exists():
        return env
    own = tools_dir() / "node_modules" / ".bin" / ("claude.cmd" if os.name == "nt" else "claude")
    if own.exists():
        return str(own)
    for c in (shutil.which("claude"), str(Path.home() / ".local" / "bin" / "claude"), str(Path.home() / ".claude" / "local" / "claude")):
        if c and Path(c).exists():
            return c
    return None


_version: dict[str, str | None] = {}


def cli_version() -> str | None:
    b = find_cli()
    if not b:
        return None
    if b not in _version:
        try:
            _version[b] = (subprocess.run([b, "--version"], capture_output=True, text=True, timeout=30).stdout or "").strip() or None
        except (OSError, subprocess.SubprocessError):
            _version[b] = None
    return _version[b]


class _Install:
    def __init__(self):
        self.state, self.log = "idle", []

    def snapshot(self) -> dict:
        return {"state": self.state, "log": self.log[-10:]}

    def start(self) -> dict:
        if self.state == "running":
            return self.snapshot()
        self.state, self.log = "running", ["Installing Claude Code…"]
        threading.Thread(target=self._run, daemon=True).start()
        return self.snapshot()

    def _run(self):
        npm = shutil.which("npm")
        if not npm:
            self.state, self.log = "failed", self.log + ["Claude Code needs Node.js (nodejs.org). Install it, then try again."]
            return
        tools_dir().mkdir(parents=True, exist_ok=True)
        r = subprocess.run([npm, "install", "--prefix", str(tools_dir()), "--no-audit", "--no-fund", NPM_PACKAGE], capture_output=True, text=True)
        _version.clear()
        if r.returncode == 0 and find_cli():
            self.state, self.log = "done", self.log + [f"Installed {cli_version() or 'Claude Code'}"]
        else:
            self.state, self.log = "failed", self.log + [(r.stderr or r.stdout).strip()[-400:]]


installer = _Install()


# ------------------------------------------------------------------ accounts
def add_account(db, label: str, token: str) -> HarnessAccount:
    token = token.strip()
    if not TOKEN_RE.match(token):
        raise ValueError("That does not look like a Claude Code token. It starts with sk-ant- (run `claude setup-token`).")
    a = HarnessAccount(label=label.strip() or f"Account {token[-4:]}", token_enc=encrypt(token), token_hint=token[-4:])
    db.add(a)
    db.flush()
    return a


def serialize(a: HarnessAccount, busy: int = 0) -> dict:
    from .serialize import iso

    cooling = a.cooldown_until and a.cooldown_until.replace(tzinfo=a.cooldown_until.tzinfo or dt.UTC) > now()
    state = "disabled" if not a.enabled else "cooling" if cooling else a.status
    return {"id": a.id, "label": a.label, "kind": a.kind, "token_hint": a.token_hint, "enabled": a.enabled, "state": state,
            "cooldown_until": iso(a.cooldown_until) if cooling else None,
            "last_used_at": iso(a.last_used_at), "last_error": re.sub(r"\|\d{10}\b", "", a.last_error or ""),
            "runs": a.runs, "tokens": a.tokens, "cost_usd": round(a.cost_usd or 0, 4), "busy": busy}


# in-process lease counts (the worker process runs every harness call)
_busy: dict[str, int] = {}
_lock = threading.Lock()


def busy_counts() -> dict[str, int]:
    return dict(_busy)


def lease(exclude: set[str] | None = None) -> tuple[str, str, str] | None:
    """Pick an account: enabled, not cooling, not in error, under the parallel limit, least recently used.
    Returns (account_id, label, token) and counts it busy until release()."""
    with session_scope() as db, _lock:
        rows = list(db.scalars(select(HarnessAccount).where(HarnessAccount.enabled.is_(True))))
        t = now()
        ok = [a for a in rows if a.id not in (exclude or set()) and a.status != "error"
              and not (a.cooldown_until and a.cooldown_until.replace(tzinfo=a.cooldown_until.tzinfo or dt.UTC) > t)
              and _busy.get(a.id, 0) < MAX_PARALLEL_PER_ACCOUNT]
        if not ok:
            return None
        ok.sort(key=lambda a: (_busy.get(a.id, 0), a.last_used_at or dt.datetime.min.replace(tzinfo=dt.UTC)))
        a = ok[0]
        a.last_used_at = t
        _busy[a.id] = _busy.get(a.id, 0) + 1
        return a.id, a.label, decrypt(a.token_enc) or ""


def release(account_id: str, *, ok: bool, tokens: int = 0, cost: float = 0.0, error: str = "", limit: bool = False,
            resets_at: dt.datetime | None = None) -> None:
    with session_scope() as db, _lock:
        _busy[account_id] = max(0, _busy.get(account_id, 1) - 1)
        a = db.get(HarnessAccount, account_id)
        if not a:
            return
        a.runs += 1
        a.tokens += tokens
        a.cost_usd = (a.cost_usd or 0) + cost
        if ok:
            a.status, a.last_error = "ready", ""
        elif limit:
            a.status, a.last_error = "ready", error[:500]
            a.cooldown_until = resets_at or (now() + DEFAULT_COOLDOWN)
        else:
            a.last_error = error[:500]
            if AUTH_RE.search(error or ""):
                a.status = "error"


def pool_summary() -> dict:
    with session_scope() as db:
        rows = list(db.scalars(select(HarnessAccount).order_by(HarnessAccount.created_at)))
        accounts = [serialize(a, _busy.get(a.id, 0)) for a in rows]
    ready = sum(1 for a in accounts if a["state"] in ("ready", "new"))
    return {"accounts": accounts, "ready": ready, "total": len(accounts),
            "cli": {"path": find_cli(), "version": cli_version(), "install": installer.snapshot(), "node": bool(shutil.which("npm"))},
            "parallel_per_account": MAX_PARALLEL_PER_ACCOUNT}


def parse_reset(text: str) -> dt.datetime | None:
    """'…limit reached|1760000000' (epoch) or 'resets in 2h' style hints; None when unknown."""
    if m := re.search(r"\|(\d{10})\b", text or ""):
        return dt.datetime.fromtimestamp(int(m.group(1)), dt.UTC)
    if m := re.search(r"resets? in (\d+)\s*(h|hour|m|min)", text or "", re.I):
        n = int(m.group(1))
        return now() + (dt.timedelta(hours=n) if m.group(2).lower().startswith("h") else dt.timedelta(minutes=n))
    return None
