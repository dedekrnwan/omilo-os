# 00 · Architecture & Library Decisions

> Track: **technical**. Decides the shape of the system and the library stack. Downstream
> docs assume everything here.

## 1. Goals, non-goals, anti-goals

**Goals**
- A single Python backend that runs the agent loop (Chief → delegate → execute → review →
  approve), RAG + learning, MCP surfaces, connectors, and billing for **many companies**.
- One React frontend served to both a **Tauri desktop app** and a **website**, backed by a
  clean REST + realtime contract that matches the existing `Repos` port.
- Routines keep running when the operator's laptop is closed → **server-side execution**.

**Non-goals**
- Not reusing the omilo-os schema verbatim. We keep its *patterns*, not its tables.
- Not a general workflow engine for arbitrary users; the domain is business operations.

**Anti-goals** (would make this a failure even if it "works")
- An architecture where the desktop app must be open for agents to work.
- A tenancy model that can leak one company's data into another's context/RAG.
- A billing design that cannot attribute real provider cost to a company's credit spend.

## 2. System shape

```
                    ┌──────────────────────────────────────────────┐
   Tauri (macOS) ───┤                                              │
   Web browser  ────┤   React SPA  (src/, existing)                │
                    │   • REST for reads/mutations                 │
                    │   • SSE for event feeds (jobs, inbox)        │
                    │   • WebSocket for interactive chat           │
                    │   • Web Push for notifications               │
                    └───────────────┬──────────────────────────────┘
                                    │ HTTPS / WSS
                    ┌───────────────▼──────────────────────────────┐
                    │  API Gateway  (FastAPI, uvicorn)             │
                    │  auth · tenancy (RLS) · REST · WS · SSE      │
                    │  MCP server (per-agent, JSON-RPC/HTTP)       │
                    └───┬───────────────┬───────────────┬──────────┘
                        │ enqueue       │ read/write    │ meter
             ┌──────────▼───┐   ┌───────▼───────┐  ┌────▼─────────┐
             │ Worker pool  │   │ Postgres 16    │  │ Redis        │
             │ (LangGraph   │   │ + pgvector     │  │ queue/locks/ │
             │  engine)     │   │ (RLS, shared   │  │ pubsub/cache │
             │ • supervisor │   │  schema)       │  └──────────────┘
             │ • worker     │   └────────────────┘
             │ • gate       │   ┌────────────────┐
             │ • review     │   │ Object store    │  (S3/MinIO: files, screenshots)
             │ • learn      │   └────────────────┘
             └──────┬───────┘
                    │ LLM calls
        ┌───────────▼───────────────────────────────┐
        │ Engines: litellm (credits) · Claude Code   │
        │ account pool · direct provider keys        │
        └────────────────────────────────────────────┘
```

**Three processes, one codebase** (as in omilo-os):
- `omilo-api` — FastAPI gateway: auth, tenancy, REST/WS/SSE, MCP server endpoint.
- `omilo-worker` — background execution: scheduler (routines/goals), the LangGraph engine,
  learning jobs, KB indexing.
- `omilo-migrate` — Alembic migrations (plus `omilo-seed` for demo data).

Gateway and worker share models and the engine library but scale independently. Redis is the
work queue + distributed lock + pub/sub bus (fan-out of `run_event`s to SSE/WS subscribers).

## 3. Library stack (reuse omilo-os choices)

| Concern | Choice | Why |
|---|---|---|
| Web framework | **FastAPI** + uvicorn | async, Pydantic v2 contracts, WS/SSE support. |
| ORM / DB | **SQLAlchemy 2.0** (Mapped) + **Postgres 16** | mature, RLS-friendly, pgvector. |
| Migrations | **Alembic** | standard for SQLAlchemy. |
| Validation | **Pydantic v2** | request/response schemas = API contract. |
| Agent orchestration | **LangGraph ≥1.0** + `langgraph-checkpoint-postgres` | the supervisor→worker→gate→review loop with durable checkpoints & `interrupt()` for approvals. |
| LLM routing | **litellm ≥1.81** | one interface over Anthropic/OpenAI/Gemini/… with fast/balanced/deep tiers. |
| Subscription engine | **Claude Code** CLI pool | run headless `claude` across a pooled set of accounts (the AI-accounts screen). |
| Embeddings | **fastembed** (local, default) + Voyage/OpenAI (optional) | no-GPU default, pluggable. |
| Vector search | **pgvector** (HNSW) + Postgres FTS | hybrid retrieval with reciprocal-rank fusion. |
| Scheduling | **croniter** | routine cron in the company timezone. |
| Queue / locks / pubsub | **Redis** | durable-enough queue, leader locks, event fan-out. |
| Auth | argon2 password hash, JWT session + opaque refresh, `cryptography` for secret encryption | see `07`. |
| Payments | **pluggable `PaymentProvider` port** (optional) | subscriptions + metered usage behind a port; concrete processor undecided (Stripe / Xendit / Midtrans / Paddle / manual), wired later; see `08`. |
| HTTP client | **httpx** | async connector/OAuth calls. |
| Object storage | **S3 / MinIO** (boto3) | files, browser screenshots, exports. |
| Notifications | **pywebpush** | Web Push to desktop/web (os pattern). |
| Browser connector | **Playwright** (Chromium headless) | per-agent browsing, sandboxed in worker. |

