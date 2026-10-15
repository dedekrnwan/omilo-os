"""Company OS core: paths, settings, loops, runs, approvals, accounts. Python stdlib only."""
import datetime as dt
import fcntl
import json
import os
import re
import secrets
import subprocess
import time
from pathlib import Path

ROOT = Path(os.environ.get("COS_ROOT", Path(__file__).resolve().parent.parent))
STATE = ROOT / "state"
RUNS = STATE / "runs"
APPROVALS = STATE / "approvals"
LOCKS = STATE / "locks"
CONFIG = ROOT / "config" / "settings.json"

for _d in (RUNS, APPROVALS, LOCKS):
    _d.mkdir(parents=True, exist_ok=True)


# ---------- small helpers ----------
def now_iso():
    return dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")


def parse_iso(s):
    try:
        return dt.datetime.fromisoformat(s)
    except Exception:
        return None


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)


class FileLock:
    """Non-blocking exclusive lock. `with FileLock(p) as ok:` -> ok False if held elsewhere."""

    def __init__(self, path):
        self.path = Path(path)
        self.fd = None

    def acquire(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self.fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            os.close(self.fd)
            self.fd = None
            return False

    def release(self):
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            self.fd = None

    def held_elsewhere(self):
        if self.acquire():
            self.release()
            return False
        return True

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *a):
        self.release()


# ---------- settings ----------
def settings():
    s = read_json(CONFIG, {}) or {}
    s.setdefault("timezone", "Asia/Jakarta")
    s.setdefault("daily_api_cost_cap_usd", 25)
    s.setdefault("max_parallel_runs", 4)
    s.setdefault("harnesses", {})
    return s


def workspace_dir():
    return Path(os.environ.get("WORKSPACE_DIR") or settings().get("workspace_dir") or ROOT.parent)


def is_paused():
    return (STATE / "PAUSED").exists()


def set_paused(paused: bool):
    p = STATE / "PAUSED"
    if paused:
        p.write_text(now_iso() + "\n")
    elif p.exists():
        p.unlink()


# ---------- loops ----------
def _overrides():
    return read_json(STATE / "overrides.json", {}) or {}


def list_loops():
    out = []
    ov = _overrides()
    for f in sorted((ROOT / "loops").glob("*/loop.json")):
        d = read_json(f)
        if not d:
            continue
        d["prompt_path"] = str(f.parent / "prompt.md")
        if d["id"] in ov and "enabled" in ov[d["id"]]:
            d["enabled"] = ov[d["id"]]["enabled"]
        out.append(d)
    return out


def get_loop(loop_id):
    for l in list_loops():
        if l["id"] == loop_id:
            return l
    return None


def set_loop_enabled(loop_id, enabled: bool):
    ov = _overrides()
    ov.setdefault(loop_id, {})["enabled"] = bool(enabled)
    write_json(STATE / "overrides.json", ov)


def loop_workdir(loop):
    w = loop.get("workdir") or "company-os"
    if w in ("company-os", "@root"):
        return ROOT
    return (workspace_dir() / w).resolve()


# ---------- runs ----------
def new_run_id(loop_id):
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + loop_id


def run_dir(run_id):
    return RUNS / run_id


def load_run(run_id):
    r = read_json(run_dir(run_id) / "run.json")
    if r and r.get("status") == "running" and r.get("pid"):
        if not _pid_alive(r["pid"]):
            r["status"] = "failed"
            r["error"] = "runner died (aborted)"
            r["ended_at"] = r.get("ended_at") or now_iso()
            write_json(run_dir(run_id) / "run.json", r)
    return r


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def list_runs(loop_id=None, limit=200, since_days=None):
    dirs = sorted(RUNS.iterdir(), reverse=True) if RUNS.exists() else []
    out = []
    cutoff = None
    if since_days is not None:
        cutoff = dt.datetime.now().astimezone() - dt.timedelta(days=since_days)
    for d in dirs:
        if loop_id and not d.name.endswith("-" + loop_id):
            continue
        r = load_run(d.name)
        if not r:
            continue
        if cutoff:
            t = parse_iso(r.get("started_at", ""))
            if t and t < cutoff:
                break
        out.append(r)
        if len(out) >= limit:
            break
    return out


def running_count():
    return sum(1 for r in list_runs(limit=50, since_days=1) if r.get("status") == "running")


def today_api_cost():
    today = dt.date.today().isoformat()
    total = 0.0
    for r in list_runs(limit=500, since_days=1):
        if r.get("billing") == "api" and (r.get("started_at") or "").startswith(today):
            total += r.get("cost_usd") or 0
    return round(total, 4)


# ---------- approvals ----------
FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.S)


def parse_proposal(text):
    meta, body = {}, text
    m = FRONT.match(text)
    if m:
        body = m.group(2)
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip().lower()] = v.strip()
    return meta, body.strip()


def create_approval(loop_id, run_id, slug, text, by="agent"):
    meta, body = parse_proposal(text)
    aid = dt.datetime.now().strftime("%y%m%d") + "-" + secrets.token_hex(3)
    a = {
        "id": aid,
        "loop": loop_id,
        "run_id": run_id,
        "slug": slug,
        "title": meta.get("title") or slug.replace("-", " "),
        "type": meta.get("type", "other"),
        "risk": meta.get("risk", "medium"),
        "body": body,
        "status": "pending",
        "created_at": now_iso(),
        "decided_at": None,
        "decided_by": None,
        "note": "",
        "executed_at": None,
        "executed_run": None,
        "created_by": by,
        "revisions": [],
    }
    write_json(APPROVALS / f"{aid}.json", a)
    return a


