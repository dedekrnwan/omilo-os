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
from .models import Proposal, Staff, StaffRelation, Task, ToolCall
from .security import staff_from_mcp_token

# Maximum delegation chain depth.  Configurable via Setting("delegation_max_depth"); falls back to this.
MAX_DELEGATION_DEPTH = 2

router = APIRouter()
SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]
SERVER_INFO = {"name": "omilo", "title": "Omilo gateway", "version": "0.3.0"}
INSTRUCTIONS = (
    "You are a staff agent of a company run on Omilo. Use these tools to read company context, "
    "save checkpoints, report results and ask for approval. Agents propose, the founder decides: "
    "anything with a side effect outside the company goes through request_action or propose. "
    "Work you repeat (same steps every day or week) should become a workflow: check list_workflows and run one if it fits; "
    "otherwise suggest one with propose_workflow (the founder approves it)."
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
    {"name": "request_access", "description": "Ask the founder for access to a folder, connector or skill you need but don't have. "
                                               "Renders an inline card in the current chat/task thread and files it in the Inbox. "
                                               "kind: folder | connector | skill. "
                                               "target (folder): {path, access: read|write, commands: bool}. "
                                               "target (connector): {id}. "
                                               "target (skill): {slug}.",
     "inputSchema": {"type": "object", "properties": {
         "task_id": _s("string", "task id, if this is about a task"),
         "kind": _s("string", "folder | connector | skill", enum=["folder", "connector", "skill"]),
         "target": _s("object", "what you need access to — shape depends on kind"),
         "reason": _s("string", "why you need it (shown in the Inbox card)"),
     }, "required": ["kind", "target", "reason"]}},
    {"name": "propose_job", "description": "Propose (or revise) your own job to the founder: what you will own, measurable goals, "
                                           "first moves and open questions. Shows an Approve card in the current chat (or your chat with "
                                           "the founder); approving adds it to your job description. Use it when the founder asks you to change "
                                           "your job, or when you learn your work should change.",
     "inputSchema": {"type": "object", "properties": {
         "responsibilities": _s("array", "3-6 concrete things you will own", items={"type": "string"}),
         "goals": _s("array", "1-3 measurable goals (number + by when)", items={"type": "string"}),
         "ideas": _s("array", "first moves you suggest", items={"type": "string"}),
         "questions": _s("array", "what you still need to know", items={"type": "string"}),
         "note": _s("string", "one or two sentences to the founder: what changed and why"),
     }, "required": ["responsibilities"]}},
    {"name": "skills_list", "description": "The skills you can use: team skills and your own. Read one with skill_read before you rely on it.",
     "inputSchema": {"type": "object", "properties": {}, "required": []}},
    {"name": "skill_read", "description": "Read a skill (its steps, checklist and examples).",
     "inputSchema": {"type": "object", "properties": {"slug": _s("string", "skill id")}, "required": ["slug"]}},
    {"name": "skill_save", "description": "Write or improve a skill: reusable know-how (steps, checklist, rules, examples) so you do it better next "
                                          "time. It is yours and works at once. share=true asks the founder to make it a team skill every helper "
                                          "uses. Changing a team skill sends your version to the founder for approval. Skills from a folder you "
                                          "can read (e.g. a SKILL.md file) can be saved this way too.",
     "inputSchema": {"type": "object", "properties": {
         "slug": _s("string", "short id: lowercase, digits, dashes"), "name": _s("string", "title"),
         "description": _s("string", "one line: when to use it"), "body": _s("string", "markdown: the steps, checklist, rules, examples"),
         "share": _s("boolean", "ask the founder to share it with the whole team")}, "required": ["slug", "name", "body"]}},
    {"name": "ask_teammate", "description": "Ask a teammate (another helper) a question to learn from them or agree on something. It goes to the "
                                            "team chat, where they answer right after and the founder can follow along.",
     "inputSchema": {"type": "object", "properties": {"teammate": _s("string", "their id or name"), "question": _s("string", "the question, with context")},
                     "required": ["teammate", "question"]}},
    {"name": "read_team_chat", "description": "Read the latest messages of the team chat (answers to your questions, what teammates discuss).",
     "inputSchema": {"type": "object", "properties": {"limit": _s("integer", "how many messages (default 20)")}, "required": []}},
    {"name": "message_founder", "description": "Write to the founder in your own chat, on your own initiative: an idea that helps their goals, a "
                                               "check-in, or a question about your work. Only when it is worth their time (a few a day at most). "
                                               "options: clickable replies.",
     "inputSchema": {"type": "object", "properties": {"text": _s("string", "short message, markdown"),
                                                      "options": _s("array", "2-5 short clickable replies", items={"type": "string"})}, "required": ["text"]}},
    {"name": "docs_search", "description": "Search the shared Docs (notes for the owner and all helpers) by words. Returns paths, titles and snippets.",
     "inputSchema": {"type": "object", "properties": {"query": _s("string", "words to look for; empty lists recent docs")}, "required": []}},
    {"name": "docs_read", "description": "Read one doc from the shared Docs, with its version, [[links]] and backlinks.",
     "inputSchema": {"type": "object", "properties": {"path": _s("string", "e.g. 'Projects/Launch plan' or 'Company/company'")}, "required": ["path"]}},
    {"name": "docs_write", "description": "Create or update a doc in the shared Docs (Markdown, [[wiki links]] to other docs). Pass base_version "
                                          "from docs_read when editing, so you do not overwrite someone else's change. Company/ docs become a "
                                          "suggestion the owner approves.",
     "inputSchema": {"type": "object", "properties": {"path": _s("string", "doc path, folders with /"), "content": _s("string", "the full new Markdown"),
                                                      "base_version": _s("integer", "version you read (omit for a new doc)"),
                                                      "summary": _s("string", "one line: what you changed and why"),
                                                      "task_id": _s("string", "task id, if this is part of a task")}, "required": ["path", "content"]}},
    {"name": "remember", "description": "Keep something for next time in your memory (Docs → Memory, which the founder can read and edit). "
                                         "Use it for facts, preferences and what worked. Give a title to keep a topic note, e.g. 'Posting times'.",
     "inputSchema": {"type": "object", "properties": {"text": _s("string", "what to remember, one or two sentences"),
                                                      "title": _s("string", "optional topic note title")}, "required": ["text"]}},
    {"name": "recall", "description": "Search the company's knowledge base by meaning and words: Docs, memory and lessons, finished jobs, "
                                       "chats, approved work, uploaded files, saved web pages and connector data. Use before you start.",
     "inputSchema": {"type": "object", "properties": {"query": _s("string", "what you want to know, in plain words"),
                                                      "kinds": _s("array", "only these kinds: doc, memory, context, job, chat, proposal, file, web, connector, workflow, note",
                                                                  items={"type": "string"}),
                                                      "memory_only": _s("boolean", "only search memory (Docs → Memory)"),
                                                      "limit": _s("integer", "how many pieces (default 8)"), "task_id": _s("string", "your task id")},
                     "required": ["query"]}},
    {"name": "kb_add", "description": "Save something to the knowledge base so every helper can find it later: a web page you read, data "
                                      "from a connector, a fact sheet. Give the source address if there is one. Same source again = update.",
     "inputSchema": {"type": "object", "properties": {"title": _s("string", "short title"), "text": _s("string", "the content (Markdown is fine)"),
                                                      "url": _s("string", "where it came from, if anywhere"),
                                                      "kind": _s("string", "web | connector | note (default: web when url is given, else note)",
                                                                 enum=["web", "connector", "note"]),
                                                      "task_id": _s("string", "your task id")}, "required": ["title", "text"]}},
    {"name": "review_week", "description": "Chief of Staff, for the weekly retro: every loop's scorecard, each helper's jobs, your decisions "
                                            "and notes, their lessons and schedules, and recent improvements with their measured effect.",
     "inputSchema": {"type": "object", "properties": {"days": _s("integer", "how many days back (default 7)")}, "required": []}},
    {"name": "improve", "description": "Chief of Staff, in the retro: change how a helper works, right away. kind = job (new full instructions), "
                                        "shift_brief / shift_schedule (needs shift_id; schedule is cron), or lessons (the cleaned-up list). "
                                        "At most 3 a week. Each change is measured and rolled back automatically if results get worse. "
                                        "Permissions, budgets, engines and approvals cannot be changed.",
     "inputSchema": {"type": "object", "properties": {"staff_id": _s("string", "the helper to improve"), "kind": _s("string", "job | shift_brief | shift_schedule | lessons"),
                                                      "change": _s("string", "the new text (for lessons: one lesson per line)"), "shift_id": _s("string", "for shift_* kinds"),
                                                      "reason": _s("string", "why, with the evidence from review_week"),
                                                      "task_id": _s("string", "your retro task id")}, "required": ["staff_id", "kind", "change", "reason"]}},
    {"name": "tune_helper", "description": "Chief of Staff: tune a helper's instructions by trying variants on one task and keeping the best; off unless the owner enabled self-tuning.",
     "inputSchema": {"type": "object", "properties": {"staff_id": _s("string", "the helper to tune"),
                                                      "brief": _s("string", "the task brief to use for probing (optional; falls back to the helper's last task)")},
                     "required": ["staff_id"]}},
    {"name": "share_file", "description": "Show the founder a file you made or found (report, image, CSV, code, PDF) as a card they can preview and download, "
                                           "in the current chat or task thread. The file must be in your workspace or a shared folder (25 MB max).",
     "inputSchema": {"type": "object", "properties": {"path": _s("string", "absolute path, or relative to your workspace"), "note": _s("string", "one line about it"),
                                                      "task_id": _s("string", "task id, if this is about a task")}, "required": ["path"]}},
    {"name": "update_kpi", "description": "Record a KPI value with its source (Finance only unless permitted).",
     "inputSchema": {"type": "object", "properties": {"name": _s("string", "kpi name"), "value": _s("number", "value"),
                     "period": _s("string", "e.g. 2026-W42"), "source": _s("string", "where the number comes from")}, "required": ["name", "value", "source"]}},
    {"name": "create_task", "description": "Delegate a task to another staff agent (Chief of Staff only unless permitted). "
                                           "Specify the assignee via staff_id (exact id) or role (e.g. 'marketing'); one of the two is required.",
     "inputSchema": {"type": "object", "properties": {"staff_id": _s("string", "who should do it (exact id); alternative to role"),
                     "role": _s("string", "the role to delegate to, e.g. 'marketing'; alternative to staff_id"),
                     "brief": _s("string", "what to do and why"),
                     "parent_task_id": _s("string", "your task id"),
                     "goal_id": _s("string", "the founder's goal this serves (ids from get_context → goals); sub-jobs inherit it")}, "required": ["brief"]}},
    {"name": "log_usage", "description": "Report tokens and cost spent on a task (for the budget meter).",
     "inputSchema": {"type": "object", "properties": {"task_id": _s("string", "task id"), "tokens": _s("integer", "tokens"),
                     "cost_usd": _s("number", "cost in USD")}, "required": ["task_id"]}},
    {"name": "list_workflows", "description": "The company's workflow automations (active, paused, waiting for approval): what they do and how to start them. "
                                              "Before doing repeated work by hand, check if a workflow already does it and run it instead (cheaper, no AI).",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "workflow_blocks", "description": "The blocks a workflow can use (triggers, apps, data, logic, AI) with their config fields. Read before propose_workflow.",
     "inputSchema": {"type": "object", "properties": {}}},
    {"name": "propose_workflow", "description": "Suggest a workflow automation for work you do again and again. It waits in the owner's Inbox; nothing runs until "
                                                "they approve. Graph: {nodes:[{id,type,label,note,config,x,y}], edges:[{from,port,to}]}; exactly one trigger; "
                                                "ports: 'out', If → 'true'/'false', Ask me → 'approved'/'rejected'. Templates in config: {{ trigger.x }}, "
                                                "{{ steps.<id>.output.y }}, {{ last }}. Prefer app/data steps; use AI steps only for thinking. Put 'Ask me' before "
                                                "sending, publishing or spending.",
     "inputSchema": {"type": "object", "properties": {"name": _s("string", "short name"), "description": _s("string", "what it does, in one or two lines"),
                                                      "reason": _s("string", "why: what repeated work it replaces, how often, what it saves"),
                                                      "graph": _s("object", "the workflow graph"), "task_id": _s("string", "your task id")},
                     "required": ["name", "description", "reason", "graph"]}},
    {"name": "run_workflow", "description": "Start an active workflow with an input (it runs in the background; risky steps still wait for the owner).",
     "inputSchema": {"type": "object", "properties": {"workflow_id": _s("string", "workflow id"), "input": _s("object", "the trigger input"),
                                                      "task_id": _s("string", "your task id")}, "required": ["workflow_id"]}},
    {"name": "get_workflow_run", "description": "Status and step outputs of a workflow run.",
     "inputSchema": {"type": "object", "properties": {"run_id": _s("string", "run id")}, "required": ["run_id"]}},
    {"name": "complete_goal", "description": "Mark a goal as done after reviewing all work against its target. "
                                             "Writes an audit trail with the outcome. Available to the Chief of Staff "
                                             "and any reviewing staff (staff with staff.delegate permission).",
     "inputSchema": {"type": "object", "properties": {
         "goal_id": _s("string", "id of the goal to complete"),
         "outcome": _s("string", "one or two sentences summarising what was achieved"),
     }, "required": ["goal_id", "outcome"]}},
]
TOOL_NAMES = {t["name"] for t in TOOLS}


