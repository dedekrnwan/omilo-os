# 01 · Data Model

> Track: **technical**. The canonical entities, enums, and relationships. Every other doc
> uses these names. Shared-schema multi-tenant: **every tenant table carries `company_id`**
> and is protected by Postgres RLS (see [`07`](07-multitenancy-auth.md)).

Conventions: Postgres 16 + SQLAlchemy 2.0. IDs are prefixed ULIDs (`cmp_…`, `hlp_…`,
`job_…`) stored as text — sortable, URL-safe, and readable in logs. `created_at`/`updated_at`
are `timestamptz`. JSON columns are `jsonb`. Vectors use `pgvector`.

---

## 1. Enums (single source of truth)

```python
Autonomy       = "strict" | "ask" | "yolo"          # strict < ask < yolo
Risk           = "low" | "medium" | "high"
HelperArea     = soft, EXTENSIBLE category — NOT a closed enum. Seeded defaults
                 {brand, ops, support, finance, marketing, sales, growth, data, …};
                 companies add their own. Each area maps to one bounded visual
                 accent (color + mascot). The real per-Helper variance lives in
                 `role` / `job_description`, which are free-form. See §3 note.
MemberRole     = "owner" | "admin" | "member"
JobOrigin      = "chat"|"goal"|"routine"|"flow"|"delegation"|"execution"|"plan"
JobStatus      = "queued"|"running"|"waiting"|"done"|"failed"|"cancelled"
ProposalType   = "message"|"spend"|"external_write"|"deploy"|"doc_write"|"flow_publish"
               | "connector_access"|"settings_change"|"skill_publish"|"other"
ProposalStatus = "pending"|"approved"|"rejected"|"changes_requested"|"executing"|"done"|"failed"
InboxKind      = "decision"|"update"|"mention"|"question"|"alert"|"failure"
InboxStatus    = "open"|"snoozed"|"done"
ChannelContextScope = "isolated" | "isolated_plus_general"   # what agents in an area may read
SessionScope   = "chat"|"chief_dm"|"job"|"proposal"|"group"
MessageRole    = "you"|"helper"|"system"
ThinkLevel     = "auto"|"standard"|"high"|"max"   # composer reasoning effort → tier + thinking budget
RoutineFreq    = "daily"|"weekdays"|"weekly"|"monthly"
FlowRunStatus  = "running"|"needs_you"|"done"|"failed"
FlowNodeKind   = "trigger"|"ai_step"|"connector"|"approval"|"condition"
EngineType     = "litellm"|"claude_code"|"anthropic"|"graph"|"fake"
AccountStatus  = "new"|"ready"|"working"|"near_limit"|"cooling"|"error"  # near_limit = ≥ warn threshold, de-prioritized
KbKind         = "doc"|"memory"|"context"|"job"|"chat"|"proposal"|"file"|"web"|"connector"|"skill"|"note"
LedgerReason   = "job"|"topup"|"grant"|"adjustment"|"refund"|"subscription_grant"
PlanTier       = "free"|"starter"|"growth"|"scale"|"enterprise"
```

> **Mapping to omilo-os:** autonomy `strict/ask/yolo` ↔ os `guided/standard/trusted`;
> `Helper` ↔ `Staff`; `Routine` ↔ `Shift`; `Job` ↔ `Task`; `Flow` ↔ `Workflow`;
> `Session` ↔ `Thread`. The *semantics* are identical; names are v2-native.

---

## 2. Tenancy & identity

### `Company` (the tenant — no `company_id` on itself)
| col | type | notes |
|---|---|---|
| id | text PK | `cmp_…` |
| name | text | |
| color | text | brand accent (UI) |
| industry | text | sector, e.g. "F&B", "Agency", "Fintech" (seeded list + free entry). Seeds the handbook / `get_context` so Helpers tailor to the business. |
| team_size | text | band, e.g. `1-10`\|`11-50`\|`51-200`\|`200+` (onboarding picker). Context signal for the Chief. |
| region | text | geo/market, e.g. `ID`, `SEA`, `US` (ISO country or region). Drives locale + data-residency hints; defaults the timezone. |
| currency | text | ISO 4217, e.g. `IDR`, `USD`. **Display + money context only** — formats spend/disbursements and the credit→money view; credits stay a provider-independent internal unit (see [`08`](08-billing-ai-credits.md)). |
| pic_role | text | the primary person-in-charge's role, e.g. "Owner", "Ops Manager", "Marketing Lead" (onboarding). Feeds the operator profile so the Chief knows *who* it represents. |
| timezone | text | e.g. `Asia/Jakarta`; drives routine cron (defaulted from `region`). |
| plan_id | text FK→Plan | current subscription |
| autonomy_default | Autonomy | workspace default dial (UI `store.ts`) |
| edition | `cloud`\|`self_host` | self_host = single company |
| created_at / updated_at | timestamptz | |

