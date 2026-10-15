"""Runs one loop once: compose prompt -> pick harness + account -> execute -> record -> collect proposals -> notify."""
import datetime as dt
import json
import os
import re
import urllib.request

import cos_core as C
from harness import get_harness


def _compose_prompt(loop, run_id, rdir, workdir, to_execute, note=None):
    constitution = (C.ROOT / "CLAUDE.md").read_text()
    loop_prompt = open(loop["prompt_path"]).read()
    tz_now = dt.datetime.now().astimezone()
    parts = [
        constitution,
        "\n---\n# Run context",
        f"- RUN_ID: {run_id}",
        f"- RUN_DIR: {rdir}  (write report.md and proposals/ here)",
        f"- COS_ROOT (company-os repo): {C.ROOT}",
        f"- WORKSPACE_DIR (all repos): {C.workspace_dir()}",
        f"- Working directory: {workdir}",
        f"- Now: {tz_now.strftime('%A %d %B %Y, %H:%M')} (server local time; company timezone {C.settings()['timezone']})",
        "\n---\n" + loop_prompt,
    ]
    recent = [r for r in C.list_runs(loop_id=loop["id"], limit=4) if r.get("status") != "running"][:3]
    if recent:
        parts.append("\n---\n# Your last runs (headlines)")
        for r in recent:
            parts.append(f"- {r.get('started_at', '')[:16]} [{r.get('status')}] {r.get('headline') or r.get('error') or ''}")
    if note:
        parts.append("\n---\n# Founder instructions for THIS run (follow these; they override the loop prompt where they conflict, never the hard rules)")
        parts.append(note)
    if to_execute:
        parts.append("\n---\n# Approved proposals to EXECUTE in this run")
        parts.append("Execute exactly these, then list their ids (one per line) in $RUN_DIR/executed.txt.")
        for a in to_execute:
            parts.append(f"\n## id: {a['id']} | {a['title']} ({a['type']})")
            if a.get("note"):
                parts.append(f"Founder note: {a['note']}")
            parts.append(a["body"])
    return "\n".join(parts) + "\n"


