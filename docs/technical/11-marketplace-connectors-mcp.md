# 11 · Marketplace, Connectors & the Three MCP Roles

> Track: **technical**. How omilo's first-party connector **marketplace** (`omilo-pieces`) works,
> and the full picture of **where MCP sits** — omilo is both an MCP *client* (consuming
> connectors) and an MCP *server* (to its own agents, and — designed here, built later — to the
> outside world). Extends [`05-mcp-surfaces.md`](05-mcp-surfaces.md) and
> [`../integrations/README.md`](../integrations/README.md).

## 1. The three MCP roles

MCP is a client/server protocol. omilo plays **both sides**, in three distinct roles. Keeping
them separate is the key to not getting confused about "client vs server."

```
 ROLE 1  omilo as MCP CLIENT ──────────────► connectors (the outside world)
   engine's tool call ──► omilo ──► { type:piece: omilo makes the HTTP call itself
                                      type:mcp:   omilo mounts a REMOTE MCP server (e.g. Repliz) }

 ROLE 2  omilo as MCP SERVER ◄────────────── its own Helper engines (inside omilo)
   per-agent endpoint exposes goals/routines/flows/docs/recall/propose + compiled connector tools

 ROLE 3  omilo as MCP SERVER ◄────────────── EXTERNAL clients (Claude Desktop, Cursor, ChatGPT…)
   a user drives their own omilo workspace from outside — "omilo itself is a connector others install"
```

| Role | omilo is… | Counterparty | Status |
|---|---|---|---|
| **1 · consume connectors** | **client** | a connector (HTTP piece, or a remote MCP server like Repliz) | built (this doc + integrations) |
| **2 · serve own agents** | **server** | each Helper's engine | built ([`05`](05-mcp-surfaces.md)) |
| **3 · expose omilo outward** | **server** | an external MCP client | **designed here, built later** (§6) |

> So "does our design cover client or server?" → **both.** Role 1 is the client side; Roles 2–3
> are the server side. Role 1 even covers connectors that are *themselves* MCP servers
> (`type: mcp`). The only not-yet-built piece is Role 3 (exposing omilo to outside clients).

---

## 2. The marketplace — `omilo-pieces`

omilo ships a **first-party catalog of supported connectors** in a separate repo,
[`omilo-pieces`](../../omilo-pieces) (**MIT-licensed** so the community can contribute
connectors; the platform itself stays ELv2). Its core principle:

> **"A piece is data, not code."** Each connector is a declarative `piece.yaml` manifest; omilo
> reads it and makes the calls itself. Nothing from a piece ever executes on a user's machine,
> and **adding a connector needs no omilo release** — it's one folder + one PR to the catalog.

### 2.1 Catalog pipeline (fetch → index → catalog)

```
omilo-pieces repo (git)          omilo-v2 backend
  pieces/<slug>/piece.yaml  ──►  (1) FETCH   clone repo (PIECES_REPO=owner/name)
  pieces/<slug>/logo.svg          │          or read local checkout (PIECES_SOURCE=/path)
                                  (2) INDEX   validate every piece.yaml → write catalog rows
                                  │           (status ok | invalid + error reasons)
                                  (3) SERVE   GET /v1/marketplace → cards (logo, label, category)
```

Refreshed on startup and via a **Refresh** button. The catalog is **global** (not tenant data);
*installing* a piece is what creates a per-company connector (§3).

### 2.2 Two kinds of piece

| `piece.yaml` `type` | What it is | How omilo runs it | Example |
|---|---|---|---|
| **`piece`** (default) | metadata + OAuth + declarative **HTTP actions** | omilo makes the HTTP call itself and **compiles each action into an MCP tool** for agents. omilo is the credential holder. | Gmail, Google Calendar/Sheets, WhatsApp, Instagram, Facebook |
| **`mcp`** | points at a **remote MCP server** | omilo **mounts it as a client** and passes its tools through (no re-definition) | Repliz (105 tools across 11 social platforms via one card) |

### 2.3 Manifest schema (from `omilo-pieces`)

