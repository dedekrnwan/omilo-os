"""MCP server (Streamable HTTP, JSON responses) that every staff agent connects to.

One endpoint: POST {public_url}/mcp with `Authorization: Bearer <staff MCP token>`.
The token identifies the staff agent; every tool call is checked against that agent's permissions
and logged in `tool_call`. Implemented directly on JSON-RPC so it has no SDK version churn.
"""
import json
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select

from . import policy
from . import services as S
from .db import get_db
from .models import Proposal, Staff, Task, ToolCall
from .security import staff_from_mcp_token

router = APIRouter()
SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "saga-os", "title": "Saga OS gateway", "version": "0.2.0"}
INSTRUCTIONS = (
    "You are a staff agent of a company run on Saga OS. Use these tools to read company context, "
    "save checkpoints, report results and ask for approval. Agents propose, the founder decides: "
    "anything with a side effect outside the company goes through request_action or propose."
)


def _s(type_, desc, **extra):
    return {"type": type_, "description": desc, **extra}


TOOLS: list[dict] = [
    {"name": "whoami", "description": "Your staff identity, job and permission levels.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "get_context", "description": "Company knowledge (profile, goals, offer, voice, rules, systems) and latest KPIs. Optionally filter by topics, e.g. ['voice','offer'].",
     "inputSchema": {"type": "object", "properties": {"topics": _s("array", "file-name keywords to include", items={"type": "string"})}}},
    {"name": "get_task", "description": "The brief of a task: founder note, latest checkpoint, and for execution tasks the exact approved text.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id")}, "required": ["task_id"]}},
    {"name": "checkpoint", "description": "Save progress so any harness can resume this task. Call at least every 10 tool calls and before any gated action.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "plan": _s("array", "checklist of steps", items={"type": "string"}),
                     "done": _s("string", "what is done"), "next": _s("string", "the next step"), "notes": _s("string", "decisions, open questions")},
                     "required": ["task_id", "next"]}},
    {"name": "report", "description": "Close your task with a report. Headline = one line, numbers first. Body = markdown: Summary, Done, Needs founder, Handoffs.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "headline": _s("string", "one-line result"),
                     "body": _s("string", "markdown report"), "kpis": _s("object", "optional KPI name -> number")}, "required": ["task_id", "headline", "body"]}},
    {"name": "propose", "description": "Put something in the founder's Inbox for approval. Include the exact text, command or change to execute if approved.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "title": _s("string", "short title"),
                     "type": _s("string", "action type, e.g. content.publish, outreach.send, ops.command, staff.change"),
                     "risk": _s("string", "low | medium | high", enum=["low", "medium", "high"]), "body": _s("string", "markdown: what, why, exact content")},
                     "required": ["title", "type", "body"]}},
    {"name": "revise_proposal", "description": "Replace the text of one of your pending (or changes-requested) proposals; the old version is kept.",
     "inputSchema": {"type": "object", "properties": {"proposal_id": _s("string", "proposal id"), "body": _s("string", "full new text"),
                     "summary": _s("string", "what changed")}, "required": ["proposal_id", "body"]}},
    {"name": "get_approved", "description": "Your approved proposals waiting to be executed, with the exact approved text.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "mark_executed", "description": "Confirm you executed an approved proposal (or that it failed), with evidence.",
     "inputSchema": {"type": "object", "properties": {"proposal_id": _s("string", "proposal id"), "ok": _s("boolean", "true if it worked"),
                     "result": _s("string", "what happened, links, ids")}, "required": ["proposal_id", "ok", "result"]}},
    {"name": "request_action", "description": "Before any side effect (publish, send, run a command, spend), ask the gateway. Answers allowed, needs_approval (filed as a proposal) or refused.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "action": _s("string", "action type, e.g. outreach.send"),
                     "summary": _s("string", "one line"), "details": _s("string", "exact content or command")}, "required": ["action", "summary", "details"]}},
    {"name": "ask_founder", "description": "Ask the founder a question. Set blocking=true if your work stops until they answer. The answer arrives as a new task.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "question": _s("string", "the question, with options if any"),
                     "blocking": _s("boolean", "work stops until answered")}, "required": ["question"]}},
    {"name": "post_message", "description": "Post a progress note into your task's thread (the founder can read it).",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "text": _s("string", "markdown")}, "required": ["task_id", "text"]}},
    {"name": "offer_choices", "description": "Show the founder clickable options in the current chat or task thread (e.g. pick a direction). Their pick comes back as their next message.",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id, if this is about a task"), "question": _s("string", "short question"),
                     "options": _s("array", "2-6 short options", items={"type": "string"})}, "required": ["question", "options"]}},
    {"name": "update_kpi", "description": "Record a KPI value with its source (Finance only unless permitted).",
     "inputSchema": {"type": "object", "properties": {"name": _s("string", "kpi name"), "value": _s("number", "value"),
                     "period": _s("string", "e.g. 2026-W42"), "source": _s("string", "where the number comes from")}, "required": ["name", "value", "source"]}},
    {"name": "create_task", "description": "Delegate a task to another staff agent (Chief of Staff only unless permitted).",
     "inputSchema": {"type": "object", "properties": {"staff_id": _s("string", "who should do it"), "brief": _s("string", "what to do and why"),
                     "parent_task_id": _s("string", "your task id")}, "required": ["staff_id", "brief"]}},
    {"name": "log_usage", "description": "Report tokens and cost spent on a task (for the budget meter).",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "tokens": _s("integer", "tokens"),
                     "cost_usd": _s("number", "cost in USD")}, "required": ["task_id"]}},
]
TOOL_NAMES = {t["name"] for t in TOOLS}


