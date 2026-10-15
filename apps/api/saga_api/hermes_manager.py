"""Managed Hermes: Saga OS installs, configures and runs Hermes for the owner.

Hermes stays the engine (browser, terminal, web, skills, memory). Saga OS is the wrapper:
- install:   a private virtualenv in <data_dir>/hermes-venv with `pip install hermes-agent[...]`
- configure: one Hermes home per helper in <data_dir>/hermes/<staff_id> (config.yaml + .env):
             Claude as the model provider, the saga-os MCP server with that helper's token,
             and the OpenAI-compatible API server on its own local port with a strong random key
- run:       the worker supervises one `hermes gateway run` process per managed helper and restarts
             it when it exits or when its configuration changes

Staff engine config for a managed helper:
  {"type": "hermes", "managed": true, "base_url": "http://127.0.0.1:<port>/v1", "port": <port>,
   "claude_model": "claude-sonnet-5-5", "api_key_enc": "<Fernet>"}
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import yaml

from .config import get_settings

log = logging.getLogger("saga.hermes")

PIP_SPEC = "hermes-agent[anthropic,mcp,messaging,cron,web]"
FIRST_PORT = 8650
MCP_SERVER_NAME = "saga-os"


# ------------------------------------------------------------------ paths & detection
def root() -> Path:
    d = get_settings().data_dir / "hermes"
    d.mkdir(parents=True, exist_ok=True)
    return d


def venv_dir() -> Path:
    return get_settings().data_dir / "hermes-venv"


def tools_dir() -> Path:
    """npm prefix for the browser helper (agent-browser) that Hermes's browser tools drive."""
    return get_settings().data_dir / "hermes-tools"


def agent_browser_bin() -> str | None:
    own = tools_dir() / "node_modules" / ".bin" / ("agent-browser.cmd" if os.name == "nt" else "agent-browser")
    if own.exists():
        return str(own)
    return shutil.which("agent-browser")


CHROME_PATHS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]


def find_chrome() -> str | None:
    """A Chrome-family browser already on this computer (so nothing big has to be downloaded)."""
    env = os.environ.get("AGENT_BROWSER_EXECUTABLE_PATH")
    if env and Path(env).exists():
        return env
    for p in CHROME_PATHS:
        if Path(p).exists():
            return p
    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        if found := shutil.which(name):
            return found
    cache = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or Path.home() / (
        "Library/Caches/ms-playwright" if sys.platform == "darwin" else ".cache/ms-playwright"))
    for pattern in ("chromium-*/chrome-linux/chrome", "chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
                    "chromium-*/chrome-win/chrome.exe"):
        for hit in sorted(cache.glob(pattern), reverse=True) if cache.exists() else []:
            return str(hit)
    return None


def browser_ready() -> bool:
    """The helper is installed and has a Chrome to drive (yours, or one it downloaded)."""
    if not agent_browser_bin():
        return False
    own = Path.home() / ".agent-browser" / "browsers"
    return bool(find_chrome()) or (own.exists() and any(own.iterdir()))


def home_for(staff_id: str) -> Path:
    return root() / staff_id


def find_hermes() -> str | None:
    """SAGA_HERMES_BIN, then our own install, then whatever is on PATH."""
    env = os.environ.get("SAGA_HERMES_BIN")
    if env and Path(env).exists():
        return env
    own = venv_dir() / ("Scripts/hermes.exe" if os.name == "nt" else "bin/hermes")
    if own.exists():
        return str(own)
    found = shutil.which("hermes")
    if found:
        return found
    local = Path.home() / ".local" / "bin" / "hermes"
    return str(local) if local.exists() else None


_version_cache: dict[str, str | None] = {}


def version(binary: str | None = None) -> str | None:
    b = binary or find_hermes()
    if not b:
        return None
    if b in _version_cache:
        return _version_cache[b]
    try:
        out = subprocess.run([b, "--version"], capture_output=True, text=True, timeout=30).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    first = (out or "").strip().splitlines()
    _version_cache[b] = first[0] if first else None
    return _version_cache[b]


_python_cache: list[str | None] = []


def _python_for_hermes() -> str | None:
    """Hermes supports Python 3.11-3.13 (the answer is cached for the process)."""
    if _python_cache:
        return _python_cache[0]
    found = _find_python()
    _python_cache.append(found)
    return found


def _find_python() -> str | None:
    cands = [sys.executable, "python3.13", "python3.12", "python3.11", "python3"]
    for c in cands:
        exe = c if os.path.isabs(c) else shutil.which(c)
        if not exe:
            continue
        try:
            v = subprocess.run([exe, "-c", "import sys;print(sys.version_info[:2] >= (3,11) and sys.version_info[:2] < (3,14))"],
                               capture_output=True, text=True, timeout=15).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            continue
        if v == "True":
            return exe
    return None


