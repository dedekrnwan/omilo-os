# Autonomous Team Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Omilo's existing goal/task/staff backbone into an autonomous digital team: one live source of truth across surfaces, a goal → decompose → delegate → monitor → validate → loop engine with the Chief of Staff as manager, a permissive config-driven autonomy policy, any-staff task/goal creation, and external access + self-directed learning.

**Architecture:** A shared `worklog` read model unifies tasks + chat activity + proposals for every surface, pushed live over the existing `office` bus. Orchestration is event-driven: a planner run decomposes a goal into role-assigned Tasks; `_finish` enqueues an idempotent CoS review Task on each child's terminal success; the review decides next/revise/done. Autonomy is a config layer over the existing `autonomy` field + `_cos_rule`, with a stop/escalate gate. Creation and web/learning tools are added to the existing MCP server.

**Tech Stack:** Python/FastAPI (`apps/api/omilo_api`), SQLAlchemy models, the in-repo MCP server (`mcp_server.py`), the worker loop (`worker.py`), Next.js web (`apps/web`); pytest.

**Spec:** `docs/superpowers/specs/2026-10-20-autonomous-team-engine-design.md`

## Global Constraints

- **Permissive by default; owner control absolute.** The owner can always tighten config, leave a note, or stop; `pause-all` / stop-goal is never weakened.
- **No engine/provider change.** Runs on the existing Claude Code harness; reuse the shipped local/pool/api auth + defer/spill/cap fallback untouched.
- **One source of truth.** Inbox board, Monitor, and Plan read the same `worklog` model; they must not disagree for the same DB state.
- **Reuse the office bus** for live push; do not invent a second realtime channel.
- **Everything autonomous is visible + audited** — no silent action; every delegation/decision writes an event/audit row.
- **Budgets stay enforced**; money-spend over threshold is a stop condition.
- **CoS-as-manager is context-sensitive** — execution tools excluded only for the CoS's goal-delivery runs, never for its admin chores.
- **KB learning gate is cheap/structural** — reuse `kb_add` upsert dedup + metadata; no per-`learn` LLM validation call.
- **Do not break shipped behavior** — existing task/chat/workflow execution, the Monitor's live union, the defer ladder, auth paths.
- **Loop safety** — the orchestration loop advances only on task-completion events, is idempotent, and terminates on goal-done/stop; never hot-spins.

## Review Focus

- **Orchestration loop runs away or double-fires** — child-complete → review → next could duplicate reviews or loop forever. → pinned in Task B5 (idempotency) and B6 (termination).
- **Chat activity desync / orphan** — a thread `awaiting_reply` with no live run, or a finished chat still shown running. → pinned in Task A1/A2.
- **Role resolves to zero or many staff** — `staff_by_role` with no holder or multiple holders must not crash or mis-route. → pinned in Task B1.
- **An irreversible/outside-world action slips the autonomy gate** — a send/payment/destructive op runs without escalation. → pinned in Task C3.
- **KB pollution** — duplicate or low-quality learning writes. → pinned in Task D4.

---

## Phase A — Single source of truth + live sync

### Task A1: Unified live work-state read model

**Files:**
- Create: `apps/api/omilo_api/worklog.py`
- Test: `apps/api/tests/test_worklog.py`

**Interfaces:**
- Produces: `live_state(db) -> dict` returning `{"items": [WorkItem]}` where a `WorkItem` is `{"kind": "task"|"chat"|"proposal"|"question", "id": str, "staff_id": str, "status": "running"|"queued"|"waiting"|"working", "title": str, "goal_id": str|None, "since": iso|None}`. Unions: Tasks with status in (running,queued,waiting); Threads with `awaiting_reply==True` (kind="chat", status="working"); open InboxItems of kind proposal/question. Mirrors the union already in `office.state()` (`office.py:191-264`) but as a reusable, surface-agnostic model.

