# Integrations — Connectors, the Outside World, and How Agents DO Things

> Track: **integrations**. This is where omilo stops being a chat box and starts being an
> operations platform. Agents reach the outside world **only** through **Connectors** exposed
> as [MCP tools](../technical/05-mcp-surfaces.md), and they **propose** consequential actions
> rather than performing them — the gateway gate decides based on **effective autonomy × risk**
> (see [`business/autonomy.md`](../business/autonomy.md)). Marketing, lead triage, reporting,
> disbursements: all of it flows through this layer. Open-source under **ELv2**, shipped as a
> cloud SaaS and a self-host edition — the split is config + packaging, not a fork.

This doc spans both concerns on purpose: connectors are a technical substrate (OAuth, secrets,
MCP) **and** a business surface (what agents can actually do for the operator, and what they're
trusted to do unsupervised).

**One load-bearing rule up front: agents reach external systems _outbound only_.** They **call**
a system (read or write) and they **poll** it on a schedule to notice what's new. There is **no
public webhook ingress** — nothing outside can push an event into omilo. Flows and routines react
to the outside world by *polling* against a stored watermark, not by receiving pushes. (The only
inbound hooks anywhere in the product are optional payment-**provider** callbacks in billing, out
of scope for this doc.) This keeps the operational surface tiny: no public endpoints to secure,
no signatures to verify, no third-party webhook plumbing to babysit.

---

## 1. The connector model

A **`Connector`** ([`01` §12](../technical/01-data-model.md)) is a per-company row that teaches
the platform how to talk to one external system. The operator connects it once in
**Control-Panel → Connectors**; from then on, every enabled connector is compiled into a set of
**MCP tools** that granted Helpers can call during a Job.

### Kinds (`Connector.kind`)

| kind | What it is | Transport | Examples |
|---|---|---|---|
| `builtin` | First-party connector maintained in-repo; curated tools, known risk tags | in-process | `web` (fetch/search) |
| `oauth` | Builtin tool surface, but credentials obtained via a 3-legged **OAuth** flow | in-process + stored token | Gmail, Google Calendar/Drive/Sheets, Slack, Notion, HubSpot |
| `http` | A remote **MCP server over Streamable HTTP** (paste a URL) | JSON-RPC 2.0 / HTTP | your own system via an MCP endpoint, WhatsApp, a payments connector |
| `stdio` | An MCP server shipped as a **package/command**, spawned sandboxed in the worker | JSON-RPC over stdio | `npx -y some-mcp-server`, a Docker image |
| `browser` | A headless **Chromium under Playwright**, one profile per agent | in-process driver | "go read the competitor's pricing page" |

A connector carries: `slug`, `label`, `url`/`command`/`args` (for http/stdio), `secrets_enc`
(encrypted, never shown), `scopes` (what the grant actually permits), `approval` (`auto`|`ask`),
`default_on` (whether new Helpers get it without an explicit grant), `enabled`, `status`
(`ok`|`warn`|`disconnected`), `poll_spec` (for connectors a flow polls on a schedule — the
endpoint + which field is the cursor), and `health_at`. **There is no `webhook_url` field** — a
connector is something agents *call out to* and *poll*, never something that pushes events in.

### Polled, not pushed