# ------------------------------------------------------------------ install (background, with a log)
class _Install:
    def __init__(self):
        self.state = "idle"  # idle | running | done | failed
        self.log: list[str] = []
        self.started_at: float | None = None
        self.browser_only = False
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        return {"state": self.state, "log": self.log[-15:], "started_at": self.started_at}

    def start(self, browser_only: bool = False) -> dict:
        self.browser_only = browser_only
        with self._lock:
            if self.state == "running":
                return self.snapshot()
            self.state, self.log, self.started_at = "running", [], time.time()
        threading.Thread(target=self._run, daemon=True).start()
        return self.snapshot()

    def _browser(self):
        """agent-browser (npm) + a Chrome. Optional: without it helpers still have everything but the browser."""
        npm = shutil.which("npm")
        if not npm:
            self._say("Skipping the web browser: Node.js is not installed (https://nodejs.org). Everything else works.")
            return
        if not agent_browser_bin():
            self._say("Installing the web browser helper…")
            tools_dir().mkdir(parents=True, exist_ok=True)
            r = subprocess.run([npm, "install", "--prefix", str(tools_dir()), "--no-audit", "--no-fund", "agent-browser"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                self._say(f"Browser helper not installed: {(r.stderr or r.stdout).strip()[-300:]}")
                return
        chrome = find_chrome()
        if chrome:
            self._say(f"Using your browser: {chrome}")
        elif not browser_ready():
            self._say("Downloading a browser for your helpers (Chromium)…")
            r = subprocess.run([agent_browser_bin() or "agent-browser", "install"], capture_output=True, text=True)
            if r.returncode != 0:
                self._say(f"Browser download failed: {(r.stderr or r.stdout).strip()[-300:]}")
                return
        self._say("Web browser ready.")

    def _say(self, line: str):
        self.log.append(line.rstrip()[:300])
        log.info("hermes install: %s", line.rstrip())

    def _run(self):
        try:
            py = _python_for_hermes()
            if not py:
                raise RuntimeError("Hermes needs Python 3.11, 3.12 or 3.13. On macOS: brew install python@3.12")
            if find_hermes() and self.browser_only:
                self._browser()
                self.state = "done"
                return
            v = venv_dir()
            if not (v / "bin" / "pip").exists() and not (v / "Scripts" / "pip.exe").exists():
                self._say(f"Creating a private Python environment ({py})…")
                subprocess.run([py, "-m", "venv", str(v)], check=True, capture_output=True, text=True)
            pip = str(v / ("Scripts/pip.exe" if os.name == "nt" else "bin/pip"))
            self._say("Downloading Hermes and its tools (this can take a few minutes)…")
            p = subprocess.Popen([pip, "install", "--upgrade", PIP_SPEC], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in p.stdout or []:
                if line.startswith(("Collecting", "Successfully", "ERROR", "error")):
                    self._say(line)
            if p.wait() != 0:
                raise RuntimeError("pip could not install Hermes (see the log above)")
            _version_cache.clear()
            self._say(f"Installed: {version() or 'hermes'}")
            try:
                self._browser()
            except Exception as e:  # noqa: BLE001 - optional part
                self._say(f"Browser setup skipped: {e}")
            self.state = "done"
        except Exception as e:  # noqa: BLE001 - reported to the owner
            self._say(f"Failed: {e}")
            self.state = "failed"


installer = _Install()


# ------------------------------------------------------------------ configuration per helper
def _port_free(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def allocate_port(taken: set[int]) -> int:
    p = FIRST_PORT
    while p in taken or not _port_free(p):
        p += 1
    return p


def new_api_key() -> str:
    return secrets.token_hex(32)  # Hermes refuses short keys: its API server can run terminal commands


def _read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip()
    return out


def write_profile(staff_id: str, *, port: int, api_key: str, mcp_url: str, mcp_token: str,
                  provider: str, model: str, provider_key: str | None, extra_env: dict | None = None,
                  connectors: list[dict] | None = None) -> str:
    """Write config.yaml and .env for one helper's Hermes. Keeps anything else the owner added. Returns a config hash."""
    home = home_for(staff_id)
    home.mkdir(parents=True, exist_ok=True)
    cfg_path, env_path = home / "config.yaml", home / ".env"
    cfg = yaml.safe_load(cfg_path.read_text()) if cfg_path.exists() else {}
    cfg = cfg or {}
    cfg.setdefault("model", {})
    cfg["model"]["provider"] = provider
    cfg["model"]["default"] = model
    cfg.setdefault("mcp_servers", {})
    cfg["mcp_servers"][MCP_SERVER_NAME] = {"url": mcp_url, "headers": {"Authorization": "Bearer ${SAGA_MCP_TOKEN}"}, "timeout": 120}
    managed = set(cfg.get("x_saga_connectors") or [])
    for old in managed:  # connectors Saga OS added before and that are gone now
        cfg["mcp_servers"].pop(old, None)
    names = []
    for c in connectors or []:
        names.append(c["id"])
        cfg["mcp_servers"][c["id"]] = ({"command": c["command"], "args": c["args"], "env": c["env"]} if c["kind"] == "stdio"
                                       else {"url": c["url"], "headers": c["headers"], "timeout": 120})
    cfg["x_saga_connectors"] = names
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False))
    cfg_path.chmod(0o600)

    env = _read_env(env_path)
    env.update({"API_SERVER_ENABLED": "true", "API_SERVER_HOST": "127.0.0.1", "API_SERVER_PORT": str(port),
                "API_SERVER_KEY": api_key, "SAGA_MCP_TOKEN": mcp_token})
    if provider == "anthropic" and provider_key:
        env["ANTHROPIC_API_KEY"] = provider_key
    if os.environ.get("SAGA_ANTHROPIC_BASE_URL"):  # tests and proxies
        env["ANTHROPIC_BASE_URL"] = os.environ["SAGA_ANTHROPIC_BASE_URL"]
    env.update(extra_env or {})
    body = "# Managed by Saga OS. Edit in Saga OS (Settings → AI); manual changes to these keys are overwritten.\n"
    body += "".join(f"{k}={v}\n" for k, v in env.items())
    env_path.write_text(body)
    env_path.chmod(0o600)
    return hashlib.sha256((cfg_path.read_text() + body).encode()).hexdigest()[:16]


# ------------------------------------------------------------------ supervisor (runs inside the worker)
class Supervisor:
    """Keeps one `hermes gateway run` per managed helper alive."""

    def __init__(self):
        self.procs: dict[str, asyncio.subprocess.Process] = {}
        self.hashes: dict[str, str] = {}
        self.backoff: dict[str, float] = {}
        self.logs: dict[str, object] = {}

    def status(self) -> dict:
        return {sid: {"pid": p.pid, "running": p.returncode is None} for sid, p in self.procs.items()}

    async def reconcile(self, desired: dict[str, dict]):
        """desired: staff_id -> {"hash": str}. Start missing, restart changed or dead, stop removed."""
        binary = find_hermes()
        for sid in list(self.procs):
            if sid not in desired:
                await self.stop(sid)
        if not binary:
            return
        for sid, d in desired.items():
            p = self.procs.get(sid)
            alive = p is not None and p.returncode is None
            if alive and self.hashes.get(sid) == d["hash"]:
                continue
            if alive:
                await self.stop(sid)
            if time.time() < self.backoff.get(sid, 0):
                continue
            await self.start(sid, binary, d["hash"])

    async def start(self, sid: str, binary: str, cfg_hash: str):
        home = home_for(sid)
        logf = open(home / "saga-gateway.log", "ab")  # noqa: SIM115 - kept open for the child process
        env = {**os.environ, "HERMES_HOME": str(home)}
        bin_dir = tools_dir() / "node_modules" / ".bin"
        if bin_dir.exists():
            env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        if (chrome := find_chrome()) and not env.get("AGENT_BROWSER_EXECUTABLE_PATH"):
            env["AGENT_BROWSER_EXECUTABLE_PATH"] = chrome
        for k in ("HERMES_API_KEY", "SAGA_SECRET_KEY", "SAGA_DATABASE_URL"):  # never leak gateway secrets to agents
            env.pop(k, None)
        try:
            proc = await asyncio.create_subprocess_exec(binary, "gateway", "run", cwd=str(home), env=env,
                                                        stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as e:
            log.error("could not start hermes for %s: %s", sid, e)
            self.backoff[sid] = time.time() + 60
            return
        self.procs[sid], self.hashes[sid], self.logs[sid] = proc, cfg_hash, logf
        self.backoff[sid] = time.time() + 15  # if it dies right away, wait before the next try
        log.info("hermes gateway for %s started (pid %s)", sid, proc.pid)

    async def stop(self, sid: str):
        p = self.procs.pop(sid, None)
        if p and p.returncode is None:
            p.terminate()
            try:
                await asyncio.wait_for(p.wait(), timeout=10)
            except TimeoutError:
                p.kill()
        f = self.logs.pop(sid, None)
        if f:
            f.close()  # type: ignore[attr-defined]

    async def stop_all(self):
        for sid in list(self.procs):
            await self.stop(sid)


def log_tail(staff_id: str, lines: int = 30) -> list[str]:
    f = home_for(staff_id) / "saga-gateway.log"
    if not f.exists():
        return []
    return f.read_text(errors="replace").splitlines()[-lines:]


def describe() -> dict:
    b = find_hermes()
    return {"installed": bool(b), "path": b, "version": version(b) if b else None,
            "install": installer.snapshot(), "python_ok": _python_for_hermes() is not None,
            "browser": {"ready": browser_ready(), "helper": agent_browser_bin(), "chrome": find_chrome(), "node": bool(shutil.which("npm"))}}


def dumps(obj) -> str:
    return json.dumps(obj, sort_keys=True)