```yaml
id: gmail                         # slug  ^[a-z0-9][a-z0-9-]{0,40}$
label: Gmail
category: Email                   # groups the marketplace grid
description: Send and read email.
type: piece                       # piece | mcp   (default piece)
runtime: http                     # http (immediate calls) | engine (persistent session, e.g. WhatsApp)

auth:                             # type:piece → OAuth2 (or apikey, roadmap)
  type: oauth2
  provider: google                # must be on omilo's provider allowlist
  scopes: [ https://www.googleapis.com/auth/gmail.send, …gmail.readonly ]

actions:
  - name: send-email
    label: Send an email
    approval: ask                 # ask → Proposal; auto → runs within the gate
    http:
      method: POST
      url: https://gmail.googleapis.com/…/messages/send   # absolute https; HOST on provider allowlist
      auth: bearer                # omilo injects the held OAuth token
      body: { raw: "{{ message }}" }                       # {{input}} templating in url/query/body
    inputs:
      - { name: message, type: string, required: true }

triggers:                         # OPTIONAL, data-only — see 2.4
  - name: message-received
    event: message.received
    mapping: { text: "{{ message_text }}" }
```

`type: mcp` manifests instead carry an `mcp: { url, auth: { scheme: header|basic, fields[], attach{} } }`
block (credentials collected at connect-time and injected into requests).

**Hard guardrails** validated at index time (`validate_manifest`):
- slugs match the pattern; `label/category/description` non-empty.
- `type:piece`: `auth.type=oauth2`, non-empty `provider` + `scopes`; every action has a valid
  method, an **absolute `https://` url whose host is on the provider's allowlist** (SSRF guard),
  `auth: bearer`, and `approval ∈ {auto, ask}`. **The host is never templatable** — only path/
  query/body are.
- `type:mcp`: `mcp.url` absolute https on the `MCP_HOSTS` allowlist; `auth.scheme ∈ {header, basic}`.
- `runtime ∈ {http, engine}`; `triggers` is a list of `{name, event, mapping?}`.

### 2.4 Reconciling piece `triggers` with "no webhooks"

`omilo-pieces` can declare `triggers` abstractly (`event: message.received`). **omilo-v2 does
not expose a public webhook ingress** (decided — see
[`../business/flows.md`](../business/flows.md) §trigger). So a piece's triggers are consumed as
**scheduled polling** (`connector_poll`) or **internal events**, never inbound pushes: omilo
polls the piece's read action on a schedule, maps new items via the trigger `mapping`, and
advances a watermark. A piece author declares *what* the event is; omilo decides *how* to
observe it — by polling. (The sole exception remains optional payment-provider callbacks in
[`08`](08-billing-ai-credits.md), which are not pieces.)

### 2.5 Versioning

The catalog is versioned by **git commit** — pieces are read at `HEAD`, and back-compat is a
rule (new manifest fields are optional; old pieces keep working). A company's *installed*
connector pins the manifest it was validated against; re-index surfaces changes.

---

## 3. Data model (catalog + installed instance)

See [`01-data-model.md` §12](01-data-model.md). Two layers: the **global catalog** and the
**per-company installed connector**.

### `Piece` — global catalog row (not tenant-scoped)
`id` (slug), `label`, `category`, `description`, `type` (`piece`|`mcp`), `runtime`
(`http`|`engine`), `auth_descriptor` jsonb (oauth2 provider+scopes, or mcp/apikey field spec),
`actions` jsonb (compiled tool specs), `mcp` jsonb (remote server url+auth for `type:mcp`),
`triggers` jsonb, `logo` (svg/data-uri), `catalog_commit` (git sha), `status` (`ok`|`invalid`),
`errors` jsonb. Populated by the indexer from `omilo-pieces`.

### `Connector` — per-company installed instance (tenant table)
Already defined in `01` §12; the marketplace adds:
- `source` (`marketplace`|`custom`|`builtin`) — where it came from.
- `piece_id` (FK→`Piece`, when `source=marketplace`).
- `secrets_enc` holds the **omilo-held** OAuth token / API-key fields (encrypted; never shown to
  agents). `approval`, `enabled`, `status`, `poll_spec` as before.

Installing a marketplace piece = create a `Connector` with `source=marketplace`, `piece_id` set,
then run the connect flow (§4) to populate `secrets_enc`. Custom/BYO MCP URLs and OpenAPI imports
are `source=custom`; first-party in-process ones (`web`, browser) are `source=builtin`.

### `McpAccessToken` — Role 3 exposure (tenant table; see §6)
`id`, `company_id`, `label`, `token_hash`, `scopes` jsonb (which surfaces/areas), `helper_id`
(acts *as* this Helper → inherits its `autonomy_cap`/permissions), `expires_at`, `last_used_at`,
`revoked_at`.

---

## 4. Connect flows (auth) — omilo is the credential holder

Agents **never** see credentials; omilo holds them encrypted and injects them at call time.