def _proposal_view(p: Proposal) -> dict:
    return {"id": p.id, "title": p.title, "type": p.type, "status": p.status, "approved_text": S.current_body(p),
            "founder_note": p.decision_note}


def call_tool(db, st: Staff, name: str, args: dict) -> tuple[str, dict]:
    """Returns (decision, result). Raises S.DomainError for refusals the agent should read."""
    if name == "whoami":
        levels = {a: policy.describe(policy.level_for(a, st.permissions, S.strict_mode(db))) for a in sorted(policy.DEFAULTS)}
        return "allowed", {"id": st.id, "name": st.name, "chief_of_staff": st.is_chief, "job": st.job, "permissions": levels}
    if name == "get_context":
        return "allowed", {"context": S.company_context(db, args.get("topics"))}
    if name == "get_task":
        t = S.task_for_staff(db, st, args["task_id"])
        ck = S.latest_checkpoint(db, t.id)
        out = {"id": t.id, "origin": t.origin, "status": t.status, "brief": t.brief, "founder_note": t.founder_note,
               "checkpoint": ck and {"plan": ck.plan, "done": ck.done, "next": ck.next, "notes": ck.notes}}
        if t.proposal_id and (p := db.get(Proposal, t.proposal_id)):
            out["proposal"] = _proposal_view(p)
        return "allowed", out
    if name == "checkpoint":
        c = S.write_checkpoint(db, st, args["task_id"], args.get("plan"), args.get("done", ""), args["next"], args.get("notes", ""))
        return "allowed", {"checkpoint_id": c.id}
    if name == "report":
        r = S.write_report(db, st, args["task_id"], args["headline"], args["body"], args.get("kpis"))
        return "allowed", {"report_id": r.id, "message": "Report saved. Your task closes when you finish."}
    if name == "propose":
        if args.get("task_id"):
            S.task_for_staff(db, st, args["task_id"])
        p = S.create_proposal(db, st, args.get("task_id"), args["title"], args["type"], args.get("risk", "medium"), args["body"])
        return "proposal", {"proposal_id": p.id, "message": "In the founder's Inbox. Do not act on it until it comes back approved."}
    if name == "revise_proposal":
        p = db.get(Proposal, args["proposal_id"])
        if not p or p.staff_id != st.id:
            raise S.DomainError("not your proposal", 403)
        p = S.revise_proposal(db, p, args["body"], f"staff:{st.id}", args.get("summary", ""))
        return "allowed", {"proposal_id": p.id, "revision": p.current_revision}
    if name == "get_approved":
        rows = db.scalars(select(Proposal).where(Proposal.staff_id == st.id, Proposal.status.in_(["approved", "executing"])))
        return "allowed", {"approved": [_proposal_view(p) for p in rows]}
    if name == "mark_executed":
        p = S.mark_executed(db, st, args["proposal_id"], bool(args["ok"]), args["result"])
        return "allowed", {"proposal_id": p.id, "status": p.status}
    if name == "request_action":
        res = S.request_action(db, st, args.get("task_id"), args["action"], args["summary"], args["details"])
        return {"allowed": "allowed", "needs_approval": "proposal", "refused": "refused"}[res["decision"]], res
    if name == "ask_founder":
        item = S.ask_founder(db, st, args.get("task_id"), args["question"], bool(args.get("blocking")))
        return "proposal", {"question_id": item.id, "message": "Asked. The answer will arrive as a new task."}
    if name == "post_message":
        t = S.task_for_staff(db, st, args["task_id"])
        th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        m = S.post_message(db, th, "agent", st.id, args["text"])
        return "allowed", {"message_id": m.id}
    if name == "offer_choices":
        from .events import current_run

        opts = [str(o)[:120] for o in (args.get("options") or [])][:6]
        if len(opts) < 2:
            raise S.DomainError("give 2-6 options")
        task_id, thread_id = current_run(db, st.id, args.get("task_id"))
        if task_id:
            t = S.task_for_staff(db, st, task_id)
            th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        elif thread_id:
            th = db.get(S.Thread, thread_id)
        else:
            raise S.DomainError("no open task or chat to show the options in")
        m = S.post_message(db, th, "agent", st.id, str(args["question"]), blocks=[{"type": "choices", "options": opts}])
        return "allowed", {"message_id": m.id, "thread_id": th.id}
    if name == "update_kpi":
        if policy.level_for("kpi.write", st.permissions) < policy.DO_AND_TELL:
            raise S.DomainError("you may not write KPIs; ask Finance or propose it", 403)
        k = S.record_kpi(db, st, args["name"], args["value"], args.get("period", ""), args["source"])
        return "allowed", {"kpi_id": k.id}
    if name == "create_task":
        level = policy.level_for("staff.delegate", st.permissions) if not st.is_chief else policy.AUTO
        if level < policy.DO_AND_TELL:
            raise S.DomainError("only the Chief of Staff may delegate tasks", 403)
        if args["staff_id"] == st.id:
            raise S.DomainError("delegate to someone else")
        depth, parent = 0, args.get("parent_task_id")
        while parent and depth < 5:
            pt = db.get(Task, parent)
            parent = pt.parent_task_id if pt and pt.origin == "delegation" else None
            depth += 1
        if depth >= 2:
            raise S.DomainError("delegation is limited to 2 levels")
        t = S.create_task(db, args["staff_id"], "delegation", args["brief"], f"staff:{st.id}", parent_task_id=args.get("parent_task_id"))
        return "allowed", {"task_id": t.id}
    if name == "log_usage":
        t = S.task_for_staff(db, st, args["task_id"])
        t.tokens += int(args.get("tokens") or 0)
        t.cost_usd += float(args.get("cost_usd") or 0)
        db.commit()
        return "allowed", {"ok": True}
    raise S.DomainError(f"unknown tool {name}", 404)


