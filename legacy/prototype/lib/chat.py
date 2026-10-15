"""Chat threads for the dashboard: one master thread + one thread per run and per proposal.

A "brain" answers each message:
  - claude-code (default): `claude -p` in chat/ with the `cos` CLI as its tool, session resumed per thread,
    using the same account pool as the loops.
  - openai: any OpenAI-compatible chat endpoint, e.g. Hermes' API server (Hermes then uses its own tools/skill).
Configure in config/settings.json -> "chat".
"""
import datetime as dt
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

import cos_core as C
from harness import RATE_LIMIT_RE, _last_json

THREADS = C.STATE / "threads"
THREADS.mkdir(parents=True, exist_ok=True)
(C.STATE / "chat-tmp").mkdir(parents=True, exist_ok=True)
CHAT_DIR = C.ROOT / "chat"
_lock = threading.Lock()
ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


def chat_cfg():
    c = dict(C.settings().get("chat") or {})
    c.setdefault("brain", "claude-code")
    c.setdefault("harness", "claude-code")
    c.setdefault("timeout_s", 300)
    c.setdefault("max_turns", 30)
    return c


# ---------- scopes ----------
def thread_id(scope):
    if scope == "master":
        return "master"
    kind, _, ref = scope.partition(":")
    if kind not in ("run", "approval") or not ID_RE.match(ref or ""):
        raise ValueError("scope must be master, run:<run_id> or approval:<id>")
    return f"{kind}--{ref}"


def _path(tid):
    if not ID_RE.match(tid):
        raise ValueError("bad thread id")
    return THREADS / f"{tid}.json"


def get_thread(scope, create=True):
    tid = thread_id(scope)
    t = C.read_json(_path(tid))
    if t and t.get("busy") and time.time() - t.get("busy_since", 0) > chat_cfg()["timeout_s"] + 120:
        t["busy"] = False  # worker died (server restart)
        t["messages"].append({"role": "note", "text": "The previous reply was interrupted.", "at": C.now_iso()})
        C.write_json(_path(tid), t)
    if not t and create:
        t = {"id": tid, "scope": scope, "created_at": C.now_iso(), "updated_at": C.now_iso(), "busy": False,
             "brain": chat_cfg()["brain"], "account": None, "session_id": None, "messages": []}
    return t


