# 02 · API Contracts

> Track: **technical**. The HTTP + realtime surface the frontend consumes. It **must satisfy
> the existing `Repos` port** (`src/core/ports/repos.ts`) and the domain types
> (`src/core/domain/types.ts`), then extend them with the mutations and streams the UI
> implies. Transport: REST/JSON for reads+mutations, SSE for event feeds, WebSocket for
> interactive chat, Web Push for notifications.

## 1. Conventions

- Base path `/v1`. JSON only. All bodies validated by Pydantic v2 (schemas mirror
  [`01-data-model.md`](01-data-model.md)).
- **Tenant is implicit.** The active `company_id` comes from the auth session (+ optional
  `X-Company-Id` for multi-company users), never from the body. See [`07`](07-multitenancy-auth.md).
- **Auth**: `Authorization: Bearer <access_jwt>` (web uses httpOnly cookie; desktop uses the
  token store — see [`10`](10-tauri-desktop.md)).
- **Errors** use RFC 9457 problem+json: `{type, title, status, detail, instance}`. Standard
  codes: `401` unauth, `403` wrong tenant/role, `404`, `409` conflict, `422` validation,
  `402` insufficient credits, `429` rate limited.
- **Pagination**: cursor-based `?cursor=&limit=` → `{items, next_cursor}`. List endpoints that
  back a `Repos.list*()` return the bare array the UI expects (no envelope) for parity; larger
  feeds (messages, events, audit) use the cursor envelope.
- **Idempotency**: mutations accept `Idempotency-Key` header (required for spend/approve).
- **Timestamps** ISO-8601 UTC. The UI's relative strings (`"now"`, `"2h"`) are **derived
  client-side**; the API returns absolute `*_at` fields.

---

## 2. Repos-port parity (P0 — unmock the UI)

The frontend's `Repos` interface is the contract floor. Direct mapping:

| `Repos` method | Endpoint |
|---|---|
| `channels.list()` | `GET /v1/channels` → `Channel[]` |
| `channels.get(id)` | `GET /v1/channels/{id}` → `Channel \| 404` |
| `folders.listByChannel(id)` | `GET /v1/channels/{id}/folders` → `Folder[]` |
| `folders.listAll()` | `GET /v1/folders` → `Folder[]` |
| `goals.listByChannel(id)` | `GET /v1/channels/{id}/goals` → `Goal[]` |
| `goals.listAll()` | `GET /v1/goals` → `Goal[]` |
| `sessions.get(id)` | `GET /v1/sessions/{id}` → `Session \| 404` |
| `sessions.listByChannel(id)` | `GET /v1/channels/{id}/sessions` → `Session[]` |
| `sessions.listAll()` | `GET /v1/sessions` → `Session[]` |
| `messages.listBySession(id)` | `GET /v1/sessions/{id}/messages` → `Message[]` |
| `inbox.list()` | `GET /v1/inbox` → `InboxItem[]` |
| `inbox.get(id)` | `GET /v1/inbox/{id}` → `InboxItem \| 404` |

Response bodies are **structurally identical** to the TS types (same field names). Server-only
fields (`created_at`, `company_id`) are additive and ignored by the current UI. A new
`HttpRepos` adapter implements `Repos` against these endpoints; `ReposProvider` swaps mock →
http by env. **This is the only change needed to make today's UI live.**

---

## 3. Auth & tenancy

```
POST /v1/auth/sign-up            {email,name,password}        → {user, session}
POST /v1/auth/sign-in            {email,password}             → {user, session, companies[]}
POST /v1/auth/sign-in/google     {id_token}                   → {...}
POST /v1/auth/refresh            {refresh_token}              → {access, expires_at}
POST /v1/auth/sign-out
POST /v1/auth/forgot-password    {email}
POST /v1/auth/reset-password     {token,password}
POST /v1/auth/two-step/verify    {code}
GET  /v1/me                                               → {user, member, company, companies[]}
POST /v1/companies   {name, industry?, team_size?, region?, currency?, pic_role?,
                      timezone?, plan?}                       → Company       (onboarding)
GET  /v1/companies                                        → Company[]       (choose-company)
GET  /v1/company                                          → Company         (active tenant profile)
PATCH /v1/company    {name?, industry?, team_size?, region?,
                      currency?, pic_role?, timezone?, color?}  → Company     (Control-Panel → General)
POST /v1/companies/{id}/switch                            → {session}       (sets active tenant)
```

