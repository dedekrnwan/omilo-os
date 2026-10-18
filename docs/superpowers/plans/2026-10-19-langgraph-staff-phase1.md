# Dynamic LangGraph Staff — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a per-staff opt-in LangGraph "brain" where the Chief of Staff supervises a worker run, auto-handles low/medium-risk results, and escalates high-risk to the owner — running Claude Code as the underlying engine — without changing behavior for staff that stay on the single engine.

**Architecture:** A new `GraphEngine` implements the existing `Engine.run_task(ctx) -> EngineResult` contract, so `get_engine` stays the only factory and `worker.run_task` is nearly untouched. When a staff has `brain="graph"`, the worker routes through `GraphEngine`, which runs a small LangGraph `StateGraph` (supervisor → worker → review/gate) whose work node calls the staff's underlying engine (Claude Code first). The gate re-derives risk structurally (never trusting a worker's self-label), auto-approves low/medium via the existing `decide_proposal` with the CoS as actor, and for high risk checkpoints the graph (thread keyed by `task_id`), files a `Proposal`, and suspends; the owner's later decision resumes it from the checkpoint.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Postgres (+ LangGraph Postgres checkpointer), Redis; new dep `langgraph`. Reuse `engines.Engine`/`TaskContext`/`EngineResult`/`get_engine`, `services.create_proposal`/`decide_proposal`, `memory.lesson_from_decision`, the `db.py` `_COLUMNS`/`_add_columns` migration pattern, and the worker dispatch loop.

**Spec:** `docs/superpowers/specs/2026-10-19-dynamic-langgraph-staff-design.md`

## Global Constraints

