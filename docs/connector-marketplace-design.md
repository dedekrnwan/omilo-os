# Omilo Connector Marketplace — Design (v1)

**Date:** 2026-10-17
**Status:** Draft for approval (no code until approved)

## Intent & why

Omilo's users are **non-IT business owners**. They know their product, not "MCP servers,"
API keys, or OAuth. Today a `Connector` is a raw MCP server you configure by pasting URLs and
secrets — unusable for the target market.

We want a **marketplace of connectors**: a browsable grid of logos (Instagram, Gmail, Google
Calendar, WhatsApp, …) where the owner clicks **Connect**, signs in, and their helpers can then
act in that tool. The catalog of what's connectable is **indexed from an external GitHub repo**,
so Omilo doesn't hand-build or host every integration and the community can add connectors by PR —
the same pattern Omilo already uses for the **talent roster and skills library**.

## Goals

- A non-IT owner connects a tool in ≤ 3 taps: pick from marketplace → sign in → done. The word
  "MCP" never appears.
- The connectable catalog is sourced from a **public GitHub "pieces" repo**, indexed into Omilo.
  Adding a connector = opening a PR with a small manifest. No Omilo release required to grow it.
- Omilo **owns the whole stack** — no third-party aggregator (Composio/Pipedream/Nango). No
  per-connect fees, no vendor lock-in.
- Connectors expose to helpers as `mcp__<id>__<tool>`, so the existing agent/permission/approval
  layer is unchanged.

## Non-goals (v1)

- **Event triggers** ("when a DM arrives, wake a helper"). Deferred to v2 — needs always-on
  per-account polling/webhook infrastructure. Today's cron **shifts** cover "do X regularly."
- Webhooks of any kind.
- A visual flow/automation builder (this is a connector layer, not an automation canvas).
- Letting owners author connectors in-app (they come from the GitHub repo).

## Anti-goals (would make this a failure even if it "works")

- Any step that requires the owner to paste a URL, API key, client ID, or run a command.
- Running **arbitrary community code** on the owner's machine. Pieces are *data the runtime
  interprets*, not programs Omilo executes.
- A design that only functions when Omilo is reachable from the public internet (owners run on
  laptops behind NAT).

## Target-user constraints that shape everything

- **Self-hosted per business** (laptop or small server, from the CLI/compose modes). No assumption
  of a public URL or a static IP.
- **Non-technical operator.** Cannot register OAuth apps, cannot vet code, cannot debug.

## Architecture

Five components. Only #4's broker is operated centrally by Omilo-the-company; everything else runs
inside the owner's instance.

### 1. The catalog — a public GitHub "pieces" repo
One folder per connector, each with a declarative manifest. Example shape:

```
pieces/
  gmail/
    piece.yaml          # metadata + auth + actions
    logo.svg
  instagram/
    piece.yaml
    logo.svg
```

`piece.yaml` (illustrative):

```yaml
id: gmail                      # slug -> mcp__gmail__<action>
label: Gmail
category: email
description: Read and send email from the business inbox.
auth:
  type: oauth2
  provider: google             # maps to a registered OAuth app in the broker
  scopes: [gmail.send, gmail.readonly]
actions:
  - name: send_email
    label: Send an email
    approval: ask               # auto | ask  (overrides nothing; feeds existing approval gate)
    http:
      method: POST
      url: https://gmail.googleapis.com/gmail/v1/users/me/messages/send
      auth: bearer               # runtime injects the owner's token
      body: { raw: "{{ base64(message) }}" }
    inputs:
      - { name: to, type: string, required: true }
      - { name: subject, type: string }
      - { name: message, type: string, required: true }
```

Key property: an action is **a declarative HTTP call + an input schema**. No executable code.
A rare advanced connector may set `kind: mcp-server` instead and ship a full MCP server
(the existing `Connector` path) — the escape hatch, expected to be <5% of pieces.

### 2. The indexer
Periodically (and on demand) fetches the GitHub repo, validates each manifest against a schema,
and upserts entries into a `catalog`/`connector-catalog` table (distinct from an owner's *connected*
`Connector` rows). Pins a repo ref/version for reproducibility. Surfaces validation errors so a bad
PR can't poison the marketplace. Mirrors the existing talent-roster-from-GitHub mechanism.

### 3. The piece runtime (one engine, many pieces)
Loads catalog manifests and, for each *connected* connector, exposes its actions to helpers as MCP
tools (`mcp__<id>__<action>`). On a tool call it: resolves the owner's token, builds the HTTP
request from the manifest (templating inputs), injects auth, calls the vendor, maps the response
back. This is the single audited surface — contained blast radius. It emits the same tool events and
honors the same per-action `approval` the current system already understands.

**Transport & lifecycle (resolved).** The runtime does **not** introduce a new daemon. Omilo
already runs a local HTTP MCP gateway inside the API process (`mcp_server.py`, the "omilo" server
the engine points at). The piece runtime lives **in that same API process** and is served over the
same local HTTP MCP surface. Each *connected* piece is registered for a run as an MCP server entry
(`claude_code.py` `plan()` gains a `kind=="piece"` branch) pointing back at the in-process runtime,
with the piece id in the path/header so the runtime knows which manifest to interpret. Each action's
`inputs` (`{name,type,required}`) are compiled into the MCP tool `inputSchema` the engine advertises.
No per-connector container, nothing extra to install or keep alive in laptop mode.