- [ ] **Step 1: Write the failing test**
```python
def test_live_state_unions_tasks_and_chats(owner, db):
    # given: one running Task for staff A, one Thread awaiting_reply for staff B
    s = live_state(db)
    kinds = {(i["kind"], i["staff_id"]) for i in s["items"]}
    assert ("task", "A") in kinds
    assert ("chat", "B") in kinds   # the desync bug: chat work IS live work
def test_live_state_excludes_finished(db):
    # a done task + a thread with awaiting_reply=False -> neither appears
    assert live_state(db)["items"] == []
```
- [ ] **Step 2: Run test, verify it fails** (`live_state` undefined).
- [ ] **Step 3: Implement `live_state(db)`** in `worklog.py`, reusing the same queries `office.state()` uses (running tasks, `Thread.awaiting_reply`, open InboxItems); return the flat `items` list. Do not duplicate logic that can be imported.
- [ ] **Step 4: Run test, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(worklog): unified live work-state read model"`

### Task A2: Inbox board surfaces chat activity via the read model

**Files:**
- Modify: `apps/api/omilo_api/board.py` (`build()`, the RUNNING column ~line 83)
- Test: `apps/api/tests/test_board.py`

**Interfaces:**
- Consumes: `worklog.live_state` (Task A1).
- Produces: `board.build(db)` RUNNING column includes chat activity items (a card with kind="chat", label "Replying in chat") alongside running Tasks.

- [ ] **Step 1: Write the failing test**
```python
def test_board_running_includes_chat(owner, db):
    # given a Thread awaiting_reply (no Task), board RUNNING is non-empty
    b = board.build(db)
    assert any(c.get("kind") == "chat" for c in b["running"])
```
- [ ] **Step 2: Run test, verify it fails** (RUNNING only has tasks today).
- [ ] **Step 3:** In `build()`, merge chat-kind items from `live_state` into the `running` list, mapped to the board card shape. Keep existing task cards unchanged.
- [ ] **Step 4: Run test, verify pass.** Also assert existing board task tests still pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(board): show in-progress chat work in RUNNING (single source of truth)"`

### Task A3: Live push to the board/Plan over the office bus

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `GET /board/stream` SSE, mirroring the office WS wake), `apps/web/app/page.tsx` (subscribe), `apps/web/app/plan/page.tsx` (subscribe)
- Test: `apps/api/tests/test_board.py`

**Interfaces:**
- Consumes: `bus` publish on `"office"` (same signal the Monitor uses, `office.py:146-151`).
- Produces: `GET /api/board/stream` emits a tick whenever `bus` publishes for the company; the web board refetches on tick (no more poll-only).

- [ ] **Step 1: Write the failing test**
```python
def test_board_stream_emits_on_commit(owner):
    # subscribing to /api/board/stream, a commit that touches a Task yields a tick within wait_for
```
- [ ] **Step 2: Run test, verify it fails.**
- [ ] **Step 3:** Add the SSE endpoint subscribing to `bus` for the company (reuse the office subscription pattern). In web, subscribe and refetch `/api/board` on tick.
- [ ] **Step 4: Run test, verify pass;** `cd apps/web && npm run build` passes.
- [ ] **Step 5: Commit** — `git commit -m "feat(board): live push over the office bus"`

---

## Phase B — Orchestration loop

### Task B1: Role resolution + role-based delegation

**Files:**
- Modify: `apps/api/omilo_api/services.py` (add `staff_by_role`), `apps/api/omilo_api/mcp_server.py` (`create_task` accepts `role`)
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Produces: `services.staff_by_role(db, role: str) -> Staff | None` (first active staff whose `role` matches, case-insensitive; `None` if none). `create_task` MCP tool accepts an optional `role` (resolved via `staff_by_role`) as an alternative to `staff_id`; if both absent or role unresolved → `DomainError`.

- [ ] **Step 1: Write the failing tests** — resolves a role to its staff; returns `None` for an unknown role; `create_task(role="marketing")` routes to that staff; unresolved role raises a clear error (Review Focus: zero/many holders).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `staff_by_role` and wire the `role` branch in `create_task` (`mcp_server.py:467-482`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): role-based task routing"`

### Task B2: Seed the delegation/review org chart (`StaffRelation`)

**Files:**
- Modify: `apps/api/omilo_api/services.py` (add `seed_relations`), the onboarding finish path (`routers/api.py` `_kickoff`) + a migration for existing installs
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Consumes: `Staff.is_chief`, `Staff.role`.
- Produces: `services.seed_relations(db)` creating default `StaffRelation` rows — CoS `delegates_to` and `reviews` every active non-chief staff — idempotently.

