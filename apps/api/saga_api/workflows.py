"""Workflow automations: a trigger and a few steps, run without AI unless a step asks for it.

A workflow is a small graph. The first node is a trigger (by hand, a schedule, a webhook, or something that happens in
Saga OS); then steps: call a connector tool or a web address, pick and reshape data, decide (If), ask you, or hand a
piece of work to a helper (the only steps that use AI, besides "AI extract"). Values flow between steps with
templates: {{ trigger.email }}, {{ steps.score.output.total }}, {{ last.items | length }}.

Safety: a workflow a helper writes waits in your Inbox until you approve it. While running, a risky step (a connector
that asks first, or a web request that changes something) waits for your OK unless you set the workflow to run on its
own. A run never does more than MAX_STEPS steps.
"""
from __future__ import annotations

import asyncio
import csv
import datetime as dt
import io
import json
import logging
import re
import secrets
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Connector, InboxItem, OfficeEvent, Staff, Task, Workflow, WorkflowRun, now

log = logging.getLogger("saga.workflows")
MAX_STEPS = 200
OUT_LIMIT = 20000  # characters of a step's output kept in the run

# ------------------------------------------------------------------ the blocks
F = dict  # a field: {key, label, kind, ...}
BLOCKS: dict[str, dict] = {
    # triggers
    "trigger.manual": {"label": "Run by hand", "group": "Triggers", "icon": "ri-hand", "color": "blue", "trigger": True,
                       "desc": "Start it from the Workflows page, from a chat, or a helper starts it.",
                       "fields": [F(key="sample", label="Test input (JSON)", kind="json", help="Used when you press Test run.")]},
    "trigger.schedule": {"label": "On a schedule", "group": "Triggers", "icon": "ri-time-line", "color": "blue", "trigger": True,
                         "desc": "Every day, weekday, week or hour.", "fields": [F(key="cron", label="When", kind="cron", default="0 9 * * 1-5")]},
    "trigger.webhook": {"label": "Webhook", "group": "Triggers", "icon": "ri-webhook-line", "color": "blue", "trigger": True,
                        "desc": "Another app posts JSON to a private web address. The JSON is the input.", "fields": []},
    "trigger.event": {"label": "When something happens", "group": "Triggers", "icon": "ri-flashlight-line", "color": "blue", "trigger": True,
                      "desc": "A job finishes or fails, you decide an approval, a helper asks you something.",
                      "fields": [F(key="event", label="Event", kind="select", default="job.done",
                                   options=[["job.done", "A job finished"], ["job.failed", "A job failed"], ["approval.requested", "A helper asks for approval"],
                                            ["approval.decided", "You decided an approval"], ["question.asked", "A helper asks you a question"],
                                            ["handoff", "A helper hands work to another"]]),
                                 F(key="staff_id", label="Only for helper", kind="staff", optional=True)]},
    # AI (costs tokens)
    "ai.helper": {"label": "Give a helper a job", "group": "AI", "icon": "ri-robot-2-line", "color": "green", "ai": True,
                  "desc": "A helper does the thinking part, with its tools and your approval rules. Output: its result.",
                  "fields": [F(key="staff_id", label="Helper", kind="staff"), F(key="brief", label="The job", kind="template", rows=4),
                             F(key="wait", label="Wait for the result", kind="bool", default=True)]},
    "ai.extract": {"label": "AI extract", "group": "AI", "icon": "ri-sparkling-2-line", "color": "green", "ai": True,
                   "desc": "Pull named fields out of messy text (an email, a page). One short AI call.",
                   "fields": [F(key="text", label="From", kind="template", default="{{ last }}"),
                              F(key="fields", label="Fields to fill", kind="text", placeholder="name, email, company, budget"),
                              F(key="instruction", label="Hints", kind="textarea", optional=True)]},
    # apps
    "app.connector": {"label": "Use a connector", "group": "Apps", "icon": "ri-plug-line", "color": "orange",
                      "desc": "Call a tool of one of your connectors (GitHub, CRM, Sheets…). Arguments can use templates.",
                      "fields": [F(key="connector", label="Connector", kind="connector"), F(key="tool", label="Tool", kind="tool"),
                                 F(key="args", label="Arguments (JSON)", kind="json", default={})]},
    "app.http": {"label": "Web request", "group": "Apps", "icon": "ri-global-line", "color": "orange",
                 "desc": "Call any web address (API). GET reads; POST/PUT/DELETE change things and ask you first.",
                 "fields": [F(key="method", label="Method", kind="select", default="GET", options=[["GET", "GET"], ["POST", "POST"], ["PUT", "PUT"], ["PATCH", "PATCH"], ["DELETE", "DELETE"]]),
                            F(key="url", label="Address", kind="template", placeholder="https://api.example.com/items"),
                            F(key="headers", label="Headers (JSON)", kind="json", default={}, optional=True),
                            F(key="body", label="Body (JSON)", kind="json", optional=True),
                            F(key="fail", label="Stop the run when the address answers with an error", kind="bool", default=True)]},
    # data
    "data.pick": {"label": "Pick fields", "group": "Data", "icon": "ri-filter-3-line", "color": "violet",
                  "desc": "Make a small object from the data so far. One line per field: name: path or template.",
                  "fields": [F(key="fields", label="Fields", kind="textarea", placeholder="email: trigger.email\nname: {{ trigger.first }} {{ trigger.last }}")]},
    "data.text": {"label": "Compose text", "group": "Data", "icon": "ri-text", "color": "violet",
                  "desc": "Write a message from a template.", "fields": [F(key="template", label="Text", kind="template", rows=5)]},
    "data.parse": {"label": "Parse", "group": "Data", "icon": "ri-braces-line", "color": "violet",
                   "desc": "Turn JSON, CSV or lines of text into data.",
                   "fields": [F(key="text", label="Text", kind="template", default="{{ last }}"),
                              F(key="format", label="Format", kind="select", default="json", options=[["json", "JSON"], ["csv", "CSV (first row = names)"], ["lines", "Lines"]])]},
    "data.regex": {"label": "Find with a pattern", "group": "Data", "icon": "ri-search-eye-line", "color": "violet",
                   "desc": "Find text with a regular expression; named groups become fields.",
                   "fields": [F(key="text", label="In", kind="template", default="{{ last }}"),
                              F(key="pattern", label="Pattern", kind="text", placeholder="(?P<order>INV-\\d+)"), F(key="all", label="Every match", kind="bool", default=False)]},
    "data.list": {"label": "Filter a list", "group": "Data", "icon": "ri-list-check-3", "color": "violet",
                  "desc": "Keep the items of a list that match, pick some fields, and limit the count.",
                  "fields": [F(key="list", label="List", kind="template", default="{{ last }}"),
                             F(key="where", label="Keep items where", kind="text", optional=True, placeholder="status == open"),
                             F(key="fields", label="Fields to keep", kind="text", optional=True, placeholder="id, title"),
                             F(key="limit", label="At most", kind="number", optional=True)]},
    # logic
    "logic.if": {"label": "If", "group": "Logic", "icon": "ri-git-branch-line", "color": "purple", "ports": ["true", "false"],
                 "desc": "Go one way or the other.",
                 "fields": [F(key="left", label="Value", kind="template"),
                            F(key="op", label="Is", kind="select", default="equals",
                              options=[["equals", "equal to"], ["not_equals", "not equal to"], ["contains", "contains"], ["gt", "greater than"],
                                       ["lt", "less than"], ["empty", "empty"], ["not_empty", "not empty"], ["matches", "matches pattern"]]),
                            F(key="right", label="Than / to", kind="template", optional=True)]},
    "logic.approval": {"label": "Ask me", "group": "Logic", "icon": "ri-hand", "color": "amber", "ports": ["approved", "rejected"],
                       "desc": "Wait until you approve or reject in your Inbox.",
                       "fields": [F(key="title", label="Question", kind="template"), F(key="body", label="Details", kind="template", optional=True, rows=3)]},
    # Saga OS
    "saga.inbox": {"label": "Tell me", "group": "Saga OS", "icon": "ri-inbox-line", "color": "slate",
                   "desc": "Put a note in your Inbox.", "fields": [F(key="title", label="Title", kind="template"), F(key="body", label="Text", kind="template", optional=True, rows=3)]},
    "saga.doc": {"label": "Write a doc", "group": "Saga OS", "icon": "ri-file-text-line", "color": "slate",
                 "desc": "Create or add to a doc in Docs.",
                 "fields": [F(key="path", label="Doc", kind="template", placeholder="Reports/Leads"), F(key="content", label="Text", kind="template", rows=4),
                            F(key="mode", label="", kind="select", default="append", options=[["append", "Add to the end"], ["replace", "Replace"]])]},
    "saga.kpi": {"label": "Record a KPI", "group": "Saga OS", "icon": "ri-line-chart-line", "color": "slate",
                 "desc": "Save a number on the Company page.",
                 "fields": [F(key="name", label="KPI", kind="kpi"), F(key="value", label="Value", kind="template"),
                            F(key="period", label="Period", kind="template", optional=True), F(key="source", label="Source", kind="text", default="workflow")]},
}