> **Why "fresh service, reuse patterns":** omilo-os proves these libraries fit the problem.
> We adopt the stack and the *loop/RAG/MCP logic* but model the domain cleanly for v2
> (Helper/Channel/Goal/Routine/Flow/Member/Plan), avoiding a multi-year coupling to the
> os schema. The port is logic-level, not table-level.

## 4. Repository layout (proposed)

```
omilo-v2/
├── src/                      # existing React frontend (unchanged by this TRD)
├── src-tauri/                # Tauri shell (see technical/10)
├── apps/
│   └── api/
│       ├── omilo/            # the Python package
│       │   ├── main.py             # FastAPI app factory
│       │   ├── config.py           # Settings (env)
│       │   ├── db.py               # engine, session, RLS helpers
│       │   ├── models/             # SQLAlchemy models (see technical/01)
│       │   ├── schemas/            # Pydantic request/response (see technical/02)
│       │   ├── api/                # routers: channels, goals, sessions, inbox, …
│       │   ├── realtime/           # SSE + WS hubs, Redis fan-out
│       │   ├── engine/             # LangGraph graph: supervisor/worker/gate/review
│       │   ├── engines/            # litellm / claude_code / direct providers (factory)
│       │   ├── kb/                 # chunk, embed, retrieve (hybrid RAG)
│       │   ├── memory/             # editable-markdown lessons/notes
│       │   ├── mcp/                # per-agent MCP server + tool handlers
│       │   ├── connectors/         # connector registry + OAuth
│       │   ├── billing/            # metering, credit ledger, PaymentProvider port (+ optional impls)
│       │   ├── worker/             # scheduler + task runner
│       │   └── tenancy/            # company context, RLS session vars
│       ├── migrations/             # Alembic
│       ├── tests/
│       └── pyproject.toml
├── deploy/                   # docker-compose, Traefik, prod config
└── docs/                     # this TRD
```

## 5. Request / execution lifecycle (happy path)

1. Operator sets a **Goal** with an expected result and (optionally) an autonomy override.
2. Gateway writes the `Goal`, enqueues a **plan Job** for the **Chief**.
3. Worker runs the Chief through the LangGraph **supervisor**: it decomposes the goal into
   delegated `Job`s for the right Helpers (by `area`/role).
4. Each Helper `Job` runs the **worker** node on its engine; tool calls go through the
   **MCP server**, which checks the **gate** (effective autonomy × action risk).
5. Low/medium-risk actions the Chief auto-approves; high-risk actions create an
   **InboxItem/Proposal** and `interrupt()` the graph (durable checkpoint).
6. Operator (or Chief, under `yolo`) approves → graph resumes from checkpoint → Helper
   **executes** and files a **Report**.
7. The **review** node decides done vs. loop-again; progress updates the Goal.
8. **Learning**: the Job's outcome and any operator decision feed Memory lessons and the KB;
   the retro scorecard updates. Every LLM call is **metered** into the credit ledger.
9. The frontend sees each step live via **SSE** (`run_event`), chat via **WS**, and
   approvals via the **Inbox** + **Web Push**.

Detailed in [`03-agent-loop-engine.md`](03-agent-loop-engine.md) and
[`business/chief-orchestration.md`](../business/chief-orchestration.md).

## 6. Cross-cutting principles

- **Server-authoritative execution.** All agent work runs in the worker; clients only
  observe and decide. Closing the desktop app never stops a routine.
- **Everything is attributable.** Every `Job`, `ToolCall`, and LLM call records tokens, cost,
  Helper, and company → analytics + billing are exact, not estimated.
- **Idempotent & resumable.** Jobs checkpoint; resume after crash or approval reuses prior
  work (keyed by `job_id` + `step`). Account-pool switches mid-job are idempotent.
- **Tenant isolation is non-negotiable.** RLS is enforced at the DB session for *every*
  request and worker task; RAG retrieval is always company-scoped.
- **Least privilege for agents.** Agents never hold raw credentials and never call tools
  directly — they `propose`/`request_action` and the gateway decides (see `05`).

## 7. Delivery phases

| Phase | Theme | Ships |
|---|---|---|
| **P0** | Contract + skeleton | FastAPI app, models, Alembic, RLS, auth, `Repos`-parity read endpoints backed by a real DB (unmock the UI). |
| **P1** | The loop | Worker, LangGraph engine (supervisor/worker/gate/review), chat (WS), Jobs/Reports, Inbox approvals, SSE run events. Engine via litellm + Claude Code pool. |
| **P2** | Alive platform | Routines (cron), Flows (trigger+steps), Goals orchestration, MCP surfaces for Goals/Routines/Flows/Docs. |
| **P3** | Smarter | RAG (hybrid), Memory lessons, periodic external learning, Skills, Flow-proposal-from-repetition, retro/scorecard. |
| **P4** | Business | Plans, **credit metering** (first), connectors catalog + OAuth, analytics. |
| **P5** | Commerce core + desktop | Credit **wallet/top-up/overage**, **internal subscriptions + manual provisioning** (sellable on offline billing), Tauri native (secure storage, notifications, deep links), self-host edition. |
| **P6** | Payment provider (optional) | Wire one pluggable `PaymentProvider` (Stripe / Xendit / Midtrans / Paddle): hosted checkout, webhooks, metered overage, onboarding payment. |

Billing note: **metering lands in P4; wallet + the full (offline-sellable) subscription model in
P5; actual payment collection is P6 and OPTIONAL** — the payment processor is undecided and sits
behind a port, so omilo is monetizable on manual/offline billing before any provider is chosen.
See [`08-billing-ai-credits.md`](08-billing-ai-credits.md).