- [ ] **Step 1: Write the failing test** — after `seed_relations`, a `delegates_to` and a `reviews` edge exist from the CoS to each non-chief; running it twice adds no duplicates.
- [ ] **Step 2: Run, verify fail** (StaffRelation is dead schema today).
- [ ] **Step 3: Implement** `seed_relations`; call it from onboarding finish and from a one-time migration for existing companies.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): seed delegates_to/reviews org chart"`

### Task B3: Goal planner — decompose a goal into role-assigned tasks

**Files:**
- Modify: `apps/api/omilo_api/plan.py` (add `start_planning`), `apps/api/omilo_api/worker.py` (dispatch a `plan` run), `apps/api/omilo_api/models.py` (`Task.origin` accepts `"plan"`)
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Consumes: `Goal`, `create_task`, `staff_by_role`.
- Produces: `plan.start_planning(db, goal_id)` enqueues one planner Task (`origin="plan"`, assigned to the CoS, `goal_id` linked) whose brief instructs decomposition of the goal `target` into role-assigned sub-tasks via `create_task`. Activating a goal (owner `POST /goals` or agent `create_goal`) calls `start_planning`.

- [ ] **Step 1: Write the failing test** — creating/activating a goal enqueues exactly one `origin="plan"` CoS task linked to the goal; the planner task's `create_task` calls produce child tasks linked to the same goal (simulate the agent by calling the plumbing). Re-activating an already-planned goal does not double-plan.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `start_planning` + the dispatch wiring + the `"plan"` origin. The LLM decomposition itself is agent behavior driven by the planner brief; test the plumbing (one plan task; children link to the goal).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): goal planner run"`

### Task B4: Chief of Staff manager tool-policy (context-sensitive)

**Files:**
- Modify: `apps/api/omilo_api/worker.py` (`_task_context`) and/or `apps/api/omilo_api/capabilities.py` (tool resolution)
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Consumes: `Task.origin`, `Task` goal link, `Staff.is_chief`.
- Produces: for a CoS run that is goal-delivery work (`origin in ("plan","review")` or a goal-linked task), execution tools (`Bash`, `Write`, `Edit`, web-write) are excluded from the resolved `allowedTools`; for a CoS admin run (no goal link, e.g. retro/chat) the normal tool set is kept.

- [ ] **Step 1: Write the failing test** — resolve tools for a goal-linked CoS run → no `Bash`/`Write`; resolve for a non-goal CoS run → `Bash` present; a non-CoS staff run is unaffected.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the context-sensitive filter keyed on run kind + `is_chief`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): CoS manager tool-policy (delegate, don't do)"`

### Task B5: Loop-closure — enqueue CoS review on child completion

**Files:**
- Modify: `apps/api/omilo_api/worker.py` (`_finish`)
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Consumes: `Task` goal link, `StaffRelation.reviews`, the terminal-success path in `_finish`.
- Produces: on terminal **success** of a goal-linked child (not defer/retry/transient), `_finish` creates one `origin="review"` Task assigned to the reviewing staff (CoS by default), linked to the goal and to the child via `parent_task_id`. Idempotent: no new review if one is already open for that (goal, child).

- [ ] **Step 1: Write the failing tests** — finishing a goal-linked child creates exactly one review task; calling `_finish` twice for it creates no duplicate (Review Focus: double-fire); a `defer=True` finish creates none; a non-goal task creates none.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the review-enqueue hook after the success branch in `_finish`, with the idempotency guard.
- [ ] **Step 4: Run, verify pass;** confirm `tests/test_pool_wait.py` (defer ladder) still green.
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): child-complete -> CoS review (loop-closure)"`

### Task B6: Goal termination — review decides next / revise / done

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (add `complete_goal` tool), `apps/api/omilo_api/plan.py` (helper)
- Test: `apps/api/tests/test_orchestration.py`