_SAMPLE = F(key="sample", label="Test input (JSON)", kind="json", optional=True, help="Used when you press Test run.")


def blocks_public() -> list[dict]:
    out = []
    for k, b in BLOCKS.items():
        fields = list(b.get("fields", []))
        if b.get("trigger") and not any(f["key"] == "sample" for f in fields):
            fields.append(_SAMPLE)
        out.append({"type": k, **b, "fields": fields, "ports": b.get("ports", ["out"]), "ai": bool(b.get("ai")), "trigger": bool(b.get("trigger"))})
    return out


# ------------------------------------------------------------------ checking a graph
class Invalid(ValueError):
    pass


def validate(graph: dict) -> dict:
    """Clean and check a graph: known blocks, exactly one trigger, edges between existing nodes, no loops."""
    if not isinstance(graph, dict):
        raise Invalid("the workflow must be an object with nodes and edges")
    nodes = graph.get("nodes") or []
    if not isinstance(nodes, list) or not nodes:
        raise Invalid("add at least a trigger")
    if len(nodes) > 60:
        raise Invalid("at most 60 steps")
    seen: dict[str, dict] = {}
    for i, n in enumerate(nodes):
        if not isinstance(n, dict) or n.get("type") not in BLOCKS:
            raise Invalid(f"step {i + 1}: unknown block {n.get('type') if isinstance(n, dict) else n!r}")
        nid = str(n.get("id") or f"n{i + 1}")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,40}", nid) or nid in seen:
            raise Invalid(f"step ids must be short, unique words (got {nid!r})")
        seen[nid] = {"id": nid, "type": n["type"], "label": str(n.get("label") or BLOCKS[n["type"]]["label"])[:80],
                     "note": str(n.get("note") or "")[:160], "config": n.get("config") if isinstance(n.get("config"), dict) else {},
                     "x": float(n.get("x") or 0), "y": float(n.get("y") or 0)}
    triggers = [n for n in seen.values() if BLOCKS[n["type"]].get("trigger")]
    if len(triggers) != 1:
        raise Invalid("a workflow has exactly one trigger")
    edges = []
    for e in graph.get("edges") or []:
        a, b, port = str(e.get("from", "")), str(e.get("to", "")), str(e.get("port") or "out")
        if a not in seen or b not in seen:
            raise Invalid("a line points to a missing step")
        if port not in BLOCKS[seen[a]["type"]].get("ports", ["out"]):
            raise Invalid(f"{seen[a]['label']} has no exit called {port}")
        if BLOCKS[seen[b]["type"]].get("trigger"):
            raise Invalid("nothing can lead into the trigger")
        edges.append({"from": a, "port": port, "to": b})
    # no loops (a run must end)
    out: dict[str, list[str]] = {}
    for e in edges:
        out.setdefault(e["from"], []).append(e["to"])
    state: dict[str, int] = {}

    def visit(n: str):
        state[n] = 1
        for m in out.get(n, []):
            if state.get(m) == 1:
                raise Invalid("steps can't go round in a loop")
            if not state.get(m):
                visit(m)
        state[n] = 2
    for n in seen:
        if not state.get(n):
            visit(n)
    if triggers[0]["type"] == "trigger.schedule":
        from croniter import croniter

        if not croniter.is_valid(str(triggers[0]["config"].get("cron") or "")):
            raise Invalid("the schedule is not valid")
    return {"nodes": list(seen.values()), "edges": edges}


def trigger_of(wf: Workflow) -> dict:
    return next((n for n in (wf.graph or {}).get("nodes", []) if BLOCKS.get(n["type"], {}).get("trigger")), {"type": "trigger.manual", "config": {}})


