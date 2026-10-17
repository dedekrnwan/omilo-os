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
from .models import HarnessAccount, HarnessLimitHit, HarnessQuota, HarnessUsage, Setting, now
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


# Leases live in Redis, so every worker process sees the same counts: one sorted set per account, a member per lease
# with its expiry time (a crashed process can't keep an account busy forever).
_lock = threading.Lock()


def _lease_key(account_id: str) -> str:
    from . import bus

    return bus.key(f"pool:lease:{account_id}")


def _busy_of(account_id: str) -> int:
    import time

    from . import bus

    try:
        k = _lease_key(account_id)
        bus.r().zremrangebyscore(k, 0, time.time())
        return int(bus.r().zcard(k))
    except Exception:  # noqa: BLE001
        return 0


class _Busy:
    def get(self, account_id: str, default: int = 0) -> int:
        return _busy_of(account_id) or default


_busy = _Busy()


def busy_counts() -> dict[str, int]:
    from . import bus

    out: dict[str, int] = {}
    try:
        prefix = bus.key("pool:lease:")
        for k in bus.r().scan_iter(prefix + "*", count=200):
            aid = k[len(prefix):]
            out[aid] = _busy_of(aid)
    except Exception:  # noqa: BLE001
        pass
    return out


def _take(account_id: str) -> None:
    import time
    import uuid

    from . import bus
    from .config import get_settings

    k = _lease_key(account_id)
    bus.r().zadd(k, {uuid.uuid4().hex: time.time() + get_settings().task_timeout_s + 120})
    bus.r().expire(k, get_settings().task_timeout_s + 300)


def _give_back(account_id: str) -> None:
    from . import bus

    try:
        bus.r().zpopmin(_lease_key(account_id), 1)
    except Exception:  # noqa: BLE001
        pass


def lease(exclude: set[str] | None = None) -> tuple[str, str, str] | None:
    """Pick an account: enabled, not cooling, not in error, under the parallel limit, least recently used.
    Returns (account_id, label, token) and counts it busy until release()."""
    from . import bus

    with session_scope() as db, _lock, bus.lock("pool", ttl_s=10, wait_s=5):
        rows = list(db.scalars(select(HarnessAccount).where(HarnessAccount.enabled.is_(True))))
        t = now()
        busy = {a.id: _busy_of(a.id) for a in rows}
        ok = [a for a in rows if a.id not in (exclude or set()) and a.status != "error"
              and not (a.cooldown_until and a.cooldown_until.replace(tzinfo=a.cooldown_until.tzinfo or dt.UTC) > t)
              and busy[a.id] < MAX_PARALLEL_PER_ACCOUNT]
        if not ok:
            return None
        ok.sort(key=lambda a: (busy[a.id], a.last_used_at or dt.datetime.min.replace(tzinfo=dt.UTC)))
        a = ok[0]
        a.last_used_at = t
        _take(a.id)
        return a.id, a.label, decrypt(a.token_enc) or ""


