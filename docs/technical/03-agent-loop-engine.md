# 03 · Agent Loop Engine

> Track: **technical**. How a goal becomes work: the Chief → delegate → execute → review →
> approve loop. Built on **LangGraph** with Postgres checkpointing, ported from omilo-os's
> proven graph. Business behavior lives in
> [`business/chief-orchestration.md`](../business/chief-orchestration.md); this doc is the
> mechanism.

## 1. The loop in one picture

```
            (goal set / routine fires / chat / flow step)
                              │
                         enqueue Job
                              │
   ┌──────────────────────────▼───────────────────────────────┐
   │  LangGraph  (checkpointed to Postgres per job_id)         │
   │                                                            │
   │   START → supervisor → worker → gate ─approved→ execute   │
   │              ▲            │       │                 │      │
   │              │            │       └─needs_owner─► INTERRUPT│
   │              └── review ◄──┴───────────────────────┘       │
   │                    │                                       │
   │                    └─ done ─► END  (Report + learn)        │
   └────────────────────────────────────────────────────────────┘
```

The graph is the trigger→context→act→report→approve→execute→learn cycle from omilo-os,
re-expressed for the v2 domain. **Every regular job is a loop that learns.**

## 2. Nodes

### `supervisor` (the Chief's planning brain)
- Runs only when the Job is a **plan/goal/chat-to-Chief** job, or when a Helper job needs
  re-planning. Builds a **bounded plan** (`MAX_STEPS = 12`) of delegated sub-jobs: for a Goal,
  it decomposes `target` into `Job`s assigned to Helpers by `area`/role and standing
  `job_description`.
- Writes the plan into the Job `checkpoint.plan` and emits `RunEvent(kind=thinking|status)`.
- For a Goal, each planned step becomes a child `Job` (`origin=delegation`, `parent_job_id`).

### `worker` (a Helper doing one job)
- Loads **TaskContext** (below), picks the Helper's **engine** (litellm / Claude Code pool /
  direct), and runs the turn. The agent reaches tools **only through MCP** (see [`05`](05-mcp-surfaces.md)).
- Produces `worker_output`, a possible `pending_action` (a side-effecting intent), a `risk`
  estimate, token/cost usage, and streamed `RunEvent`s.

### `gate` (the approval decision — Chief-as-representative)
- For any `pending_action`, computes **effective autonomy** and resolves the policy:
  `decide(effective_autonomy, risk, action_type, safety_limits) → allowed | needs_owner | refused`.
  - `allowed` → proceed to `execute` (Chief auto-approves on the operator's behalf; log an
    `AuditEvent` + optional `update` InboxItem).
  - `needs_owner` → create `Proposal` + `InboxItem`, then `langgraph.interrupt()` → the graph
    checkpoints and suspends until a human (or Chief under `yolo`) decides via the API.
  - `refused` → hard `SafetyLimit` hit; record and surface a `failure`/`alert` InboxItem.
- Resolution table in [`business/autonomy.md`](../business/autonomy.md). The gate **is** the
  Chief's mandate made executable.

### `execute`
- Carries out the approved `pending_action` (send message, spend, write doc, deploy, publish
  flow…) via the relevant connector/MCP tool. Idempotent: keyed by `(job_id, step,
  proposal_id)`; re-running after resume reuses prior effect if already done.

### `review`
- Decides **done** vs **loop again** (another supervisor pass) based on whether the
  `target`/brief is met, bounded by `MAX_STEPS`. On done → write `Report`, update `Goal.progress`,
  trigger **learn**.

### `learn` (post-step, async)
- Appends a Memory lesson if the operator corrected/decided something; indexes the Report into
  the KB; updates the retro scorecard. See [`04`](04-rag-knowledge-learning.md).

## 3. Graph state (TypedDict)

```python
class GraphState(TypedDict):
    company_id: str
    job_id: str
    helper_id: str
    brief: str
    operator_note: str | None
    messages: list            # running transcript
    plan: list[dict]          # supervisor output (bounded)
    step: int
    worker_output: str | None
    pending_action: dict | None   # {type, risk, payload, connector}
    risk: Risk | None
    effective_autonomy: Autonomy
    proposal_id: str | None   # set when gate interrupts
    done: bool
    result_text: str | None
    usage: dict               # tokens_in/out, cost_credits
```

Checkpointed with `langgraph-checkpoint-postgres` keyed by `thread_id = job_id`. A crash or an
approval-wait resumes from the exact node.

## 4. TaskContext / EngineResult (engine boundary)

Ported from omilo-os; the contract between the graph and whichever engine runs a turn.