The profile fields (`industry`, `team_size`, `region`, `currency`, `pic_role`) come from the
onboarding **create-company** step and are editable later in Control-Panel → General. `region`
defaults `timezone` + `currency` when those aren't given. They're **context** (folded into the
handbook / `get_context`) plus the **locale triple** (`currency`+`region`+`timezone`) for
rendering money/dates — see [`01` §2](01-data-model.md).

Onboarding wizard (`features/onboarding`) drives: create company → choose AI mode
(self-host vs cloud, see [`06`](06-llm-routing-account-pool.md)) → pick team helpers
(`TEAM_HELPERS`) → choose plan → *(optional)* payment. Each step is a mutation above or in
§8/§11. The **payment step is skippable**: with no `PaymentProvider` configured (or self-host),
onboarding completes on a `trialing`/`active` plan with offline billing — see
[`08` §6](08-billing-ai-credits.md).

---

## 4. Chat (sessions, messages, streaming)

```
POST /v1/sessions                {channel_id?, goal_id?, title?, scope}   → Session
GET  /v1/sessions/{id}/messages  ?cursor=&limit=                           → {items:Message[], next_cursor}
POST /v1/sessions/{id}/messages  {content, attachments?, model?, think_level?}  → Message (your msg, persisted)
POST /v1/sessions/{id}/archive
PATCH /v1/sessions/{id}          {title?, folder_id?, model_override?, think_level?}
```

**Streaming the Helper's reply** uses the WebSocket channel (§9), not a REST response — the
Helper's turn produces a `Job` whose `RunEvent`s stream tokens, tool calls, and sources live,
then a final `Message` is persisted. The Chief DM (`features/chief-dm`) is a session with
`scope=chief_dm`; same endpoints.

### 4a. Composer controls (model · think level · context meter · compaction)

The chat composer exposes four runtime controls; all are backed here.

```
GET  /v1/sessions/{id}/context     → { used_tokens, window_tokens, pct, model, think_level,
                                        breakdown:{system,memory,history,tools}, compactable:bool }
POST /v1/sessions/{id}/compact     {strategy?: "auto"|"aggressive"}  → { summary, freed_tokens, Session }
GET  /v1/models                    → ModelOption[]  (allowed models for this company/engine; picker)
```

- **Model selection.** The composer's model picker sets `model` per-send or `model_override` on
  the session. Resolution order (loosest-binds-last): **message `model`** → **session
  `model_override`** → Helper `engine.model` → Channel/area default → company default. See
  [`06` §7](06-llm-routing-account-pool.md). `GET /v1/models` returns what's installable given the
  active engine (litellm providers, the Claude Code pool, or BYO keys) + each model's context
  window.
- **Think level.** `think_level ∈ auto|standard|high|max` sets reasoning effort for the turn →
  maps to the engine tier + a thinking/`reasoning_effort` budget ([`06` §7](06-llm-routing-account-pool.md)).
  `auto` lets the engine pick by task; the others let the operator force deeper reasoning on a hard
  question (at higher cost/latency, surfaced in the composer).
- **Context usage meter.** `GET …/context` returns the tokens the *next* turn would send vs the
  active model's window (with a breakdown: system prompt, assembled memory/RAG, message history,
  tool schemas). The composer renders the `pct` meter; it also streams live as
  `RunEvent(kind=usage)` during a turn (§9).
- **Compaction.** When `pct` crosses a threshold (default ~80%) the composer surfaces **Compact**
  (and can auto-compact). `POST …/compact` distills the earlier history into `Session.summary`
  (fast-tier model), sets `summary_upto_message_id` + `compacted_at`, and the next turn sends
  **[summary + recent turns]** instead of the full transcript — freeing context while preserving
  salient facts. Mechanism in [`03` §9](03-agent-loop-engine.md). Compaction is non-destructive:
  original messages stay stored and scrollable; only what's *sent to the model* is compacted.

---

## 5. Goals