def list_approvals(status=None, loop_id=None, limit=500):
    out = []
    for f in sorted(APPROVALS.glob("*.json"), reverse=True):
        a = read_json(f)
        if not a:
            continue
        if status and a["status"] != status:
            continue
        if loop_id and a["loop"] != loop_id:
            continue
        out.append(a)
        if len(out) >= limit:
            break
    return out


def get_approval(aid):
    if not re.fullmatch(r"[0-9a-f-]+", aid or ""):
        return None
    return read_json(APPROVALS / f"{aid}.json")


def decide_approval(aid, decision, note="", by="founder"):
    a = get_approval(aid)
    if not a:
        raise KeyError(aid)
    if a["status"] != "pending":
        raise ValueError(f"already {a['status']}")
    if decision not in ("approved", "rejected"):
        raise ValueError("decision must be approved or rejected")
    a.update(status=decision, decided_at=now_iso(), decided_by=by, note=note or "")
    write_json(APPROVALS / f"{aid}.json", a)
    return a


def mark_executed(aid, run_id):
    a = get_approval(aid)
    if a and a["status"] == "approved":
        a.update(status="executed", executed_at=now_iso(), executed_run=run_id)
        write_json(APPROVALS / f"{aid}.json", a)


# ---------- accounts (subscription pools) ----------
ACCOUNTS_STATE = STATE / "accounts.json"


def harness_cfg(name):
    return settings()["harnesses"].get(name) or {}


def pool_dir(harness_name):
    cfg = harness_cfg(harness_name)
    d = cfg.get("accounts_dir")
    if not d:
        return None
    p = Path(d)
    return p if p.is_absolute() else ROOT / p


def list_accounts(harness_name):
    """Each sub-folder of accounts_dir is one logged-in account (its own CLAUDE_CONFIG_DIR / HOME)."""
    d = pool_dir(harness_name)
    st = read_json(ACCOUNTS_STATE, {}) or {}
    names = sorted(p.name for p in d.iterdir() if p.is_dir() and not p.name.startswith(".")) if d and d.exists() else []
    if not names:
        names = ["default"]
    now = time.time()
    out = []
    for n in names:
        key = f"{harness_name}/{n}"
        s = st.get(key, {})
        lock = FileLock(LOCKS / f"acct-{harness_name}-{n}.lock")
        in_use = lock.held_elsewhere()
        cd = s.get("cooldown_until") or 0
        status = "in_use" if in_use else ("cooldown" if cd > now else "available")
        if s.get("disabled"):
            status = "disabled"
        out.append({
            "harness": harness_name, "name": n, "status": status,
            "path": str(d / n) if d and n != "default" else None,
            "cooldown_until": dt.datetime.fromtimestamp(cd).astimezone().isoformat(timespec="seconds") if cd > now else None,
            "last_used": s.get("last_used"), "runs": s.get("runs", 0),
            "failures": s.get("failures", 0), "rate_limits": s.get("rate_limits", 0),
            "last_error": s.get("last_error"),
        })
    return out


def update_account(harness_name, name, **changes):
    fd = os.open(LOCKS / "accounts-state.lock", os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)  # blocking: serialize read-modify-write
        st = read_json(ACCOUNTS_STATE, {}) or {}
        s = st.setdefault(f"{harness_name}/{name}", {})
        for k, v in changes.items():
            if k.endswith("_inc"):
                s[k[:-4]] = s.get(k[:-4], 0) + v
            else:
                s[k] = v
        write_json(ACCOUNTS_STATE, st)
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def acquire_account(harness_name, exclude=()):
    """Pick the least-recently-used available account and lock it. Returns (name, path, lock) or None."""
    cands = [a for a in list_accounts(harness_name) if a["status"] == "available" and a["name"] not in exclude]
    cands.sort(key=lambda a: a["last_used"] or "")
    for a in cands:
        lock = FileLock(LOCKS / f"acct-{harness_name}-{a['name']}.lock")
        if lock.acquire():
            return a["name"], a["path"], lock
    return None


# ---------- schedule info (systemd) ----------
_next_cache = {"t": 0, "data": {}}


def next_runs():
    if time.time() - _next_cache["t"] < 60:
        return _next_cache["data"]
    data = {}
    for l in list_loops():
        unit = f"cos-loop-{l['id']}.timer"
        try:
            out = subprocess.run(["systemctl", "show", unit, "-p", "NextElapseUSecRealtime", "-p", "ActiveState"],
                                 capture_output=True, text=True, timeout=3).stdout
            props = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
            nxt = props.get("NextElapseUSecRealtime") or ""
            data[l["id"]] = {"next": nxt if nxt and nxt != "n/a" else None, "timer": props.get("ActiveState")}
        except Exception:
            data[l["id"]] = {"next": None, "timer": None}
    _next_cache.update(t=time.time(), data=data)
    return data


def revise_approval(aid, new_body, summary="", by="chat"):
    """Replace a pending proposal's body, keeping the previous version in `revisions`."""
    a = get_approval(aid)
    if not a:
        raise KeyError(aid)
    if a["status"] != "pending":
        raise ValueError(f"only pending proposals can be revised (this one is {a['status']})")
    meta, body = parse_proposal(new_body)
    a.setdefault("revisions", []).append({"at": now_iso(), "by": by, "summary": summary, "previous_body": a["body"],
                                          "previous_title": a["title"]})
    a["body"] = body
    for k in ("title", "type", "risk"):
        if meta.get(k):
            a[k] = meta[k]
    write_json(APPROVALS / f"{aid}.json", a)
    return a
