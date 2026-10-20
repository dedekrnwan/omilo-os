# Autonomous Team Engine (Design)

Date: 2026-10-20
Status: Draft for approval
Author: Dede Kurniawan (with Claude)

## Intent & why

Omilo should run as an **autonomous digital team**. The owner sets **goals**
(epics). The **Chief of Staff** — and any staff — decompose a goal into
role-assigned specs/tasks, **delegate** them, execute, **monitor**, **validate**
against the goal, and **loop until the goal is done or the owner stops it** —
operating continuously and largely **on the owner's behalf**, and reaching the
**outside world** (web search / external data) to research and learn without the
owner's direction.

Today the *data backbone* for this mostly exists, but the *behavior* does not,
and the UI surfaces read different slices of the database so they disagree:

- A helper working in a **chat** creates no Task, so the Inbox board shows
  "0 running" while the Monitor shows the same helper working. (Surface desync.)
- There is **no planner**: nothing reads a goal and breaks it into tasks.
- There is **no loop-closure**: nothing watches a delegated task, validates it
  against the goal, and decides to continue or finish. Work is one-shot.
- The **Chief of Staff acts as a doer**, not a manager — "delegate, don't do" is
  only prompt text. The `StaffRelation(delegates_to|reviews)` graph in the schema
  is **dead code**.
- **Creation is gated**: `create_task` is CoS-only (others get 403); goals are
  owner-only (no agent tool at all).
- Agents have **no first-class external access or learning loop**.

This project builds the engine that turns the existing backbone into that team.

## Current state (grounded in code)

- `models.py`: `Goal(id,title,target,due,status,...)`; `Task(staff_id, origin,
  brief, status∈queued|running|waiting|done|failed|cancelled, parent_task_id,
  proposal_id, shift_id, ...)`; `TaskGoal(task_id,goal_id)` join (auto-populated
  by a `before_flush` hook in `plan.py:17-35`); `Staff(is_chief, job, role,
  autonomy∈guided|standard|trusted, brain∈single_engine|graph, permissions,
  budget_usd_month, access)`; `StaffRelation(kind∈delegates_to|reviews)` —
  **defined but never read/written**.
- `mcp_server.py`: ~35 agent tools. Reads (`get_task`, `get_context` →
  includes active goals, `recall`, `docs_search`, `read_team_chat`,
  `get_approved`, `list_workflows`, …) and writes (`report`, `propose`,
  `checkpoint`, `post_message`, `docs_write`, `kb_add`, `remember`,
  `ask_founder`, `create_task` [CoS-only, self-delegation blocked, depth cap 2],
  `update_kpi`, `improve`/`tune_helper` [CoS-only], …). **No `create_goal`.**
- `worker.py`: `run_forever→tick()` every `worker_interval_s` →
  `schedule_shifts` (cron Shifts create Tasks), `nudges` (nudge ladder),
  `dispatch_tasks` (queued Task → one-shot `run_task`), `dispatch_chats`
  (`Thread.awaiting_reply` → `answer_thread`, **no Task row**),
  `dispatch_workflows`. `_finish` does transient retry ≤3 and the shipped
  defer/spill/cap pool fallback.
- `office.py`: a `before_flush` collector writes `OfficeEvent` rows for
  Task/Proposal/InboxItem/RunEvent/Thread/Staff changes; `state()` unions
  running Tasks **and** `Thread.awaiting_reply` chats; the office WebSocket is
  woken by `bus.publish("office")` on commit. **The Monitor is live & unioned.**
- `board.py`: `build()` reads **only** `Task`/`InboxItem`/`RunEvent`; RUNNING =
  `Task.status in (running,queued,waiting)`. **No chat, no live push.** This is
  the desync.
- `services._cos_rule` (`services.py:900-937`): CoS auto-approves low/medium-risk
  proposals **for graph-brain staff only** — a partial on-behalf-of-owner path.
- `plan.tree()` backs the Plan page (goal→task tree).

## Goals (the five parts)