```
GET   /v1/goals                              → Goal[]
POST  /v1/goals     {channel_id,title,target,due?,autonomy_override?}  → Goal
                    # creating a goal enqueues a Chief plan Job (see 03)
GET   /v1/goals/{id}                          → GoalDetail {goal, jobs[], kpis[], proposals[]}
PATCH /v1/goals/{id} {title?,target?,due?,status?,autonomy_override?,position?}
POST  /v1/goals/{id}/replan                   → {job_id}   # ask Chief to re-decompose
DELETE /v1/goals/{id}                          # status→dropped (soft)
```

The "set a goal, step back" behavior lives here: `POST /v1/goals` with `target` is the single
entrypoint that kicks off autonomous delivery. See
[`business/goals.md`](../business/goals.md).

## 6. Inbox & approvals (the human-in-the-loop seam)

```
GET  /v1/inbox                 ?status=open&channel_id=     → InboxItem[]
GET  /v1/inbox/{id}                                          → InboxItem
POST /v1/inbox/{id}/snooze     {until}
GET  /v1/proposals/{id}                                      → {proposal, revisions[]}
POST /v1/proposals/{id}/approve          {note?}            → {proposal, execution_job_id}
POST /v1/proposals/{id}/reject           {note}
POST /v1/proposals/{id}/request-changes  {note}            → new ProposalRevision
```

Approving resumes the interrupted LangGraph checkpoint and spawns an `execution` Job that
carries out the action (idempotent via `Idempotency-Key`). Under `yolo`, the Chief approves
server-side and no InboxItem is created (an `update` item records it after the fact). Full
rules in [`business/inbox-approvals.md`](../business/inbox-approvals.md) and
[`business/autonomy.md`](../business/autonomy.md).

## 7. Routines (cron)

```
GET   /v1/routines                                   → RoutineRow[]   (list + week lanes)
GET   /v1/routines/week  ?week=2026-10-19             → {label, days[], lanes[]}
POST  /v1/routines   {helper_id,name,instructions,freq,at,days?,monthly?,sends_to[],goal_ids?}
GET   /v1/routines/{id}                               → RoutineDetail {routine, runs[]}
PATCH /v1/routines/{id}  {…, paused?, enabled?}
POST  /v1/routines/{id}/run-now                       → {job_id}
DELETE /v1/routines/{id}
```

Backed by `croniter` in the company timezone; each firing creates a `Job`. The Chief can
propose schedule changes (the `ROUTINE_SUGGESTION` "spread Monday mornings" flow) as an
InboxItem. See [`business/routines.md`](../business/routines.md).

## 8. Flows

```
GET   /v1/flows                                       → FlowCard[]
POST  /v1/flows   {title, trigger, nodes[], edges[], channel_ids[]}  → Flow (status=draft)
GET   /v1/flows/{id}                                  → Flow (nodes/edges canvas)
PATCH /v1/flows/{id}  {nodes?,edges?,trigger?,enabled?}
POST  /v1/flows/{id}/publish                          → Proposal (type=flow_publish)
POST  /v1/flows/{id}/test-run  {sample}               → FlowRun (ephemeral)
GET   /v1/flows/{id}/runs                             → FlowRunRow[]
GET   /v1/flow-runs/{id}                              → FlowRun {+ job timeline}
```

Publishing a Flow requires approval (operator, or Chief under higher autonomy) — matching the
"flows require approval but can use Chief approval" rule. Agent-proposed flows (from repeated
actions) arrive as a `flow_publish` Proposal with the draft attached. See
[`business/flows.md`](../business/flows.md).

## 9. Realtime (SSE + WebSocket + Push)

Detailed in [`09-realtime.md`](09-realtime.md). Surface summary:

```
GET  /v1/stream              (SSE)   # per-company event bus: inbox.*, job.*, goal.*, flow.*, notice.*
WS   /v1/ws/sessions/{id}            # interactive chat: send msg → stream helper RunEvents → final Message
WS   /v1/ws/jobs/{id}                # observe a single job's RunEvents (used by flow/routine run views)
POST /v1/push/subscribe      {endpoint, keys}         # Web Push registration
```

SSE events are small envelopes `{type, id, data}`; the client invalidates the matching React
Query key or appends to a stream. This is how the Inbox, analytics, routine runs, and "Chief
is working" indicators update without polling.

