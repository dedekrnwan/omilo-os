# Dynamic LangGraph staff with Claude Code execution — Design

**Date:** 2026-10-19
**Status:** Draft for approval (no code until approved)

## Intent (the why)

Omilo's staff behave like agentic tools, not like agents. Each run is close to a
one-shot tool-caller, and every decision stops and waits for the human owner — even
though a Chief of Staff (CoS) already exists to act as the owner's representative. The
owner wants two things at once:

1. **Smarter staff.** Agents that plan, pull from the knowledge base (pgvector), call
   skills and MCP tools, check their own work, and loop toward a goal — the kind of
   dynamic agent the owner associates with Hermes (NousResearch/hermes-agent). Omilo
   had a Hermes engine + manager + supervisor and removed it on 2026-10-16 (v0.3.0) in
   favor of a single Claude Code engine plus `loops.py` (structured loop + Docs memory
   + weekly retro). The simplification was deliberate; this design must not re-introduce
   what made Hermes not pay its way (a bespoke manager/supervisor that duplicated the
   engine's own agent loop).

2. **A loop that closes without the owner.** The CoS should review, validate, and
   approve the other staff's work as the owner's delegate, escalating to the owner only
   what genuinely needs a human. Today the "you decide" step in `loops.py` is always the
   human.

The approach: **LangGraph becomes the orchestration brain; Claude Code stays the
execution engine.** LangGraph provides multi-agent topology, state, dynamic-from-data
assembly, and human/CoS approval interrupts. Claude Code (the subscription pool) remains
the per-node brain-and-hands, because its results are better and the owner wants to keep
them. The existing learning (`loops.py` retro) and initiative (Shifts) stay — LangGraph
upgrades the brain *inside* the loop that already runs.

## What exists today (ground truth, verified in the repo)

- **Staff identity (the "soul") is already data** (`models.py` `Staff`): `name`, `role`,
  `is_chief`, `job` (brief/instructions), `engine` (`{type, auth, model}`),
  `permissions` (`{actions: {name: count}}`), `budget_usd_month`, `access`
  (`folders/connectors/skills`), `max_task_minutes`, `status`, and an encrypted MCP
  token the worker hands to the engine. Plus `Goal`/`TaskGoal`/`ShiftGoal`, `Shift`
  (scheduled initiative), and Docs `Memory/` lessons.
- **Engines** (`engines/`): `claude_code` (subscription pool, the preferred brain),
  `claude` (direct API), `litellm_engine` (vendor-agnostic linear tool loop — real
  tool-use loop with `max_turns`), `fake`. `get_engine(config)` selects by `type`.
- **The loop is split across modules** (corrected after review): the *runtime* —
  trigger → act → report + proposals → owner decides → execute — lives in `worker.py`
  (shift firing + task dispatch, `worker.py:223-283`), `routers/api.py` (`decide`, ~545)
  + `services.py` (`decide_proposal`, 357), and `memory.py` (`lesson_from_decision`, 131).
  `loops.py` is **only** the weekly retro/improvement machinery (`scorecard`, `review`,
  `improve`, `evaluate`, `undo`, `ensure_retro`), which edits
  instructions/briefs/schedule/lessons, measured and rolled back if worse, and can never
  change permissions, budgets, engine, approvals, or hard rules. **The graph integration
  seam is therefore in `worker.py` (where `run_task` / shift dispatch runs), not
  `loops.py`.**
- **Turns run in the worker** (`worker.py`): chat turns via
  `chatting[thread_id] = asyncio.create_task(answer_thread(thread_id))`; tasks via the
  engine's `run_task`, dispatched as detached asyncio tasks (`worker.py:277`). The CoS is
  already a distinguished staff member (`is_chief`).
- **Approvals-in-chat + bulk + multi-engine harness** (feature branch, review-passed,
  not yet merged): inline approval cards, `POST /api/inbox/bulk`, per-engine harness
  page. This design builds on that delegation surface.

## Settled decisions (from the owner)

1. **Rollout: all staff become LangGraph agents, phased.** Phase 1 the CoS as
   supervisor; later phases the worker staff. Simple staff may still *execute* via
   Claude Code, but they run inside the graph.
2. **The thinking layer is Claude Code too.** No separate API vendor for the graph's
   reasoning. A node that must "think" (plan, decide, validate, write) calls Claude Code
   (via the pool). LangGraph itself is deterministic Python: it owns control flow,
   routing, state, interrupts — not the reasoning.
3. **CoS authority: auto-handle low and medium risk** (including reversible outward
   actions); only high-risk (money, external send, production/deploy/merge) escalates to
   the owner. This widens delegation beyond today's "internal-only."
4. **The soul grows** to add, beyond today's fields: an **autonomy level per staff**, a
   **personality/voice**, and **staff-to-staff relations** (who delegates to/reviews
   whom), which drive graph routing.

## Architecture

### Layering (the core idea)

```
            ┌────────────────────────── LangGraph (orchestration brain) ──────────────────────────┐
            │  supervisor node (Chief of Staff)                                                     │
 trigger →  │     routes by soul + relations → worker node(s) → review/validate node →              │ → report
 (shift /   │     human/CoS approval interrupt (delegation dial) → apply/execute                    │   + lessons
  chat /    │  state: goal, plan, messages, pending action, risk, approvals, autonomy               │
  manual)   └───────────────────────────────────────────────────────────────────────────────────────┘
                         │ a node that must think OR do work calls ↓
            ┌────────────────────────── Claude Code (brain + hands) ────────────────────────────────┐
            │  subscription pool: plan/validate/write/execute with files, commands, web, MCP, skills │
            └───────────────────────────────────────────────────────────────────────────────────────┘
```

LangGraph answers *what next, who does it, does it need approval, is it done*. Claude
Code answers *actually produce the work*. This is **not** a revived Hermes manager: there
is no bespoke supervisor LLM loop reimplementing an engine. The supervisor is a graph
node whose single reasoning call is a Claude Code decision, and the heavy lifting is a
Claude Code run — the same engine, with LangGraph as the control plane.

### Dynamic souls (what fh_ai cannot do)

`../../finity/fh_ai` is one hardcoded agent: a single giant system prompt,
`planner → tool → human_review(interrupt) → tool_result → planner`, request→response, no
learning, no initiative, no multi-agent routing. Its reusable gold is the
**permission/approval model** (`PermissionMode` YOLO/ACCEPT_EDITS/PLAN/ASK ×
`ApprovalMode` ALWAYS/ONCE) enforced through LangGraph `interrupt()` — that is exactly
the CoS delegation dial, pointed at the CoS instead of a human.

Omilo's graph must be **assembled from data at runtime**, one worker node per active
`Staff` row. Hire a staff member → a node exists, no code change. Edit its soul or let
its lessons grow → its next run behaves differently. The node's system/context is built
from: `job`, `role`, personality/voice, goals, the soul's autonomy level, KB scope, the
skills/connectors/folders in `access`, and the staff's `Memory/` lessons. Relations
decide routing (who the supervisor hands to, who reviews whom).

### Soul extensions (new fields)

Add to `Staff` (all nullable/defaulted, so existing rows keep working):
- `autonomy` (enum): e.g. `guided` (asks the CoS often) → `standard` → `trusted` (acts
  within its permissions, reports after). Separate from `permissions` (what it *may* do)
  and from the CoS's own risk dial — this is how much *this* staff decides alone before
  consulting the CoS.
- `voice` (text): a short personality/voice note that colors communication and framing,
  layered on the onboarding `tone`.
- Staff-to-staff **relations**: a small table (`staff_relation`: `from_staff`,
  `to_staff`, `kind` ∈ `delegates_to`/`reviews`), so routing reflects an org chart, not
  only CoS-over-everyone. Absent relations → default to CoS supervising directly.

### The delegation dial (CoS as the owner's representative)

Reuse fh_ai's model, mapped onto Omilo's risk taxonomy (`Proposal.risk`
low/medium/high) and the new approvals surface:
- A worker's proposed action carries a risk. The **supervisor** (CoS) node decides:
  low/medium → the CoS reviews/validates and approves (records the decision + a lesson,
  exactly like the owner's note does today); high → escalate to the owner via the
  existing inbox/chat approval card (now also decidable in chat, and batchable).
- The CoS's approvals are audited with the CoS as actor; the owner can see and override
  them. Hard rules are unchanged: no sending/spending/merging/deploying/production
  without the owner's OK stays enforced regardless of autonomy or CoS authority.
- Per-staff `autonomy` modulates how often a worker consults the CoS before acting at
  all (a `trusted` worker proposes less and acts more within its permissions).

### Learning and initiative (kept, not rebuilt)

- **Learning:** CoS/owner decision notes → lessons (existing `memory.py`); the weekly
  retro (`loops.py`) still edits instructions/briefs/schedule/lessons, measured and
  rolled back if worse. LangGraph nodes read the same lessons as context. The retro's
  locked scope (never touches permissions/budgets/engine/approvals/hard rules) is
  unchanged and now explicitly also never edits a soul's `autonomy` or the CoS risk dial.
- **Initiative:** Shifts still fire scheduled runs; a shift run now enters the graph at
  the supervisor instead of a single-engine `run_task`. Proactive initiative beyond the
  schedule (an agent proposing new work) flows as a proposal through the same CoS dial.

### Execution engine (unchanged results)

A worker node that must act calls the engine already selected for that staff
(`engine.type`), Claude Code pool first. `get_engine` and the multi-engine harness are
reused as-is. The graph passes the staff's MCP token to the engine exactly as the worker
does today, so KB/skills/MCP/folders all work unchanged.

## Key risk and its mitigation (the nested-agent cost)

Claude Code is itself an agent-in-a-box. Wrapping it in LangGraph nodes means nested
agents, and using a full Claude Code run for *pure routing/validation* decisions is slow
and burns pool budget. Mitigation:
- **Routing/validation = a single bounded, structured Claude Code decision call**
  (small, one-shot, "pick the worker / approve or escalate / is this done" with a schema)
  — not an open-ended agent run. Reserve full Claude Code agent runs for actual work
  nodes.
- Cap graph depth/turns (a supervisor↔worker ping-pong limit) the way the engines cap
  turns today (`MAX_TURNS_TASK=40`, `MAX_TURNS_CHAT=8` in `engines/claude.py`, imported by
  litellm), so a confused graph can't loop forever on pool budget.
- Keep a fast path: trivial/routine work with an unambiguous owner skips the supervisor
  decision (routed by relations/soul directly), so the graph doesn't tax every tiny task.

## Goals

- Staff run as dynamic, data-assembled LangGraph agents that plan, use KB/skills/MCP,
  self-check, and loop toward goals.
- The CoS closes the loop as the owner's delegate: auto-handles low/medium risk,
  escalates high risk, all audited and overridable.
- Souls (including the new autonomy/voice/relations) drive behavior and routing with no
  per-agent code.
- Claude Code remains the brain and the execution engine; results do not regress.
- Learning (retro/lessons) and initiative (shifts) keep working, now feeding the graph.

## Non-goals / anti-goals

- **Not** a revived bespoke Hermes manager/supervisor LLM loop separate from the engine.
- **Not** removing or weakening the hard rules or the owner's final authority over
  high-risk outward actions.
- **Not** a separate reasoning vendor/API key for the graph (Claude Code is the brain).
- **Not** changing how the KB, skills, MCP, or the Claude Code pool themselves work.
- **Anti-goal:** a graph so eager to delegate that the owner loses visibility — if the
  owner can't see at a glance what the CoS auto-approved, the feature has failed even if
  it technically works.

## Constraints

- Build on the approvals-in-chat + bulk + multi-engine-harness branch (the delegation
  surface); sequence after it merges.
- Python 3.12, FastAPI, SQLAlchemy, Postgres+pgvector, Redis; add `langgraph`
  (+ its checkpointer) as a dependency. Reuse `get_engine`, `loops.py`, `memory.py`,
  Shifts, Goals, the MCP token path, and the Proposal/Inbox/decide plumbing.
- New `Staff` columns and the `staff_relation` table must be additive and non-destructive.
  Caveat corrected after review: `Base.metadata.create_all` creates the new *table*
  (`staff_relation`) but does **not** add columns to the existing `staff` table. New
  `Staff` columns need an explicit additive `ALTER TABLE ... ADD COLUMN ... DEFAULT ...`
  run at startup (follow the lightweight column-patch pattern already in `db.py`, which
  the v0.3.0 change extended). No column drops, no data loss.
- Phased: Phase 1 ships the CoS supervisor + the graph runtime for one staff path behind
  a per-staff opt-in flag, provably not regressing existing single-engine runs, before
  the all-staff rollout.

## What is left to the builder

- The exact LangGraph state shape, node set, and checkpointer choice (Postgres-backed to
  match the stack).
- How the "structured Claude Code decision call" is implemented (a constrained prompt +
  schema vs a small tool) and the graph depth/turn caps' exact numbers.
- The soul→prompt assembly details and where graph assembly lives
  (`engines/` vs a new `graph/` module).
- Migration/compatibility specifics for souls and the relations table.
- UI surfacing of what the CoS auto-approved (likely an extension of the Monitor/Inbox).

## Builder calls settled after review (not owner decisions — engineering rulings)

A cold builder-check surfaced five technical unknowns. None are product choices; all are
settled here so the plan has a single answer:

1. **How an escalation survives detached async runs / long waits (highest-risk unknown).**
   The graph does **not** hold a live `interrupt()` open for hours. When the CoS escalates
   a high-risk action, the graph **checkpoints and suspends** (Postgres-backed
   checkpointer, thread keyed by `task_id`), files the existing `Proposal` + inbox/chat
   approval card, and the run ends. When the owner later decides via
   `POST /proposals/{pid}/decide`, that existing event **resumes the graph from its
   checkpoint** (the proposal carries the checkpoint thread id; a worker resumes it the
   same way shifts/answers spawn follow-up work today). This matches Omilo's already-async
   proposal model and avoids any long-lived connection. (Exact checkpointer wiring and
   resume trigger remain the builder's to implement; the *approach* is fixed here.)

2. **CoS auto-approval reuses the existing decision plumbing.** The CoS's low/medium
   approval calls `services.decide_proposal(...)` with the CoS as actor, so audit,
   `lesson_from_decision`, and execution-task spawning are all reused unchanged. The
   `risk == "low"`-only guards on `decide_similar` and the notification batch path are a
   *separate* owner-facing batch feature and are left untouched; `decide_proposal` itself
   already accepts any risk, so no guard changes are needed for the CoS path.

3. **Risk is classified independently by the CoS, not trusted from the worker.** Today the
   acting agent self-reports `Proposal.risk` via the MCP `propose` tool. Trusting that
   would let a worker under-report to dodge escalation — defeating the hard-rules
   guarantee (an anti-goal). So the **supervisor node re-derives risk**: the hard-rule
   categories (send / spend / merge / deploy / production, and any outward action) are
   detected structurally at the gate regardless of the worker's self-label, and the CoS's
   own decision call assigns the risk used for escalate-vs-handle. The worker's label is a
   hint, never the authority.

4. **New soul columns via additive ALTER at startup** (see Constraints) — not
   `create_all`. The `staff_relation` table is created by `create_all`.

5. **The per-staff opt-in flag is a new `Staff` field** (e.g. `brain` ∈
   `single_engine` | `graph`, default `single_engine`), added by the same additive ALTER,
   so Phase 1 touches the schema once and existing staff keep their current behavior until
   opted in.

## Verification (what "done and right" looks like)

- A shift fires → the graph plans, a worker pulls KB + calls a skill/MCP + produces work
  via Claude Code → the CoS validates a low/medium result and approves it itself (audited
  as CoS) → a high-risk action escalates to the owner → the run logs lessons. All without
  the owner touching the low/medium step.
- Hiring a new staff member makes a new worker node with no code change; editing its soul
  (autonomy/voice/relations) changes its next run's behavior and routing.
- Existing single-engine runs still work for staff not yet opted in; the Claude Code pool
  results are unchanged.
- The owner can see, in one place, what the CoS auto-approved, and override it.
- Hard rules still block send/spend/merge/deploy/production without the owner, regardless
  of autonomy or CoS authority.