def uses_ai(graph: dict) -> bool:
    return any(BLOCKS.get(n["type"], {}).get("ai") for n in (graph or {}).get("nodes", []))


# ------------------------------------------------------------------ templates
_TPL = re.compile(r"\{\{\s*(.+?)\s*\}\}")


def resolve(path: str, ctx: dict) -> Any:
    """trigger.items[0].name, steps.score.output.total, last … (no code is evaluated)."""
    cur: Any = ctx
    for part in re.findall(r"[^.\[\]]+|\[\d+\]", path.strip()):
        if part.startswith("["):
            i = int(part[1:-1])
            cur = cur[i] if isinstance(cur, list) and -len(cur) <= i < len(cur) else None
        elif isinstance(cur, dict):
            cur = cur.get(part)
        else:
            return None
        if cur is None:
            return None
    return cur


def _filter(v: Any, f: str) -> Any:
    name, _, arg = f.partition(":")
    name, arg = name.strip(), arg.strip().strip("\"'")
    if name == "json":
        return json.dumps(v, ensure_ascii=False, default=str)
    if name == "lower":
        return str(v or "").lower()
    if name == "upper":
        return str(v or "").upper()
    if name == "trim":
        return str(v or "").strip()
    if name == "length":
        return len(v) if isinstance(v, (list, dict, str)) else 0
    if name == "first":
        return v[0] if isinstance(v, list) and v else None
    if name == "default":
        return v if v not in (None, "", [], {}) else arg
    if name == "number":
        try:
            return float(str(v).replace(",", ""))
        except ValueError:
            return None
    if name == "join":
        return (arg or ", ").join(str(x) for x in v) if isinstance(v, list) else v
    return v


def _expr(expr: str, ctx: dict) -> Any:
    parts = [p for p in expr.split("|")]
    head = parts[0].strip()
    v = head[1:-1] if len(head) >= 2 and head[0] == head[-1] and head[0] in "\"'" else resolve(head, ctx)
    for f in parts[1:]:
        v = _filter(v, f)
    return v


def render(value: Any, ctx: dict) -> Any:
    """Fill templates in a string (or in every string of a JSON value). A string that is a single {{ … }} keeps the
    value's type (a list stays a list)."""
    if isinstance(value, dict):
        return {k: render(v, ctx) for k, v in value.items()}
    if isinstance(value, list):
        return [render(v, ctx) for v in value]
    if not isinstance(value, str):
        return value
    m = _TPL.fullmatch(value.strip())
    if m:
        return _expr(m.group(1), ctx)

    def sub(mm: re.Match) -> str:
        v = _expr(mm.group(1), ctx)
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        return "" if v is None else v if isinstance(v, str) else json.dumps(v, ensure_ascii=False, default=str) if isinstance(v, (dict, list)) else str(v)
    return _TPL.sub(sub, value)