1. **Single source of truth + live sync** — one work-state read model that Inbox,
   Monitor, and Plan all consume live; chat work is first-class and visible
   everywhere.
2. **Orchestration loop** — goal → decompose into role-assigned specs → delegate
   → monitor → validate against the goal → loop or close. The CoS becomes a
   manager, not a doer; the `delegates_to|reviews` graph is activated.
3. **Autonomy policy** — config-driven, **permissive by default**, the CoS
   decides/reviews **on the owner's behalf**, stopping only on the owner's
   conditions.
4. **Open creation** — **any** staff (not just the CoS) can create tasks **and
   goals** through the native MCP.
5. **External access + self-directed learning** — every agent (CoS included) can
   search/fetch the outside world and write what it learns back to the shared KB.

## Non-goals

- Not removing human control — the owner can always tighten config, leave a note,
  or stop everything; nothing here weakens the kill switch.
- Not replacing the engine/provider layer — runs on the existing Claude Code
  harness (and the local/pool/fallback work already shipped).
- Not a UI rewrite — extend the existing Inbox / Monitor / Plan surfaces.
- Not unbounded spend — per-helper/company budgets stay enforced and become a
  first-class stop condition.
- Not a generic multi-tenant policy engine — scoped to Omilo's company model.

## Anti-goals (failure even if it "works")

- A team that **spends money or takes irreversible/outside-world actions without
  the configured gate**.
- Surfaces that **still disagree** — the entire point of Part 1 is one truth.
- A Chief of Staff that **still does the execution itself** instead of delegating.
- An autonomy loop that **hot-spins or never terminates** — no goal-done / stop
  detection, or busy-looping when idle.
- **Learning that pollutes the KB** with junk, duplicates, or unverified claims.
- **Silent action** — anything the team does autonomously must be visible and
  audited (the owner can always see who did what, and why).
- Breaking the shipped behavior (pool/local/api auth, the defer ladder, existing
  task/chat/workflow execution).

## The how (decided — items marked "my call" settled by Claude)

### Part 1 — Single source of truth + live sync
- **One work-state read model.** Introduce a single service (e.g.
  `worklog.live_state(db)`) that returns the unified set of in-flight work:
  running/queued/waiting Tasks **plus** active chat work (`Thread.awaiting_reply`)
  **plus** open proposals/questions — the union the Monitor already computes.
  `board.build()`, the Monitor `state()`, and `plan.tree()` all consume this one
  model so they cannot disagree. *(My call: a shared read model, not three
  queries.)*
- **Chat work is first-class.** Represent an in-progress chat reply as a
  lightweight **activity** in the read model (keyed by thread + staff), shown in
  the board's RUNNING column as "Replying in chat" — the same way the Monitor
  shows it. *(My call: surface chat as activity in the unified model rather than
  forcing every chat into a Task row; a Task is still created when chat work is
  promoted into real delegated work — see Part 2/4.)*
- **Live push to every surface.** The board (and Plan) subscribe to the existing
  `bus.publish("office")` signal (as the Monitor WebSocket does) so they update
  in realtime instead of polling. *(My call: reuse the office bus; don't invent a
  second channel.)*

### Part 2 — Orchestration loop (the heart)
- **Planner.** Activating a goal (owner or agent) triggers a **plan step**: the
  CoS decomposes the goal's `target` into N specs → creates N Tasks linked to the
  goal (via the existing `TaskGoal` auto-link), each with a role assignment. This
  is a dedicated planner run (a Task of a new `origin="plan"`, or a graph node),
  **not** ad-hoc chat. *(My call: structured planner step, re-runnable.)*
- **Role routing.** Resolve an assignment by **role** (e.g. "Marketing") to the
  staff holding that role, instead of a hard-coded slug. Add a helper lookup
  `staff_by_role(db, role)`; `create_task` accepts a `role` alternative to
  `staff_id`. *(My call.)*
- **Activate `StaffRelation`.** Use `delegates_to` to drive who the CoS may route
  to and `reviews` to drive who validates a result — turning the dead schema into
  the org chart that governs routing + review.