- **OAuth2** (`type:piece`, `auth.oauth2`): operator clicks Connect → system browser → provider
  consent (requested `scopes`) → `omilo://` deep-link callback (desktop) or hosted callback
  (web) → omilo stores the refresh/access token in `secrets_enc`, auto-refreshes (the OAuth
  broker). Provider must be on the allowlist; host-pinned per provider.
- **API-key / header / basic** (`type:mcp`, or `type:piece` apikey roadmap): a small form
  collects the `fields` (secret ones masked); omilo stores them and injects per the `attach`
  template (`X-Repliz-Access-Key: {{access_key}}`, or `Authorization: Basic …`).
- **Per-Helper grants**: installing a connector doesn't give every Helper access — grants are
  `HelperAccess` rows (least privilege); an agent can `request_access` → a `connector_access`
  Proposal. See [`05` §4](05-mcp-surfaces.md).

---

## 5. Role 1 runtime — consuming a connector

- `type:piece` → omilo compiles each `action` into an **MCP tool** on the Helper's per-agent
  endpoint; on call it fills `{{inputs}}`, injects the bearer token, enforces the **SSRF
  allowlist**, runs the HTTP call, and routes side-effecting ones through the **gate** (`approval`
  = `ask` → Proposal). `runtime: engine` pieces (e.g. unofficial WhatsApp) run a persistent
  session instead of one-shot HTTP.
- `type:mcp` → omilo **mounts the remote MCP server** and exposes its tools to granted Helpers,
  injecting the stored auth; approval is gated at the connector level. Repliz's 105 tools arrive
  as one installable card.

Every call lands a `ToolCall` (`allowed|proposal|refused|error`) and respects
`effective_autonomy × risk` + `SafetyLimit`s exactly like any native tool.

---

## 6. Role 3 — omilo as an external MCP server (designed now, built later)

**Goal:** let a user operate *their own* omilo workspace from an outside MCP client — Claude
Desktop, Cursor, ChatGPT, or another agent — so **omilo itself becomes a connector others
install**.

```
  Claude Desktop / Cursor / ChatGPT  (external MCP client)
        │  connects to:  https://mcp.omilo.app/x/{company}   (Bearer <McpAccessToken>)
        ▼
  omilo MCP server  (per-company exposure endpoint)
    • authenticates the McpAccessToken → resolves company_id + acts-as Helper
    • exposes a CURATED subset of platform tools: goals_*, routines_*, flows_*, docs_*,
      recall, propose, post_message  (NOT the full internal tool set)
    • every call runs through the SAME gate + autonomy + SafetyLimits + audit as Role 2
```

Design rules:
- **Reuses Role 2 wholesale.** It's the same per-agent MCP server and tool handlers; Role 3 only
  adds an **externally-mintable, scoped access token** and a public endpoint. No parallel logic.
- **Token-scoped & acts-as a Helper.** The owner mints an `McpAccessToken` bound to one Helper
  (so it inherits that Helper's `autonomy_cap` + `permissions`) and a `scopes` set (which
  surfaces/areas). An external client can never exceed what that Helper could do.
- **Same safety envelope.** Consequential actions still become Proposals / respect `SafetyLimit`s;
  nothing an external client does bypasses the gate. Calls are audited as `ToolCall` with
  `actor = external:<token_label>`.
- **Revocable & observable.** Tokens are listed, scoped, and revocable in the Connections UI
  (§7); last-used is tracked.
- **Phase:** later (post-core). Marked so the contract exists now without blocking P0–P5.

---

## 7. UI sketches (low-fidelity)

Reference only — the frontend owns final design. Three screens + a Role-3 token manager.

### 7.1 Marketplace grid — `Control-Panel → Connectors → Browse`
```
┌ Marketplace ───────────────────────────── [ Refresh ]  [ search… ] ┐
│  Filter: All · Email · Calendar · Messaging · Social · Spreadsheets │
│                                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  ✉ Gmail │  │ 📅 Cal.  │  │ 🟢 WhatsA│  │ 📊 Sheets│            │
│  │  Email   │  │ Calendar │  │ Messaging│  │ Spreadsh.│            │
│  │ [Install]│  │ [Install]│  │ [Install]│  │ ✓ Added  │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────┐  ┌──────────┐   … invalid pieces greyed with reason  │
│  │ ◎ Repliz │  │ + Custom │                                        │
│  │ Social   │  │ MCP/API  │   "Add your own MCP URL or OpenAPI"    │
│  │ [Install]│  │ [Add…]   │                                        │
│  └──────────┘  └──────────┘                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Connect modal — OAuth vs API-key (driven by the manifest)
```
 type:piece / oauth2                    type:mcp / header-keys (Repliz)
