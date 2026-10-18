"""Omilo as one app: run Postgres (with pgvector), Valkey (Redis) and the gateway from a bundled runtime, no Docker.

The macOS app (apps/desktop) starts this with the bundled Python and reads one line from stdout:

    OMILO_READY http://127.0.0.1:7700

then opens its window there. It also works by hand on Linux or macOS against a runtime built by
scripts/desktop/build-runtime.sh:

    python -m omilo_api.desktop --runtime ./dist/runtime --data ~/OmiloData

Runtime layout (all optional except pgsql and valkey):
    pgsql/bin/{initdb,postgres,pg_ctl}   Postgres with pgvector installed into it
    valkey/bin/valkey-server             (redis-server works too)
    web/index.html                       the built web app
    node/bin/{node,npm}                  Node.js, so Claude Code can run and be installed from Settings
    models/                              a preloaded embedding model

Data layout: <data>/postgres, <data>/valkey, <data>/omilo (Omilo's own files), <data>/logs, <data>/desktop.json
(ports and generated passwords, private to the user).

Stops everything on SIGTERM/SIGINT, and when stdin closes (the app that started it went away), so nothing keeps
running after the app quits or crashes.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import logging
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

log = logging.getLogger("omilo.desktop")
DEFAULT_PORT = 7700


# ------------------------------------------------------------------ small helpers
def _busy(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", port)) == 0


def free_port(preferred: int | None = None) -> int:
    """`preferred` if nothing listens there, else any free port on 127.0.0.1. (A connect test first: on macOS a bind
    can succeed next to a server listening on all addresses, such as Omilo in Docker.)"""
    for port in ([preferred] if preferred else []) + [0]:
        if port and _busy(port):
            continue
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # a port we used a moment ago is still ours
            try:
                s.bind(("127.0.0.1", port))
            except OSError:
                continue
            return s.getsockname()[1]
    raise RuntimeError("no free port")


def wait_port(port: int, timeout: float, proc: subprocess.Popen | None = None, name: str = "") -> None:
    end = time.time() + timeout
    while time.time() < end:
        if proc and proc.poll() is not None:
            raise RuntimeError(f"{name} stopped while starting (exit {proc.returncode}); see the log in the data folder")
        with socket.socket() as s:
            s.settimeout(0.3)
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.15)
    raise RuntimeError(f"{name} did not start within {timeout:.0f}s")


def login_path() -> str:
    """The PATH a Terminal would have. Apps started from Finder get a bare PATH, which would hide `claude`, `git` and
    `npm` from the helpers."""
    shell = os.environ.get("SHELL") or "/bin/zsh"
    try:
        out = subprocess.run([shell, "-ilc", 'printf "__P__%s__P__" "$PATH"'], capture_output=True, text=True, timeout=8,
                             stdin=subprocess.DEVNULL).stdout
        if "__P__" in out:
            return out.split("__P__")[1]
    except (OSError, subprocess.SubprocessError):
        pass
    return ""


def merge_path(*parts: str) -> str:
    seen, out = set(), []
    for part in parts:
        for p in (part or "").split(os.pathsep):
            if p and p not in seen:
                seen.add(p)
                out.append(p)
    return os.pathsep.join(out)


def _answers(url: str) -> bool:
    try:
        urllib.request.urlopen(url + "/healthz", timeout=2)
        return True
    except Exception:  # noqa: BLE001
        return False


def _q(v) -> str:
    """A value for valkey.conf, quoted: paths on macOS have spaces ("Application Support")."""
    return '"' + str(v).replace("\\", "\\\\").replace('"', '\\"') + '"'


class State:
    """<data>/desktop.json: the ports and passwords this install uses (kept so the web app's address, and so its
    cookies and notification subscriptions, stay the same from one start to the next)."""

    def __init__(self, path: Path):
        self.path = path
        try:
            self.d = json.loads(path.read_text())
        except (OSError, ValueError):
            self.d = {}

    def get(self, k: str, make):
        if k not in self.d:
            self.d[k] = make()
        return self.d[k]

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.d, indent=2))
        tmp.chmod(0o600)
        tmp.replace(self.path)


# ------------------------------------------------------------------ the services
class Services:
    def __init__(self, runtime: Path, data: Path, port: int | None = None):
        self.runtime, self.data = runtime.resolve(), data.resolve()
        self.port_wanted = port
        self.procs: list[tuple[str, subprocess.Popen]] = []
        self.logs = self.data / "logs"
        self.pgdata = self.data / "postgres"
        self.state: State | None = None
        self._lock_fd = None

    # binaries ------------------------------------------------------------------
    def pg(self, name: str) -> str:
        b = self.runtime / "pgsql" / "bin" / name
        if b.exists():
            return str(b)
        found = shutil.which(name)  # development: a system Postgres
        if not found:
            raise RuntimeError(f"Postgres is missing from the runtime ({b})")
        return found

    def kv(self) -> str:
        for b in (self.runtime / "valkey" / "bin" / "valkey-server", self.runtime / "valkey" / "bin" / "redis-server"):
            if b.exists():
                return str(b)
        found = shutil.which("valkey-server") or shutil.which("redis-server")
        if not found:
            raise RuntimeError(f"Valkey is missing from the runtime ({self.runtime / 'valkey'})")
        return found

    # lifecycle -----------------------------------------------------------------
    def lock(self, wait: float = 60) -> dict | None:
        """One copy per data folder. Returns the running copy's details when another one holds the folder and
        answers. A copy that is still shutting down (Omilo quit and was opened again at once) is waited for."""
        self.data.mkdir(parents=True, exist_ok=True)
        self.data.chmod(0o700)
        self._lock_fd = open(self.data / "desktop.lock", "a+")  # noqa: SIM115 - held for the life of the process
        end = time.time() + wait
        while True:
            try:
                fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return None
            except BlockingIOError:
                url = State(self.data / "desktop.json").d.get("url")
                if url and _answers(url):
                    return {"url": url}
                if time.time() >= end:
                    return {"url": url}
                time.sleep(0.5)

    def start(self) -> str:
        for d in (self.logs, self.data / "valkey", self.data / "omilo"):
            d.mkdir(parents=True, exist_ok=True)
        self.state = st = State(self.data / "desktop.json")
        backup = self.pgdata / "omilo.pw"  # a second copy next to the database it opens (desktop.json can be lost)
        pg_pw = st.get("pg_password", lambda: backup.read_text().strip() if backup.exists() else secrets.token_urlsafe(24))
        kv_pw = st.get("kv_password", lambda: secrets.token_urlsafe(24))
        wanted = self.port_wanted or st.d.get("port") or DEFAULT_PORT
        port = free_port(wanted)
        st.d.setdefault("port", port)  # keep the address stable; a busy port only moves this one start
        st.save()

        pg_port = self._postgres(pg_pw)
        kv_port = self._valkey(kv_pw)
        url = f"http://127.0.0.1:{port}"
        st.d["url"] = url
        st.save()

        env = os.environ
        env["OMILO_DATABASE_URL"] = f"postgresql+psycopg://omilo:{pg_pw}@127.0.0.1:{pg_port}/omilo"
        env["OMILO_REDIS_URL"] = f"redis://:{kv_pw}@127.0.0.1:{kv_port}/0"
        env.setdefault("OMILO_DATA_DIR", str(self.data / "omilo"))
        env["OMILO_PUBLIC_URL"] = url
        env["OMILO_HOST"], env["OMILO_PORT"] = "127.0.0.1", str(port)
        env.setdefault("OMILO_EMBEDDED_WORKER", "true")
        if (self.runtime / "web" / "index.html").exists():
            env["OMILO_WEB_DIR"] = str(self.runtime / "web")
        if (self.runtime / "models").is_dir() and not env.get("OMILO_MODELS_DIR"):
            env["OMILO_MODELS_DIR"] = str(self.runtime / "models")
        if not env.get("SSL_CERT_FILE"):  # the bundled Python has no system certificate store on macOS
            with contextlib.suppress(ImportError):
                import certifi

                env["SSL_CERT_FILE"] = certifi.where()
        # helpers run `claude`, `git`, `npm`: the user's own tools first, then the bundled Node
        extra = [str(self.runtime / "node" / "bin")] if (self.runtime / "node" / "bin").is_dir() else []
        shell_path = login_path() if sys.platform == "darwin" else ""
        env["PATH"] = merge_path(shell_path, env.get("PATH", ""), *extra, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin")
        return url

    def _spawn(self, name: str, args: list[str], **kw) -> subprocess.Popen:
        out = open(self.logs / f"{name}.log", "ab")  # noqa: SIM115 - the child keeps it
        p = subprocess.Popen(args, stdout=out, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, **kw)
        self.procs.append((name, p))
        return p

    def _postgres(self, password: str) -> int:
        fresh = not (self.pgdata / "PG_VERSION").exists()
        if fresh:
            if self.pgdata.exists():  # a first start that was cut short: begin again
                shutil.rmtree(self.pgdata)
            pwfile = self.data / ".pgpass.init"
            pwfile.write_text(password)
            pwfile.chmod(0o600)
            try:
                r = subprocess.run([self.pg("initdb"), "-D", str(self.pgdata), "-U", "omilo", "--pwfile", str(pwfile),
                                    "--auth=scram-sha-256", "-E", "UTF8", "--locale=C"], capture_output=True, text=True)
            finally:
                pwfile.unlink(missing_ok=True)
            if r.returncode:
                raise RuntimeError(f"could not create the database: {(r.stderr or r.stdout).strip()[-500:]}")
            (self.logs / "initdb.log").write_text(r.stdout + r.stderr)
            (self.pgdata / "omilo.pw").write_text(password)
            (self.pgdata / "omilo.pw").chmod(0o600)
        self._stop_stale_postgres()
        port = free_port(self.state.d.get("pg_port") if self.state else None)
        if self.state:
            self.state.d["pg_port"] = port
            self.state.save()
        p = self._spawn("postgres", [self.pg("postgres"), "-D", str(self.pgdata), "-p", str(port),
                                     "-c", "listen_addresses=127.0.0.1", "-c", "unix_socket_directories=",
                                     "-c", "max_connections=60", "-c", "shared_buffers=64MB"])
        wait_port(port, 60, p, "Postgres")
        self._ensure_database(port, password)
        return port

    def _stop_stale_postgres(self) -> None:
        """A Postgres left running by a crash still holds the data folder: ask it to stop before starting again."""
        pid_file = self.pgdata / "postmaster.pid"
        if not pid_file.exists():
            return
        try:
            pid = int(pid_file.read_text().split()[0])
            os.kill(pid, 0)
        except (OSError, ValueError, IndexError):
            return  # stale file: Postgres cleans it up itself
        log.warning("stopping a Postgres left over from an earlier run (pid %s)", pid)
        subprocess.run([self.pg("pg_ctl"), "-D", str(self.pgdata), "-m", "fast", "-w", "-t", "30", "stop"], capture_output=True)

    def _ensure_database(self, port: int, password: str) -> None:
        import psycopg

        dsn = f"host=127.0.0.1 port={port} user=omilo password={password}"
        for attempt in range(40):  # the port opens a moment before Postgres accepts logins
            try:
                with psycopg.connect(dsn + " dbname=postgres", autocommit=True) as c:
                    if not c.execute("SELECT 1 FROM pg_database WHERE datname='omilo'").fetchone():
                        c.execute("CREATE DATABASE omilo")
                break
            except psycopg.OperationalError:
                if attempt == 39:
                    raise
                time.sleep(0.25)
        with psycopg.connect(dsn + " dbname=omilo", autocommit=True) as c:
            c.execute("CREATE EXTENSION IF NOT EXISTS vector")

    def _stop_stale_valkey(self, pidfile: Path) -> None:
        try:
            pid = int(pidfile.read_text().strip())
            os.kill(pid, 0)
        except (OSError, ValueError):
            return
        cmd = subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout
        if "valkey" not in cmd and "redis" not in cmd:
            return  # the pid was reused by something else
        log.warning("stopping a Valkey left over from an earlier run (pid %s)", pid)
        os.kill(pid, signal.SIGTERM)
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except OSError:
                return
            time.sleep(0.1)

    def _valkey(self, password: str) -> int:
        pidfile = self.data / "valkey" / "valkey.pid"
        self._stop_stale_valkey(pidfile)
        port = free_port(self.state.d.get("kv_port") if self.state else None)
        if self.state:
            self.state.d["kv_port"] = port
            self.state.save()
        conf = self.data / "valkey" / "valkey.conf"  # the password goes in a private file, not the process list
        conf.write_text(f"port {port}\nbind 127.0.0.1\ndir {_q(self.data / 'valkey')}\nappendonly yes\nsave \"\"\n"
                        f"protected-mode yes\nrequirepass {_q(password)}\nmaxmemory-policy noeviction\npidfile {_q(pidfile)}\n")
        conf.chmod(0o600)
        p = self._spawn("valkey", [self.kv(), str(conf)])
        wait_port(port, 20, p, "Valkey")
        return port

    def stop(self) -> None:
        for name, p in reversed(self.procs):
            if p.poll() is None:
                # Postgres: SIGINT is a fast shutdown (ends sessions, writes a checkpoint); Valkey saves on SIGTERM
                p.send_signal(signal.SIGINT if name == "postgres" else signal.SIGTERM)
        for name, p in reversed(self.procs):
            try:
                p.wait(timeout=30)
            except subprocess.TimeoutExpired:
                log.warning("%s did not stop in time; killing it", name)
                p.kill()
        self.procs.clear()

    def died(self) -> str | None:
        for name, p in self.procs:
            if p.poll() is not None:
                return name
        return None


# ------------------------------------------------------------------ main
def _say(line: str) -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="omilo-desktop", description=__doc__.split("\n\n")[0])
    ap.add_argument("--runtime", default=os.environ.get("OMILO_RUNTIME_DIR") or str(Path(sys.executable).resolve().parents[2]))
    default_data = (Path.home() / "Library" / "Application Support" / "Omilo") if sys.platform == "darwin" else (Path.home() / ".omilo-desktop")
    ap.add_argument("--data", default=os.environ.get("OMILO_DESKTOP_DATA") or str(default_data))
    ap.add_argument("--port", type=int, default=None, help=f"web port (default: the last one used, else {DEFAULT_PORT})")
    ap.add_argument("--watch-stdin", action="store_true", help="stop when stdin closes (the app that started us quit)")
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stderr)
    svc = Services(Path(a.runtime), Path(a.data), a.port)
    other = svc.lock()
    if other is not None:
        _say(f"OMILO_ALREADY {other.get('url') or ''}")
        return 0

    stop = threading.Event()
    server = None

    def shutdown(*_):
        stop.set()
        if server is not None:
            server.should_exit = True

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    if a.watch_stdin:
        def _watch():
            with contextlib.suppress(Exception):
                while sys.stdin.read(1024):
                    pass
            shutdown()
        threading.Thread(target=_watch, daemon=True).start()

    try:
        _say("OMILO_STATUS Starting the database…")
        url = svc.start()
        if stop.is_set():
            return 0
        _say("OMILO_STATUS Opening the office…")
        import uvicorn

        from .main import app  # after start(): settings read the environment set there

        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=int(os.environ["OMILO_PORT"]), log_level="info", access_log=False,
                                               proxy_headers=True, forwarded_allow_ips="127.0.0.1"))

        def _ready():
            while not stop.is_set():
                if server.started:
                    try:
                        urllib.request.urlopen(url + "/healthz", timeout=5)
                        _say(f"OMILO_READY {url}")
                        return
                    except Exception:  # noqa: BLE001 - not yet
                        pass
                if name := svc.died():
                    log.error("%s stopped unexpectedly", name)
                    _say(f"OMILO_ERROR {name} stopped unexpectedly; see {svc.logs / (name + '.log')}")
                    shutdown()
                    return
                time.sleep(0.2)

        def _guard():  # a service dying later takes the app down cleanly instead of half-working
            while not stop.wait(2):
                if name := svc.died():
                    log.error("%s stopped unexpectedly", name)
                    _say(f"OMILO_ERROR {name} stopped unexpectedly; see {svc.logs / (name + '.log')}")
                    shutdown()

        threading.Thread(target=_ready, daemon=True).start()
        threading.Thread(target=_guard, daemon=True).start()
        server.run()
        return 0
    except Exception as e:  # noqa: BLE001
        log.exception("could not start")
        _say(f"OMILO_ERROR {e}")
        return 1
    finally:
        svc.stop()


if __name__ == "__main__":
    sys.exit(main())