These profile fields are captured in onboarding (`CreateCompanyPage`, `/auth/onboarding/company`)
and are **context, not config** — `industry`, `team_size`, `region`, and `pic_role` are folded
into the company handbook and the Chief's `get_context` (see
[`business/docs-knowledge.md`](../business/docs-knowledge.md)) so Helpers reason about the right
kind of business for the right person. `currency` + `region` + `timezone` form the **locale
triple** used wherever money, dates, or language are rendered.

### `User` (a human login; can belong to many companies)
`id` (`usr_…`), `email` (unique), `name`, `password_hash` (argon2, nullable for SSO),
`avatar_color`, `auth_provider` (`password`|`google`), `created_at`.

### `Member` (User ↔ Company, with role) — tenant table
`id`, **`company_id`**, `user_id` FK, `role` (MemberRole), `channel_scope` (jsonb: all | list
of channel ids), `last_seen_at`, `status` (`active`|`invited`|`suspended`), `invited_by`.
Unique `(company_id, user_id)`. *Mirrors the Control-Panel → Members screen (`PEOPLE`).*

### `Invite` — tenant table
`id`, `company_id`, `email`, `role`, `token_hash`, `expires_at`, `accepted_at`.

---

## 3. Workspace structure

### `Channel` (= Area) — tenant table
A **focused space for one part of the company** — its chats, goals, flows, and docs stay together
(the "Create area" modal).

| col | type | notes |
|---|---|---|
| id | text PK | `chn_…` |
| company_id | text | |
| name | text | "Customer Success", "Marketing" |
| icon | text | icon id (e.g. a lucide key) shown on the area tile |
| color | text | accent from the bounded palette (the color dots) — replaces the old fixed `accent` enum; same finite palette as `HelperCategory` |
| purpose | text null | optional — *"helps Chief focus."* Free text ("Customer onboarding, retention and support"). **Folded into `get_context`** for agents working in this area (see [`04`](04-rag-knowledge-learning.md)). |
| context_scope | ChannelContextScope | **what agents in this area can read.** `isolated` = only this area's chats/goals/docs (recommended default); `isolated_plus_general` = also company-wide basics from the **General** area. Bounds RAG retrieval for jobs scoped to this area. |
| is_default | bool | the **General** area (exactly one per company) |

Denormalized counters refreshed by worker: `agent_count`, `chat_count`, `open_items`.
*Matches `Channel` in `types.ts` and the "Create area" modal.*

**Agent membership** ("Agents in this area"): which Helpers operate here, via `Helper.channel_ids`
(the modal's per-Helper toggles). The **Chief is implicitly in every area** (`is_chief` → always
present, not toggleable). **Visibility** ("Visible to N people"): which human Members see the area,
via `Member.channel_scope` (`all` or a list of channel ids).

### `Helper` (AI agent / staff) — tenant table
| col | type | notes |
|---|---|---|
| id | text PK | `hlp_…` (slug-like, e.g. `hlp_chief`, `hlp_dev`) |
| company_id | text | |
| name | text | "Chief of Staff", "Competitor Analyst", "Collections" |
| area | text (soft category, FK→`HelperCategory`) | visual/organizational bucket → one accent (color+mascot); seeded defaults, **extensible per company**. Not a closed enum. |
| role | text | **free-form** — the variance axis. "Runs the team", "Tracks competitors weekly", "Chases overdue invoices" |
| job_description | text | the standing brief ("what this helper does"), free-form |
| is_chief | bool | exactly one per company; the operator's representative |
| engine | jsonb | `{type, auth, model, tier}` (see [`06`](06-llm-routing-account-pool.md)) |
| autonomy_cap | Autonomy | tightest this helper may act at (layered dial) |
| permissions | jsonb | allowed `ProposalType`s it can self-authorize at its autonomy |
| budget_credits_month | int | monthly credit cap; null = workspace pooled |
| voice | text | tone/style guidance |
| status | `active`\|`paused`\|`resting` | |
| channel_ids | jsonb | channels it serves |
| created_by | `operator`\|`chief` | helpers can be proposed by Chief |
| created_at / updated_at | | |