# ------------------------------------------------------------------ talking to connectors (MCP, http or a local program)
async def _mcp_http(url: str, headers: dict, tool: str, args: dict, method: str = "tools/call") -> Any:
    def parse(r: httpx.Response) -> dict:
        body = r.text
        if "data:" in body and "{" in body and not body.lstrip().startswith("{"):
            lines = [ln[5:].strip() for ln in body.splitlines() if ln.startswith("data:")]
            body = next((ln for ln in reversed(lines) if ln.startswith("{")), body)
        return json.loads(body)
    hdrs = {"Accept": "application/json, text/event-stream", **headers}
    async with httpx.AsyncClient(timeout=60, headers=hdrs) as h:
        r = await h.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "saga-os-workflows", "version": "1"}}})
        r.raise_for_status()
        sid = r.headers.get("mcp-session-id")
        extra = {"mcp-session-id": sid} if sid else {}
        await h.post(url, headers=extra, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
        params = {"name": tool, "arguments": args} if method == "tools/call" else {}
        r2 = await h.post(url, headers=extra, json={"jsonrpc": "2.0", "id": 2, "method": method, "params": params})
        r2.raise_for_status()
        return parse(r2)


async def _mcp_stdio(command: str, cargs: list[str], env: dict, tool: str, args: dict, method: str = "tools/call") -> Any:
    import os

    proc = await asyncio.create_subprocess_exec(command, *cargs, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.DEVNULL, env={**os.environ, **env})
    assert proc.stdin and proc.stdout

    async def send(msg: dict):
        proc.stdin.write((json.dumps(msg) + "\n").encode())
        await proc.stdin.drain()

    async def wait_for(i: int) -> dict:
        while True:
            line = await asyncio.wait_for(proc.stdout.readline(), timeout=90)
            if not line:
                raise RuntimeError("the connector program stopped")
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if m.get("id") == i:
                return m
    try:
        await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                                                                                     "clientInfo": {"name": "saga-os-workflows", "version": "1"}}})
        await wait_for(1)
        await send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        await send({"jsonrpc": "2.0", "id": 2, "method": method, "params": {"name": tool, "arguments": args} if method == "tools/call" else {}})
        return await wait_for(2)
    finally:
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def _tool_payload(resp: dict) -> Any:
    if "error" in resp:
        raise RuntimeError(str(resp["error"].get("message") or resp["error"]))
    res = resp.get("result") or {}
    if res.get("isError"):
        txt = " ".join(c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text")
        raise RuntimeError(txt[:500] or "the tool failed")
    if res.get("structuredContent") is not None:
        return res["structuredContent"]
    texts = [c.get("text", "") for c in res.get("content") or [] if c.get("type") == "text"]
    text = "\n".join(texts)
    try:
        return json.loads(text)
    except ValueError:
        return text


async def call_connector(rt: dict, tool: str, args: dict) -> Any:
    if rt["kind"] == "http":
        return _tool_payload(await _mcp_http(rt["url"], rt["headers"], tool, args))
    return _tool_payload(await _mcp_stdio(rt["command"], rt["args"], rt["env"], tool, args))


async def list_tools(rt: dict) -> list[dict]:
    """A connector's tools with their argument schemas (for the builder)."""
    if rt["kind"] == "http":
        resp = await _mcp_http(rt["url"], rt["headers"], "", {}, method="tools/list")
    else:
        resp = await _mcp_stdio(rt["command"], rt["args"], rt["env"], "", {}, method="tools/list")
    if "error" in resp:
        raise RuntimeError(str(resp["error"].get("message") or resp["error"]))
    return [{"name": t["name"], "description": (t.get("description") or "")[:400], "schema": t.get("inputSchema") or {}}
            for t in (resp.get("result") or {}).get("tools", [])][:200]


# ------------------------------------------------------------------ steps
class Wait(Exception):
    def __init__(self, kind: str, ref: str):
        super().__init__(kind)
        self.kind, self.ref = kind, ref


def _compare(left: Any, op: str, right: Any) -> bool:
    def num(v):
        try:
            return float(str(v).replace(",", ""))
        except (TypeError, ValueError):
            return None
    if op == "empty":
        return left in (None, "", [], {})
    if op == "not_empty":
        return left not in (None, "", [], {})
    if op == "equals":
        return str(left).strip().lower() == str(right).strip().lower() if not (num(left) is not None and num(right) is not None) else num(left) == num(right)
    if op == "not_equals":
        return not _compare(left, "equals", right)
    if op == "contains":
        return str(right).lower() in (json.dumps(left, ensure_ascii=False).lower() if isinstance(left, (list, dict)) else str(left).lower())
    if op in ("gt", "lt"):
        a, b = num(left), num(right)
        return a is not None and b is not None and (a > b if op == "gt" else a < b)
    if op == "matches":
        try:
            return re.search(str(right), str(left or "")) is not None
        except re.error:
            return False
    return False


def _where(item: Any, cond: str) -> bool:
    m = re.match(r"\s*([\w.\[\]]+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+?)\s*$", cond or "")
    if not m:
        return True
    left = resolve(m.group(1), item if isinstance(item, dict) else {"value": item})
    right = m.group(3).strip("\"'")
    op = {"==": "equals", "!=": "not_equals", ">": "gt", "<": "lt", "contains": "contains"}.get(m.group(2))
    if m.group(2) in (">=", "<="):
        return _compare(left, "equals", right) or _compare(left, "gt" if m.group(2) == ">=" else "lt", right)
    return _compare(left, op, right)


def risky(db: Session, node: dict) -> str | None:
    """Why this step should wait for your OK (None when it is safe)."""
    t, c = node["type"], node.get("config") or {}
    if t == "app.http" and str(c.get("method") or "GET").upper() != "GET":
        return f"{str(c.get('method')).upper()} {c.get('url', '')}"
    if t == "app.connector":
        conn = db.get(Connector, str(c.get("connector") or ""))
        if conn and conn.approval == "ask":
            return f"{conn.label}: {c.get('tool', '')}"
    return None


async def run_step(db: Session, run: WorkflowRun, wf: Workflow, node: dict, ctx: dict) -> tuple[Any, str]:
    """Do one step. Returns (output, exit port). Raises Wait to pause the run."""
    from . import services as S

    t, raw = node["type"], node.get("config") or {}
    c = render(raw, ctx)
    if t.startswith("trigger."):
        return ctx["trigger"], "out"
    if t == "data.text":
        return {"text": c.get("template") or ""}, "out"
    if t == "data.pick":
        out = {}
        for line in str(raw.get("fields") or "").splitlines():
            k, sep, v = line.partition(":")
            if not sep or not k.strip():
                continue
            v = v.strip()
            out[k.strip()] = render(v, ctx) if "{{" in v else resolve(v, ctx)
        return out, "out"
    if t == "data.parse":
        text, fmt = c.get("text"), c.get("format") or "json"
        if not isinstance(text, str):
            return text, "out"
        if fmt == "csv":
            return list(csv.DictReader(io.StringIO(text))), "out"
        if fmt == "lines":
            return [ln for ln in text.splitlines() if ln.strip()], "out"
        return json.loads(text), "out"
    if t == "data.regex":
        try:
            rx = re.compile(str(raw.get("pattern") or ""))
        except re.error as e:
            raise RuntimeError(f"the pattern is not valid: {e}") from e
        text = c.get("text") if isinstance(c.get("text"), str) else json.dumps(c.get("text"), ensure_ascii=False)
        def one(m: re.Match):
            return m.groupdict() or {"match": m.group(0), "groups": list(m.groups())}
        if c.get("all"):
            return [one(m) for m in rx.finditer(text or "")][:500], "out"
        m = rx.search(text or "")
        return (one(m) if m else None), "out"
    if t == "data.list":
        items = c.get("list")
        if isinstance(items, dict):
            items = next((v for v in items.values() if isinstance(v, list)), [items])
        items = list(items or []) if isinstance(items, list) else []
        if raw.get("where"):
            items = [i for i in items if _where(i, str(raw["where"]))]
        if raw.get("fields"):
            keys = [k.strip() for k in str(raw["fields"]).split(",") if k.strip()]
            items = [{k: resolve(k, i) if isinstance(i, dict) else None for k in keys} for i in items]
        if raw.get("limit"):
            items = items[: int(raw["limit"])]
        return {"items": items, "count": len(items)}, "out"
    if t == "logic.if":
        return {"result": _compare(c.get("left"), raw.get("op") or "equals", c.get("right"))}, ("true" if _compare(c.get("left"), raw.get("op") or "equals", c.get("right")) else "false")
    if t == "logic.approval":
        item = InboxItem(kind="workflow", ref_id=f"step:{run.id}:{node['id']}", title=str(c.get("title") or node["label"])[:300],
                         body=f"From the workflow **{wf.name}**.\n\n{c.get('body') or ''}", level="decision")
        db.add(item)
        db.commit()
        raise Wait("approval", item.id)
    if t == "saga.inbox":
        S.alert(db, str(c.get("title") or wf.name)[:300], f"{c.get('body') or ''}\n\n_From the workflow {wf.name}._", None, None, level="fyi")
        return {"ok": True}, "out"
    if t == "saga.doc":
        from . import docs as D

        path, content = str(c.get("path") or "Workflows/" + wf.name), str(c.get("content") or "")
        cur = None
        try:
            cur = D.read(db, path)
        except Exception:  # noqa: BLE001 - a new doc
            cur = None
        text = content if (raw.get("mode") == "replace" or not cur) else f"{cur.get('content', '').rstrip()}\n\n{content}"
        r = D.write(db, path, text, author=f"workflow:{wf.id}", author_kind="workflow", summary=f"From the workflow {wf.name}"[:300])
        return {"path": r["path"], "version": r.get("version")}, "out"
    if t == "saga.kpi":
        from .models import KpiValue

        try:
            val = float(str(c.get("value")).replace(",", ""))
        except (TypeError, ValueError) as e:
            raise RuntimeError(f"the KPI value is not a number: {c.get('value')!r}") from e
        db.add(KpiValue(name=str(raw.get("name") or "").strip(), value=val, period=str(c.get("period") or ""), source=str(c.get("source") or "workflow"), staff_id="owner"))
        db.commit()
        return {"value": val}, "out"
    if t == "app.http":
        method = str(c.get("method") or "GET").upper()
        url = str(c.get("url") or "")
        if not re.match(r"^https?://", url):
            raise RuntimeError("the address must start with http:// or https://")
        body = c.get("body")
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as h:
            try:
                r = await h.request(method, url, headers={str(k): str(v) for k, v in (c.get("headers") or {}).items()},
                                    json=body if isinstance(body, (dict, list)) else None, content=body if isinstance(body, str) else None)
            except httpx.HTTPError as e:
                if raw.get("fail", True) is not False:
                    raise RuntimeError(f"could not reach {url}: {type(e).__name__}") from e
                return {"status": 0, "data": None, "error": type(e).__name__}, "out"
        try:
            data = r.json()
        except ValueError:
            data = r.text[:OUT_LIMIT]
        if r.status_code >= 400 and raw.get("fail", True) is not False:
            raise RuntimeError(f"{url} answered {r.status_code}: {str(data)[:300]}")
        return {"status": r.status_code, "data": data}, "out"
    if t == "app.connector":
        from . import capabilities as CAP

        conn = db.get(Connector, str(raw.get("connector") or ""))
        if not conn or not conn.enabled:
            raise RuntimeError(f"the connector {raw.get('connector')!r} is missing or off")
        if not raw.get("tool"):
            raise RuntimeError("pick a tool of the connector")
        args = c.get("args") if isinstance(c.get("args"), dict) else {}
        return await call_connector(CAP.connector_runtime(conn), str(raw["tool"]), args), "out"
    if t == "ai.helper":
        st = db.get(Staff, str(raw.get("staff_id") or ""))
        if not st or st.status == "retired":
            raise RuntimeError("pick a helper on your team")
        task = S.create_task(db, st.id, "workflow", f"{c.get('brief') or ''}\n\n(Step “{node['label']}” of the workflow “{wf.name}”. Report the result.)",
                             created_by=f"workflow:{wf.id}")
        run.ai_steps += 1
        if raw.get("wait", True) is False:
            return {"task_id": task.id, "status": "queued"}, "out"
        raise Wait("task", task.id)
    if t == "ai.extract":
        return await _ai_extract(db, run, c), "out"
    raise RuntimeError(f"unknown step {t}")


async def _ai_extract(db: Session, run: WorkflowRun, c: dict) -> dict:
    from . import services as S
    from .engines.claude import DEFAULT_MODEL, api_base, headers

    key = S.ai_api_key(db, "claude")
    if not key:
        import os

        key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("AI extract needs your Claude API key (Settings → AI)")
    fields = [f.strip() for f in str(c.get("fields") or "").split(",") if f.strip()]
    text = c.get("text") if isinstance(c.get("text"), str) else json.dumps(c.get("text"), ensure_ascii=False)
    tool = {"name": "fill", "description": "Fill the fields from the text. Use null when the text does not say.",
            "input_schema": {"type": "object", "properties": {f: {"type": ["string", "number", "null"]} for f in fields}, "required": fields}}
    body = {"model": S.get_setting(db, "workflow_model", None) or DEFAULT_MODEL, "max_tokens": 1024, "tools": [tool], "tool_choice": {"type": "tool", "name": "fill"},
            "messages": [{"role": "user", "content": f"{c.get('instruction') or ''}\n\nText:\n{(text or '')[:30000]}"}]}
    async with httpx.AsyncClient(timeout=90) as h:
        r = await h.post(f"{api_base()}/v1/messages", json=body, headers=headers(key))
    if r.status_code >= 400:
        raise RuntimeError(f"Claude answered {r.status_code}: {r.text[:200]}")
    run.ai_steps += 1
    data = r.json()
    block = next((b for b in data.get("content", []) if b.get("type") == "tool_use"), None)
    return block.get("input") if block else {}


# ------------------------------------------------------------------ running
def _trim(v: Any) -> Any:
    s = json.dumps(v, ensure_ascii=False, default=str)
    if len(s) <= OUT_LIMIT:
        return v
    return {"_truncated": True, "preview": s[:OUT_LIMIT]}


def start_run(db: Session, wf: Workflow, trigger: str, payload: dict | None = None, by: str = "owner") -> WorkflowRun:
    g = wf.graph or {}
    trig = next(n for n in g.get("nodes", []) if BLOCKS[n["type"]].get("trigger"))
    run = WorkflowRun(workflow_id=wf.id, trigger=trigger, started_by=by, input=payload or {}, status="queued",
                      state={"queue": [trig["id"]], "steps": {}, "approved": []})
    db.add(run)
    wf.runs_count = (wf.runs_count or 0) + 1
    wf.last_run_at = now()
    db.commit()
    return run


def _ctx(run: WorkflowRun, state: dict) -> dict:
    steps = state.get("steps", {})
    order = state.get("order", [])
    last = steps.get(order[-1], {}).get("output") if order else None
    outs = {k: {**v, "output": v.get("output")} for k, v in steps.items()}
    return {"trigger": run.input or {}, "input": run.input or {}, "steps": outs, "last": last, "run": {"id": run.id},
            "now": now().isoformat()}


def _save(db: Session, run: WorkflowRun, state: dict) -> None:
    run.state = json.loads(json.dumps(state, default=str))
    db.commit()


async def execute(db: Session, run: WorkflowRun) -> WorkflowRun:
    """Run (or resume) a run until it ends or has to wait."""
    wf = db.get(Workflow, run.workflow_id)
    if not wf:
        run.status, run.error, run.ended_at = "failed", "the workflow was deleted", now()
        db.commit()
        return run
    nodes = {n["id"]: n for n in (wf.graph or {}).get("nodes", [])}
    edges = (wf.graph or {}).get("edges", [])
    state = json.loads(json.dumps(run.state or {}, default=str))
    state.setdefault("steps", {}); state.setdefault("approved", []); state.setdefault("order", [])  # noqa: E702
    queue: list[str] = list(state.get("queue") or [])
    run.status = "running"
    run.started_at = run.started_at or now()
    db.commit()
    done = 0
    while queue:
        nid = queue.pop(0)
        node = nodes.get(nid)
        if not node:
            continue
        done += 1
        if len(state["order"]) + done > MAX_STEPS:
            run.status, run.error = "failed", f"stopped after {MAX_STEPS} steps"
            break
        waiting = state.get("waiting")
        step = state["steps"].get(nid, {})
        if waiting and waiting.get("node") == nid and waiting.get("result") is not None:
            out, port = waiting["result"], waiting.get("port", "out")
            state.pop("waiting", None)
        else:
            why = risky(db, node) if wf.autonomy != "auto" else None
            if why and nid not in state["approved"]:
                if waiting and waiting.get("node") == nid and waiting.get("kind") == "gate" and waiting.get("denied"):
                    state["steps"][nid] = {**step, "status": "skipped", "error": "you said no", "ended_at": now().isoformat()}
                    state.pop("waiting", None)
                    state["order"].append(nid)
                    continue
                item = InboxItem(kind="workflow", ref_id=f"gate:{run.id}:{nid}", title=f"{wf.name}: OK to run “{node['label']}”?",
                                 body=f"The workflow **{wf.name}** wants to do this now:\n\n`{why}`\n\nApprove to let this step run once.", level="decision")
                db.add(item)
                db.commit()
                state["steps"][nid] = {**step, "status": "waiting", "waiting_for": "your OK", "started_at": now().isoformat()}
                state["waiting"] = {"node": nid, "kind": "gate", "ref": item.id}
                state["queue"] = [nid, *queue]
                run.status = "waiting"
                _save(db, run, state)
                return run
            state["steps"][nid] = {"status": "running", "started_at": now().isoformat(), "label": node["label"]}
            try:
                out, port = await run_step(db, run, wf, node, _ctx(run, state))
            except Wait as w:
                state["steps"][nid] = {**state["steps"][nid], "status": "waiting",
                                       "waiting_for": "a helper's job" if w.kind == "task" else "your answer", "ref": w.ref}
                state["waiting"] = {"node": nid, "kind": w.kind, "ref": w.ref}
                state["queue"] = [nid, *queue]
                run.status = "waiting"
                _save(db, run, state)
                return run
            except Exception as e:  # noqa: BLE001 - a failed step fails the run, with the reason on the step
                log.info("workflow %s step %s failed: %s", wf.id, nid, e)
                state["steps"][nid] = {**state["steps"][nid], "status": "failed", "error": str(e)[:1000], "ended_at": now().isoformat()}
                state["queue"] = []
                run.status, run.error, run.ended_at = "failed", f"{node['label']}: {str(e)[:500]}", now()
                _save(db, run, state)
                return run
        state["steps"][nid] = {**state["steps"].get(nid, {}), "status": "done", "output": _trim(out), "port": port, "ended_at": now().isoformat()}
        state["order"].append(nid)
        queue.extend(e["to"] for e in edges if e["from"] == nid and e["port"] == port)
        state["queue"] = queue
        _save(db, run, state)
    if run.status == "running":
        run.status = "done"
    run.ended_at = now()
    state["queue"] = []
    _save(db, run, state)
    return run


def check_waiting(db: Session, run: WorkflowRun) -> bool:
    """Is what this run waits for settled? Puts the result in the state and returns True when it can go on."""
    state = json.loads(json.dumps(run.state or {}, default=str))  # a copy: changing the loaded value in place would not be saved
    w = state.get("waiting") or {}
    if not w:
        return True
    if w["kind"] == "task":
        t = db.get(Task, w["ref"])
        if not t or t.status not in ("done", "failed", "cancelled"):
            return False
        from .models import Report

        rep = db.scalar(select(Report).where(Report.task_id == t.id))
        w["result"] = {"task_id": t.id, "status": t.status, "result": (rep.headline if rep else "") or (t.result_text or "")[:4000],
                       "report": (rep.body_md if rep else "")[:8000], "error": t.error}
        w["port"] = "out"
        if t.status != "done":
            state["steps"][w["node"]] = {**state["steps"].get(w["node"], {}), "status": "failed", "error": f"the helper's job {t.status}: {t.error[:300]}"}
            run.state, run.status, run.error, run.ended_at = state, "failed", f"the helper's job {t.status}", now()
            db.commit()
            return False
    elif w["kind"] in ("approval", "gate"):
        item = db.get(InboxItem, w["ref"])
        if not item or item.status != "done":
            return False
        ok = item.answer == "approved"
        if w["kind"] == "gate":
            if ok:
                state.setdefault("approved", []).append(w["node"])
                state.pop("waiting", None)
            else:
                w["denied"] = True
        else:
            w["result"] = {"approved": ok, "by": "you", "note": item.answer}
            w["port"] = "approved" if ok else "rejected"
    state["waiting"] = w if state.get("waiting") else None
    if state["waiting"] is None:
        state.pop("waiting")
    run.state = json.loads(json.dumps(state, default=str))
    run.status = "queued"
    db.commit()
    return True


# ------------------------------------------------------------------ triggers and the worker
def set_next(wf: Workflow) -> None:
    from . import services as S

    t = trigger_of(wf)
    wf.next_at = S.next_run(t["config"].get("cron") or "0 9 * * 1-5") if wf.status == "active" and t["type"] == "trigger.schedule" else None


def activate(db: Session, wf: Workflow) -> None:
    wf.status = "active"
    t = trigger_of(wf)
    if t["type"] == "trigger.webhook" and not wf.hook_token:
        wf.hook_token = secrets.token_urlsafe(24)
    if t["type"] == "trigger.event":
        wf.event_cursor = db.scalar(select(func.max(OfficeEvent.id))) or 0  # only what happens from now on
    set_next(wf)


def due_runs(db: Session) -> list[WorkflowRun]:
    """Start what is due: schedules and events. Returns runs ready to execute (queued, or waiting and now settled)."""
    t_now = now()
    for wf in db.scalars(select(Workflow).where(Workflow.status == "active")):
        trig = trigger_of(wf)
        if trig["type"] == "trigger.schedule" and wf.next_at and (wf.next_at if wf.next_at.tzinfo else wf.next_at.replace(tzinfo=dt.UTC)) <= t_now:
            start_run(db, wf, "schedule", {"at": t_now.isoformat()})
            set_next(wf)
            db.commit()
        elif trig["type"] == "trigger.event":
            ev, who = trig["config"].get("event") or "job.done", trig["config"].get("staff_id") or None
            q = select(OfficeEvent).where(OfficeEvent.id > (wf.event_cursor or 0), OfficeEvent.kind == ev)
            if who:
                q = q.where(OfficeEvent.staff_id == who)
            rows = list(db.scalars(q.order_by(OfficeEvent.id).limit(5)))
            last = db.scalar(select(func.max(OfficeEvent.id))) or wf.event_cursor
            for e in rows:
                if e.task_id and db.scalar(select(Task.created_by).where(Task.id == e.task_id)) == f"workflow:{wf.id}":
                    continue  # never trigger on its own jobs
                start_run(db, wf, "event", {"event": e.kind, "staff_id": e.staff_id, "task_id": e.task_id, **(e.data or {})})
            wf.event_cursor = rows[-1].id if len(rows) == 5 else last
            db.commit()
    ready = list(db.scalars(select(WorkflowRun).where(WorkflowRun.status == "queued").order_by(WorkflowRun.created_at).limit(20)))
    for r in db.scalars(select(WorkflowRun).where(WorkflowRun.status == "waiting").limit(200)):
        if check_waiting(db, r):
            ready.append(r)
    return ready


# ------------------------------------------------------------------ views
def view(db: Session, wf: Workflow, full: bool = False) -> dict:
    from . import serialize as X

    trig = trigger_of(wf)
    creator = wf.created_by or "owner"
    staff = db.get(Staff, creator[6:]) if creator.startswith("staff:") else None
    last = db.scalar(select(WorkflowRun).where(WorkflowRun.workflow_id == wf.id).order_by(WorkflowRun.created_at.desc()).limit(1))
    out = {"id": wf.id, "name": wf.name, "description": wf.description, "status": wf.status, "autonomy": wf.autonomy,
           "trigger": {"type": trig["type"], "label": BLOCKS.get(trig["type"], {}).get("label"), "config": trig.get("config", {})},
           "steps": len((wf.graph or {}).get("nodes", [])) - 1, "uses_ai": uses_ai(wf.graph or {}),
           "created_by": {"kind": "helper" if staff else "you", "id": staff.id if staff else None, "name": staff.name if staff else "You"},
           "source": wf.source, "reason": wf.reason, "runs": wf.runs_count or 0, "last_run": run_view(last) if last else None,
           "next_at": X.iso(wf.next_at), "created_at": X.iso(wf.created_at), "updated_at": X.iso(wf.updated_at)}
    if full:
        out["graph"] = wf.graph
        from . import company as C

        out["hook_path"] = f"{C.prefix()}/api/hooks/{wf.hook_token}" if wf.hook_token else None
    return out


def run_view(r: WorkflowRun, full: bool = False) -> dict:
    from . import serialize as X

    st = r.state or {}
    out = {"id": r.id, "workflow_id": r.workflow_id, "status": r.status, "trigger": r.trigger, "started_by": r.started_by, "error": r.error,
           "ai_steps": r.ai_steps, "created_at": X.iso(r.created_at), "started_at": X.iso(r.started_at), "ended_at": X.iso(r.ended_at),
           "waiting": st.get("waiting"),
           "nodes": {k: {kk: vv for kk, vv in v.items() if kk != "output"} for k, v in (st.get("steps") or {}).items()}}
    if full:
        out["input"] = r.input
        out["steps"] = st.get("steps") or {}
    return out


# ------------------------------------------------------------------ the Inbox, proposals from helpers
def inbox_info(db: Session, item: InboxItem) -> dict | None:
    """What a workflow Inbox item is about: a helper's proposed workflow, an "Ask me" step, or a step waiting for your OK."""
    ref = item.ref_id or ""
    kind, _, rest = ref.partition(":")
    if kind == "wf":
        wf = db.get(Workflow, rest)
        return {"type": "proposal", "workflow": view(db, wf, full=True) if wf else None}
    if kind in ("step", "gate"):
        rid, _, nid = rest.partition(":")
        run = db.get(WorkflowRun, rid)
        wf = db.get(Workflow, run.workflow_id) if run else None
        node = next((n for n in (wf.graph or {}).get("nodes", []) if n["id"] == nid), None) if wf else None
        return {"type": "approval" if kind == "step" else "gate", "run_id": rid, "node": node,
                "workflow": {"id": wf.id, "name": wf.name} if wf else None}
    return None


def decide(db: Session, item: InboxItem, decision: str, note: str = "", by: str = "owner") -> InboxItem:
    """Approve or reject a workflow Inbox item. A run that waits on it goes on at the next worker tick."""
    from . import services as S

    if item.kind != "workflow" or item.status == "done":
        raise S.DomainError("not an open workflow item", 409)
    if decision not in ("approved", "rejected"):
        raise S.DomainError("decide approved or rejected")
    kind, _, rest = (item.ref_id or "").partition(":")
    if kind == "wf" and (wf := db.get(Workflow, rest)):
        if decision == "approved":
            activate(db, wf)
        else:
            wf.status = "rejected"
            wf.reason = (wf.reason or "") + (f"\n\nYou said no: {note}" if note else "")
        wf.updated_at = now()
    item.answer, item.status, item.closed_at = decision, "done", now()
    S.audit(db, by, f"workflow.{decision}", item.ref_id or item.id, note=note[:300])
    db.commit()
    return item


def propose(db: Session, st: Staff, name: str, description: str, graph: dict, reason: str, task_id: str | None = None) -> Workflow:
    """A helper suggests a workflow. It waits in the Inbox; nothing runs until you approve it."""
    g = validate(graph)
    for n in g["nodes"]:
        if n["type"] == "ai.helper" and not n["config"].get("staff_id"):
            n["config"]["staff_id"] = st.id
    wf = Workflow(name=name[:120] or "Untitled workflow", description=description[:2000], graph=g, status="pending", autonomy="ask",
                  created_by=f"staff:{st.id}", source=f"task:{task_id}" if task_id else "helper", reason=reason[:2000])
    db.add(wf)
    db.flush()
    steps = "\n".join(f"{i + 1}. {n['label']}" + (f" — {n['note']}" if n["note"] else "") for i, n in enumerate(g["nodes"]))
    ai = " Uses AI in some steps." if uses_ai(g) else " No AI: it costs nothing to run."
    db.add(InboxItem(kind="workflow", ref_id=f"wf:{wf.id}", staff_id=st.id, task_id=task_id, level="decision",
                     title=f"{st.name} suggests a workflow: {wf.name}",
                     body=f"{description}\n\n**Why:** {reason}\n\n**Steps**\n{steps}\n\n{ai.strip()} Approve to switch it on, or open it to change it first."))
    db.commit()
    return wf


# ------------------------------------------------------------------ what helpers do over and over
def _norm_brief(b: str) -> str:
    first = ((b or "").strip().splitlines() or [""])[0].lower()
    first = re.sub(r"\d+|https?://\S+|[^\w\s]", " ", first)
    return " ".join(first.split()[:8])


def patterns(db: Session, days: int = 30) -> list[dict]:
    """Jobs a helper did again and again lately (same shift, or the same kind of brief): good candidates for a workflow."""
    from . import serialize as X
    from .models import Shift

    since = now() - dt.timedelta(days=days)
    groups: dict[tuple, dict] = {}
    for t in db.scalars(select(Task).where(Task.created_at >= since, Task.origin != "execution").order_by(Task.created_at.desc()).limit(2000)):
        if (t.created_by or "").startswith("workflow:"):
            continue
        key = (t.staff_id, f"shift:{t.shift_id}" if t.shift_id else _norm_brief(t.brief))
        if not key[1]:
            continue
        g = groups.setdefault(key, {"staff_id": t.staff_id, "key": key[1], "count": 0, "cost_usd": 0.0, "tokens": 0, "example": t.brief[:400],
                                    "last_at": t.created_at, "task_ids": []})
        g["count"] += 1
        g["cost_usd"] += t.cost_usd or 0
        g["tokens"] += t.tokens or 0
        if len(g["task_ids"]) < 5:
            g["task_ids"].append(t.id)
    out = []
    for g in groups.values():
        if g["count"] < 3:
            continue
        st = db.get(Staff, g["staff_id"])
        if not st or st.status == "retired":
            continue
        title = g["example"].strip().splitlines()[0][:100] if g["example"].strip() else "Repeated job"
        if g["key"].startswith("shift:") and (sh := db.get(Shift, g["key"][6:])):
            title = sh.name
        out.append({"staff": {"id": st.id, "name": st.name}, "title": title, "count": g["count"], "cost_usd": round(g["cost_usd"], 2),
                    "tokens": g["tokens"], "example": g["example"], "last_at": X.iso(g["last_at"]), "task_ids": g["task_ids"],
                    "per_week": round(g["count"] / max(days / 7, 1), 1)})
    out.sort(key=lambda x: (-x["count"], -x["cost_usd"]))
    return out[:12]


def build_brief(description: str, examples: list[str] | None = None) -> str:
    ex = "\n".join(f"- {e[:300]}" for e in (examples or []))
    return (f"Design a workflow automation for this:\n\n{description}\n\n"
            + (f"It replaces jobs like these:\n{ex}\n\n" if ex else "")
            + "Call workflow_blocks to see the blocks, then propose_workflow with a graph: one trigger, then steps that use "
              "connectors, web requests and data steps; use AI steps (ai.extract, ai.helper) only where thinking is needed. "
              "Put an 'Ask me' step before anything that sends, publishes or spends. The owner approves it in the Inbox. "
              "Then report what you proposed.")


# ------------------------------------------------------------------ the marketplace (ready-made workflows)
def _templates_dir():
    from pathlib import Path

    return Path(__file__).parent / "templates" / "workflows"


def market() -> list[dict]:
    out = []
    for f in sorted(_templates_dir().glob("*.json")):
        try:
            t = json.loads(f.read_text())
        except ValueError:
            continue
        g = t.get("graph") or {}
        out.append({"slug": f.stem, "name": t.get("name", f.stem), "description": t.get("description", ""), "category": t.get("category", "Other"),
                    "icon": t.get("icon", "ri-flow-chart"), "needs": t.get("needs", []), "uses_ai": uses_ai(g),
                    "trigger": BLOCKS.get(next((n["type"] for n in g.get("nodes", []) if BLOCKS.get(n["type"], {}).get("trigger")), ""), {}).get("label"),
                    "steps": max(len(g.get("nodes", [])) - 1, 0), "by": t.get("by", "Saga OS"), "graph": g})
    return out


def _fill_placeholders(db: Session, graph: dict) -> tuple[dict, list[str]]:
    """@chief → your Chief of Staff, @role:<words> → a helper whose job matches; connectors by kind word."""
    from . import services as S

    missing: list[str] = []
    team = S.team(db)
    chief = S.chief(db)

    def pick_staff(v: str) -> str:
        if v == "@chief":
            return chief.id if chief else (team[0].id if team else "")
        if v.startswith("@role:"):
            words = v[6:].lower().split()
            for st in team:
                hay = f"{st.name} {st.id} {(st.job or '')[:400]}".lower()
                if any(w in hay for w in words):
                    return st.id
            return chief.id if chief else (team[0].id if team else "")
        return v
    g = json.loads(json.dumps(graph))
    for n in g.get("nodes", []):
        c = n.setdefault("config", {})
        if isinstance(c.get("staff_id"), str) and c["staff_id"].startswith("@"):
            c["staff_id"] = pick_staff(c["staff_id"])
        if isinstance(c.get("connector"), str) and c["connector"].startswith("@"):
            word = c["connector"][1:].lower()
            conn = next((x for x in db.scalars(select(Connector)) if word in f"{x.id} {x.label} {x.url} {x.command} {' '.join(x.args or [])}".lower()), None)
            if conn:
                c["connector"] = conn.id
            else:
                missing.append(word)
                c["connector"] = ""
    return g, missing


def install(db: Session, slug: str, by: str = "owner") -> tuple[Workflow, list[str]]:
    t = next((m for m in market() if m["slug"] == slug), None)
    if not t:
        raise KeyError(slug)
    g, missing = _fill_placeholders(db, t["graph"])
    wf = Workflow(name=t["name"], description=t["description"], graph=validate(g), status="draft", autonomy="ask",
                  created_by=by, source=f"market:{slug}")
    db.add(wf)
    db.commit()
    return wf, missing


def export(wf: Workflow) -> dict:
    g = json.loads(json.dumps(wf.graph or {}))
    for n in g.get("nodes", []):
        c = n.get("config") or {}
        if c.get("staff_id"):
            c["staff_id"] = "@chief"
    return {"saga_workflow": 1, "name": wf.name, "description": wf.description, "graph": g}
