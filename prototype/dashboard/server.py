#!/usr/bin/env python3
"""Company OS dashboard: monitor loops, runs, accounts, KPIs; approve proposals. Python stdlib only.

  COS_DASHBOARD_TOKEN=... python3 dashboard/server.py [--host 127.0.0.1] [--port 8787]

Auth: browser logs in with the token (cookie). Scripts/Hermes send `Authorization: Bearer <token>`.
Keep it on 127.0.0.1 and reach it through Tailscale / SSH tunnel / Traefik with TLS.
"""
import argparse
import datetime as dt
import hmac
import json
import os
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "lib"))
import cos_core as C  # noqa: E402
import chat as CHAT  # noqa: E402

TOKEN = os.environ.get("COS_DASHBOARD_TOKEN", "")
COOKIE = "cos_session"
COS_BIN = HERE.parent / "bin" / "cos"


def _day(iso):
    return (iso or "")[:10]


def overview():
    loops = C.list_loops()
    runs = C.list_runs(limit=2000, since_days=14)
    nxt = C.next_runs()
    today = dt.date.today()
    days = [(today - dt.timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    daily = {d: {"date": d, "ok": 0, "problems": 0, "skipped": 0, "cost": 0.0} for d in days}
    week_ago = (today - dt.timedelta(days=6)).isoformat()
    for r in runs:
        d = daily.get(_day(r.get("started_at")))
        if not d:
            continue
        if r["status"] == "success":
            d["ok"] += 1
        elif r["status"] in ("failed", "timeout", "rate_limited"):
            d["problems"] += 1
        elif r["status"] == "skipped":
            d["skipped"] += 1
        d["cost"] += r.get("cost_usd") or 0
    out_loops = []
    for l in loops:
        lr = [r for r in runs if r["loop"] == l["id"]]
        wk = [r for r in lr if _day(r.get("started_at")) >= week_ago and r["status"] != "skipped"]
        ok = sum(1 for r in wk if r["status"] == "success")
        last = lr[0] if lr else None
        out_loops.append({
            "id": l["id"], "name": l["name"], "function": l["function"], "description": l["description"],
            "schedule": l["schedule"], "harness": l.get("harness", "claude-code"), "enabled": l.get("enabled", True),
            "last": last and {k: last.get(k) for k in ("id", "status", "started_at", "headline", "error", "duration_s", "account")},
            "next": nxt.get(l["id"], {}).get("next"),
            "history": [{"id": r["id"], "status": r["status"], "at": r.get("started_at")} for r in lr[:14]][::-1],
            "runs_7d": len(wk), "success_7d": ok,
            "cost_7d": round(sum((r.get("cost_usd") or 0) for r in wk), 2),
            "pending": len(C.list_approvals(status="pending", loop_id=l["id"])),
        })
    harnesses = sorted({l["harness"] for l in out_loops})
    accounts = [a for h in harnesses for a in C.list_accounts(h)]
    day_list = [daily[d] for d in days]
    for d in day_list:
        d["cost"] = round(d["cost"], 2)
    last24 = [r for r in runs if (C.parse_iso(r.get("started_at", "")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc))
              > dt.datetime.now().astimezone() - dt.timedelta(hours=24)]
    return {
        "now": C.now_iso(), "paused": C.is_paused(),
        "pending": len(C.list_approvals(status="pending")),
        "running": sum(1 for r in runs if r["status"] == "running"),
        "runs_24h": len([r for r in last24 if r["status"] != "skipped"]),
        "problems_24h": len([r for r in last24 if r["status"] in ("failed", "timeout", "rate_limited")]),
        "cost_7d": round(sum(d["cost"] for d in day_list[-7:]), 2),
        "api_cost_today": C.today_api_cost(),
        "api_cap": C.settings()["daily_api_cost_cap_usd"],
        "kpis": C.read_json(C.STATE / "kpis.json"), "goals": C.read_json(C.STATE / "goals.json"),
        "loops": out_loops, "accounts": accounts, "daily": day_list,
    }


def run_detail(run_id):
    if "/" in run_id or ".." in run_id:
        return None
    r = C.load_run(run_id)
    if not r:
        return None
    rd = C.run_dir(run_id)
    rep = rd / "report.md"
    err = rd / "stderr.log"
    r["report"] = rep.read_text(errors="replace") if rep.exists() else None
    r["stderr_tail"] = "\n".join(err.read_text(errors="replace").splitlines()[-40:]) if err.exists() else ""
    r["proposal_items"] = [C.get_approval(a) for a in r.get("proposals", []) if C.get_approval(a)]
    return r


class H(BaseHTTPRequestHandler):
    server_version = "CompanyOS/1"

    def log_message(self, fmt, *args):
        if os.environ.get("COS_DASHBOARD_LOG"):
            super().log_message(fmt, *args)

    # ---- helpers
    def _authed(self):
        if not TOKEN:
            return True
        auth = self.headers.get("Authorization", "")
        if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], TOKEN):
            return True
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE and hmac.compare_digest(v, TOKEN):
                return True
        return False

    def _send(self, code, body, ctype="application/json", headers=None):
        data = body if isinstance(body, bytes) else (json.dumps(body, ensure_ascii=False).encode() if ctype == "application/json" else body.encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if "json" in ctype or "html" in ctype else ""))
        self.send_header("Content-Length", str(len(data)))
        if "Cache-Control" not in (headers or {}):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(min(n, 1_000_000)) if n else b""
        ctype = self.headers.get("Content-Type", "")
        if "application/json" in ctype:
            return json.loads(raw or b"{}")
        return {k: v[0] for k, v in parse_qs(raw.decode()).items()}

    # ---- routes
    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/login":
            return self._send(200, (HERE / "login.html").read_text(), "text/html")
        if u.path.startswith("/fonts/"):
            name = u.path.split("/")[-1]
            f = HERE / "fonts" / name
            if name.endswith(".woff2") and "/" not in name and f.is_file():
                return self._send(200, f.read_bytes(), "font/woff2", {"Cache-Control": "public, max-age=31536000"})
            return self._send(404, {"error": "not found"})
        if u.path == "/healthz":
            return self._send(200, {"ok": True})
        if not self._authed():
            if u.path.startswith("/api/"):
                return self._send(401, {"error": "unauthorized"})
            return self._send(302, b"", headers={"Location": "/login"})
        if u.path in ("/", "/index.html"):
            return self._send(200, (HERE / "index.html").read_text(), "text/html")
        if u.path == "/api/overview":
            return self._send(200, overview())
        if u.path == "/api/runs":
            runs = C.list_runs(loop_id=q.get("loop") or None, limit=int(q.get("limit", 100)))
            if q.get("status"):
                runs = [r for r in runs if r["status"] == q["status"]]
            return self._send(200, runs)
        if u.path.startswith("/api/runs/"):
            r = run_detail(u.path.split("/")[-1])
            return self._send(200, r) if r else self._send(404, {"error": "not found"})
        if u.path == "/api/approvals":
            st = q.get("status", "pending")
            return self._send(200, C.list_approvals(status=None if st == "all" else st, limit=int(q.get("limit", 200))))
        if u.path == "/api/chat":
            try:
                t = CHAT.get_thread(q.get("scope", "master"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, CHAT.public(t))
        if u.path == "/api/chat/threads":
            return self._send(200, CHAT.list_threads())
        if u.path == "/api/digest":
            out = subprocess.run([sys.executable, str(COS_BIN), "digest", "--hours", q.get("hours", "24")],
                                 capture_output=True, text=True, timeout=30)
            return self._send(200, {"text": out.stdout})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/login":
            b = self._body()
            if TOKEN and hmac.compare_digest(b.get("token", ""), TOKEN):
                secure = "; Secure" if os.environ.get("COS_COOKIE_SECURE") == "1" else ""
                return self._send(303, b"", headers={"Location": "/", "Set-Cookie": f"{COOKIE}={TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000{secure}"})
            return self._send(303, b"", headers={"Location": "/login?e=1"})
        if u.path == "/logout":
            return self._send(303, b"", headers={"Location": "/login", "Set-Cookie": f"{COOKIE}=; Max-Age=0; Path=/"})
        if not self._authed():
            return self._send(401, {"error": "unauthorized"})
        # CSRF guard for browser calls: require a custom header (cannot be sent cross-site without CORS)
        if not self.headers.get("Authorization") and self.headers.get("X-COS") != "1":
            return self._send(403, {"error": "missing X-COS header"})
        try:
            b = self._body()
        except Exception:
            return self._send(400, {"error": "bad body"})
        parts = u.path.strip("/").split("/")
        try:
            if parts[:2] == ["api", "approvals"] and len(parts) == 3:
                dec = {"approve": "approved", "approved": "approved", "reject": "rejected", "rejected": "rejected"}.get(b.get("decision"))
                if not dec:
                    return self._send(400, {"error": "decision must be approve|reject"})
                if dec == "rejected" and not (b.get("note") or "").strip():
                    return self._send(400, {"error": "a note is required when rejecting (the retro loop learns from it)"})
                return self._send(200, C.decide_approval(parts[2], dec, b.get("note", ""), by=b.get("by", "founder")))
            if parts[:2] == ["api", "loops"] and len(parts) == 4 and C.get_loop(parts[2]):
                if parts[3] == "run":
                    subprocess.Popen([sys.executable, str(COS_BIN), "run", parts[2], "--trigger", b.get("trigger", "dashboard")],
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True, env=os.environ.copy())
                    return self._send(202, {"started": parts[2]})
                if parts[3] == "enabled":
                    C.set_loop_enabled(parts[2], bool(b.get("enabled")))
                    return self._send(200, {"id": parts[2], "enabled": bool(b.get("enabled"))})
            if parts == ["api", "chat"]:
                t = CHAT.send(b.get("scope", "master"), b.get("text", ""), by=b.get("by", "founder"))
                return self._send(202, CHAT.public(t))
            if parts == ["api", "chat", "reset"]:
                return self._send(200, CHAT.public(CHAT.reset_thread(b.get("scope", "master"))))
            if parts == ["api", "system"]:
                C.set_paused(bool(b.get("paused")))
                return self._send(200, {"paused": C.is_paused()})
        except KeyError:
            return self._send(404, {"error": "not found"})
        except ValueError as e:
            return self._send(409, {"error": str(e)})
        return self._send(404, {"error": "not found"})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--host", default=os.environ.get("COS_DASHBOARD_HOST", "127.0.0.1"))
    p.add_argument("--port", type=int, default=int(os.environ.get("COS_DASHBOARD_PORT", "8787")))
    a = p.parse_args()
    if not TOKEN and a.host not in ("127.0.0.1", "localhost"):
        sys.exit("Refusing to listen on a public interface without COS_DASHBOARD_TOKEN.")
    print(f"Company OS dashboard on http://{a.host}:{a.port}  (root: {C.ROOT})")
    ThreadingHTTPServer((a.host, a.port), H).serve_forever()


if __name__ == "__main__":
    main()