def _rpc_result(id_, result):
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _rpc_error(id_, code, message):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def _handle(db, st: Staff, msg: dict) -> dict | None:
    method, id_ = msg.get("method"), msg.get("id")
    if id_ is None:  # notification
        return None
    params = msg.get("params") or {}
    if method == "initialize":
        req = params.get("protocolVersion")
        ver = req if req in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0]
        return _rpc_result(id_, {"protocolVersion": ver, "capabilities": {"tools": {"listChanged": False}},
                                 "serverInfo": SERVER_INFO, "instructions": INSTRUCTIONS})
    if method == "ping":
        return _rpc_result(id_, {})
    if method == "tools/list":
        return _rpc_result(id_, {"tools": TOOLS})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        t0 = time.monotonic()
        decision, payload, is_error = "error", {}, True
        try:
            if name not in TOOL_NAMES:
                raise S.DomainError(f"unknown tool {name}", 404)
            decision, payload = call_tool(db, st, name, args)
            is_error = False
        except S.DomainError as e:
            decision, payload = ("refused" if e.code in (403, 409, 429) else "error"), {"error": str(e)}
            db.rollback()
        except KeyError as e:
            payload = {"error": f"missing argument {e}"}
            db.rollback()
        ms = int((time.monotonic() - t0) * 1000)
        db.add(ToolCall(staff_id=st.id, task_id=str(args.get("task_id") or ""), tool=str(name), decision=decision,
                        detail=json.dumps(payload)[:500], duration_ms=ms))
        try:
            from .events import current_run, record

            run_task, run_thread = current_run(db, st.id, args.get("task_id"))
            record("tool", {"name": f"saga-os · {name}", "input": args, "output": payload, "ok": not is_error, "decision": decision, "ms": ms},
                   staff_id=st.id, task_id=run_task, thread_id=run_thread, db=db)
        except Exception:  # noqa: BLE001 - never fail a tool call over the live view
            pass
        db.commit()
        return _rpc_result(id_, {"content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False, default=str)}],
                                 "structuredContent": payload, "isError": is_error})
    return _rpc_error(id_, -32601, f"method not found: {method}")


@router.post("/mcp")
async def mcp_post(request: Request):
    raw = request.headers.get("authorization", "")
    token = raw[7:].strip() if raw.lower().startswith("bearer ") else None
    db = next(get_db())
    try:
        st = staff_from_mcp_token(db, token)
        if not st:
            return JSONResponse({"error": "invalid or missing staff MCP token"}, status_code=401)
        if st.status != "active":
            return JSONResponse({"error": f"staff {st.id} is paused"}, status_code=403)
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(_rpc_error(None, -32700, "parse error"), status_code=400)
        if isinstance(body, list):
            out = [r for r in (_handle(db, st, m) for m in body) if r is not None]
            return JSONResponse(out) if out else Response(status_code=202)
        res = _handle(db, st, body)
        return JSONResponse(res) if res is not None else Response(status_code=202)
    finally:
        db.close()


@router.get("/mcp")
async def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp")
async def mcp_delete():
    return Response(status_code=405, headers={"Allow": "POST"})