- **CoS as manager, enforced.** The CoS runs a **manager profile**: its tool
  policy favors `create_task`/monitor/validate/decide and **excludes direct
  execution tools** (Bash/Write/etc.) for goal work, so it cannot do the job
  itself — role staff execute. *(My call: enforce via tool policy + a manager
  brain, not only prompt text. The CoS keeps execution tools only for its own
  admin chores, not goal delivery.)*
- **Monitor → validate → loop-closure.** When a delegated child Task finishes,
  the worker enqueues a **CoS review step** for its goal: validate the result
  against the goal `target`, then decide — accept & schedule the next spec, send
  a **revision** task (existing `origin="revision"`), or mark the **goal done**.
  This continuation (child-complete → parent review) is the loop. *(My call:
  event-driven continuation in `_finish`, not a polling planner.)*
- **Termination & no hot-spin.** The loop only advances on task-completion events
  and is bounded by budget + stop conditions (Part 3). A goal ends when the CoS
  judges `target` met → `status="done"`, or the owner drops/stops it. Idle = no
  open goal work = no activity (never a busy loop).

### Part 3 — Autonomy policy
- **Config-driven, permissive by default.** A company-level + per-helper policy
  (builds on the existing `autonomy∈guided|standard|trusted` field). Default:
  the team runs and the CoS decides; the owner is pulled in only by the stop
  conditions below.
- **CoS decides/reviews on the owner's behalf.** Generalize `_cos_rule` beyond
  graph-brain staff: the CoS can approve/validate delegated work and proposals up
  to the configured risk tier, writing an audit trail. The owner can tighten per
  helper / per company.