def _proposal_view(p: Proposal) -> dict:
    return {"id": p.id, "title": p.title, "type": p.type, "status": p.status, "approved_text": S.current_body(p),
            "founder_note": p.decision_note}


async def call_tool(db, st: Staff, name: str, args: dict) -> tuple[str, dict]:
    """Returns (decision, result). Raises S.DomainError for refusals the agent should read."""
    if name == "whoami":
        levels = {a: policy.describe(policy.level_for(a, st.permissions, S.strict_mode(db))) for a in sorted(policy.DEFAULTS)}
        return "allowed", {"id": st.id, "name": st.name, "chief_of_staff": st.is_chief, "job": st.job, "permissions": levels}
    if name == "get_context":
        from .kpis import for_prompt as kpis_for_prompt
        from .plan import goals_for_prompt

        return "allowed", {"context": S.company_context(db, args.get("topics")), "goals": goals_for_prompt(db), "kpis": kpis_for_prompt(db)}
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
        from .events import current_run

        task_id_arg, thread_id = current_run(db, st.id, args.get("task_id"))
        if task_id_arg:
            t = S.task_for_staff(db, st, task_id_arg)
            th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        elif thread_id:
            th = db.get(S.Thread, thread_id)
        else:
            th = None  # background call: no chat, no error — create proposal + inbox item only
        p = S.create_proposal(
            db, st, task_id_arg, args["title"], args["type"], args.get("risk", "medium"), args["body"],
            thread_id=th.id if th else None, th=th,
        )
        # Graph-brain staff: the Chief of Staff rules low/medium proposals inline (same
        # seam as request_action). high / no-CoS / the CoS's own action fall through to
        # the owner. single_engine is byte-for-byte unchanged (returns None).
        ruled = S._cos_rule(db, st, p)
        if ruled is not None:
            return "allowed", {"proposal_id": p.id, "message": "The Chief of Staff approved this."}
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
        from .events import current_run

        task_id_arg, thread_id = current_run(db, st.id, args.get("task_id"))
        if task_id_arg:
            t = S.task_for_staff(db, st, task_id_arg)
            th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        elif thread_id:
            th = db.get(S.Thread, thread_id)
        else:
            th = None  # background call: no chat, no error — file question to inbox only
        item = S.ask_founder(
            db, st, task_id_arg, args["question"], bool(args.get("blocking")),
            thread_id=th.id if th else None, th=th,
        )
        return "proposal", {"question_id": item.id, "message": "Asked. The answer will arrive as a new task."}
    if name == "post_message":
        t = S.task_for_staff(db, st, args["task_id"])
        th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        m = S.post_message(db, th, "agent", st.id, args["text"])
        return "allowed", {"message_id": m.id}
    if name in ("docs_search", "docs_read", "docs_write"):
        from . import docs as D
        from . import policy as P

        try:
            if name == "docs_search":
                return "allowed", {"results": D.search(db, str(args.get("query") or ""), 15)}
            if name == "docs_read":
                d = D.read(db, str(args["path"]))
                return "allowed", {k: d[k] for k in ("path", "title", "content", "version", "links", "backlinks")}
            path = str(args["path"])
            action = "knowledge.write" if D.is_company(path) else "docs.write"
            level = P.level_for(action, st.permissions, S.strict_mode(db))
            if level == P.OFF:
                return "refused", {"message": f"{st.name} may not change docs here ({action} is off)."}
            if level == P.ASK:
                res = D.suggest(db, st, args.get("task_id"), path, str(args["content"]), str(args.get("summary") or ""))
                return "proposal", {**res, "message": "Saved as a suggestion; the owner approves it in the Inbox."}
            base = args.get("base_version")
            res = D.write(db, path, str(args["content"]), author=st.id, author_kind="agent",
                          base_version=int(base) if base is not None else None, summary=str(args.get("summary") or ""))
            return "allowed", res
        except D.DocError as e:
            if e.code == 409:
                return "allowed", {"conflict": True, "message": str(e) + ": read it again, merge your change, and write with the new base_version.",
                                   "current_version": e.extra["current"]["version"]}
            raise S.DomainError(str(e), e.code) from e

    if name == "kb_add":
        from . import kb

        kind = args.get("kind") or ("web" if args.get("url") else "note")
        if kind not in ("web", "connector", "note"):
            raise S.DomainError("kind is web, connector or note")
        ref = str(args.get("url") or f"{st.id}:{args['title']}")
        src = kb.put(db, kind, ref, str(args["title"]), str(args["text"])[:200_000], url=str(args.get("url") or ""), staff_id=st.id,
                     meta={"added_by": st.id, "task_id": args.get("task_id")})
        return "allowed", {"source_id": src.id, "chunks": src.chunks}
    if name in ("remember", "recall"):
        from . import docs as D
        from . import memory as M

        try:
            if name == "remember":
                path = M.remember(db, st, str(args["text"]), (str(args["title"]).strip() or None) if args.get("title") else None)
                return "allowed", {"saved_in": path}
            from . import kb

            kinds = ["memory"] if args.get("memory_only") else (args.get("kinds") or None)
            res = kb.search(db, str(args.get("query") or ""), int(args.get("limit") or 8), kinds=kinds, who=st.id,
                            task_id=str(args.get("task_id") or ""), via="recall")
            return "allowed", {"mode": res["mode"], "results": [
                {"title": r["title"], "kind": r["kind"], "path": r["ref"] if r["kind"] in ("doc", "memory", "context") else None,
                 "source": r["url"] or r["ref"], "section": r["heading"], "snippet": r["text"][:300], "text": r["text"], "score": r["score"]}
                for r in res["results"]]}
        except D.DocError as e:
            raise S.DomainError(str(e), e.code) from e
    if name in ("review_week", "improve"):
        from . import loops as L

        if not st.is_chief:
            raise S.DomainError("only the Chief of Staff runs the retro", 403)
        if name == "review_week":
            return "allowed", L.review(db, int(args.get("days") or 7))
        try:
            imp = L.improve(db, st, str(args["staff_id"]), str(args["kind"]), args["change"], str(args.get("reason") or ""),
                            shift_id=args.get("shift_id"), task_id=args.get("task_id"))
        except L.LoopError as e:
            raise S.DomainError(str(e), e.status) from e
        return "allowed", {"improvement_id": imp.id, "message": "Applied. It will be measured after a week and rolled back if results get worse."}
    if name == "tune_helper":
        from . import tune

        if not st.is_chief:
            raise S.DomainError("only the Chief of Staff tunes helpers", 403)
        imp = await tune.refine(db, args["staff_id"], brief=args.get("brief"))
        if imp is not None:
            return "allowed", {"improvement_id": imp.id}
        return "allowed", {"message": "no change"}
    if name == "share_file":
        from pathlib import Path as _P

        from . import capabilities as C
        from .config import get_settings
        from .events import current_run

        raw = str(args.get("path") or "")
        if raw and not _P(raw.removeprefix("file://")).expanduser().is_absolute():
            raw = str(get_settings().company_dir / "workspaces" / st.id / raw)
        p = C.allowed_path(db, raw, st.id)
        if not p:
            raise S.DomainError("that file does not exist in your workspace or a shared folder")
        if p.stat().st_size > C.MAX_FILE:
            raise S.DomainError("the file is larger than 25 MB; share a smaller export")
        f = C.save_bytes(p.name, p.read_bytes())
        task_id, thread_id = current_run(db, st.id, args.get("task_id"))
        if task_id:
            t = S.task_for_staff(db, st, task_id)
            th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        elif thread_id:
            th = db.get(S.Thread, thread_id)
        else:
            raise S.DomainError("no open task or chat to share the file in")
        note = str(args.get("note") or "").strip() or f"Shared **{f['name']}**"
        m = S.post_message(db, th, "agent", st.id, note, blocks=[{"type": "text", "text": note}, {"type": "file", **f, "source": str(p)}])
        return "allowed", {"message_id": m.id, "file_id": f["id"], "thread_id": th.id}

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

    if name == "request_access":
        from .events import current_run

        kind = str(args.get("kind") or "")
        target = args.get("target") if isinstance(args.get("target"), dict) else {}
        reason = str(args.get("reason") or "").strip()
        if not reason:
            raise S.DomainError("reason is required")
        task_id, thread_id = current_run(db, st.id, args.get("task_id"))
        if task_id:
            t = S.task_for_staff(db, st, task_id)
            th = S.get_or_create_thread(db, "task", t.id, st.id, t.brief[:120])
        elif thread_id:
            th = db.get(S.Thread, thread_id)
            if th is None:
                raise S.DomainError("no open chat to attach the access request to")
        else:
            raise S.DomainError("no open task or chat to attach the access request to")
        item = S.request_access(db, st, task_id, th.id if th else None, kind, target, reason, th=th)
        return "allowed", {"decision": "needs_approval", "request_id": item.id, "thread_id": th.id}
    if name == "propose_job":
        from . import jobs as J
        from .events import current_run

        _task_id, thread_id = current_run(db, st.id, None)
        th = db.get(S.Thread, thread_id) if thread_id else None
        m = J.propose(db, st, args, intro=str(args.get("note") or ""), th=th)
        return "allowed", {"decision": "needs_approval", "message_id": m.id, "thread_id": m.thread_id}
    if name in ("skills_list", "skill_read", "skill_save", "ask_teammate", "read_team_chat", "message_founder"):
        from . import capabilities as CAP
        from . import growth as G

        if name == "skills_list":
            mine = [k for k in CAP.list_skills() if not k["owner"] or k["owner"] == st.id]
            return "allowed", {"skills": [{"slug": k["slug"], "name": k["name"], "description": k["description"],
                                           "yours": k["owner"] == st.id, "team": not k["owner"]} for k in mine]}
        if name == "skill_read":
            k = CAP.get_skill(str(args.get("slug") or ""))
            if not k or (k["owner"] and k["owner"] != st.id):
                raise S.DomainError("no such skill", 404)
            return "allowed", {k2: k[k2] for k2 in ("slug", "name", "description", "body")}
        if name == "skill_save":
            return "allowed", G.save_skill(db, st, str(args.get("slug") or ""), str(args.get("name") or ""), str(args.get("description") or ""),
                                           str(args.get("body") or ""), bool(args.get("share")))
        if name == "ask_teammate":
            return "allowed", G.ask_teammate(db, st, str(args.get("teammate") or ""), str(args.get("question") or ""))
        if name == "read_team_chat":
            return "allowed", {"messages": G.read_team_chat(db, int(args.get("limit") or 20))}
        m = G.message_founder(db, st, str(args.get("text") or ""), args.get("options") if isinstance(args.get("options"), list) else None)
        return "allowed", {"message_id": m.id, "thread_id": m.thread_id}
    if name == "update_kpi":
        if policy.level_for("kpi.write", st.permissions) < policy.DO_AND_TELL:
            raise S.DomainError("you may not write KPIs; ask Finance or propose it", 403)
        k = S.record_kpi(db, st, args["name"], args["value"], args.get("period", ""), args["source"])
        return "allowed", {"kpi_id": k.id}
    if name == "create_task":
        # --- Step 1: Resolve target staff (B1 path; must happen before the scope check). ---
        target_id = args.get("staff_id")
        if target_id:
            pass  # use as-is; downstream create_task validates existence
        elif args.get("role"):
            resolved = S.staff_by_role(db, str(args["role"]))
            if resolved is None:
                raise S.DomainError(f"no active staff holds the role '{args['role']}'")
            target_id = resolved.id
        else:
            raise S.DomainError("provide staff_id or role to specify who should do it")

        # --- Step 2: Self-delegation guard (before scope check so the message is accurate). ---
        if target_id == st.id:
            raise S.DomainError("delegate to someone else")

        # --- Step 3: Scope check — any one of three paths grants access. ---
        # (a) Caller is the Chief of Staff.
        # (b) A delegates_to edge from caller → target exists.
        # (c) Permissive mode AND caller holds staff.delegate >= DO_AND_TELL.
        if not st.is_chief:
            has_edge = db.get(StaffRelation, (st.id, target_id, "delegates_to")) is not None
            ap = S.autonomy_policy(db, st)
            level = policy.level_for("staff.delegate", st.permissions)
            has_permission = ap["mode"] == "permissive" and level >= policy.DO_AND_TELL
            if not has_edge and not has_permission:
                raise S.DomainError(
                    "no delegation scope: add a delegates_to edge or grant staff.delegate permission in permissive mode",
                    403,
                )

        # --- Step 4: Depth cap (configurable, defaults to MAX_DELEGATION_DEPTH). ---
        max_depth = int(S.get_setting(db, "delegation_max_depth", None) or MAX_DELEGATION_DEPTH)
        depth, parent = 0, args.get("parent_task_id")
        while parent and depth < max_depth + 3:  # +3 sentinel to avoid an infinite scan
            pt = db.get(Task, parent)
            parent = pt.parent_task_id if pt and pt.origin == "delegation" else None
            depth += 1
        if depth >= max_depth:
            raise S.DomainError(f"delegation is limited to {max_depth} levels")

        t = S.create_task(db, target_id, "delegation", args["brief"], f"staff:{st.id}", parent_task_id=args.get("parent_task_id"),
                          goal_id=args.get("goal_id") or None)
        return "allowed", {"task_id": t.id}
    if name == "log_usage":
        t = S.task_for_staff(db, st, args["task_id"])
        t.tokens += int(args.get("tokens") or 0)
        t.cost_usd += float(args.get("cost_usd") or 0)
        db.commit()
        return "allowed", {"ok": True}
    if name in ("list_workflows", "workflow_blocks", "propose_workflow", "run_workflow", "get_workflow_run"):
        return _workflow_tool(db, st, name, args)
    if name == "complete_goal":
        from .models import Goal

        # Permission: CoS or reviewing staff (staff.delegate >= DO_AND_TELL).
        if not st.is_chief and policy.level_for("staff.delegate", st.permissions) < policy.DO_AND_TELL:
            raise S.DomainError("only the Chief of Staff or a reviewing staff member may complete a goal", 403)
        goal_id = str(args.get("goal_id") or "")
        outcome = str(args.get("outcome") or "").strip()
        g = db.get(Goal, goal_id)
        if g is None:
            raise S.DomainError(f"unknown goal '{goal_id}'", 404)
        # Idempotent: if already done (or dropped), return ok without overwriting.
        if g.status not in ("done", "dropped"):
            g.status = "done"
            S.audit(db, f"staff:{st.id}", "goal.complete", goal_id, outcome=outcome)
        db.commit()
        return "allowed", {"ok": True, "goal_id": g.id, "status": g.status}
    raise S.DomainError(f"unknown tool {name}", 404)