def list_threads():
    out = []
    for f in sorted(THREADS.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        t = C.read_json(f)
        if t:
            last = t["messages"][-1] if t["messages"] else None
            out.append({"id": t["id"], "scope": t["scope"], "updated_at": t["updated_at"], "busy": t["busy"],
                        "count": len(t["messages"]), "last": last and last["text"][:140]})
    return out


def reset_thread(scope):
    p = _path(thread_id(scope))
    t = C.read_json(p)
    if t and t.get("busy"):
        raise ValueError("busy: wait for the reply to finish")
    if p.exists():
        archive = THREADS / "archive"
        archive.mkdir(exist_ok=True)
        os.replace(p, archive / f"{p.stem}-{int(time.time())}.json")
    return get_thread(scope)


# ---------- context ----------
def _tail(path, n):
    try:
        return "\n".join(Path(path).read_text(errors="replace").splitlines()[-n:])
    except Exception:
        return ""


def context_block(scope):
    if scope == "master":
        loops = C.list_loops()
        lines = [f"System: {'PAUSED' if C.is_paused() else 'running'}. Now: {dt.datetime.now().astimezone():%a %d %b %Y %H:%M}."]
        for l in loops:
            r = next(iter(C.list_runs(loop_id=l["id"], limit=1)), None)
            lines.append(f"- loop {l['id']} ({'on' if l.get('enabled', True) else 'off'}): last "
                         + (f"{r['status']} {r['started_at'][:16]} — {r.get('headline') or r.get('error') or ''}" if r else "never ran"))
        pend = C.list_approvals(status="pending")
        lines.append(f"Pending approvals: {len(pend)}" + "".join(f"\n  - {a['id']} [{a['loop']}] {a['title']}" for a in pend[:10]))
        k = C.read_json(C.STATE / "kpis.json") or {}
        if k.get("updated_at"):
            lines.append("KPIs: " + json.dumps({x: k.get(x) for x in ("week", "mrr_idr", "paying_communities", "digital_share", "churn_monthly", "support_hours")}))
        return "The founder is on the main chat. Current state:\n" + "\n".join(lines)
    kind, _, ref = scope.partition(":")
    if kind == "run":
        r = C.load_run(ref) or {}
        rd = C.run_dir(ref)
        rep = (rd / "report.md").read_text(errors="replace")[:5000] if (rd / "report.md").exists() else "(no report)"
        meta = {k: r.get(k) for k in ("id", "loop", "status", "trigger", "started_at", "duration_s", "account", "num_turns",
                                      "cost_usd", "error", "proposals", "executed", "note")}
        return (f"The founder is looking at RUN {ref} of loop `{r.get('loop')}`.\n"
                f"Run folder: {rd}  (prompt.md = what the agent was told; loop prompt: loops/{r.get('loop')}/prompt.md)\n"
                f"Run record: {json.dumps(meta, ensure_ascii=False)}\n--- report.md ---\n{rep}\n"
                f"--- stderr (tail) ---\n{_tail(rd / 'stderr.log', 15) or '(empty)'}\n"
                f"To rerun it with changes: cos rerun {r.get('loop')} --note \"...\"")
    if kind == "approval":
        a = C.get_approval(ref) or {}
        src = C.load_run(a.get("run_id")) if a.get("run_id") else None
        return (f"The founder is looking at PROPOSAL {ref} (status: {a.get('status')}) from loop `{a.get('loop')}`.\n"
                f"Title: {a.get('title')} | type: {a.get('type')} | risk: {a.get('risk')} | revisions so far: {len(a.get('revisions') or [])}\n"
                + (f"Source run: {src['id']} — {src.get('headline')}\n" if src else "")
                + (f"Founder's decision note: {a['note']}\n" if a.get("note") else "")
                + f"--- current text ---\n{a.get('body', '')}\n--- end ---\n"
                + ("To change it: write the full new text to ../state/chat-tmp/<file>.md, then "
                   f"cos revise {ref} --body-file <file> --summary \"...\"" if a.get("status") == "pending"
                   else "It is no longer pending, so it can't be revised; suggest a new proposal or a rerun instead."))
    return ""


# ---------- brains ----------
def _chat_tools():
    root = str(C.ROOT)
    cos_cmds = ["status", "loops", "runs", "show", "approvals", "approval", "accounts", "digest", "rerun", "revise", "propose"]
    return (["Read", "Glob", "Grep", "WebSearch", "WebFetch", f"Write(/{root}/state/chat-tmp/**)", f"Edit(/{root}/state/chat-tmp/**)"]
            + [f"Bash(cos {c}:*)" for c in cos_cmds])


class ClaudeCodeBrain:
    def reply(self, t, message, transcript):
        cfg = chat_cfg()
        hname = cfg["harness"]
        hcfg = C.harness_cfg(hname) or {"type": "claude-code"}
        tried = []
        for _ in range(2):
            acct = None
            if t.get("account") and t["account"] not in tried:  # stick to the account that holds the session
                for a in C.list_accounts(hname):
                    if a["name"] == t["account"] and a["status"] == "available":
                        lock = C.FileLock(C.LOCKS / f"acct-{hname}-{a['name']}.lock")
                        if lock.acquire():
                            acct = (a["name"], a["path"], lock)
            if not acct:
                acct = C.acquire_account(hname, exclude=tried)
            if not acct:
                return {"text": "All accounts are busy or cooling down right now. Try again in a few minutes.", "error": "no account"}
            name, path, lock = acct
            tried.append(name)
            resume = t.get("session_id") if name == t.get("account") else None
            prompt = message if resume else (transcript + message)
            argv = [hcfg.get("bin", "claude"), "-p", "--output-format", "json", "--max-turns", str(cfg["max_turns"]),
                    "--add-dir", str(C.ROOT), "--allowedTools", ",".join(_chat_tools())]
            if cfg.get("model"):
                argv += ["--model", cfg["model"]]
            if resume:
                argv += ["--resume", resume]
            env = dict(os.environ, COS_ROOT=str(C.ROOT), COS_ACTOR="chat",
                       PATH=f"{C.ROOT / 'bin'}{os.pathsep}{os.environ.get('PATH', '')}")
            if path:
                env["CLAUDE_CONFIG_DIR"] = path
            if hcfg.get("billing", "subscription") == "subscription":
                env.pop("ANTHROPIC_API_KEY", None)
            try:
                C.update_account(hname, name, last_used=C.now_iso())
                p = subprocess.run(argv, input=prompt, cwd=CHAT_DIR, env=env, capture_output=True, text=True,
                                   timeout=cfg["timeout_s"])
                out, err, rc = p.stdout, p.stderr, p.returncode
            except subprocess.TimeoutExpired:
                return {"text": "That took too long and was stopped. Try a narrower question.", "error": "timeout"}
            except FileNotFoundError:
                return {"text": "Claude Code CLI not found on this machine (install it and log in).", "error": "no claude"}
            finally:
                lock.release()
            data = _last_json(out) or {}
            if (rc != 0 or data.get("is_error")) and RATE_LIMIT_RE.search(out + err):
                C.update_account(hname, name, rate_limits_inc=1, last_error="usage limit (chat)",
                                 cooldown_until=time.time() + int(hcfg.get("cooldown_min", 60)) * 60)
                continue
            if rc != 0 and not data:
                return {"text": f"Chat failed: {(err.strip().splitlines() or ['exit ' + str(rc)])[-1][:300]}", "error": "failed"}
            t["account"], t["session_id"] = name, data.get("session_id") or t.get("session_id")
            return {"text": data.get("result") or "(no answer)", "cost_usd": data.get("total_cost_usd"),
                    "error": "agent error" if data.get("is_error") else None}
        return {"text": "Every account I tried hit its usage limit. Try again later.", "error": "rate limited"}


class OpenAICompatBrain:
    """Hermes (or any OpenAI-compatible server). Set chat.brain = "openai", chat.base_url, chat.api_key_env, chat.model."""

    def reply(self, t, message, transcript):
        cfg = chat_cfg()
        sys_prompt = (CHAT_DIR / "CLAUDE.md").read_text() + f"\n\nCOS_ROOT on this server: {C.ROOT}"
        msgs = [{"role": "system", "content": sys_prompt}]
        for m in t["messages"][-20:-1]:
            if m["role"] in ("user", "assistant"):
                msgs.append({"role": m["role"], "content": m.get("sent") or m["text"]})
        msgs.append({"role": "user", "content": message})
        body = json.dumps({"model": cfg.get("model", "hermes"), "messages": msgs}).encode()
        req = urllib.request.Request(cfg["base_url"].rstrip("/") + "/chat/completions", data=body, method="POST",
                                     headers={"Content-Type": "application/json",
                                              "Authorization": f"Bearer {os.environ.get(cfg.get('api_key_env', 'HERMES_API_KEY'), '')}",
                                              "X-Conversation-Id": t["id"]})
        try:
            with urllib.request.urlopen(req, timeout=cfg["timeout_s"]) as r:
                data = json.loads(r.read())
            return {"text": data["choices"][0]["message"]["content"] or "(no answer)"}
        except Exception as e:
            return {"text": f"Could not reach the chat endpoint ({cfg.get('base_url')}): {e}", "error": "unreachable"}


def _brain():
    return OpenAICompatBrain() if chat_cfg()["brain"] == "openai" else ClaudeCodeBrain()


# ---------- send ----------
def send(scope, text, by="founder"):
    text = (text or "").strip()
    if not text:
        raise ValueError("empty message")
    with _lock:
        t = get_thread(scope)
        if t["busy"]:
            raise ValueError("busy: wait for the current reply")
        ctx = context_block(scope)
        sent = f"[context]\n{ctx}\n[/context]\n\n{text}"
        t["messages"].append({"role": "user", "text": text, "sent": sent, "at": C.now_iso(), "by": by})
        t.update(busy=True, busy_since=time.time(), updated_at=C.now_iso())
        C.write_json(_path(t["id"]), t)
    threading.Thread(target=_work, args=(scope, sent), daemon=True).start()
    return t


def _transcript(t):
    prev = [m for m in t["messages"][:-1] if m["role"] in ("user", "assistant")][-10:]
    if not prev:
        return ""
    return ("[earlier in this conversation]\n" + "\n".join(f"{m['role']}: {m['text'][:1500]}" for m in prev)
            + "\n[/earlier]\n\n")


def _work(scope, sent):
    t = get_thread(scope)
    try:
        res = _brain().reply(t, sent, _transcript(t))
    except Exception as e:
        res = {"text": f"Chat error: {type(e).__name__}: {e}", "error": "exception"}
    with _lock:
        cur = get_thread(scope)
        cur.update(account=t.get("account"), session_id=t.get("session_id"), busy=False, updated_at=C.now_iso())
        cur["messages"].append({"role": "assistant", "text": res["text"], "at": C.now_iso(),
                                "cost_usd": res.get("cost_usd"), "error": res.get("error")})
        C.write_json(_path(cur["id"]), cur)


def public(t):
    """Thread without internal fields, for the API."""
    return {k: (v if k != "messages" else [{x: m.get(x) for x in ("role", "text", "at", "error", "cost_usd")} for m in v])
            for k, v in t.items() if k not in ("session_id",)}
