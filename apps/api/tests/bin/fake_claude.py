#!/usr/bin/env python3
"""A stand-in for the `claude` CLI in tests: speaks stream-json and really calls the saga-os MCP server.

Token behaviour: contains "LIMITED" -> usage limit reached; contains "BAD" -> auth error; otherwise works.
"""
import json
import os
import re
import sys
import time
import urllib.request


def out(obj):
    print(json.dumps(obj), flush=True)
    time.sleep(float(os.environ.get("FAKE_CLAUDE_DELAY", "0")))


def arg(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


def mcp_call(cfg, tool, args):
    srv = json.load(open(cfg))["mcpServers"]["saga-os"]
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}}).encode()
    req = urllib.request.Request(srv["url"], data=body, headers={**srv["headers"], "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())


if "--version" in sys.argv:
    print("2.9.9 (Claude Code, fake)")
    sys.exit(0)
token = os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "")
prompt = arg("-p", "")
session = arg("--resume") or f"sess-{int(time.time() * 1000)}"
log = os.environ.get("FAKE_CLAUDE_LOG")
if log:
    with open(log, "a") as f:
        f.write(json.dumps({"token": token[-6:], "resume": arg("--resume"), "prompt": prompt[:60], "tools": arg("--allowedTools"),
                            "mode": arg("--permission-mode"), "cfgdir": os.environ.get("CLAUDE_CONFIG_DIR")}) + "\n")
if "--output-format" in sys.argv and arg("--output-format") == "json":  # account test
    ok = "LIMITED" not in token and "BAD" not in token
    print(json.dumps({"type": "result", "is_error": not ok, "result": "OK" if ok else "Invalid API key · Please run /login"}))
    sys.exit(0)
# like Claude Code, a resumed session remembers the conversation (kept in CLAUDE_CONFIG_DIR)
store = os.path.join(os.environ.get("CLAUDE_CONFIG_DIR", "/tmp"), "fake-sessions")
os.makedirs(store, exist_ok=True)
path = os.path.join(store, session)
if os.path.exists(path):
    prompt = open(path).read() + "\n" + prompt
open(path, "w").write(prompt)
out({"type": "system", "subtype": "init", "session_id": session, "model": "claude-sonnet-5-5", "tools": ["WebSearch", "mcp__saga-os__report"]})
if "LIMITED" in token:
    out({"type": "result", "subtype": "success", "is_error": True, "session_id": session, "result": "Claude AI usage limit reached|4102444800",
         "usage": {"input_tokens": 5, "output_tokens": 1}, "total_cost_usd": 0.001})
    sys.exit(1)
if "BAD" in token:
    out({"type": "result", "subtype": "success", "is_error": True, "session_id": session, "result": "Invalid API key · Please run /login"})
    sys.exit(1)
out({"type": "assistant", "session_id": session, "message": {"content": [
    {"type": "thinking", "thinking": "I should look this up first."},
    {"type": "tool_use", "id": "tu1", "name": "WebSearch", "input": {"query": "office lunch catering jakarta"}}]}})
out({"type": "user", "session_id": session, "message": {"content": [
    {"type": "tool_result", "tool_use_id": "tu1", "content": "Results: https://example.com/catering and https://example.org/lunch"}]}})

m = re.search(r"Task (tsk_[0-9a-f]+)", prompt)
cfg = arg("--mcp-config")
if m:
    mcp_call(cfg, "checkpoint", {"task_id": m.group(1), "next": "report"})
    mcp_call(cfg, "report", {"task_id": m.group(1), "headline": "Claude Code did it", "body": "## Summary\n- via the pool"})
    final = "finished"
else:
    final = f"Claude Code here. You said: {prompt.splitlines()[-1][-80:]}"
out({"type": "assistant", "session_id": session, "message": {"content": [{"type": "text", "text": final}]}})
out({"type": "result", "subtype": "success", "is_error": False, "session_id": session, "result": final,
     "usage": {"input_tokens": 300, "output_tokens": 40}, "total_cost_usd": 0.0123, "num_turns": 3})