def _workflow_tool(db, st: Staff, name: str, args: dict) -> tuple[str, dict]:
    from . import workflows as W
    from .models import Workflow, WorkflowRun, now

    if name == "list_workflows":
        rows = db.scalars(select(Workflow).where(Workflow.status.in_(["active", "paused", "pending"])).order_by(Workflow.name))
        return "allowed", {"workflows": [{k: v for k, v in W.view(db, w).items() if k in ("id", "name", "description", "status", "trigger", "steps", "uses_ai", "runs")}
                                         for w in rows]}
    if name == "workflow_blocks":
        return "allowed", {"blocks": [{k: b[k] for k in ("type", "label", "group", "desc", "fields", "ports", "ai", "trigger")} for b in W.blocks_public()]}
    if name == "propose_workflow":
        if not isinstance(args.get("graph"), dict):
            raise S.DomainError("graph must be an object with nodes and edges")
        try:
            wf = W.propose(db, st, str(args["name"]), str(args.get("description") or ""), args["graph"], str(args.get("reason") or ""), args.get("task_id"))
        except W.Invalid as e:
            raise S.DomainError(f"the workflow is not valid: {e}") from e
        return "proposal", {"workflow_id": wf.id, "status": "pending", "note": "It waits in the owner's Inbox; nothing runs until they approve."}
    if name == "run_workflow":
        wf = db.get(Workflow, str(args.get("workflow_id") or ""))
        if not wf:
            raise S.DomainError("no such workflow", 404)
        if wf.status != "active":
            raise S.DomainError(f"the workflow is {wf.status}; only active workflows can be started", 409)
        tid = args.get("task_id")
        if tid and (t := db.get(Task, tid)) and t.created_by == f"workflow:{wf.id}":
            raise S.DomainError("this job was started by that workflow; it can't start itself again", 409)
        import datetime as _dt

        recent = db.scalars(select(WorkflowRun).where(WorkflowRun.workflow_id == wf.id, WorkflowRun.started_by == f"staff:{st.id}",
                                                      WorkflowRun.created_at >= now() - _dt.timedelta(hours=1))).all()
        if len(recent) >= 30:
            raise S.DomainError("too many runs of this workflow in the last hour", 429)
        r = W.start_run(db, wf, "helper", args.get("input") if isinstance(args.get("input"), dict) else {}, f"staff:{st.id}")
        return "allowed", {"run_id": r.id, "status": r.status}
    r = db.get(WorkflowRun, str(args.get("run_id") or ""))
    if not r:
        raise S.DomainError("no such run", 404)
    return "allowed", W.run_view(r, full=True)