### `HelperAccess` — tenant table
Grants a Helper access to a folder / connector / skill: `id`, `company_id`, `helper_id`,
`kind` (`connector`|`folder`|`skill`), `ref_id`, `access` (`read`|`write`), `default_on`.

### `HelperCategory` (the extensible "area" set) — tenant table
`id`, `company_id`, `key` (slug, e.g. `marketing`, `collections`), `label`, `accent` (one of the
bounded visual palette: color + mascot id), `seeded` bool. Each company starts with a seed set
(`brand/ops/support/finance/marketing/sales/growth/data/…`) and can **add its own**. `Helper.area`
references `key`. This keeps areas open-ended while the color/mascot **palette stays a finite
design asset** (a new category maps onto an existing accent).

> **Variance model (important):** the number and kind of Helpers a company runs is **unbounded**.
> A Helper's identity is its free-form `role` + `job_description` + `Skill`s + granted connectors
> — *that's* where variance lives, and it's all user-editable at runtime. `area`/`HelperCategory`
> is only a visual/organizational grouping (color, mascot, board bucket), deliberately a **soft,
> extensible** taxonomy rather than a closed enum, so "more variance later" needs no schema change
> — just new `Helper` rows (and optionally new categories). `is_chief` is the only structurally
> special Helper (exactly one per company).

---

## 4. Goals