def _ts(v) -> dt.datetime | None:
    """resetsAt arrives as epoch seconds or milliseconds."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return dt.datetime.fromtimestamp(f / 1000 if f > 1e11 else f, dt.UTC)


def rejected_reset(limits: list[dict] | None) -> dt.datetime | None:
    """When Claude Code said a window is exhausted (status rejected), when it resets (or in an hour if unknown)."""
    for info in reversed(limits or []):
        if str(info.get("status", "")).lower() in ("rejected", "rate_limited", "blocked"):
            return _ts(info.get("resetsAt")) or (now() + DEFAULT_COOLDOWN)
    return None


def record_limits(db, account_id: str, limits: list[dict] | None) -> None:
    for info in limits or []:
        window = str(info.get("rateLimitType") or "five_hour")[:24]
        q = db.get(HarnessQuota, (account_id, window)) or HarnessQuota(account_id=account_id, window=window)
        q.status = str(info.get("status") or "allowed")[:24]
        u = info.get("utilization")
        if isinstance(u, (int, float)):
            q.utilization = max(0.0, min(1.0, float(u) / 100 if u > 1.5 else float(u)))
        elif q.status == "rejected":
            q.utilization = 1.0
        q.resets_at = _ts(info.get("resetsAt")) or q.resets_at
        q.updated_at = now()
        db.merge(q)


WINDOW = dt.timedelta(hours=5)


def window_tokens(db, account_id: str) -> int:
    from sqlalchemy import func

    return int(db.scalar(select(func.coalesce(func.sum(HarnessUsage.tokens), 0)).where(
        HarnessUsage.account_id == account_id, HarnessUsage.at >= now() - WINDOW)) or 0)


def release(account_id: str, *, ok: bool, tokens: int = 0, cost: float = 0.0, error: str = "", limit: bool = False,
            resets_at: dt.datetime | None = None, limits: list[dict] | None = None) -> None:
    with session_scope() as db, _lock:
        _give_back(account_id)
        a = db.get(HarnessAccount, account_id)
        if not a:
            return
        if tokens or cost:
            db.add(HarnessUsage(account_id=account_id, tokens=tokens, cost_usd=cost))
        record_limits(db, account_id, limits)
        if limit:
            db.add(HarnessLimitHit(account_id=account_id, resets_at=resets_at))
            # learn this account's real capacity: what it had used in this window when the limit hit
            used = window_tokens(db, account_id) + tokens
            if used > 0:
                key = f"harness_capacity:{account_id}"
                s = db.get(Setting, key)
                if s:
                    s.value = used
                else:
                    db.add(Setting(key=key, value=used))
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


def _aware(d: dt.datetime | None) -> dt.datetime | None:
    return d.replace(tzinfo=d.tzinfo or dt.UTC) if d else None


def meter() -> dict:
    """How much of its limits each pool account has used, for the bar in the Workspace.

    Uses what Claude Code reports (exact) when it is recent; otherwise estimates the 5-hour window from tokens spent,
    against the capacity learned the last time this account hit its limit."""
    from .serialize import iso

    out = []
    with session_scope() as db:
        rows = list(db.scalars(select(HarnessAccount).order_by(HarnessAccount.created_at)))
        t = now()
        for a in rows:
            acc = serialize(a, _busy.get(a.id, 0))
            quotas = {q.window: q for q in db.scalars(select(HarnessQuota).where(HarnessQuota.account_id == a.id))}
            windows = {}
            for name, q in quotas.items():
                live = q.resets_at is None or _aware(q.resets_at) > t
                if not live:
                    continue  # that window has reset since Claude last told us
                windows[name] = {"pct": None if q.utilization is None else round(q.utilization * 100), "status": q.status,
                                 "resets_at": iso(q.resets_at), "source": "claude"}
            used = window_tokens(db, a.id)
            cap = (db.get(Setting, f"harness_capacity:{a.id}") or Setting(value=None)).value
            five = windows.get("five_hour") or {"pct": None, "status": "allowed", "resets_at": None, "source": None}
            if five["pct"] is None and cap:
                five = {**five, "pct": min(99, round(used * 100 / cap)), "source": "estimate"}
            if acc["state"] == "cooling":
                five = {**five, "pct": 100, "status": "rejected", "resets_at": acc["cooldown_until"], "source": five["source"] or "limit"}
            out.append({"id": a.id, "label": a.label, "state": acc["state"], "busy": acc["busy"], "tokens_5h": used,
                        "five_hour": five, "weekly": windows.get("seven_day"), "last_error": acc["last_error"] if acc["state"] == "error" else ""})
    ready = sum(1 for a in out if a["state"] in ("ready", "new"))
    known = [a["five_hour"]["pct"] for a in out if a["state"] not in ("disabled", "error") and a["five_hour"]["pct"] is not None]
    return {"accounts": out, "ready": ready, "total": len(out), "busy": sum(a["busy"] for a in out),
            "avg_pct": round(sum(known) / len(known)) if known else None}


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