Because there is no inbound ingress, "noticing new things in an outside system" is done by
**scheduled polling**. A connector's `poll_spec` declares *what to read* and *which field marks
position*; the flow that polls it keeps a **watermark/cursor** (`Flow.poll_cursor`, [`01`
§9](../technical/01-data-model.md)) of the last thing it saw. Each poll reads only what's newer
than the cursor, acts on it, and advances the cursor so nothing is handled twice. This gives
event-like reactivity ("when a lead arrives, qualify it") with a plain cron mental model and zero
public surface — see [§5](#5-feeding-flows-and-jobs) and
[`business/flows.md` §trigger](../business/flows.md).

### Read-only-first, then write

Every connector exposes **read tools** and **write tools** as distinct MCP tools:

- **Read tools** (`search_threads`, `list_leads`, `read_calendar`, `query` on a reporting DB…)
  carry no side effects. They may be `approval=auto`: the agent calls them directly and the
  gateway executes + logs, no human in the loop.
- **Write tools** (`send_email`, `create_lead`, `send_message`, `create_payout`…) are
  side-effecting. They default to `approval=ask`, which routes the call through the gate as an
  **`external_write` Proposal** (or `spend` for money-moving actions). The agent never
  "just writes."

The discipline: **a connector is useful read-only on day one, and earns write trust over time.**
A freshly connected CRM lets agents triage and qualify leads immediately; sending outreach stays
`ask` until the operator flips it (or raises the Helper's autonomy).

### `approval`: `auto` vs `ask`

`Connector.approval` is the **default** policy for that connector's write tools:

- `auto` — writes are attempted directly; the gate still consults `effective_autonomy × risk`
  and `SafetyLimit`s, but the connector itself isn't adding friction.
- `ask` — every write becomes a Proposal in the Inbox, regardless of autonomy (short of `yolo`
  with an explicit permission). This is the safe default for anything money-, customer-, or
  production-facing.

This is a **connector-level backstop layered under** the per-Helper autonomy dial. Even a `yolo`
Helper hitting an `ask` connector produces a Proposal unless it holds the matching `permission`
(`external_write`, `spend`) — see [autonomy policy](../business/autonomy.md).

### `default_on`

`default_on=true` connectors (typically `web`, maybe a read-only reporting DB) are granted to new
Helpers automatically via an implicit `HelperAccess`. Everything else is **opt-in per Helper** —
least privilege by default (§4).

### Where connectors come from (marketplace vs custom)

Most connectors are **installed from omilo's first-party marketplace**, `omilo-pieces` — a
catalog of declarative `piece.yaml` manifests ("a piece is data, not code"), indexed from a
separate **MIT** repo so the community can add connectors without an omilo release. A piece is
either `type:piece` (OAuth + HTTP actions omilo runs and compiles into MCP tools) or `type:mcp`
(a **remote MCP server** omilo mounts, e.g. Repliz). The rest are **custom** (your own MCP URL /
OpenAPI) or **builtin** (`web`, browser). This is also where the **three MCP roles** are spelled
out — omilo as MCP *client* to connectors, MCP *server* to its own agents, and (later) MCP
*server* to outside clients. Full mechanics, schema, install/connect flows, Role 3, and UI
sketches: **[`../technical/11-marketplace-connectors-mcp.md`](../technical/11-marketplace-connectors-mcp.md)**.

---

## 2. Planned connector catalog

These are **business tools** — the systems an operator actually runs their company on. "Risk" is
the **worst-case** risk of the connector's write tools; reads are `low` unless noted. Reads are
served by direct calls and by scheduled **polling** (the "read messages / read leads" entries are
all polled, never webhook-driven).

| Connector | kind | Read tools (what agents learn) | Write tools (what agents DO) | Typical risk | Default |
|---|---|---|---|---|---|
| **Gmail** | oauth | search threads, read messages (scheduled poll for new mail), read drafts | **draft** (low), send email, label, trash | low→**high** (send is high) | `ask`, send always `ask` |
| **Google Calendar** | oauth | list/search events, read availability | create/update/delete event, respond to invite | **medium** | `ask` |
| **Google Drive / Sheets** | oauth | search files, read file content, read sheet ranges, metadata | create/copy file, update content, write rows | **medium** (data egress + mutation) | `ask` |
| **Slack** | oauth | read channel history, search messages (scheduled poll for new messages) | post message, DM, set status, pin | **medium** (external comms) | `ask` |
| **WhatsApp** | http | read messages (scheduled poll) | send template/message to a customer | **high** (direct customer contact) | `ask` |
| **Notion** | oauth | search pages, read databases/blocks | create/update pages, write DB rows | **medium** | `ask` |
| **CRM (e.g. HubSpot)** | oauth | list/search contacts, deals, pipeline; poll for **new leads** | create/update contact, log activity, move deal stage, tag | **medium** (customer data) | `ask` |
| **Ads / Analytics (Meta/Google Ads, GA)** | oauth / http | read campaigns, spend, conversions, traffic, audience reports | pause/adjust campaign, change budget/bid | **high** (ad spend movement) | `ask`, `spend` typed |
| **Payments / banking (Stripe, Xendit, Midtrans)** | oauth / http | list charges, balance, payouts, customers | create charge/refund, **disbursements/payouts** | **high** (money movement) | `ask`, `spend` typed |
| **Your database (read-only)** | http / stdio | `query` (SELECT-only on a replica) for reporting | — (read-only by construction) | low (reads only; PII-scoped) | `auto` reads |
| **Browser** | browser | navigate, read DOM, screenshot (competitor pages, dashboards without an API) | fill forms, click (gated) | **medium**→high (acts as a logged-in user) | `ask` for interactions |
| **Web** | builtin | fetch URL, search | — | low | `auto`, `default_on` |
| **Your own system (OpenAPI / any MCP server)** | http / stdio | whatever your **OpenAPI/MCP** server exposes | whatever it exposes | **you decide** (declare risk tags) | `ask` until trusted |

Notes:
- **Your database (read-only)** is the recommended way to give agents data access for reporting
  and portfolio/competitor analysis without ever touching production write paths — point it at a
  replica, grant SELECT-only, and the connector surfaces only a `query` read tool.
- **Disbursements** (a core omilo use case) ride on the payments/banking connector as
  `spend`-typed writes: always a Proposal with the amount, recipient, and reason, gated hard by
  the `spend_day`/`spend_month` `SafetyLimit`s (§7). Note that a payments connector like **Stripe
  here is a connector the agents use for the operator's _own_ business** (collect, refund,
  disburse) — distinct from omilo's own billing, which is out of scope for this doc.
- **"Your own system via OpenAPI / any MCP server"** is the escape hatch that makes omilo fit
  *any* operator: wrap an internal API as an MCP server (or point at one that already speaks
  OpenAPI→MCP) and it appears alongside first-party connectors with the same gating.

---

## 3. Connecting a connector: OAuth, encryption, revocation

### OAuth flow (Control-Panel → Connectors)

```
operator clicks "Connect Slack"
  → POST /v1/connectors/{id}/oauth/start        → { authorize_url, state }
  → open authorize_url in the SYSTEM browser     (web: new tab; desktop: OS default browser)
  → user approves scopes at the provider
  → provider redirects to the callback:
        cloud    → https://app.omilo.…/oauth/callback?code=…&state=…
        desktop  → omilo://oauth/callback?code=…&state=…      (deep link back into the app)
  → backend exchanges code→tokens, stamps company_id from the signed `state`
  → tokens encrypted and stored in Connector.secrets_enc; status → ok
```

Design points:
- **System browser, not an embedded webview.** Providers increasingly block embedded webviews,
  and the system browser carries the user's real SSO session. On desktop the loop closes via the
  **`omilo://` deep link** (same mechanism as approve-from-notification) — see
  [`10` §3 & §4](../technical/10-tauri-desktop.md).
- **`state` is a signed, short-lived token** that carries `company_id` + connector id so the
  callback can't be cross-tenant-confused.
- Non-OAuth connectors (http/stdio/API-key) use the same screen with a secrets form instead of a
  redirect; secrets land in `secrets_enc` the same way.

Note what this flow is **not**: there is no step that registers a webhook or exposes a callback
*back* to the connected system. The only inbound redirect is the OAuth `code` exchange above; the
provider never gets a URL to push ongoing events to. Everything after connection is omilo calling
*out*.

### Credential encryption at rest

- `secrets_enc` is encrypted with Fernet/AES-GCM under a KMS-managed key (`OMILO_SECRET_KEY`;
  cloud uses a real KMS). Only a `*_hint` (e.g. `…pwAA`) is ever returned to clients. See
  [`07` §5](../technical/07-multitenancy-auth.md).
- **Secrets are never shown to agents and never logged.** The gateway injects them only at
  execution time, server-side, inside the connector tool call. An agent calling `send_email`
  passes a subject and body; it never sees the OAuth token. (MCP isolation, [`05` §4](../technical/05-mcp-surfaces.md).)
- Every secret read/rotate is audited (`AuditEvent`).

### Revocable

Disabling or deleting a `Connector` (`PATCH`/`DELETE /v1/connectors/{id}`) immediately: revokes
the provider token where supported, sets `enabled=false`/`status=disconnected`, drops the tools
from every Helper's MCP surface on the next turn, and cascades to the `HelperAccess` grants that
referenced it. Health checks (`health_at`) flip a connector to `warn`/`disconnected` when the
token expires, surfacing an Inbox `alert` to reconnect.

---

## 4. Per-Helper access grants (`HelperAccess`)

A connector existing in the workspace does **not** mean every agent can use it. Access is a
separate, least-privilege grant:

**`HelperAccess`** ([`01` §3](../technical/01-data-model.md)) = `{ helper_id, kind:
connector|folder|skill, ref_id, access: read|write, default_on }`.

- A Helper's MCP token resolves to exactly the connectors it's been granted — it sees no others
  ([`05` §4](../technical/05-mcp-surfaces.md)). The Growth helper may hold the CRM (read) + Gmail
  (write); the Finance helper may hold the payments connector (read) + the read-only reporting
  DB, and nothing else.
- `access=read` surfaces only the connector's read tools even if write tools exist. `access=write`
  additionally surfaces writes — still gated by `approval` + autonomy, so "write grant" means
  "*may propose* writes," not "may write unsupervised."
- `default_on` grants (web, perhaps a read-only reporting DB) are attached to new Helpers
  automatically.

### `request_access` flow

Agents can't grant themselves access. When a Helper needs a connector it lacks, it calls the
`request_access` MCP tool ([`05` §2](../technical/05-mcp-surfaces.md)), which files a
**`connector_access` Proposal** into the Inbox:

```
helper: request_access({ kind:"connector", ref:"payments", access:"read", reason:"month-end payout report" })
  → Proposal(type=connector_access) + InboxItem(kind=decision)
  → operator approves  → a HelperAccess row is created; the connector's tools appear next turn
  → operator rejects   → agent is told, proceeds without it
```

This keeps privilege expansion visible and auditable, and lets the Chief assemble a working team
("Finance needs the payments connector; grant?") without the operator pre-wiring everything.

---

## 5. Feeding Flows and Jobs

Connectors show up in two execution surfaces.

### Flows — connectors as triggers and steps

A **`Flow`** ([`01` §9](../technical/01-data-model.md)) has a `trigger` (`{kind, spec}`) and
typed nodes (`FlowNodeKind = trigger|ai_step|connector|approval|condition`). A connector
participates two ways:

- **As a trigger (`connector_poll`).** A flow reacts to external changes by **polling on a
  schedule**, never by receiving a push. `trigger.kind = "connector_poll"` runs the flow on a
  cron, reads the connector (new mail, new CRM leads, overdue invoices), and compares against the
  stored watermark (`Flow.poll_cursor`). If nothing is newer than the cursor, the run ends
  immediately and cheaply (no `ai_step`, no credits). If there's new work, the `FlowRun` proceeds
  (`started_by =` the polled connector slug) and the cursor advances. The **other** trigger kinds
  are `schedule` (plain cron), `manual` (operator clicks Run, or an agent calls `flows_run`), and
  `internal_event` (another flow/goal/routine finishing — chaining). **There is no
  `connector_webhook` kind and no `webhook_url`** — omilo runs no public ingress.
- **As a step.** A `connector` node calls a connector read/write tool; an `ai_step` node spawns a
  Job whose agent does the reasoning; an `approval` node is an explicit human gate. Writes inside
  a flow obey the **same** propose-don't-act rule — the flow doesn't bypass the gate.

The trade-off of poll-over-push is **latency** (reactivity is bounded by one poll interval, e.g.
up to 15 min) in exchange for **far less operational surface**: no public endpoint, no signature
verification, no webhook retries/replays to reason about. For business work ("triage a new lead,"
"nudge an overdue invoice") a 15-minute poll is indistinguishable from real-time, and the
operational simplicity is worth it.

See [`business/flows.md`](../business/flows.md) and [`02` §8](../technical/02-api-contracts.md).

### Jobs — connectors as tool calls

Outside flows, any Job (from chat, a goal, a routine, a delegation) reaches connectors through
MCP tool calls during its turn. The worker drives the engine; tool calls hit the per-Helper MCP
endpoint; the gate decides allowed/proposal/refused; results stream as `RunEvent`s. This is how a
chat request ("summarize this week's support tickets") turns into real reads and, if it needs to
act, real Proposals.

### The browser connector

The `browser` kind is special: it's how agents handle systems with **no API** — competitor
pricing pages, a vendor dashboard, a form that must be filled.

- **Chromium headless via Playwright**, under omilo's control, **one isolated profile per
  agent** ([`05` §4](../technical/05-mcp-surfaces.md)) — no shared cookies, no cross-agent
  session bleed.
- **Reads** (navigate, extract, screenshot) can be `auto`. **Interactions** (click, type, submit)
  are gated — the browser is effectively acting as a logged-in user, so form submits are
  `external_write` Proposals.
- **Screenshots stream into the Job thread** as `RunEvent(kind=browser)`, so the operator watches
  what the agent is looking at — the competitor page, the dashboard, the half-filled form.

---

## 6. Third-party & custom MCP servers

The platform is open by design: an operator can connect **any MCP server**, not just the curated
catalog.

- **Paste a URL** → an `http` connector (remote MCP over Streamable HTTP).
- **Paste a package/command** → a `stdio` connector; the server is spawned **sandboxed in the
  worker container** with egress controls ([`05` §5](../technical/05-mcp-surfaces.md)).
- **OpenAPI → MCP.** An internal REST API can be wrapped (generated MCP server from an OpenAPI
  spec) and connected as http/stdio. This is the "your own system" row in the catalog.

Trust rules for third-party servers:
- Their tools appear **alongside native tools** in the Helper's surface, tagged with the
  connector slug so provenance is clear.
- They are **always `ask`** (every write → Proposal) **until the operator explicitly trusts** the
  connector by flipping `approval=auto`. A pasted server never gets silent write access.
- Risk tags default to `high` for undeclared write tools; the operator can refine per tool.
- Sandboxing + egress controls mean a hostile MCP server can't exfiltrate other connectors'
  secrets (it never sees them — the gateway injects, [§3](#3-connecting-a-connector-oauth-encryption-revocation)) or reach arbitrary hosts.

---

## 7. Safety: every external write is gated

Connectors are the sharpest edge in the product, so safety is layered, not single-point.

1. **Propose, don't act** ([`05` §3](../technical/05-mcp-surfaces.md)). An agent cannot perform a
   consequential action by calling a tool. It calls `request_action`; the gate returns
   `allowed` (one-time execution token), `needs_owner` (Proposal + InboxItem, the agent's turn
   ends), or `refused` (hard limit). External writes are `external_write` / `spend` Proposals.
2. **Effective autonomy × risk.** The gate's decision is the Helper's effective autonomy
   (workspace default → helper cap → goal override) crossed with the action's risk and the
   connector's `approval`. Higher autonomy auto-approves *more* categories; it never bypasses a
   hard limit. Policy table in [`business/autonomy.md`](../business/autonomy.md).
3. **`SafetyLimit` backstop** ([`01` §14](../technical/01-data-model.md)). Operator-set hard caps
   — `external_write` (count/day), `spend_day`, `spend_month`, `messages_day` — are
   enforced by the gate **regardless of autonomy**, scoped to workspace/channel/helper, set to
   block or warn. A `yolo` Finance helper still cannot push a payout past the daily spend cap.
4. **Audit of every tool call.** Every MCP call writes a `ToolCall` row (`decision ∈
   allowed|proposal|refused|error`, duration) and consequential actions write `AuditEvent`s.
   Control-Panel → Activity shows the full external-action trail; analytics are computed from it,
   not estimated ([`02` §13](../technical/02-api-contracts.md)).

The net effect: you can dial a Helper to `yolo` for speed and still sleep, because the connector
layer makes money-movement and customer-contact **structurally** require either sufficient
standing trust *or* a human tap.

---

## 8. Cloud vs self-host editions

The ELv2 edition split is **config + packaging, not a fork** — the same binary runs both; a
`COMPANY_EDITION` env toggles behavior ([`07` §6](../technical/07-multitenancy-auth.md)).

| Concern | Cloud SaaS | Self-host |
|---|---|---|
| Tenancy | many companies, RLS-isolated | one company (RLS on, trivially satisfied) |
| Secret key | real KMS | `OMILO_SECRET_KEY` the operator controls |
| Connector catalog | same builtin + oauth + http/stdio + browser | **same**, plus the local-MCP bridge |
| OAuth callbacks | hosted `https://app.omilo.…/oauth/callback` | operator-hosted callback or the desktop `omilo://` deep link |
| Billing / credits | metered; payment via optional `PaymentProvider` (undecided; else offline) | no-op (license / out-of-band) |

**What self-host adds: the desktop local-MCP bridge.** On the Tauri desktop app a Tauri-hosted
**local MCP server** can expose the user's *own machine* — granted local folders and a
locally-installed model — to their agents, authenticated from the OS keychain, no cloud round
trip ([`10` §5](../technical/10-tauri-desktop.md)). For privacy-sensitive operators this means an
agent can read a local data folder or run against a local model as just another connector, with
the same `HelperAccess` grants and gating. It's the only local-execution surface; everything
else (scheduler, DB, agent runtime) stays server-side.

No connector code branches on edition. A connector connected in self-host behaves identically to
cloud; only *which* connectors are reachable (local bridge) and *where OAuth redirects land*
differ.

---

## 9. Worked example: "New lead triage"

This is the business flow from [`business/flows.md` §7](../business/flows.md): the **Growth**
helper polls the CRM for new leads, qualifies them, and — with your OK — sends a personalized
first reply. It exercises the `connector_poll` trigger and shows propose-don't-act end to end.
**Note the trigger: there is no webhook.** The flow reacts to new leads by *polling* on a
schedule and comparing against `Flow.poll_cursor`.

### Setup (once)

1. Operator connects the **CRM** (e.g. HubSpot, `oauth`): approves read + contact scopes in the
   system browser; token encrypted to `secrets_enc`. Its `poll_spec` declares *read new
   contacts/leads, cursor = created timestamp*. `approval=ask` on writes, reads `auto`. **No
   webhook is registered** — the flow will poll this connector.
2. Operator connects **Gmail / WhatsApp** (`oauth`/`http`) for the outbound reply; `approval=ask`.
3. Operator grants the **Growth** helper `HelperAccess`: CRM `read` (to poll + qualify) + email/
   WhatsApp `write` (to be *allowed to propose* the outreach). No CRM write grant yet — triage
   only reads.

### The flow

```
trigger: connector_poll  —  CRM, every 15 min
   │   reads leads newer than Flow.poll_cursor; nothing new → run ends free
   ▼
FlowRun created (started_by="CRM poll", trigger_summary="CRM poll · 1 new lead")
   │   poll_cursor advances so this lead is never picked up twice
   ▼
ai_step → Job(helper=hlp_growth, origin=flow)   "Qualify the lead"
   • reads the submission + CRM history            → connector read tool list_lead  (auto)
   • returns { fit_score, segment, summary }
   ▼
condition: fit score high?
   ├─ No  → connector: tag "nurture later" in CRM + add to weekly digest → run ends (no Inbox noise)
   └─ Yes ▼
approval: "You approve the outreach"  (Inbox, wait up to 2h)
   • run → needs_you, parks; Job checkpointed (LangGraph interrupt), burning nothing
   ▼
operator opens the Inbox: Growth's recommendation + draft angle
   • Approve ▼
ai_step  "Draft the reply"  → execution Job writes the personalized message
   ▼
connector "Send the outreach" → wants to send email/WhatsApp to the lead →
     request_action({ type:"external_write", risk:"medium",
                      payload:{ connector:"gmail", tool:"send_email",
                                to:"<lead>", subject:"…", body:"<draft>" } })
   ▼
gateway gate: effective_autonomy(hlp_growth) × risk(medium) × Gmail.approval(ask)
   • this is the SECOND gate verdict — on the outbound message itself.
     Under the operator's approval above, the send resolves to allowed:
     gateway injects the Gmail token, calls send_email, logs ToolCall(allowed) + AuditEvent
   • the reply lands with the lead; FlowRun → done (duration + cost recorded)
```

Everything before the approval is **read-only thinking** (poll + qualify); the only side effect
(the sent message) happens *after* a human says go — the same `gate`-before-`execute` discipline
every agent action follows. The **condition** keeps low-fit leads out of your Inbox entirely, and
the **approval** stops an outbound customer message until you approve.

### What changes as trust grows (yolo)

- Raise Growth's autonomy (or grant it the `external_write` permission for Gmail/WhatsApp), and
  the same `medium`-risk send becomes **auto-approved** — the gate returns `allowed` directly, the
  Chief "approves on the operator's behalf," and an `update` Inbox item records it after the fact.
  The flow is unchanged; only the gate's verdict changes. At full `yolo` the whole triage runs
  poll → qualify → draft → send with no human tap.
- A `messages_day` or `external_write` `SafetyLimit` still caps it: past the cap, even an
  auto-approved send is refused and surfaces an `alert`. Trust is a dial; the limit is a wall.
- The trigger never changes with trust: it stays a **scheduled poll** against `poll_cursor`. More
  autonomy removes *approval taps*, not the *polling model* — there is still no webhook.

This is the whole thesis of the integrations layer in one flow: **polling a connector let the
platform notice a real lead, and the gate made the outbound reply safe to delegate** — all with
zero public ingress.

---

## Cross-references

- [`technical/05-mcp-surfaces.md`](../technical/05-mcp-surfaces.md) — connector tools tier,
  propose-don't-act, credential isolation, browser connector, third-party MCP servers.
- [`technical/01-data-model.md`](../technical/01-data-model.md) — `Connector` (`poll_spec`, no
  `webhook_url`), `HelperAccess`, `Proposal`, `Flow` (`poll_cursor`), `SafetyLimit`, `ToolCall`.
- [`technical/02-api-contracts.md`](../technical/02-api-contracts.md) — §11 connector endpoints,
  §8 flows, §6 approvals.
- [`technical/07-multitenancy-auth.md`](../technical/07-multitenancy-auth.md) — secrets
  encryption, self-host edition (§5–6).
- [`technical/10-tauri-desktop.md`](../technical/10-tauri-desktop.md) — `omilo://` deep-link
  OAuth, local-MCP bridge.
- [`business/autonomy.md`](../business/autonomy.md) — the autonomy × risk policy the gate applies.
- [`business/flows.md`](../business/flows.md) — flow triggers (schedule/manual/internal/poll),
  the "New lead triage" worked example, approval nodes, publishing.
</content>
</invoke>