## 10. Knowledge, Docs, Skills

```
GET   /v1/docs                               → Doc[] (+ links for the d3-force graph)
GET   /v1/docs/{id}                          → {doc, version}
POST  /v1/docs   {path,title,content}        → Doc
POST  /v1/docs/{id}/suggest  {content,summary}  # agent/outside suggestion (version 0)
POST  /v1/docs/{id}/accept   {version}
GET   /v1/knowledge          ?kind=&q=       → KbSource[]        (Control-Panel → Knowledge)
POST  /v1/knowledge/sources  {kind,ref,title,body?}   # add file/url/note to RAG
DELETE /v1/knowledge/sources/{id}
GET   /v1/skills                             → Skill[]
POST  /v1/skills/{id}/publish                → Proposal (type=skill_publish)
```

## 11. Control panel (workspace admin)

```
GET/PATCH /v1/company                         # General
GET/PATCH /v1/company/handbook                # Company handbook (knowledge seed)
GET  /v1/members ; POST /v1/members/invite ; PATCH /v1/members/{id} ; DELETE /v1/members/{id}
GET  /v1/channels ; GET /v1/channels/{id}     # Channels & areas
POST /v1/channels  {name, icon, color, purpose?, context_scope?, helper_ids?, member_ids?}
                   # the "Create area" modal; context_scope defaults "isolated"; Chief auto-added
PATCH /v1/channels/{id}  {name?, icon?, color?, purpose?, context_scope?, helper_ids?, member_ids?}
DELETE /v1/channels/{id}                       # (not the default/General area)
GET/PATCH /v1/safety                          # Safety & limits → SafetyLimit rules
GET/PATCH /v1/ai-engine                       # default engine/model per area
GET  /v1/ai-accounts ; POST /v1/ai-accounts ; POST /v1/ai-accounts/{id}/test ;
     PATCH /v1/ai-accounts/{id} (enable/disable) ; POST /v1/ai-accounts/check   # connection check
GET  /v1/providers ; POST /v1/providers {provider,key} ; DELETE /v1/providers/{id}
GET  /v1/connectors ; POST /v1/connectors ; POST /v1/connectors/{id}/oauth/start ; …  (integrations/)
GET  /v1/usage                                # Usage → analytics + credit balance
GET  /v1/activity   ?cursor=                   # AuditEvent feed
GET  /v1/data/export ; POST /v1/data/delete    # Data (GDPR-style)
```

`GET /v1/ai-accounts` returns exactly the `PoolAccount` shape on the AI-accounts screen
(`harness, name, tag, status, pct, tokens, last_used`) plus server ids — the pool is
cross-harness and shared, per the current UI.

## 12. Helpers (team)

```
GET   /v1/helpers                             → HelperStat[]   (Team roster + analytics)
GET   /v1/helpers/{id}                        → HelperDetail {helper, jobs[], skills[], budget}
POST  /v1/helpers  {name,area,role,job_description,engine?,autonomy_cap?}
PATCH /v1/helpers/{id}  {…, status?}          # edit role / pause
POST  /v1/helpers/{id}/pause
```

Helper creation can be operator-initiated (Team screen) or Chief-proposed (`propose_helper`
via MCP → InboxItem).

## 13. Analytics

```
GET /v1/analytics/overview   ?range=week      → {stats[], series[]}     # channelStats, bar charts
GET /v1/analytics/helpers    ?range=          → HelperStat[]            # per-helper jobs/success/tokens/spend
GET /v1/analytics/activity   ?range=          → activity timeline
```

Values are **computed from Jobs/Reports/CreditLedger/ToolCall**, never estimated — the
"Tokens / Spend / Success rate" cards are exact.

---

## 14. Contract testing

- The existing `src/core/ports/repos.contract.ts` suite runs against `HttpRepos` (pointed at a
  seeded test server) in CI — guaranteeing the backend honors the port.
- Pydantic response models are exported to **OpenAPI 3.1**; a generator produces TS types that
  are diffed against `src/core/domain/types.ts` in CI to catch drift.
- Each mutation has a golden idempotency test (replay with same `Idempotency-Key` → same
  result, no double spend).