┌ Connect Gmail ───────────────┐       ┌ Connect Repliz ──────────────┐
│ omilo will ask Google for:   │       │ Enter your Repliz keys:      │
│  • Send email                │       │  Access Key  [••••••••••]    │
│  • Read email (readonly)     │       │  Secret Key  [••••••••••]    │
│                              │       │  (stored encrypted; agents   │
│ [ Continue with Google → ]   │       │   never see them)            │
│  opens system browser,       │       │ Approval for writes: (•)Ask  │
│  returns via omilo://        │       │                     ( )Auto  │
│ Approval for writes: (•)Ask  │       │ [ Connect ]                  │
└──────────────────────────────┘       └──────────────────────────────┘
```

### 7.3 Connections manager — `Control-Panel → Connectors`
```
┌ Connected ─────────────────────────────────────────────────────────┐
│  ✉ Gmail        ● ok     writes: Ask   used by: Growth, Chief  [⋯]  │
│  📅 Calendar    ● ok     writes: Auto  used by: Chief          [⋯]  │
│  🟢 WhatsApp    ⚠ re-auth writes: Ask   used by: Support        [⋯]  │
│  ◎ Repliz       ● ok     105 tools     used by: Growth         [⋯]  │
│  🗄 Your DB (RO) ● ok     read-only     used by: Finance        [⋯]  │
│  [⋯] = Manage grants · Re-authenticate · Disable · Remove          │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.4 (Role 3) External access tokens — `Control-Panel → Connectors → External access`
```
┌ Let outside tools drive omilo (MCP) ───────────────────────────────┐
│  Connect Claude Desktop / Cursor / ChatGPT to this workspace.      │
│                                                                     │
│  Token "Dede's laptop"   acts as: Chief   scope: Goals, Docs       │
│       mcp.omilo.app/x/cmp_…     last used 2m ago        [ Revoke ] │
│  [ + Mint access token ]  → pick a Helper to act as + surfaces     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 8. API surface

```
# Marketplace (catalog is global; install is per-company)
GET  /v1/marketplace                 ?category=&q=   → PieceCard[]        (indexed catalog)
POST /v1/marketplace/refresh                          → {indexed, invalid[]}  (admin)
POST /v1/connectors/install  {piece_id}               → Connector (status=needs_auth)
# Connect / auth
POST /v1/connectors/{id}/oauth/start                  → {redirect_url}
GET  /v1/connectors/{id}/oauth/callback               (→ stores token)
POST /v1/connectors/{id}/credentials  {fields}        (api-key/header pieces)
# Manage (connections manager)
GET  /v1/connectors ; PATCH /v1/connectors/{id} (enable/disable/approval) ; DELETE …
POST /v1/connectors/{id}/reauth
# Custom / BYO
POST /v1/connectors/custom  {mcp_url | openapi_url, auth}
# Role 3 — external MCP exposure (later phase)
GET  /v1/mcp-access-tokens ; POST /v1/mcp-access-tokens {label, helper_id, scopes} ;
     DELETE /v1/mcp-access-tokens/{id}
#   external clients connect at:  wss://mcp.omilo.app/x/{company}   (Bearer McpAccessToken)
```

---

## 9. Phasing & licensing

- **Licensing:** `omilo-pieces` is **MIT** (community-contributable catalog); omilo-v2 is **ELv2**.
  The split is deliberate — anyone can add a connector manifest; the platform that runs them stays
  source-available-but-protected.
- **Phases:** marketplace catalog + `type:piece` (OAuth/HTTP) and `type:mcp` (mount remote) land
  with connectors in **P4** ([`00` §7](00-architecture.md)). **Role 3** (external MCP exposure) is
  a **later phase** — the model and endpoints are defined here so nothing has to be retrofitted,
  but it ships after the core platform.

---

## See also
- [`05-mcp-surfaces.md`](05-mcp-surfaces.md) — Role 2: the per-agent MCP server and native tools.
- [`../integrations/README.md`](../integrations/README.md) — the business connector catalog, OAuth, HelperAccess, safety.
- [`../business/flows.md`](../business/flows.md) — how connector polls/internal events trigger flows (no webhooks).
- [`01-data-model.md`](01-data-model.md) — `Piece`, `Connector`, `McpAccessToken`.