- **Stop / escalate conditions (to the owner's inbox):**
  (a) an owner **note** on the goal/task; (b) a **critical-event** tier;
  (c) explicit **stop** (pause-all / stop-goal); (d) **money spend** over a
  configurable budget threshold; (e) **irreversible / outside-world actions** (a
  risk tier — e.g. sending external messages, payments, destructive ops);
  (f) anything **config** tightens. Everything else flows autonomously.
- Reuse the shipped proposal/inbox + defer/fallback + consent machinery as the
  escalation and gating substrate.

### Part 4 — Open creation (any staff)
- **Open `create_task`** beyond the CoS: any staff may create/delegate within its
  permitted scope and `delegates_to` edges (keep the self-delegation guard; make
  the depth cap configurable). Default **not strict**, per owner's preference.
- **New MCP tools `create_goal` / `update_goal`** (permissioned, available to
  staff) so an agent can turn a chat trigger ("build the backend until complete")
  into a real **Goal** + its decomposition — which then appears live in Plan /
  Inbox. Agent-created goals are owner-visible and owner-overridable.
- **Round-trip guarantee**: a goal/task created by any agent flows through the
  same read model (Part 1) and orchestration loop (Part 2) as owner-created ones.

### Part 5 — External access + self-directed learning
- **First-class external access.** Grant web **search** + **fetch** to agents
  (via the Claude Code harness allowedTools and/or an Omilo MCP web tool),
  permission- and budget-bounded, and treated as a risk tier under Part 3
  (outbound reads are low-risk/allowed by default; posting outward is gated).
- **Learning loop.** A capture path (`learn`, building on `kb_add`/`remember`)
  that writes researched findings into the shared KB — **deduplicated,
  attributed, and quality-gated** — so future `recall`/`get_context` make the
  team smarter without owner direction.
- **Guardrails.** Outbound *writes* to the world are gated (Part 3); KB writes
  are deduped and marked with source + confidence to prevent pollution
  (anti-goal).

## Decisions (owner) — to confirm

1. **Budget stop threshold default** — the money-spend escalation fires above
   what (e.g. a % of the helper's `budget_usd_month`, or a fixed per-goal cap)?
2. **Irreversible/outside-world risk tier** — the default list that auto-escalates
   (send external email/message, payment, delete/destructive, publish). Confirm
   the default set; the rest run autonomously.
3. **Agent-created goals** — fully autonomous, or do they surface a one-time
   informational owner ack before the team runs them?

## Phasing (recommended build order)

- **Phase A — Part 1 (sync):** unblocks the visibility you're missing; lowest
  risk; foundation for everything.
- **Phase B — Part 2 (orchestration):** the engine — planner, role routing,
  `StaffRelation`, CoS-as-manager, loop-closure.
- **Phase C — Part 3 (autonomy):** makes it safe to let run continuously.
- **Phase D — Parts 4 + 5 (open creation + external/learning):** layer on once
  the engine is safe and visible.

Each phase ships working, testable software on its own and is its own plan
section.

## Builder-check refinements (settled by Claude)

1. **CoS review trigger identity + no double-fire.** The review step fires as a
   new `Task` (`origin="review"`, assigned to the goal's reviewing staff — CoS by
   default via `StaffRelation.reviews`), created from `_finish` **only on terminal
   success** of a child that has a goal link (the defer/retry/transient paths
   return early and never reach the hook). Idempotency: do not create a review
   task if one is already open for that (goal, child) pair. `dispatch_tasks`
   picks it up next tick like any task.
2. **`StaffRelation` seeding.** Ship a default org chart derived from roles via
   migration: CoS `delegates_to` every non-chief staff, and `reviews` each one,
   on install/onboarding. Owner-editable later (a Team UI edge editor is
   out-of-scope here); the CoS may also propose new edges. Existing installs get
   the default seed via the migration.
3. **CoS-as-manager enforcement is context-sensitive, not a blanket ban.** The
   manager tool-policy is applied **per run, keyed on run kind**: when the CoS
   runs *goal-delivery* work (a `plan`/`review` run or a goal-linked task) its
   execution tools (Bash/Write/Edit/web-write) are excluded so it must delegate;
   when it runs its own *admin* chores (retro, `improve`, `tune_helper`, replying
   in its chat) it keeps its normal tools. Implemented in `_task_context` /
   `capabilities.resolve` on the run's origin+role, not prompt-only and not a
   permanent `Staff.permissions` strip.
4. **Agent-created goals enter `active` by default** (permissive, per owner's
   stance) — no new status value needed. Owner Decision #3 governs only whether a
   **non-blocking** one-time informational notice is shown (modeled on the pool
   grandfather notice), never a hard gate. `seed_from_onboarding`'s "already has
   goals" guard already coexists with agent-created goals.
5. **KB learning gate is cheap/structural — no extra LLM call in the loop.**
   Reuse `kb_add`'s existing `(kind, ref)` upsert for URL-level dedup; add a
   structural gate (min content length; web sources must carry a source URL) and
   store `source` + a `confidence` tag in `KbSource.meta`. No per-`learn`
   validation model call (keeps the loop cheap); quality is enforced by structure
   + attribution, and low-confidence items are marked, not trusted blindly.

## What's left to the builder

- The exact shape of the unified read model and how `board`/`office`/`plan`
  consume it without regressing the Monitor.
- The planner prompt/graph and how a goal `target` becomes N role-assigned specs.
- `staff_by_role` resolution and `StaffRelation` seeding (who delegates to whom;
  who reviews whom) — including a sensible default org chart from existing roles.
- The child-complete → CoS-review continuation wiring in `_finish` (and guarding
  against loops/duplicate reviews).
- The manager tool-policy for the CoS (which tools are excluded for goal work).
- The risk-tier taxonomy and where each action maps (reuse existing proposal
  risk levels where possible).
- The web tool choice (harness allowedTools vs an Omilo MCP web tool) and the
  KB dedup/quality gate.
- Test strategy per phase: unified-read-model test (board == office for the same
  state); planner decomposition test; role-routing test; loop-closure test
  (child done → review → next/close); autonomy-gate tests (each stop condition);
  any-staff create_task/create_goal permission tests; external-fetch gating +
  learn-to-KB dedup test.
