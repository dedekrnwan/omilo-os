"""The talent library: specialists from The Agency (github.com/msitarzewski/agency-agents, MIT License).

Omilo keeps a local copy of the roster in <data_dir>/talent/agency-agents, indexes every specialist
(division, name, description, emoji, vibe) and lets the owner hire one as a helper. The specialist's
personality and process become the helper's job; Omilo's own rules (approvals, tools) stay on top.

Sources, in order: OMILO_TALENT_SOURCE (a local checkout), `git clone`, then the GitHub tarball.
"""
from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import tarfile
import threading
import time
from pathlib import Path

import httpx
import yaml

from .config import get_settings

REPO = "msitarzewski/agency-agents"
REPO_URL = f"https://github.com/{REPO}"
TARBALLS = [f"https://codeload.github.com/{REPO}/tar.gz/refs/heads/main", f"https://api.github.com/repos/{REPO}/tarball/main"]
MAX_FILE = 200_000
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")

# What a new hire from each division may do without asking (on top of the safe defaults; strict mode still applies).
DIVISION_PERMISSIONS: dict[str, dict] = {
    "marketing": {"content.draft": 2, "outreach.draft": 2},
    "paid-media": {"content.draft": 2},
    "sales": {"outreach.draft": 2},
    "support": {"content.draft": 2},
    "design": {"content.draft": 2},
    "product": {"content.draft": 2},
    "project-management": {"content.draft": 2},
    "engineering": {"code.pr": 2},
    "testing": {"code.pr": 2},
    "security": {"code.pr": 2},
    "game-development": {"code.pr": 2},
    "spatial-computing": {"code.pr": 2},
}


def root() -> Path:
    d = get_settings().data_dir / "talent"
    d.mkdir(parents=True, exist_ok=True)
    return d


def repo_dir() -> Path:
    return root() / "agency-agents"


def index_path() -> Path:
    return root() / "index.json"


# ------------------------------------------------------------------ sync
class _Sync:
    def __init__(self):
        self.state, self.message, self.at = "idle", "", 0.0
        self._lock = threading.Lock()

    def snapshot(self) -> dict:
        return {"state": self.state, "message": self.message}

    def start(self) -> dict:
        with self._lock:
            if self.state == "running":
                return self.snapshot()
            self.state, self.message = "running", "Downloading The Agency roster…"
        threading.Thread(target=self._run, daemon=True).start()
        return self.snapshot()

    def run_now(self) -> dict:
        self.state = "running"
        self._run()
        return self.snapshot()

    def _run(self):
        try:
            fetch()
            n = len(build_index())
            self.state, self.message, self.at = "done", f"{n} specialists ready", time.time()
        except Exception as e:  # noqa: BLE001 - shown to the owner
            self.state, self.message = "failed", str(e)


syncer = _Sync()


def fetch() -> None:
    """Refresh the local copy of the roster."""
    dest = repo_dir()
    src = os.environ.get("OMILO_TALENT_SOURCE")
    if src:
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, ignore=shutil.ignore_patterns(".git", "integrations", "node_modules"))
        return
    git = shutil.which("git")
    if git:
        try:
            if (dest / ".git").exists():
                subprocess.run([git, "-C", str(dest), "pull", "--ff-only", "-q"], check=True, capture_output=True, timeout=180)
            else:
                if dest.exists():
                    shutil.rmtree(dest)
                subprocess.run([git, "clone", "-q", "--depth", "1", REPO_URL + ".git", str(dest)], check=True, capture_output=True, timeout=300)
            return
        except (subprocess.SubprocessError, OSError):
            pass  # fall back to the tarball
    last = None
    for url in TARBALLS:
        try:
            r = httpx.get(url, follow_redirects=True, timeout=120, headers={"User-Agent": "omilo"})
            r.raise_for_status()
            _extract(r.content, dest)
            return
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"Could not download The Agency roster from GitHub: {last}")


def _extract(data: bytes, dest: Path) -> None:
    """Extract only .md/.json/LICENSE files, never outside dest."""
    tmp = dest.with_name(dest.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar.getmembers():
            if not m.isfile() or m.size > MAX_FILE:
                continue
            parts = Path(m.name).parts[1:]  # drop the "<repo>-<sha>/" prefix
            if not parts or any(p in ("..", "") or p.startswith("/") for p in parts):
                continue
            rel = Path(*parts)
            if rel.suffix not in (".md", ".json") and rel.name != "LICENSE":
                continue
            out = (tmp / rel).resolve()
            if not str(out).startswith(str(tmp.resolve())):
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            f = tar.extractfile(m)
            if f:
                out.write_bytes(f.read())
    if dest.exists():
        shutil.rmtree(dest)
    tmp.rename(dest)


# ------------------------------------------------------------------ index
def _frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    try:
        _, fm, body = text.split("---", 2)
    except ValueError:
        return {}, text
    try:
        meta = yaml.safe_load(fm) or {}
    except yaml.YAMLError:
        meta = dict(re.findall(r"^(\w[\w-]*):\s*(.*)$", fm, re.M))
    return (meta if isinstance(meta, dict) else {}), body.strip()


def divisions() -> dict[str, dict]:
    f = repo_dir() / "divisions.json"
    if not f.exists():
        return {}
    return json.loads(f.read_text()).get("divisions", {})


def build_index() -> list[dict]:
    out: list[dict] = []
    base = repo_dir()
    for div in divisions():
        d = base / div
        if not d.is_dir():
            continue
        for f in sorted(d.rglob("*.md")):
            if f.stat().st_size > MAX_FILE:
                continue
            meta, body = _frontmatter(f.read_text(errors="replace"))
            if not meta.get("name") or not body:
                continue
            slug = f.stem.lower()
            if not SLUG.match(slug):
                continue
            out.append({"slug": slug, "division": div, "name": str(meta["name"]), "description": str(meta.get("description", "")),
                        "emoji": str(meta.get("emoji", "")), "color": str(meta.get("color", "")), "vibe": str(meta.get("vibe", "")),
                        "path": str(f.relative_to(base)), "words": len(body.split())})
    index_path().write_text(json.dumps({"synced_at": time.time(), "agents": out}))
    return out


def index() -> dict:
    p = index_path()
    if not p.exists():
        return {"synced_at": None, "agents": []}
    return json.loads(p.read_text())


def get(slug: str) -> dict | None:
    for a in index()["agents"]:
        if a["slug"] == slug:
            meta, body = _frontmatter((repo_dir() / a["path"]).read_text(errors="replace"))
            return {**a, "body": body}
    return None


def search(q: str = "", division: str = "", limit: int = 500) -> list[dict]:
    words = [w for w in q.lower().split() if w]
    res = []
    for a in index()["agents"]:
        if division and a["division"] != division:
            continue
        hay = f"{a['name']} {a['description']} {a['vibe']} {a['division']}".lower()
        if all(w in hay for w in words):
            score = sum(3 if w in a["name"].lower() else 1 for w in words)
            res.append((score, a))
    res.sort(key=lambda x: (-x[0], x[1]["name"]))
    return [a for _, a in res[:limit]]


def job_for(a: dict) -> str:
    """The helper's job: who they are (from The Agency) plus their full playbook."""
    head = f"You are {a['name']}, a specialist hired from The Agency. {a.get('description', '')}".strip()
    if a.get("vibe"):
        head += f"\nYour vibe: {a['vibe']}"
    return (head + "\n\nWork for this company using the playbook below. Where it says to ship, deploy, publish, send or spend, "
            "prepare the work and ask for approval through Omilo instead.\n\n" + a["body"]).strip()