### 4. OAuth broker (the one central, permanent, Omilo-run service)
Why it must exist: a non-IT owner can't register a Google OAuth app, and self-hosted instances have
no public callback URL. So Omilo-the-company runs a broker. **It is a permanent service, not
connect-time only** (decided 2026-10-17) — because token *refresh* needs the OAuth client secret,
which only the broker holds, so every connected tool relies on it over time. It is still **not** an
aggregator and has **no per-connect fee**; it is deliberately lightweight and sees tokens only in
transit.

- Holds the **registered OAuth apps** (client IDs/secrets) per provider, and hosts the public
  **callback URL** vendors redirect to after sign-in.
- **NAT-safe handoff (instance-initiated polling).** The owner instance starts a flow with a signed
  one-time `state`, opens the vendor sign-in (via the broker) in the owner's browser, then **polls
  the broker outbound** (`GET broker/result?state=…`) until the authorization is ready. The instance
  is never called back — it only makes outbound HTTPS, which works behind NAT. The handoff is signed
  (broker key) and bound to `state`, single-use, short-TTL, with replay protection.
- **Token exchange & refresh.** The broker performs the code→token exchange and later refreshes
  (both require the client secret). Tokens are returned to the instance over the polled channel and
  **stored encrypted on the owner's instance** (`security.py`). The broker **streams-and-forgets** —
  it holds no long-lived user tokens; it only *sees* a token transiently at connect and each refresh.
- **Broker tenancy.** The broker authenticates thousands of self-hosted instances (per-instance
  credential/registration, rate limits, abuse controls). This is the real multi-tenant surface;
  individual Omilo instances remain single-company.

Honest cost of "owns it": a small but **permanent** service Omilo operates + one OAuth app
registration per vendor. The alternative (owners registering their own OAuth apps) was rejected as
incompatible with the non-IT target.

### 5. Marketplace UI + connect flow
Replaces/augments the current `connectors` page:
- A grid of logos grouped by category, from the indexed catalog. Each card: "Connect" or
  "Connected ✓ / Disconnect."
- Connect → browser opens the provider's sign-in (via broker) → returns → card flips to Connected.
- Zero technical fields.
- **Reconnect state.** If a token is revoked upstream or refresh fails, the card shows "Needs
  reconnect" with a one-tap re-auth (reusing the same connect flow).
- **Disconnect** clears the encrypted token locally and makes a best-effort broker-side revoke
  (vendor revoke needs the client secret → broker). Copy should not over-promise instant vendor-side
  revocation.

## Reuse of what exists

- `Connector` model: a *connected* connector becomes a `Connector` row (`kind` gains `piece`
  alongside `http|stdio`; the piece id is the slug). Declarative pieces don't need `url/command`;
  they reference the catalog manifest + stored token.
- `security.py` encrypt/decrypt for token storage (same as today's `secrets_enc`).
- `capabilities.py` resource assembly and `mcp__<id>__<tool>` exposure — unchanged contract to
  engines and the approval/label system.

## v1 scope boundary

In: catalog + indexer + runtime (actions) + OAuth broker + marketplace UI, reusing Connector/
security/capabilities. Out: triggers, webhooks, flow builder, in-app piece authoring.

## Security

- Pieces are interpreted data, never executed code (except the opt-in `mcp-server` escape hatch,
  which is the existing, already-trusted path).
- **SSRF guard (my call).** The runtime restricts every action's request **host to the piece's
  declared `auth.provider` domain(s)**; templated/variable hosts are disallowed. A malicious PR
  cannot point an action at an internal address and turn the runtime into a confused deputy holding
  the owner's token.
- **Logo/asset safety (my call).** Community `logo.svg` files are served sanitized via `<img>` from a
  proxied endpoint, never inlined — same posture `capabilities.py` already takes for SVG.
- Tokens encrypted at rest on the owner instance; broker streams-and-forgets (no long-lived user
  tokens), seeing a token only transiently at connect/refresh over TLS.
- Each action keeps an `approval: auto|ask` that feeds the existing approval gate — "anything that
  leaves the company waits for the owner's OK" still holds. (Whether owners can *override* a piece's
  default per-action approval in the UI is a small follow-up decision; v1 ships with the piece's
  declared default.)
- Indexer validates manifests against the schema and pins a repo ref; the marketplace only shows
  entries that pass validation.

## Decisions already made (settled in brainstorming)

1. Omilo owns the stack — no aggregator.
2. Declarative pieces under one runtime (not a server per connector).
3. Catalog indexed from a GitHub pieces repo.
4. The OAuth broker is accepted as a **permanent, company-run** service (not connect-time only),
   reached outbound by instances, streaming-and-forgetting tokens. *(decided 2026-10-17)*
5. v1 is **actions only**; triggers are v2.
6. **MVP connector set: WhatsApp, Instagram, Gmail, Google Calendar, Google Sheets, Facebook.**
   *(decided 2026-10-17)* Next wave: TikTok, LinkedIn, Drive, Notion, Slack, marketplace.

## Open decisions (still need the owner's call, not blocking the plan)

- **Where the OAuth broker is hosted/operated** (Omilo-the-company cloud) and the process for
  registering per-vendor OAuth apps.
- **Catalog repo location** — a new public `omilo/pieces` repo vs. a folder in an existing repo;
  and refresh cadence for the indexer.
- **Per-action approval override** in the marketplace UI (v1 defaults to the piece's declared value).

## Left to the builder (minor, my call during implementation)

- Exact manifest schema fields and validation rules; templating syntax for inputs.
- Table shape for the indexed catalog vs. connected connectors.
- Token-handoff signing details between broker and instance.
- Marketplace grid layout/filtering (will follow antislop UI gate).
```
