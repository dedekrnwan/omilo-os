# omilo-v2 — Backend TRD & Platform Design

> **Status:** Draft v1 · **Owner:** Dede Kurniawan · **Last updated:** 2026-10-26
> **License:** Elastic License v2 (ELv2) — source-available; monetized via subscription + AI-credit margin.

This is the entrypoint for the omilo-v2 technical and product design. It describes the
**Python backend** and the **Tauri desktop / web** shell that bring the already-built React
UI (`src/`, currently fully mocked) to life as a multi-company, agentic AI-operations
platform.

The docs are deliberately split into **two tracks** so you can read for *technical core
decisions* or *business process decisions* independently:

- **`technical/`** — architecture, libraries, data model, API contracts, the agent engine,
  RAG, MCP, LLM routing, multi-tenancy, billing, realtime, and Tauri. *Read this to approve
  or challenge the engineering choices.*
- **`business/`** — one doc per module describing how the thing behaves for the operator:
  the Chief, goals, routines, flows, approvals, autonomy, learning, docs, teams, and plans.
  *Read this to approve or challenge the product behavior.*
- **`integrations/`** — connectors, the MCP connector model, OAuth, and the cloud vs
  self-host edition split.

---

## What omilo is (one page)

omilo is an **AI operations platform for business operators**. A company's operator sets a
**goal** and the expected end result, then — depending on an **autonomy** dial
(`strict` / `ask` / `yolo`) — steps back while a team of AI **Helpers**, led by an AI
**Chief** that holds the operator's mandate, plans, delegates, executes, reviews, and
approves the work to completion.

The platform is **alive**: its own surfaces — **Goals**, **Routines** (cron), **Flows**,
and **Docs** — are exposed to agents as native **MCP** tools, so Helpers can operate the
platform themselves while humans retain oversight. Helpers **learn** (from their jobs, from
periodic relevance-filtered external reading, and by authoring their own **Skills**), and
can **propose Flows** from repeated actions (approved by the operator or, under higher
autonomy, by the Chief).

Operators connect their existing tools via **Connectors** to automate the manual routines
they do today — marketing, competitor analysis, reporting, disbursements — gaining speed,
quality, and cost wins.

### Who it serves

| | |
|---|---|
| **Primary user** | A business operator managing many people, needing more speed/quality and lower cost. |
| **Deployment** | Cloud multi-tenant SaaS (primary) + self-hostable single-tenant edition. |
| **Clients** | One React frontend shipped as a **Tauri desktop app (macOS)** and a **website**. |
| **Monetization** | Subscription plans + margin on metered AI credits. |

---

## The design in four decisions

These four forks were decided up front and every doc assumes them:

1. **Backend = fresh v2-native service that reuses omilo-os patterns.** New clean domain
   model; same proven library stack (FastAPI, LangGraph, litellm, pgvector, per-agent MCP);
   we port the *engine and RAG logic*, not the legacy schema. See
   [`technical/00-architecture.md`](technical/00-architecture.md).
2. **Shared-schema multi-tenancy.** Every tenant row carries `company_id`; Postgres
   Row-Level Security enforces isolation. Self-host collapses to a single company. See
   [`technical/07-multitenancy-auth.md`](technical/07-multitenancy-auth.md).
3. **Billing fully designed, built in phases** (meter → wallet → pay). The subscription + credit
   model is provider-independent and sellable on **manual/offline billing**; the **payment
   processor is undecided and optional**, sitting behind a pluggable `PaymentProvider` port
   (Stripe / Xendit / Midtrans / Paddle / manual) wired only when ready. See
   [`technical/08-billing-ai-credits.md`](technical/08-billing-ai-credits.md) and
   the Omilo Cloud plan notes (private, `omilo-cloud`).
4. **Layered autonomy:** `effective = min(workspace_default, goal_override, helper_cap)`
   over `strict < ask < yolo`. See [`business/autonomy.md`](business/autonomy.md).

---

## Concept map (UI ⇄ backend)

The v2 UI concepts map almost 1:1 onto the backend domain (patterns proven in omilo-os).
This is the shared vocabulary used across every doc.

| omilo-v2 (UI concept) | Backend entity | Notes |
|---|---|---|
| **Chief** | `Helper` with `is_chief = true` | Supervisor + approval **gate**; approves on the operator's behalf. |
| **Helper** (area/role) | `Helper` | role, `area`, engine config, `autonomy_cap`, budget. |
| **Channel** / Area | `Channel` | a focused space (icon, color, **purpose**); a **context scope** bounds what its agents read; scopes chats, goals, flows, docs, inbox. |
| **Goal** | `Goal` | outcome + target; optional `autonomy_override`; progress 0–100. |
| **Routine** (cron) | `Routine` → `Job` | schedule fires a `Job` (or goal-plan) for a Helper. |
| **Flow** (canvas) | `Flow` + `FlowRun` | trigger + typed steps (nodes/edges); may spawn `Job`s. |
| **Session** / chat | `Session` + `Message` | thread of operator ⇄ Helper messages. |
| **Inbox decision** | `InboxItem` + `Proposal` | anything needing a human/Chief approval. |
| **Job** (analytics "jobs done") | `Job` | one atomic unit of agent execution (os `Task`). |
| **Report** | `Report` | a Job's outcome: headline, body, KPIs, what's next. |
| **Knowledge / Docs** | `KbSource`/`KbChunk` + `Doc` | hybrid RAG + a wiki-style Docs vault. |
| **Skills** | `Skill` | reusable agent-authored know-how. |
| **AI accounts** | `HarnessAccount` (pool) + `ProviderKey` | subscription pool + direct keys. |
| **Connectors / MCP** | `Connector` / `Piece` | external tools (first-party **marketplace** `omilo-pieces` + custom/BYO) exposed to agents over MCP; omilo is MCP client here and MCP server to its own agents (and, later, to outside clients). See [`technical/11`](technical/11-marketplace-connectors-mcp.md). |
| **Members & roles** | `Member` + `Role` | humans in a company. |
| **Plan / credits** | `Plan` + `CreditLedger` | subscription + metered AI credits. |

---

## Reading order

**To approve the engineering:**
`technical/00-architecture` → `01-data-model` → `02-api-contracts` → `03-agent-loop-engine`
→ `04-rag-knowledge-learning` → `05-mcp-surfaces` → `06-llm-routing-account-pool` →
`07-multitenancy-auth` → `08-billing-ai-credits` → `09-realtime` → `10-tauri-desktop` →
`11-marketplace-connectors-mcp`.

**To approve the product behavior:**
`business/chief-orchestration` → `goals` → `routines` → `flows` → `inbox-approvals` →
`autonomy` → `learning-skills-flows` → `docs-knowledge` → `teams-members-roles`.

**To approve integrations:** `integrations/README`.

---

## Source-of-truth & scope notes

- The frontend's `src/core/ports/repos.ts` (`Repos` interface) and `src/core/domain/types.ts`
  are the **de-facto contract** the API must satisfy; the data model and API docs extend them
  with the mutations and realtime surfaces the UI implies but does not yet call.
- omilo-os (`~/Documents/works/omilo/omilo-os`) is the **reference implementation** for the
  loop, RAG, MCP, and account-pool behavior. Where this TRD says "as in omilo-os," the
  pattern is proven there and being re-expressed in the v2 domain.
- This TRD is design only. Nothing here is built until the design is approved; build order
  is phased per [`technical/00-architecture.md` §Delivery phases](technical/00-architecture.md).