```python
@dataclass
class TaskContext:
    company_id: str
    helper_id: str; helper_name: str; is_chief: bool
    job_id: str; origin: JobOrigin; brief: str; operator_note: str | None
    mcp_url: str; mcp_token: str          # per-agent MCP endpoint + bearer
    engine: dict                          # {type, auth, model, tier}
    resources: Resources                  # granted folders/connectors/skills
    memory: str                           # lessons + last runs + recent decisions (RAG-assembled)
    emit: Callable[[RunEvent], None]      # live streaming
    autonomy: Autonomy                    # effective
    goal_delivery: bool                   # Chief delegation work

@dataclass
class EngineResult:
    text: str
    pending_action: dict | None
    error: str | None
    cost_credits: int
    tokens_in: int; tokens_out: int
    suspended: bool                       # graph interrupted for approval
    defer: bool                           # account pool exhausted → re-queue and wait
```

`defer=True` (pool exhausted) re-queues the Job with backoff rather than failing — see
[`06`](06-llm-routing-account-pool.md).

## 5. Scheduler & worker runtime

- **Scheduler** (in `omilo-worker`): a leader-locked loop (Redis lock) that, each tick, finds
  `Routine`s whose `next_at ≤ now` (company tz via `croniter`) and `Goal`s/`Flow`s needing
  work, and enqueues `Job`s. Updates `next_at`.
- **Runner**: pulls Jobs from the Redis queue, enforces **per-company concurrency** and
  per-helper budget, runs the graph, writes `RunEvent`s (also published to Redis pub/sub for
  SSE/WS fan-out). Tracks `attempts`, retries with backoff, and `recover()`s orphaned
  `running` jobs on startup (idempotent via checkpoint).
- **Delegation fan-out**: a Goal plan creates child Jobs; the parent Chief Job waits on them
  (via checkpoint) and the `review` node aggregates child Reports.

## 6. Concurrency, limits, safety

| Control | Where | Effect |
|---|---|---|
| Per-company max concurrent Jobs | runner | fairness across tenants |
| Per-helper monthly credit budget | gate/runner | pause helper when exceeded |
| `SafetyLimit` (spend/day, messages/day, deploy, external_write) | gate | hard `refused` regardless of autonomy |
| `MAX_STEPS` per goal loop | review | bounds runaway loops |
| Idempotency keys | execute | no double side effects on resume |

Safety limits always win over autonomy — even `yolo` cannot exceed a hard cap the operator
set (Control-Panel → Safety & limits).

## 7. Origins → how a Job starts

| Origin | Trigger | Runs which nodes |
|---|---|---|
| `goal` / `plan` | `POST /v1/goals` | supervisor → (delegation jobs) → review |
| `delegation` | supervisor fan-out | worker → gate → execute → review |
| `routine` | scheduler (cron) | worker → gate → … (often a brief/report) |
| `flow` | FlowRun ai_step node | worker → gate → execute |
| `chat` | operator message (WS) | worker (+ supervisor if to Chief) |
| `execution` | proposal approved | execute only (carry out the approved action) |

## 8. Why LangGraph (reuse)

- **Durable checkpoints** make approvals (`interrupt`/resume) and crash recovery first-class —
  exactly the human-in-the-loop seam omilo needs.
- The supervisor/worker/gate/review decomposition matches the product's mental model (Chief
  plans, Helpers do, Chief approves, review closes) one-to-one.
- Engine-agnostic `worker` node lets the same loop run on litellm, the Claude Code pool, or a
  fake engine for tests/demo — proven in omilo-os.

## 9. Context assembly & compaction (chat sessions)

Every turn assembles a bounded **context** before calling the model; the composer's usage meter
([`02` §4a](02-api-contracts.md)) reflects it. Assembly order and token accounting:

```
context = system prompt + company/area get_context + assembled memory (RAG recall)
          + session.summary (if compacted) + recent message history + tool schemas
used_tokens = Σ(above)   ;   window = active model's context window   ;   pct = used/window
```

**Compaction** keeps long chats inside the window without losing the thread:

1. **Trigger.** When `pct` crosses a threshold (default ~80%), the composer surfaces **Compact**;
   it can also **auto-compact** when a turn would otherwise overflow.
2. **Distill.** A **fast-tier** model summarizes history *up to* a cut point into
   `Session.summary` (decisions, facts, open threads, tone), recording
   `summary_upto_message_id` + `compacted_at`.
3. **Continue.** Subsequent turns send **[summary + messages after the cut]** instead of the full
   transcript. Compaction is **non-destructive** — original `Message`s stay stored and scrollable;
   only what's *sent to the model* shrinks. Salient facts can also be promoted to the KB/Memory
   (`04`) so they survive beyond the summary.
4. **Idempotent & cheap.** Re-compaction extends the summary from the last cut; the summary itself
   is metered like any fast-tier call (`08`).

This is the session-level analogue of the agent loop's own `MAX_STEPS`/checkpoint bounding — it
keeps *chat* context affordable the way checkpoints keep *job* state durable. Autonomous Jobs
(routines/flows/goals) rarely need it (they're short-lived), but long Chief DMs and working chats
do.
