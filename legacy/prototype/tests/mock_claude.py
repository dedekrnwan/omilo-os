#!/usr/bin/env python3
"""Fake `claude -p` for local testing. Behaviour via MOCK_MODE env: ok | fail | ratelimit | slow | noreport."""
import json, os, random, sys, time
prompt = sys.stdin.read()
mode = os.environ.get("MOCK_MODE", "ok")
if os.getcwd().endswith("/chat"):  # chat brain mode
    import re, subprocess
    msg = prompt.split("[/context]")[-1].strip()
    ctx = prompt.split("[context]")[-1].split("[/context]")[0] if "[context]" in prompt else ""
    m = re.search(r"PROPOSAL (\S+) \(status: pending\)", ctx)
    if m and re.search(r"short|pendek|rewrite|ubah", msg, re.I):
        aid = m.group(1); root = os.environ["COS_ROOT"]
        f = f"{root}/state/chat-tmp/{aid}.md"
        open(f, "w").write("---\ntitle: Draft (shorter)\ntype: content\nrisk: low\n---\nHalo Bapak/Ibu pengurus 👋 Versi lebih singkat dari draft sebelumnya.\n")
        subprocess.run(["cos", "revise", aid, "--body-file", f, "--summary", "shorter, warmer"], check=True)
        reply = f"Done. I shortened proposal **{aid}** and made it warmer. Check the new text above, then press Approve if it looks right."
    elif re.search(r"rerun", msg, re.I):
        loop = re.search(r"run [0-9-]+-([a-z-]+)|rerun ([a-z-]+)", ctx + " " + msg)
        lp = (loop.group(1) or loop.group(2)) if loop else "content-weekly"
        subprocess.run(["cos", "rerun", lp, "--note", msg], check=True, capture_output=True)
        reply = f"Started **{lp}** again with your instructions. It will show up under Runs in a minute."
    else:
        first = ctx.strip().splitlines()[0] if ctx.strip() else "no context"
        reply = f"(mock) You asked: *{msg[:120]}*\n\nWhat I see: {first}\n\n- point one\n- point two"
    time.sleep(1.5)
    print(json.dumps({"type": "result", "is_error": False, "result": reply, "session_id": "mock-chat-" + str(os.getpid()), "total_cost_usd": 0.02, "num_turns": 2}))
    sys.exit(0)
rd = os.environ["RUN_DIR"]; loop = os.environ["LOOP_ID"]
acct = os.path.basename(os.environ.get("CLAUDE_CONFIG_DIR", "default"))
if mode == "ratelimit" and acct in os.environ.get("MOCK_LIMITED", "acc-01").split(","):
    print(json.dumps({"type": "result", "is_error": True, "result": "Claude AI usage limit reached|1760000000"})); sys.exit(1)
if mode == "fail":
    print("boom: tool crashed", file=sys.stderr); sys.exit(2)
if mode == "slow":
    time.sleep(999)
heads = {"ops-health": "OK: 9/9 services healthy, no firing alerts", "dev-builder": "PR #42 opened: fix invite code expiry (go-core)",
         "support-digest": "7 tickets → 2 FAQ drafts, 1 bug proposed", "content-weekly": "Week plan: transparansi kas RT, 7 drafts",
         "sales-prospecting": "5 new prospects researched, 3 outreach drafts", "finance-scorecard": "MRR Rp 0 (pre-launch), 3 actions for the week",
         "retro-weekly": "All loops healthy; 1 prompt change proposed"}
if mode != "noreport":
    open(f"{rd}/report.md", "w").write(f"# {heads.get(loop, 'done')}\n\n## Summary\n- mock run for {loop}\n\n## Done\n- nothing real (mock)\n\n## Needs founder\nnothing\n\n## Handoffs\nnone\n")
    if loop in ("content-weekly", "sales-prospecting", "support-digest"):
        os.makedirs(f"{rd}/proposals", exist_ok=True)
        open(f"{rd}/proposals/draft-{random.randint(1,999)}.md", "w").write(
            f"---\ntitle: Mock {loop} draft\ntype: {'outreach' if 'sales' in loop else 'content'}\nrisk: low\n---\nHalo Bapak/Ibu pengurus, ini draft contoh.\n\n- poin satu\n- poin **dua**\n")
    import re
    ids = re.findall(r"## id: (\S+)", prompt)
    if ids:
        open(f"{rd}/executed.txt", "w").write("\n".join(ids) + "\n")
print(json.dumps({"type": "result", "subtype": "success", "is_error": False, "duration_ms": 1234, "num_turns": random.randint(3, 30),
                  "result": "done", "session_id": "mock-session", "total_cost_usd": round(random.uniform(0.05, 1.2), 3)}))