def _notify(event):
    url = os.environ.get("COS_NOTIFY_WEBHOOK")
    if not url:
        return
    try:
        req = urllib.request.Request(url, data=json.dumps(event).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:  # never fail a run because a notification failed
        print(f"notify failed: {e}")


def _headline(report_text):
    for line in report_text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()[:200]
    return None


def run_loop(loop_id, trigger="schedule", note=None):
    loop = C.get_loop(loop_id)
    if not loop:
        raise SystemExit(f"unknown loop: {loop_id}")
    run_id = C.new_run_id(loop_id)
    rdir = C.run_dir(run_id)
    rec = {"id": run_id, "loop": loop_id, "trigger": trigger, "harness": loop.get("harness", "claude-code"),
           "account": None, "billing": None, "status": "running", "started_at": C.now_iso(), "ended_at": None,
           "duration_s": None, "cost_usd": None, "num_turns": None, "session_id": None, "headline": None,
           "proposals": [], "executed": [], "error": None, "pid": os.getpid(), "attempts": 0, "note": note}

    def skip(reason):
        rdir.mkdir(parents=True, exist_ok=True)
        rec.update(status="skipped", error=reason, ended_at=C.now_iso(), duration_s=0)
        C.write_json(rdir / "run.json", rec)
        print(f"[{loop_id}] skipped: {reason}")
        return rec

    if trigger == "schedule" and C.is_paused():
        return skip("system paused")
    if trigger == "schedule" and not loop.get("enabled", True):
        return skip("loop disabled")

    loop_lock = C.FileLock(C.LOCKS / f"loop-{loop_id}.lock")
    if not loop_lock.acquire():
        return skip("previous run still in progress")
    try:
        if C.running_count() >= C.settings()["max_parallel_runs"]:
            return skip("max parallel runs reached")
        hname = rec["harness"]
        hcfg = C.harness_cfg(hname) or ({"type": "claude-code"} if hname == "claude-code" else None)
        if hcfg is None:
            return skip(f"harness '{hname}' not configured")
        harness = get_harness(hname, hcfg)
        rec["billing"] = harness.billing
        if harness.billing == "api" and C.today_api_cost() >= C.settings()["daily_api_cost_cap_usd"]:
            return skip("daily API cost cap reached")

        rdir.mkdir(parents=True, exist_ok=True)
        (rdir / "proposals").mkdir(exist_ok=True)
        C.write_json(rdir / "run.json", rec)

        workdir = C.loop_workdir(loop)
        to_execute = C.list_approvals(status="approved", loop_id=loop_id)
        prompt = _compose_prompt(loop, run_id, rdir, workdir, to_execute, note)
        (rdir / "prompt.md").write_text(prompt)

        env = dict(os.environ, RUN_ID=run_id, RUN_DIR=str(rdir), LOOP_ID=loop_id, COS_ROOT=str(C.ROOT),
                   WORKSPACE_DIR=str(C.workspace_dir()))
        timeout_s = int(loop.get("timeout_min", 30)) * 60
        tried, res = [], None
        for attempt in range(int(hcfg.get("max_account_attempts", 2))):
            acct = C.acquire_account(hname, exclude=tried)
            if not acct:
                if res is None:
                    rec.update(status="skipped", error="no account available (all in use or cooling down)")
                break
            name, path, alock = acct
            tried.append(name)
            rec.update(account=name, attempts=attempt + 1)
            C.write_json(rdir / "run.json", rec)
            try:
                C.update_account(hname, name, last_used=C.now_iso(), runs_inc=1)
                if not workdir.is_dir():
                    raise FileNotFoundError(f"workdir not found: {workdir} (set WORKSPACE_DIR or loop.workdir)")
                res = harness.run(prompt=prompt, loop=loop, run_dir=rdir, workdir=workdir,
                                  extra_dirs=[C.ROOT] if workdir != C.ROOT else [],
                                  account_path=path, env=env, timeout_s=timeout_s)
            except Exception as e:  # harness crashed before/while starting the agent
                from harness import HarnessResult
                res = HarnessResult(status="failed", error=f"{type(e).__name__}: {e}"[:500])
            finally:
                alock.release()
            if res.status == "rate_limited":
                cd = int(hcfg.get("cooldown_min", 60)) * 60
                C.update_account(hname, name, rate_limits_inc=1, last_error=res.error,
                                 cooldown_until=dt.datetime.now().timestamp() + cd)
                continue  # try the next account
            if res.status != "success":
                C.update_account(hname, name, failures_inc=1, last_error=res.error)
            break

        if res is not None:
            rec.update(status=res.status, error=res.error, cost_usd=res.cost_usd, num_turns=res.num_turns,
                       session_id=res.session_id)
            report = rdir / "report.md"
            if report.exists():
                rec["headline"] = _headline(report.read_text(errors="replace"))
            elif res.status == "success":
                report.write_text("# No report written\n\n" + (res.result_text or "(empty)") + "\n")
                rec.update(status="failed", error="agent did not write report.md (output contract)")
                rec["headline"] = None
            # proposals -> approval queue
            for f in sorted((rdir / "proposals").glob("*.md")):
                a = C.create_approval(loop_id, run_id, f.stem, f.read_text(errors="replace"))
                rec["proposals"].append(a["id"])
            # executed approvals
            ex = rdir / "executed.txt"
            if ex.exists():
                valid = {a["id"] for a in to_execute}
                for aid in re.findall(r"[0-9]{6}-[0-9a-f]{6}", ex.read_text()):
                    if aid in valid:
                        C.mark_executed(aid, run_id)
                        rec["executed"].append(aid)
    finally:
        loop_lock.release()
        rec["ended_at"] = C.now_iso()
        t0, t1 = C.parse_iso(rec["started_at"]), C.parse_iso(rec["ended_at"])
        rec["duration_s"] = round((t1 - t0).total_seconds(), 1) if t0 and t1 else None
        if rec["status"] == "running":
            rec.update(status="failed", error=rec.get("error") or "runner error")
        if rdir.exists():
            C.write_json(rdir / "run.json", rec)

    hl = (rec.get("headline") or "").upper()
    if rec["status"] in ("failed", "timeout") or rec["proposals"] or hl.startswith(("DOWN", "DEGRADED")):
        _notify({"event": "loop_run", "loop": loop_id, "run_id": run_id, "status": rec["status"],
                 "headline": rec.get("headline"), "error": rec.get("error"),
                 "new_proposals": len(rec["proposals"])})
    print(f"[{loop_id}] {rec['status']}: {rec.get('headline') or rec.get('error') or ''}")
    return rec