- **Opt-in, no regression.** Staff with `brain="single_engine"` (the default) run exactly as today — same `get_engine(st.engine)` path. The graph path is reached only when `brain="graph"`.
- **Claude Code is the brain and the hands.** Graph "thinking" and work nodes call the staff's underlying engine via `get_engine`; there is no separate reasoning vendor/API key. Routing/validation = one bounded structured engine call, not an open-ended agent run.
- **Risk is re-derived, never trusted from the worker.** The gate classifies risk structurally; the hard-rule categories (send / spend / merge / deploy / production / any outward action) escalate regardless of a worker's self-reported `Proposal.risk`.
- **CoS authority: auto-handle low+medium, escalate high.** CoS auto-approvals go through `services.decide_proposal(db, p, "approve", note, by=<cos staff id>)` so audit + `lesson_from_decision` + execution-task spawning are reused. The owner can override. Hard rules (no send/spend/merge/deploy/production without the owner) stay enforced regardless of autonomy.
- **Escalation never holds a live connection.** High risk → checkpoint + file `Proposal` + suspend + end the run. The existing `POST /proposals/{pid}/decide` resumes the graph from its checkpoint (thread_id = `task_id`).
- **Additive schema only.** New `staff` columns via `db.py` `_COLUMNS` + `ADD COLUMN IF NOT EXISTS`; new `staff_relation` table via `create_all`. No drops, no data loss.
- **Depth cap.** The supervisor↔worker loop is bounded (reuse the engines' turn-cap idiom; constant `MAX_GRAPH_STEPS = 12`) so a confused graph ends with an error, not infinite pool spend.
- Tests run from `apps/api` with the project venv `python -m pytest ... -p no:cacheprovider`, using the `owner` fixture and session-scoped shared DB (assert on your own ids, clean up keys/state you create).

## Review Focus

- **A worker self-labels a send/spend/deploy action "low" to dodge escalation** → the gate must still escalate it (risk re-derived structurally). *(Task 2, Task 4)*
- **`brain="single_engine"` staff are byte-for-byte unaffected** → the old dispatch path is unchanged; no graph code runs for them. *(Task 6)*
- **A suspended high-risk run executes NOTHING before approval and leaves no zombie asyncio task** → the graph ends cleanly on suspend; the task is marked waiting, not running. *(Task 4)*
- **Owner rejects a suspended high-risk proposal** → the graph resumes to a clean stop, records the note as a lesson, executes nothing. *(Task 5)*
- **Supervisor↔worker ping-pong can't loop forever** → `MAX_GRAPH_STEPS` ends the run with an error EngineResult, bounded pool spend. *(Task 3)*

---

### Task 1: Soul schema — brain / autonomy / voice columns + staff_relation table

**Files:**
- Modify: `apps/api/omilo_api/models.py` (add `Staff.brain`, `Staff.autonomy`, `Staff.voice`; add `StaffRelation`)
- Modify: `apps/api/omilo_api/db.py` (append to `_COLUMNS`)
- Test: `apps/api/tests/test_soul_schema.py`

**Interfaces:**
- Produces: `Staff.brain: str` (default `"single_engine"`, values `single_engine|graph`), `Staff.autonomy: str` (default `"standard"`, values `guided|standard|trusted`), `Staff.voice: str` (default `""`). `StaffRelation` table (`from_staff: str`, `to_staff: str`, `kind: str` ∈ `delegates_to|reviews`; composite PK `(from_staff, to_staff, kind)`).
- `db._COLUMNS` gains `("staff","brain","VARCHAR(16) NOT NULL DEFAULT 'single_engine'")`, `("staff","autonomy","VARCHAR(16) NOT NULL DEFAULT 'standard'")`, `("staff","voice","TEXT NOT NULL DEFAULT ''")`.

- [ ] **Step 1: Write failing tests** (`owner`): a newly hired staff reports `brain=="single_engine"`, `autonomy=="standard"`, `voice==""`; creating two `StaffRelation` rows and reading them back works; the three columns exist on the `staff` table (introspection) so an already-created DB is migrated.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the model fields + `StaffRelation`, and append the three tuples to `_COLUMNS`. `create_all` makes `staff_relation`; `_add_columns` adds the columns.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(soul): brain/autonomy/voice columns + staff_relation table`.

---

### Task 2: Structural risk classifier

**Files:**
- Create: `apps/api/omilo_api/graph/__init__.py`, `apps/api/omilo_api/graph/risk.py`
- Test: `apps/api/tests/test_graph_risk.py`

**Interfaces:**
- Produces: `classify_risk(action_type: str, summary: str, worker_label: str | None = None) -> str` returning `"low"|"medium"|"high"`. Hard-rule categories always return `"high"` regardless of `worker_label`: any action whose `action_type` or `summary` denotes sending externally, spending money, merging, deploying, or touching production, and any outward-facing action (`content.publish`, message/email send, payment). Otherwise return the higher of `worker_label` (if a valid level) and the classifier's own read; internal-only work (drafts, research, file edits in allowed folders, planning) is `"low"`/`"medium"`.

- [ ] **Step 1: Write failing tests:**

```python
def test_send_labeled_low_is_high():
    assert classify_risk("content.publish", "post the draft to Instagram", worker_label="low") == "high"
def test_spend_is_high():
    assert classify_risk("payment.charge", "charge the client $200", worker_label=None) == "high"
def test_internal_draft_is_low_or_medium():
    assert classify_risk("docs.write", "draft a blog post in Docs", worker_label="low") in ("low", "medium")
def test_worker_cannot_downgrade_but_can_upgrade():
    assert classify_risk("docs.write", "edit a file", worker_label="high") == "high"
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `classify_risk` — a keyword/category map for the hard-rule set plus the label-max rule. Keep the category list in one constant so Task 4 and future tasks share it.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(graph): structural risk classifier (worker label is a hint, not authority)`.

---

### Task 3: GraphEngine skeleton + factory wiring + depth cap

**Files:**
- Create: `apps/api/omilo_api/graph/state.py` (LangGraph state), `apps/api/omilo_api/graph/engine.py` (`GraphEngine`)
- Modify: `apps/api/omilo_api/engines/__init__.py` (`get_engine` routes `"graph"`)
- Modify: `apps/api/pyproject.toml` (add `langgraph`)
- Test: `apps/api/tests/test_graph_engine.py`

**Interfaces:**
- Consumes: `Engine`/`TaskContext`/`EngineResult`/`get_engine` from `engines`; `classify_risk` (Task 2).
- Produces: `GraphState` (TypedDict: `task_id`, `brief`, `messages`, `plan`, `worker_output`, `pending_action`, `risk`, `step`, `done`, `result_text`). `GraphEngine(Engine)` with `type="graph"` implementing `async def run_task(self, ctx: TaskContext) -> EngineResult`. `get_engine({"type":"graph","exec_engine": <dict>})` returns `GraphEngine`; the work node runs `get_engine(ctx.engine_config["exec_engine"]).run_task(<derived ctx>)`. Constant `MAX_GRAPH_STEPS = 12`.
- Phase-1 graph (no human yet): `supervisor → worker → review → END`. `supervisor` makes one bounded structured engine call to produce/update `plan` and pick the next step; `worker` calls the underlying engine for the actual work; `review` sets `done`. The supervisor↔worker edge increments `step`; at `MAX_GRAPH_STEPS` the graph ends with `EngineResult(error="graph did not converge in {MAX_GRAPH_STEPS} steps")`.

- [ ] **Step 1: Write failing tests** using a fake underlying engine (`exec_engine={"type":"fake"}`): a graph `run_task` returns an `EngineResult` with the fake's output text and `done`; a graph forced to loop (fake worker never satisfies review) ends with the `MAX_GRAPH_STEPS` error, not forever; `get_engine({"type":"graph",...})` returns a `GraphEngine`.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `GraphState`, `GraphEngine` with the three-node `StateGraph`, the step cap, and the factory branch. Add `langgraph` to deps and install into the venv.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(graph): GraphEngine over Engine contract with supervisor/worker/review + depth cap`.

---

### Task 4: Delegation gate — CoS auto-approve low/medium, escalate high (checkpoint + suspend)

**Files:**
- Create: `apps/api/omilo_api/graph/delegation.py`
- Modify: `apps/api/omilo_api/graph/engine.py` (insert a `gate` node after `worker`; wire the Postgres checkpointer, `thread_id = task_id`)
- Test: `apps/api/tests/test_graph_delegation.py`

**Interfaces:**
- Consumes: `classify_risk` (Task 2); `services.create_proposal(db, st, task_id, title, type_, risk, body, actor=None)`, `services.decide_proposal(db, p, decision, note, by)`, `memory.lesson_from_decision` (reused via `decide_proposal`). The CoS staff id = the `is_chief` staff of the company.
- Produces: `gate(state, ctx) -> Command` — when `pending_action` risk is `low`/`medium`: create the `Proposal`, then `decide_proposal(..., "approve", note="auto-approved by Chief of Staff", by=<cos id>)`, record that the CoS approved (audited as CoS), continue the graph to execute/finish. When `high`: `create_proposal(...)` (left pending), checkpoint the graph (LangGraph interrupt/checkpoint, thread_id=`task_id`), set the task status to a waiting state, and end the run with `EngineResult(text="Waiting for your approval: {title}")` — executing nothing. A helper `cos_id(db) -> str`.

- [ ] **Step 1: Write failing tests** (`owner`): a graph worker proposing a low/medium internal action → a `Proposal` exists decided `approved` with `decided_by == cos_id`, an audit event with the CoS as actor, and the run completes; a worker proposing a send/spend action (even self-labeled low) → a `Proposal` left `pending`, the run ends in a waiting state, and no execution task ran.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `gate` + `cos_id`, insert the node, wire the checkpointer with `thread_id=task_id`.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(graph): CoS delegation gate — auto-approve low/medium, escalate high via checkpoint`.

---

### Task 5: Resume a suspended graph on the owner's decision

**Files:**
- Modify: `apps/api/omilo_api/services.py` (`decide_proposal`: after deciding a graph-origin proposal, enqueue a resume)
- Modify: `apps/api/omilo_api/worker.py` (resume a checkpointed graph run by `task_id`)
- Modify: `apps/api/omilo_api/graph/engine.py` (`GraphEngine.resume(task_id, decision, note)`)
- Test: `apps/api/tests/test_graph_resume.py`

**Interfaces:**
- Consumes: the checkpointer + `thread_id=task_id` (Task 4); the suspended task.
- Produces: `GraphEngine.resume(task_id: str, decision: str, note: str) -> EngineResult` — reloads the checkpoint for `task_id` and continues: on `approve`, execute the approved action and finish; on `reject`/`changes`, end the run, record the note as a lesson (via the existing path), execute nothing. `decide_proposal` detects a graph-origin proposal (the proposal/task carries `brain="graph"`) and signals the worker to resume (reuse the existing "spawn follow-up work on decision" mechanism; do not block the HTTP request).

- [ ] **Step 1: Write failing tests** (`owner`): suspend a high-risk run (Task 4) → `POST /api/proposals/{id}/decide {approve}` → the graph resumes, the action executes, the task finishes `done`; a second run → decide `reject` with a note → the graph resumes to a clean stop, the note is recorded as a lesson, and nothing executed.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `resume`, the `decide_proposal` graph-origin branch, and the worker resume hook.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(graph): resume a suspended graph run when the owner decides`.

---

### Task 6: Worker opt-in wiring + soul→prompt assembly

**Files:**
- Modify: `apps/api/omilo_api/worker.py` (`_task_context` / `run_task`: route `brain="graph"` through `GraphEngine`)
- Modify: `apps/api/omilo_api/graph/engine.py` (use `voice`/`autonomy` in the node prompt assembly)
- Test: `apps/api/tests/test_graph_optin.py`

**Interfaces:**
- Consumes: `Staff.brain`/`autonomy`/`voice` (Task 1); `GraphEngine` (Tasks 3-5).
- Produces: when `st.brain == "graph"`, the effective engine config the worker runs is `{"type":"graph","exec_engine": dict(st.engine or {})}`; otherwise the config is `st.engine` unchanged. The graph's supervisor/worker prompts include the staff `voice` and adjust how often the worker consults the gate by `autonomy` (`guided` proposes more/earlier; `trusted` acts more within permissions). No behavior change for `single_engine` staff.

- [ ] **Step 1: Write failing tests** (`owner`): a `brain="single_engine"` staff task uses the normal engine (assert the graph is never entered — e.g. patch `GraphEngine.run_task` to raise and confirm a single_engine task still succeeds); a `brain="graph"` staff task routes through `GraphEngine` (assert it is entered); `voice` text appears in the assembled prompt.
- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the `_task_context`/`run_task` branch and the soul→prompt assembly.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(worker): per-staff opt-in to the graph brain + soul-driven prompts`.

---

## Self-Review

- **Spec coverage:** dynamic data-assembled agent → Tasks 3/6 (soul→graph); CoS supervisor + delegation dial (auto low/medium, escalate high) → Task 4; risk re-derived not trusted → Task 2/4; escalation via checkpoint+suspend, resume on decision → Task 4/5; Claude Code as brain+hands → Task 3 (underlying engine) ; souls (brain/autonomy/voice/relations) → Task 1/6; learning/initiative kept → reused unchanged (no task edits `loops.py`/shifts); phased opt-in, no regression → Task 6. Relations table lands in Task 1; routing *use* of relations is a later phase (Phase 1 defaults to CoS-over-everyone) — noted, not a gap.
- **Type consistency:** `classify_risk(action_type, summary, worker_label)` identical Task 2↔4; `get_engine({"type":"graph","exec_engine":...})` identical Task 3↔6; `GraphEngine.resume(task_id, decision, note)` identical Task 5↔(decide_proposal caller); `thread_id = task_id` identical Task 4↔5; `brain`/`autonomy`/`voice` names identical Task 1↔6.
- **Review Focus:** worker-downgrade-to-dodge (T2/T4), no-regression (T6), suspend-executes-nothing/no-zombie (T4), reject-clean-stop (T5), depth-cap (T3) — all owned.
- **Proportion:** 6 tasks, each an independently testable deliverable; signatures and test names carried, bodies left to the implementer except the one risk-rule the tests pin. Depends on the approvals-in-chat branch (delegation surface) being merged first — sequence after it.