**Interfaces:**
- Consumes: the `review` task, `Goal`.
- Produces: `complete_goal(goal_id, outcome)` MCP tool sets `Goal.status="done"` (and writes an audit/report); available to the reviewing staff. A review run either creates the next spec via `create_task`, a revision via `create_task(origin="revision")`, or calls `complete_goal`. Termination guarantee: once a goal is `done`/`dropped`, no further planner or review tasks are enqueued for it (guard in B3/B5).

- [ ] **Step 1: Write the failing tests** — `complete_goal` sets status done; a done goal enqueues no further reviews/plans (Review Focus: runaway loop); a revision path creates an `origin="revision"` child.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `complete_goal` + the done-goal guards in the B3/B5 enqueue paths.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(orchestration): goal termination + loop guards"`

---

## Phase C — Autonomy policy

### Task C1: Autonomy config (company + per-helper, permissive default)

**Files:**
- Modify: `apps/api/omilo_api/services.py` (settings helpers), `apps/api/omilo_api/models.py` if a column is needed; prefer a `Setting` key
- Test: `apps/api/tests/test_autonomy.py`

**Interfaces:**
- Produces: `services.autonomy_policy(db, staff=None) -> dict` → `{"mode": "permissive"|"strict", "budget_stop_usd": float|None, "escalate_tiers": [str]}` with a **permissive** default (`mode="permissive"`, default escalate tiers = the irreversible/outside set). Per-helper override falls back to company, then default.

- [ ] **Step 1: Write the failing test** — with nothing configured, `autonomy_policy` returns the permissive default; a company setting overrides; a per-helper override wins over company.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the resolver over `Setting` + `Staff.autonomy`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(autonomy): config resolver (permissive default)"`

### Task C2: CoS decides on the owner's behalf (generalize `_cos_rule`)

**Files:**
- Modify: `apps/api/omilo_api/services.py` (`_cos_rule`, ~900-937)
- Test: `apps/api/tests/test_autonomy.py`

**Interfaces:**
- Consumes: `autonomy_policy` (C1).
- Produces: `_cos_rule` approves/validates proposals for **all** brains (not only graph) up to the configured risk tier when `mode="permissive"`, writing an audit row; higher tiers still go to the owner.