### `Goal` — tenant table
`id` (`goal_…`), `company_id`, `channel_id` FK, `title`, `target` (text, the "expected end
result"), `due` (date, nullable), `progress` (int 0–100), `status`
(`active`|`done`|`dropped`), `autonomy_override` (Autonomy, nullable — layered dial),
`owner_helper_id` (usually the Chief), `position` (int, manual order), `created_by`,
`created_at`. *Matches `Goal` in `types.ts`; adds target + autonomy override + status.*

### `Kpi` / `KpiValue` — tenant tables
`Kpi`: `name` PK-per-company, `label`, `unit`, `target`, `direction` (`up`|`down`),
`goal_id`. `KpiValue`: `id`, `kpi_name`, `value`, `period`, `source`, `helper_id`, `at`.

---

## 5. Execution: Jobs, Reports, Checkpoints

### `Job` — tenant table (os `Task`)
| col | type | notes |
|---|---|---|
| id | text PK | `job_…` |
| company_id | text | |
| helper_id | text FK | who runs it |
| origin | JobOrigin | chat/goal/routine/flow/delegation/execution/plan |
| parent_job_id | text FK null | for delegated sub-jobs |
| goal_id / routine_id / flow_run_id / session_id | text FK null | source linkage |
| brief | text | what to do |
| operator_note | text | extra instruction from human |
| status | JobStatus | |
| proposal_id | text FK null | set when origin=execution (executing an approved proposal) |
| cost_credits | int | metered (see [`08`](08-billing-ai-credits.md)) |
| tokens_in / tokens_out | int | |
| attempts | int | retries |
| error | text null | |
| result_text | text null | |
| engine_type | EngineType | which engine ran it |
| checkpoint | jsonb | LangGraph durable state (plan, step, done, next) |
| started_at / ended_at | timestamptz | |

### `Report` — tenant table
`id`, `company_id`, `job_id`, `helper_id`, `headline`, `body_md`, `kpis` jsonb, `sources`
jsonb (what it read), `created_at`. *Feeds the Inbox "update" items and analytics outcomes.*

### `RunEvent` — tenant table (live progress; also fanned to SSE/WS)
`id`, `company_id`, `job_id`, `helper_id`, `session_id` null, `kind`
(`status`|`thinking`|`text`|`tool`|`sources`|`usage`|`browser`|`approval`), `data` jsonb,
`at`. High-volume; partitioned by day, retained short. *Powers live job streaming.*

---

## 6. Chat

### `Session` — tenant table (os `Thread`)
`id` (`ses_…`), `company_id`, `scope` (SessionScope), `channel_id` null, `folder_id` null,
`title`, `goal_id` null, `participants` jsonb (`[{helper_id, area}]`), `unread` bool,
`updated_at`. Chief DM = a session with `scope=chief_dm`.
**Composer state** (the chat input controls — see [`02` §4](02-api-contracts.md),
[`06` §7](06-llm-routing-account-pool.md)): `model_override` null (per-session model pick),
`think_level` (ThinkLevel, default `auto`), `context_tokens` int (cached: tokens the next turn
would send — system + memory + history + tools), `context_window` int (active model's limit),
`summary` text null + `summary_upto_message_id` null + `compacted_at` null (compaction state —
earlier turns distilled into `summary`).

### `MessageContext` — embedded on `Message`/`RunEvent` (not a table)
Each turn records `{ model, think_level, tokens_in, tokens_out, context_tokens, context_window }`
so the composer's **usage meter** is exact and auditable, and cost metering (`08`) is per-turn.

### `Folder` — tenant table
`id` (`fld_…`), `company_id`, `channel_id`, `name`, `shared_with` jsonb, `instructions` text,
`files` jsonb. Counter `count` denormalized.

### `Message` — tenant table
`id` (`msg_…`), `company_id`, `session_id` FK, `role` (MessageRole), `author` jsonb
(`{kind, name, role, area}`), `content` text, `blocks` jsonb (typed rich blocks: text,
attachment, chart, diff, doc-link, actions), `system` bool, `created_at`.

---

## 7. Approvals: Inbox & Proposals

### `Proposal` — tenant table
`id` (`prp_…`), `company_id`, `job_id` FK, `helper_id`, `type` (ProposalType), `risk` (Risk),
`title`, `body_md`, `status` (ProposalStatus), `current_revision` int, `decided_by`
(`operator:usr_…`|`chief`), `decision_note`, `decided_at`, `execution_job_id` FK null,
`result` jsonb. *Approving a proposal spawns an `execution` Job that carries it out.*

### `ProposalRevision` — tenant table
`id`, `company_id`, `proposal_id`, `n` int, `body_md`, `author` (`agent`|`operator`),
`summary`, `at`. Full history for "Review" in the Inbox.

### `InboxItem` — tenant table
`id`, `company_id`, `kind` (InboxKind), `ref_id` (proposal/job/question id), `helper_id`,
`channel_id`, `job_id` null, `title`, `summary`, `status` (InboxStatus), `needs_you` bool,
`blocking` bool, `snooze_until` null, `proposals` jsonb (inline mini-proposals for decisions),
`actions` jsonb (`[{label, primary, icon}]`), `progress` jsonb null, `meta` text,
`created_at`. *Matches `InboxItem` in `types.ts` exactly, plus server fields.*

---

## 8. Routines (cron)

### `Routine` — tenant table (os `Shift`)
`id` (`rtn_…`), `company_id`, `helper_id`, `name`, `subtitle`, `instructions`, `freq`
(RoutineFreq), `at` (text "07:30"), `days` jsonb (weekly), `monthly` (`date`|`last_working_day`),
`timezone`, `cron` (derived), `sends_to` jsonb (`[{channel: whatsapp|slack|email|chat, label}]`),
`enabled` bool, `paused` bool, `managed_by_chief` bool, `next_at`, `last_at`, `goal_ids` jsonb,
`created_by`. Each firing creates a `Job` (origin=routine). *Matches `RoutineDetail`.*

### `RoutineRun` — tenant table
Thin link for history rows: `id`, `company_id`, `routine_id`, `job_id`, `when`, `outcome`,
`duration`, `skipped` bool, `cost_credits`. *Powers the 8-run history sparkline + detail list.*

---

## 9. Flows (visual automations)

### `Flow` — tenant table (os `Workflow`)
`id` (`flw_…`), `company_id`, `title`, `enabled` bool, `channel_ids` jsonb, `areas` jsonb,
`trigger` jsonb (`{kind, spec}` — `kind ∈ schedule | manual | internal_event | connector_poll`;
**no inbound-webhook triggers** — external changes are picked up by scheduled polling, see
[`business/flows.md`](../business/flows.md) §trigger),
`poll_cursor` jsonb null (watermark for `connector_poll` flows — "last seen" marker so a poll
only acts on what's new),
`nodes` jsonb (`CanvasNode[]`: `{id,kind:FlowNodeKind,label,sublabel,x,y,w,h,config}`),
`edges` jsonb (`CanvasEdge[]`: `{id,from,to,label}`), `version` int, `status`
(`draft`|`published`), `created_by` (`operator`|`chief`), `proposed_from_pattern` bool.
*Matches the canvas `CANVAS_NODES`/`CANVAS_EDGES` + `OFFICE_FLOWS`.*

### `FlowRun` — tenant table
`id` (`frn_…`), `company_id`, `flow_id`, `status` (FlowRunStatus), `trigger_summary`,
`started_by` (connector name | `schedule` | `operator`), `cost_credits`, `duration`,
`waiting_for` null, `job_ids` jsonb (ai_step nodes spawn Jobs), `started_at`, `ended_at`.
*Matches `FlowRunRow`.*

---

## 10. Knowledge, Memory, Skills, Docs

### `KbSource` / `KbChunk` — tenant tables (pgvector RAG)
`KbSource`: `id`, `company_id`, `kind` (KbKind), `ref` (origin id/url), `title`,
`content_hash`, `helper_id` null, `meta` jsonb, `created_at`.
`KbChunk`: `id`, `company_id`, `source_id`, `heading`, `text`, `dim` int, `embedding`
`vector(dim)`, `embedding_model`, `embedded_at`, `indexed_at`, `tsv` tsvector (FTS).
Indexes: HNSW on `embedding`, GIN on `tsv`, btree `(company_id, kind)`. See [`04`](04-rag-knowledge-learning.md).

### `MemoryDoc` — tenant table (editable markdown)
`id`, `company_id`, `helper_id` null, `path` (e.g. `Memory/hlp_dev/Lessons.md`), `content`,
`updated_by`, `updated_at`. Lessons/notes/loop-logs/retros live here and are also KB-indexed.

### `Skill` — tenant table
`id` (`skl_…`), `company_id`, `helper_id`, `name`, `body_md` (steps/checklist/rules/examples),
`status` (`draft`|`published`), `version` int, `usage_count`, `created_by` (`agent`|`operator`),
`created_at`. Publishing a skill is a `skill_publish` Proposal.

### `Doc` / `DocVersion` — tenant tables (wiki vault, d3-force graph)
`Doc`: `id` (`doc_…`), `company_id`, `path`, `title`, `current_version`, `links` jsonb
(`[[wikilinks]]` for the graph). `DocVersion`: `id`, `company_id`, `doc_id`, `version`
(0 = suggestion), `content`, `author`, `author_kind` (`operator`|`agent`|`outside`),
`summary`, `status` (`saved`|`suggested`|`rejected`|`deleted`), `proposal_id` null, `at`.

---

## 11. AI accounts & providers

### `HarnessAccount` (subscription pool) — tenant table
`id` (`acc_…`), `company_id`, `harness` (`claude-code`|`codex`|`copilot`|`gemini`|`cursor`),
`label` (`cloud`,`data`,`main`,`work`), `token_enc` (encrypted), `token_hint` (`…pwAA`),
`enabled` bool, `status` (AccountStatus), `cooldown_until` null, `pct_window` int (rate-limit
window used 0–100), `tokens` text, `last_used_at`, `runs`, `cost_credits`, `last_error`.
*Matches `POOL_ACCOUNTS` on the AI-accounts screen — the pool is cross-harness & shared.*

### `HarnessQuota` / `HarnessUsage` — tenant tables
Quota window state (`five_hour`|`seven_day`, utilization, resets_at) and per-account spend
rows, as in omilo-os.

### `ProviderKey` (direct BYO keys) — tenant table
`id`, `company_id`, `provider` (`anthropic`|`openai`|`local`), `key_enc`, `key_hint`,
`connected` bool, `label`, `used_by` jsonb (helper ids). *Matches `DIRECT_PROVIDERS`.*

---

## 12. Connectors

### `Piece` — global catalog row (not tenant-scoped; from the `omilo-pieces` marketplace)
`id` (slug), `label`, `category`, `description`, `type` (`piece`|`mcp`), `runtime`
(`http`|`engine`), `auth_descriptor` jsonb (oauth2 provider+scopes, or mcp/apikey field spec),
`actions` jsonb (compiled tool specs), `mcp` jsonb (remote server url+auth, `type:mcp`),
`triggers` jsonb (consumed as polls/internal events — never webhooks), `logo`, `catalog_commit`
(git sha), `status` (`ok`|`invalid`), `errors` jsonb. Populated by the indexer from the MIT
`omilo-pieces` repo. See [`11-marketplace-connectors-mcp.md`](11-marketplace-connectors-mcp.md).

### `Connector` — tenant table (an installed connector instance)
`id` (`con_…`), `company_id`, `source` (`marketplace`|`custom`|`builtin`), `piece_id` null
(FK→`Piece` when `source=marketplace`), `slug` (`gmail`,`gcal`,`gdrive`,`slack`,`whatsapp`,
`notion`,`crm`,`ads`,`db`,…), `label`, `kind` (`http`|`stdio`|`oauth`|`builtin`|`browser`|`mcp`),
`url` null, `command` null, `args` jsonb, `secrets_enc` jsonb (omilo-held OAuth tokens / API-key
fields — never shown to agents), `scopes` jsonb, `approval` (`auto`|`ask`), `default_on` bool,
`enabled` bool, `status` (`ok`|`warn`|`disconnected`|`needs_auth`), `poll_spec` jsonb null
(for connectors a flow polls on a schedule — endpoint + cursor field), `health_at`.
**No inbound-webhook field** — omilo does not expose a public ingress; external changes are read
via scheduled polling. See [`integrations/README.md`](../integrations/README.md) and
[`11-marketplace-connectors-mcp.md`](11-marketplace-connectors-mcp.md).

### `McpAccessToken` — tenant table (Role 3: external MCP exposure, later phase)
`id`, `company_id`, `label`, `token_hash`, `helper_id` (acts *as* this Helper → inherits its
`autonomy_cap`/permissions), `scopes` jsonb (which surfaces/areas an external client may reach),
`expires_at` null, `last_used_at`, `revoked_at` null. Lets an outside MCP client (Claude Desktop,
Cursor, …) drive this workspace, under the same gate + audit — see
[`11-marketplace-connectors-mcp.md` §6](11-marketplace-connectors-mcp.md).

---

## 13. Billing & credits

### `Plan` — global table (not tenant-scoped)
`id`, `tier` (PlanTier), `name`, `monthly_price_usd`, `included_credits`, `credit_overage_usd`
(price per credit over included), `seats`, `features` jsonb.

### `CreditLedger` — tenant table (append-only)
`id`, `company_id`, `delta` int (+grant / −spend), `balance_after` int, `reason`
(LedgerReason), `job_id` null, `helper_id` null, `provider_cost_usd` numeric (true cost for
margin tracking), `credits_charged` int, `meta` jsonb, `at`. See [`08`](08-billing-ai-credits.md).

### `Subscription` / `Invoice` — tenant tables (provider-agnostic)
`Subscription` is omilo's **own** record, not a vendor mirror: `id`, `company_id`, `plan_id`,
`status` (`active`|`trialing`|`past_due`|`canceled`), `current_period_end`, `seats`, `provider`
(`manual`|`stripe`|`xendit`|`midtrans`|`paddle`), `external_ref` (nullable processor id).
`Invoice`: `id`, `company_id`, `amount` + `currency`, `status` (`paid`|`open`|`offline`|`void`),
`period`, `provider`, `external_ref` (nullable), `pdf_url` (nullable). With no payment provider
wired, `provider="manual"` and invoices are `offline` (collected out-of-band). The payment
processor is a **pluggable `PaymentProvider`**, chosen later — see
[`08-billing-ai-credits.md` §6](08-billing-ai-credits.md).

---

## 14. Platform / ops

- `AuditEvent` (append-only): `id`, `company_id`, `at`, `actor` (`user:…`|`helper:…`|`system`),
  `action`, `ref`, `detail` jsonb. Powers Control-Panel → Activity.
- `ToolCall`: `id`, `company_id`, `helper_id`, `job_id`, `tool`, `decision`
  (`allowed`|`proposal`|`refused`|`error`), `detail`, `duration_ms`, `at`. Every MCP call.
- `Notice` + `Notification` + `PushSub`: notification ladder & Web Push (os pattern) — see
  [`09`](09-realtime.md).
- `SafetyLimit` — tenant table: hard caps the operator sets (Control-Panel → Safety & limits):
  `kind` (`spend_day`|`spend_month`|`messages_day`|`external_write`|`deploy`), `value`,
  `scope` (`workspace`|`channel`|`helper`), `block_or_warn`. Enforced by the gate regardless
  of autonomy.

---

## 15. Entity relationship summary

```
Company 1─* Member *─1 User
Company 1─* Channel 1─* Goal 1─* KpiValue
Company 1─* Helper   (exactly one is_chief)
Helper  1─* Routine 1─* RoutineRun ─1 Job
Helper  1─* Job 1─1 Report ; Job 1─* RunEvent ; Job *─1 Goal
Helper  1─* Proposal 1─* ProposalRevision ; Proposal 1─1 InboxItem
Flow    1─* FlowRun 1─* Job
Session 1─* Message ; Session *─1 Channel/Folder/Goal
Company 1─* KbSource 1─* KbChunk ; Company 1─* MemoryDoc/Skill/Doc
Company 1─* HarnessAccount/ProviderKey/Connector
Company 1─* CreditLedger ; Company 1─1 Subscription ─* Invoice
```

Every arrow above lives inside one `company_id`. **No entity ever references another
company's rows.** RLS makes that a database guarantee, not a convention.