def _rpc_result(id_, result):
    return {"jsonrpc": "2.0", "id": id_, "result": result}


def _rpc_error(id_, code, message):
    return {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


async def _handle(db, st: Staff, msg: dict) -> dict | None:
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
            decision, payload = await call_tool(db, st, name, args)
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
            record("tool", {"name": f"omilo · {name}", "input": args, "output": payload, "ok": not is_error, "decision": decision, "ms": ms},
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
            results = [await _handle(db, st, m) for m in body]
            out = [r for r in results if r is not None]
            return JSONResponse(out) if out else Response(status_code=202)
        res = await _handle(db, st, body)
        return JSONResponse(res) if res is not None else Response(status_code=202)
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Token refresh helper — just-in-time pre-expiry refresh for piece tool calls
# ---------------------------------------------------------------------------

REFRESH_SKEW_S = 60  # refresh if expiry is within this many seconds


def _fresh_token(conn, manifest: dict, db) -> str:
    """Return a valid access token for *conn*, refreshing proactively if it is near expiry.

    Logic:
    - Read the stored token dict from connector_secrets(conn)["token"].
    - If expires_at is set and within REFRESH_SKEW_S seconds of now, AND a refresh_token
      exists, AND the provider's refresh_style is not "meta_long_lived": call
      oauth.refresh_access_token, persist via set_connector_token + db.commit(), return
      the new access_token.
    - On refresh failure: call set_connector_needs_reconnect(conn, True) + db.commit(),
      return the OLD access_token best-effort (no exception escapes).
    - If expires_at is absent or not near expiry: return current access_token unchanged.

    Security: tokens are never logged.
    """
    from . import oauth as _oauth
    from .capabilities import connector_secrets, set_connector_needs_reconnect, set_connector_token

    secrets = connector_secrets(conn)
    tok = secrets.get("token") or {}
    if not isinstance(tok, dict):
        return str(tok) if tok else ""

    access_token = tok.get("access_token", "")
    expires_at = tok.get("expires_at")
    refresh_token = tok.get("refresh_token")
    provider = manifest.get("auth", {}).get("provider", "")

    # Only attempt proactive refresh when all conditions hold.
    if (
        expires_at is not None
        and float(expires_at) - time.time() < REFRESH_SKEW_S
        and refresh_token
        and provider in _oauth.OAUTH_PROVIDERS
        and _oauth.OAUTH_PROVIDERS[provider].get("refresh_style") != "meta_long_lived"
    ):
        try:
            new_tok = _oauth.refresh_access_token(provider, refresh_token)
            set_connector_token(conn, new_tok)
            db.commit()
            return new_tok["access_token"]
        except Exception:  # noqa: BLE001
            set_connector_needs_reconnect(conn, True)
            db.commit()
            return access_token  # best-effort: let run_action 401 → retry path handles it

    return access_token


def _force_refresh(conn, manifest: dict, db) -> str | None:
    """Force a token refresh regardless of expiry, returning the new access_token.

    Returns None when there is no usable refresh path (no refresh_token or meta_long_lived).
    On failure sets needs_reconnect and returns None without raising.
    Used by the 401-retry path in tools/call.
    """
    from . import oauth as _oauth
    from .capabilities import connector_secrets, set_connector_needs_reconnect, set_connector_token

    secrets = connector_secrets(conn)
    tok = secrets.get("token") or {}
    if not isinstance(tok, dict):
        return None

    refresh_token = tok.get("refresh_token")
    provider = manifest.get("auth", {}).get("provider", "")

    if (
        not refresh_token
        or provider not in _oauth.OAUTH_PROVIDERS
        or _oauth.OAUTH_PROVIDERS[provider].get("refresh_style") == "meta_long_lived"
    ):
        return None

    try:
        new_tok = _oauth.refresh_access_token(provider, refresh_token)
        set_connector_token(conn, new_tok)
        db.commit()
        return new_tok["access_token"]
    except Exception:  # noqa: BLE001
        set_connector_needs_reconnect(conn, True)
        db.commit()
        return None


@router.post("/mcp/piece/{slug}")
async def mcp_piece_post(slug: str, request: Request):
    """MCP endpoint for a single piece connector.

    Authenticates the same Bearer token as POST /mcp (staff MCP token).
    Handles JSON-RPC:
      - tools/list  → pieces.action_tools(manifest)
      - tools/call  → pieces.run_action(manifest, name, args, decrypted_token)
                       on needs_reconnect: marks the Connector disabled.
    """
    from . import pieces as _pieces
    from .models import Connector

    raw = request.headers.get("authorization", "")
    token = raw[7:].strip() if raw.lower().startswith("bearer ") else None
    db = next(get_db())
    try:
        st = staff_from_mcp_token(db, token)
        if not st:
            return JSONResponse({"error": "invalid or missing staff MCP token"}, status_code=401)
        if st.status != "active":
            return JSONResponse({"error": f"staff {st.id} is paused"}, status_code=403)

        # Load manifest (file-based catalog, no DB)
        manifest = _pieces.get_piece(slug)
        if manifest is None:
            try:
                body = await request.json()
            except Exception:
                body = {}
            id_ = body.get("id") if isinstance(body, dict) else None
            return JSONResponse(_rpc_error(id_, -32602, f"piece '{slug}' not found in catalog"))

        try:
            body = await request.json()
        except Exception:
            return JSONResponse(_rpc_error(None, -32700, "parse error"), status_code=400)

        def _handle_piece(msg: dict) -> dict | None:
            method, id_ = msg.get("method"), msg.get("id")
            if id_ is None:
                return None  # notification
            params = msg.get("params") or {}
            if method == "initialize":
                req = params.get("protocolVersion")
                ver = req if req in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[0]
                return _rpc_result(id_, {"protocolVersion": ver, "capabilities": {"tools": {"listChanged": False}},
                                         "serverInfo": SERVER_INFO})
            if method == "ping":
                return _rpc_result(id_, {})
            if method == "tools/list":
                return _rpc_result(id_, {"tools": _pieces.action_tools(manifest)})
            if method == "tools/call":
                name = params.get("name")
                args = params.get("arguments") or {}
                # Look up the connected Connector to get its OAuth token
                conn = db.get(Connector, slug)
                if conn is None:
                    return _rpc_error(id_, -32602, f"no connected Connector for piece '{slug}'; connect it first")
                # Just-in-time refresh: if the stored token is near expiry (within
                # REFRESH_SKEW_S seconds), refresh it now before calling the action.
                piece_token = _fresh_token(conn, manifest, db)
                try:
                    summary, meta = _pieces.run_action(manifest, name, args, piece_token)
                except (ValueError, KeyError) as exc:
                    return _rpc_result(id_, {"content": [{"type": "text", "text": str(exc)}], "isError": True})
                if meta.get("needs_reconnect"):
                    # 401/403 from the provider: attempt exactly ONE refresh+retry before
                    # setting the sentinel.  _force_refresh returns None when there is no
                    # usable refresh path (no refresh_token or meta_long_lived provider).
                    retried_token = _force_refresh(conn, manifest, db)
                    if retried_token is not None:
                        try:
                            summary, meta = _pieces.run_action(manifest, name, args, retried_token)
                        except (ValueError, KeyError) as exc:
                            return _rpc_result(id_, {"content": [{"type": "text", "text": str(exc)}], "isError": True})
                    if meta.get("needs_reconnect"):
                        # Retry still failed (or no refresh path): store the sentinel.
                        # Do NOT touch conn.enabled — keeps the connector visible in the
                        # marketplace and in capabilities filtering (enabled=True).
                        from .capabilities import set_connector_needs_reconnect
                        set_connector_needs_reconnect(conn, True)
                        db.commit()
                payload = {"summary": summary, **meta}
                is_error = bool(meta.get("needs_reconnect"))
                return _rpc_result(id_, {"content": [{"type": "text", "text": json.dumps(payload, default=str)}],
                                          "structuredContent": payload, "isError": is_error})
            return _rpc_error(id_, -32601, f"method not found: {method}")

        if isinstance(body, list):
            out = [r for r in (_handle_piece(m) for m in body) if r is not None]
            return JSONResponse(out) if out else Response(status_code=202)
        res = _handle_piece(body)
        return JSONResponse(res) if res is not None else Response(status_code=202)
    finally:
        db.close()


@router.get("/mcp")
async def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


@router.delete("/mcp")
async def mcp_delete():
    return Response(status_code=405, headers={"Allow": "POST"})