- [ ] **Step 1: Write the failing test** — in permissive mode, a low/medium proposal from a single-engine staff is auto-approved by the CoS with an audit row; a high-tier proposal is not.
- [ ] **Step 2: Run, verify fail** (today it's graph-only).
- [ ] **Step 3: Implement** the generalization gated on `autonomy_policy`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(autonomy): CoS approves on the owner's behalf"`

### Task C3: Stop/escalate gate

**Files:**
- Create: `apps/api/omilo_api/autonomy.py`
- Test: `apps/api/tests/test_autonomy.py`

**Interfaces:**
- Consumes: `autonomy_policy` (C1).
- Produces: `should_escalate(db, staff, action: dict) -> (bool, reason)` returning True (→ owner inbox) for: an owner note on the goal/task; a `critical` tier; an explicit stop/pause; spend over the budget threshold; an **irreversible/outside-world** action (default tier: `send_external`, `payment`, `destructive`, `publish`); or anything config tightens. Everything else returns False.

- [ ] **Step 1: Write the failing tests** — one per condition: note present → escalate; `send_external` action → escalate (Review Focus: outside action must not slip); spend over threshold → escalate; a plain internal action in permissive mode → do NOT escalate.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `should_escalate` and call it at the proposal/action boundary (where `_cos_rule` / `request_action` decide).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(autonomy): stop/escalate gate"`

### Task C4: Budget stop condition

**Files:**
- Modify: `apps/api/omilo_api/worker.py` (`_budget`), `apps/api/omilo_api/autonomy.py`
- Test: `apps/api/tests/test_autonomy.py`

**Interfaces:**
- Consumes: `should_escalate` (C3), `Staff.budget_usd_month`, task/company spend.
- Produces: when accumulated spend crosses `budget_stop_usd` (default: a fraction of `budget_usd_month`), the team pauses that scope and escalates to the owner instead of continuing the loop.

- [ ] **Step 1: Write the failing test** — spend below threshold keeps running; crossing it escalates + halts new goal work for that scope.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the budget check in the dispatch/finish path via `should_escalate`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(autonomy): budget stop condition"`

---

## Phase D — Open creation + external access & learning

### Task D1: Open `create_task` beyond the Chief of Staff

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (`create_task` auth, ~468-479)
- Test: `apps/api/tests/test_creation.py`

**Interfaces:**
- Consumes: `StaffRelation.delegates_to` (B2), `autonomy_policy` (C1).
- Produces: any active staff may `create_task` within its `delegates_to` scope (default **not strict**); self-delegation still blocked; depth cap read from config (default 2). Non-permitted cross-scope delegation → clear `DomainError`.

- [ ] **Step 1: Write the failing tests** — a non-CoS staff delegates to a staff it `delegates_to` (success); self-delegation blocked; out-of-scope delegation refused.
- [ ] **Step 2: Run, verify fail** (today non-CoS gets 403 unconditionally).
- [ ] **Step 3: Implement** the scope check replacing the CoS-only gate.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(creation): any staff may delegate within scope"`

### Task D2: `create_goal` / `update_goal` MCP tools

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (register tools + handlers)
- Test: `apps/api/tests/test_creation.py`

**Interfaces:**
- Consumes: `Goal`, `plan.start_planning` (B3), `autonomy_policy`.
- Produces: `create_goal(title, target, due?) -> goal_id` and `update_goal(goal_id, status?|title?|target?)`, permissioned for staff. A created goal enters `status="active"` and triggers `start_planning`; owner Decision #3 governs a **non-blocking** informational notice (no hard gate).

- [ ] **Step 1: Write the failing tests** — a staff `create_goal` creates an active goal + one planner task; `update_goal(status="done")` closes it; the goal appears in `worklog.live_state` / Plan.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the two tools; wire `create_goal` → `start_planning`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(creation): agent create_goal/update_goal"`

### Task D3: External access — web search/fetch as governed tools

**Files:**
- Modify: `apps/api/omilo_api/capabilities.py` / the harness `plan()` tool list, `apps/api/omilo_api/autonomy.py` (classify web-write as a gated tier)
- Test: `apps/api/tests/test_external.py`

**Interfaces:**
- Consumes: `should_escalate` (C3), `autonomy_policy`.
- Produces: web **search + fetch (read)** are granted to permitted staff by default (low-risk tier); outbound **writes** (posting/sending) classify as `send_external` and route through `should_escalate`.

- [ ] **Step 1: Write the failing tests** — a permitted staff's resolved tools include web read; an outbound-write action triggers `should_escalate`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the tool grant + the write-tier classification.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(external): governed web search/fetch for agents"`

### Task D4: Learning loop — capture to KB with dedup + quality gate

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (add `learn`), `apps/api/omilo_api/services.py` (KB helper)
- Test: `apps/api/tests/test_external.py`

**Interfaces:**
- Consumes: the existing `kb_add` upsert on `(kind, ref)`.
- Produces: `learn(summary, source_url?, confidence?) -> ok` writing a KB entry with structural gating — minimum content length; web kind requires a `source_url`; stores `source` + `confidence` in `KbSource.meta`; duplicate `(kind, ref)` upserts rather than duplicates. **No extra LLM validation call.**

- [ ] **Step 1: Write the failing tests** — `learn` writes a KB entry retrievable via `recall`; a second `learn` with the same URL upserts (no duplicate, Review Focus: KB pollution); a too-short/sourceless web entry is rejected.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `learn` over `kb_add` with the structural gate + metadata.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(external): self-directed learning into the KB"`

---

## Notes for executors

- **Phases are sequential by dependency**: B consumes A's read model and B2's relations; C gates B's loop; D consumes B2 (`delegates_to`) + C (`autonomy_policy`/`should_escalate`). Execute A → B → C → D. Each phase is independently shippable and testable.
- The **LLM behaviors** (how the CoS actually decomposes/validates) are driven by the planner/review briefs, not hard-coded; tasks test the *plumbing and guarantees* (one plan task, idempotent review, termination, gating), not the model's prose.
- Run feature tests in isolation (the repo's full suite has pre-existing shared-session isolation debt — see `docs/test-suite-isolation.md`).
