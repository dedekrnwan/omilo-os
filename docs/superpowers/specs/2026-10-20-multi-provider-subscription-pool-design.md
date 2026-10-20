# Multi-provider subscription-account pool (Design)

Date: 2026-10-20
Status: Draft for approval
Author: Dede Kurniawan (with Claude)

## Intent & why

Omilo's Harness pool today pools **only Claude Code** subscription accounts (one
`claude setup-token` per account, injected server-side). API-key vendors
(OpenAI, Gemini, and six others) are already supported, but *as API keys* — not
as pooled subscription/OAuth accounts. The owner wants the **same pooling
concept extended to other subscription providers** (Codex / ChatGPT Plus,
Gemini, and the long tail of coding-agent subscriptions), keeping the posture we
just shipped: opt-in, clearly disclosed, own-accounts-only, and
**non-load-bearing** (losing the pool never loses work).

The reason Claude is the only one today is incidental, not fundamental: Claude
Code hands out a *long-lived* portable token (`setup-token`), so one paste works
forever. Every other provider uses short-lived **OAuth access tokens plus a
refresh token** — poolable, but only if Omilo stores the refresh token and runs
each provider's OAuth refresh server-side. That is the real new work, and it is
the same work for every provider.

## Prior art — 9router (MIT)

[9router](https://github.com/decolua/9router) (MIT-licensed) already implements
exactly this: a local gateway that pools OAuth accounts across ~30 providers.
Studied directly, its shape is:

- **`providerConnections`** table: `provider`, `authType` (oauth|api), `name`,
  `email`, `priority`, `isActive`, and a `data` blob holding the token-set —
  indexed by `(provider, isActive)` and `(provider, priority)` for pool
  selection. This is the generalized form of Omilo's Claude-only
  `HarnessAccount`.
- **`src/lib/oauth/providers/*`** — a per-provider **login** flow (claude,
  codex, cursor, gemini-cli, github, grok, glm, kimi, windsurf, zed, …).
- **`src/lib/oauth/services/*`** — the matching per-provider **token-refresh**
  services.
- **`connectionsRepo.js`** — pool CRUD + selection; **`usageRepo.js`** —
  per-connection usage for quota-based fallback.
- Clients point their **base URL** at 9router, which injects the pooled account
  and auto-refreshes before expiry.

**Decision: port the concept, not the app.** We borrow 9router's proven
per-provider OAuth login + refresh *logic* (MIT, with attribution) and its
data-model shape, implemented natively inside Omilo's harness — rather than
bundling 9router as a second service. Rationale: Omilo stays one lean service
with its own UX and AGPL codebase; we carry only the providers we actually use;
and native integration reuses the fallback/consent machinery we already shipped.
(9router's own framing — "unlimited free, never hit limits" — is a more openly
limit-circumventing posture than Omilo's disclosed own-accounts pool; adopting
its *code* is fine under MIT, adopting its *stance* is not the intent.)

## Goals

- **Generalize the pool account** from Claude-only to multi-provider: add a
  `provider` discriminator, an `auth_type` (`oauth` | `api` | `setup_token`),
  and a flexible encrypted credential blob to `HarnessAccount`.
- **Provider-adapter pattern** as the unit of extension. Each adapter owns both
  auth and execution: `login`, `import_local`, `validate`, `refresh`,
  `materialize`, `run`.
- **Provider-aware `lease()`**: select among a given provider's enabled,
  not-cooling, under-cap accounts (least-busy → priority → LRU).
- **OAuth refresh**: store the refresh token (encrypted), refresh before expiry
  at lease time, and persist the updated token-set.
- **First three adapters**: Claude Code (refactor the existing path into an
  adapter), **Codex** (ChatGPT Plus/Pro OAuth), **Gemini** (Google OAuth).
- **Reuse the shipped fallback ladder** per provider: pool exhausted → spill to
  that provider's API key if one is configured → else defer / cap / surface
  (the `EngineResult.defer` + `POOL_WAIT_CAP_S` machinery already built).
- **Disclosure/consent** generalized to name the provider and its ToS risk;
  existing Claude pool accounts grandfathered.
- **Honest active-auth signal**: every run surfaces which provider + which
  account actually served it — never a silent switch.

## Non-goals

- **Not bundling 9router** as a second app/service or proxy. We port logic, not
  the deployment.
- **Not building a general HTTP proxy that translates arbitrary provider APIs.**
  Execution runs through each provider's **native runner** (its CLI, mirroring
  how `claude` is driven today), with the pooled credential materialized into an
  isolated per-run config — consistent with Omilo's existing engine model.
- **No change to `local` mode** — the compliant single-user "drive my own
  signed-in CLI" path stays exactly as shipped, and remains the recommended path
  for individuals.
- **No change to `OMILO_HARNESS_PARALLEL`** (default 2).
- **No pooling of non-subscriptions.** opencode and similar are provider
  *front-ends*, not subscriptions — nothing of their own to pool (their auth
  files are only useful as a reference for credential shapes).
- **No in-app OAuth for providers that publish no usable flow** beyond what the
  provider's own CLI already does; we reuse each CLI's established login path.

## Anti-goals (failure even if it "works")

- A **silent** provider/account switch — the owner can't tell which subscription
  (or API key, or which account) ran. Active auth must always be visible.
- A **load-bearing** pool: if one provider's pool dies or an account is revoked,
  work must continue (spill to API key, defer-and-wait), never stop.
- **Leaking credentials**: OAuth refresh tokens stored unencrypted, or any token
  reaching run env/logs beyond the single injected credential the runner needs.
- **Hot-spin** refresh or lease (busy-loop on an expired/empty pool).
- **Breaking the existing Claude pool / `api` / `auto` / `local` paths** — full
  behavior of what shipped must be preserved.
- **Soft-pedaled disclosure** — the per-provider ToS risk must be stated plainly.

## Constraints & current structure

- `apps/api/omilo_api/harness.py`: `HarnessAccount` (`token_enc`, `token_hint`,
  `enabled`, cooldown, usage), `lease()` (least-busy → LRU,
  `MAX_PARALLEL_PER_ACCOUNT`), `release()` (usage, cooldown, limit-hit, auth
  error), `encrypt()`, `pool_consent_status` / `grant_pool_consent` /
  `dismiss_pool_notice`, `POOL_WAIT_CAP_S`.
- `apps/api/omilo_api/engines/claude_code.py`: `_run` branches on
  `cfg["auth"]` (`api` / `local` / pool); `_once` injects the token +
  `CLAUDE_CONFIG_DIR`; `STRIP_ENV` scrubs auth vars.
- `apps/api/omilo_api/worker.py`: the defer / spill / cap fallback ladder
  (`EngineResult.defer`, `_deferred_since`, `retry_at`) just shipped.
- Credentials are encrypted at rest; `STRIP_ENV` prevents a stray env var from
  overriding (or leaking) a chosen credential.
- The provider registry (`AI_PROVIDERS`, `_engine_for` / `_provider_of` /
  `_engine_label`) must round-trip any new provider value cleanly (the lesson
  from the `local` work).

## The how (decided in conversation — items marked "my call" settled by Claude)

### 1. Data model — one table, provider-discriminated
`HarnessAccount` gains: `provider` (TEXT, e.g. `claude-code` | `codex` |
`gemini`), `auth_type` (`setup_token` | `oauth` | `api`), and a `data`
(encrypted JSON) blob — `{access, refresh, expires, account_id, …}` for OAuth,
`{token}` for setup-token, `{key}` for API. Keep `priority`, `label`, `email`,
`enabled`, usage/cooldown columns. Existing Claude rows migrate to
`provider="claude-code"`, `auth_type="setup_token"`, `data={token: <existing>}`.
*(My call: one table with a discriminator, mirroring 9router's
`providerConnections` — keeps `lease()`/usage/cooldown uniform across providers
instead of N parallel tables.)*

### 2. Provider adapter interface (the unit of extension)
Each provider implements an adapter:

- `login(ctx) -> token_set` — run the provider's own OAuth (PKCE / device) to
  capture `access + refresh + expires (+ account id)`. **Primary acquisition
  path**, modeled on 9router's `oauth/providers/*`. *(My call.)*
- `import_local() -> token_set | None` — optional convenience: read the user's
  existing local CLI credential (`~/.codex/auth.json`, `~/.gemini/…`) so an
  already-logged-in machine can seed the pool without re-login.
- `validate(token_set) -> bool`.
- `refresh(token_set) -> token_set` — OAuth refresh; called at lease time when
  within a refresh skew of expiry.
- `materialize(token_set, run_dir) -> {env, config_dir | base_url}` — write an
  **isolated per-run credential** (e.g. a temp `CODEX_HOME` with an
  `auth.json`, or the Gemini equivalent) + the env/base-url so the runner uses
  **this** pooled account, not the host's own login. Analogous to today's
  per-company `CLAUDE_CONFIG_DIR`. *(My call: isolation per run, never the
  host's default store.)*
- `run(...)` — execute via the provider's **native runner** (its CLI, mirroring
  `claude_code`), with the materialized credential. *(My call: native runner per
  provider, not a translating proxy — reuses each CLI's provider-API handling.)*

Claude's existing engine + `setup-token` becomes the first adapter (refactor,
not rewrite).

### 3. Pool selection & refresh
`lease(provider, exclude)` selects among that provider's enabled, not-cooling,
under-`MAX_PARALLEL_PER_ACCOUNT` accounts (least-busy → priority → LRU). On
lease, if the token-set is within `REFRESH_SKEW` of expiry → `adapter.refresh()`
and persist the new token-set (encrypted) before use. *(My call.)*

### 4. Execution routing
The stored engine config carries `{type: "pooled", provider, model?}`; the
dispatcher resolves the adapter, then **lease → materialize → run → release**.
Claude Code keeps its current fast path (its adapter wraps the existing code).
`_provider_of` / `_engine_for` / `_engine_label` learn the new provider values
so the round-trip stays consistent. *(My call.)*

### 5. Fallback ladder (reuse what shipped)
Per provider, when the pool is exhausted: spill to **that provider's** API key
if one is configured → else `EngineResult(defer=True)` → worker re-queues with
backoff, capped at `POOL_WAIT_CAP_S`, then surfaces to the inbox. Spill-to-API
applies only where the provider has an API-key alternative. *(My call.)*

**Session continuity is Claude-specific.** Claude's `--resume <session>` lets a
mid-run limit-hit rotate to the next account and carry the conversation forward.
Providers whose CLI has **no portable, resumable session token** cannot do
mid-run account rotation. For those, a mid-run limit-hit does **not** rotate
accounts mid-conversation — it ends the attempt and falls back per the ladder
(spill to API key, else defer-and-retry), and the retry restarts the run. The
adapter declares whether it supports resume; the "nothing is lost" guarantee
holds via defer/retry even when mid-session rotation is impossible. *(My call —
settles builder-check Q1.)*

### 8. Registry naming & collision with existing API-key providers
`AI_PROVIDERS` already contains `openai` and `gemini` as **LiteLLM API-key**
providers. The pooled-subscription variants must not collide with those. The
pooled path uses engine `type: "pooled"` with a `provider` sub-field, and the
registry gains **distinct provider IDs** for the subscription variants (e.g.
`codex` for ChatGPT Plus/Pro, and a namespaced `gemini-sub` rather than reusing
`gemini`). `_engine_for` / `_provider_of` / `_engine_label` round-trip these new
IDs cleanly (the `local`-provider lesson). In Settings/Harness, a provider that
has both surfaces appears as two cards — e.g. "Gemini · API key" and
"Gemini · subscription pool" — never one ambiguous entry. *(My call — settles
builder-check Q3; naming is internal, no owner decision.)*

### 9. Credential encryption & key rotation
The `data` blob reuses the existing `encrypt()` / `OMILO_SECRET_KEY` path, as
`token_enc` does today (per-company DB isolation already separates tenants). One
new consequence must be documented in-product: a `setup-token` can be re-pasted,
but an **OAuth refresh token cannot** — so rotating `OMILO_SECRET_KEY` (or losing
it) forces **re-authentication of every pooled OAuth account**. Building
key-rotation migration tooling is out of scope; the re-auth requirement is
surfaced to the owner instead. *(My call — settles builder-check Q4.)*

### 6. Disclosure / consent
Generalize the one-time disclosure to name the subscription-pooling risk across
providers (your own accounts; pooling consumer subscriptions for automation may
violate each provider's terms and can be suspended; Omilo auto-falls-back if a
provider stops). Gate at enable / add-first-account (not in `lease()`).
Grandfather existing Claude pool accounts. *(My call / minor.)*

### 7. Gating & tiers
Pooling is a server-side capability (full tier / wherever the pool is enabled).
`local` mode stays the single-user compliant path and is unchanged. A provider's
pool option appears only when its adapter is present and at least its login path
is reachable. *(My call.)*

## Decisions (owner) — to confirm

1. **Acquisition UX.** Primary = **Omilo-driven OAuth login** (browser/device
   flow on the host, like 9router) capturing access+refresh, with
   **import-from-local-CLI** as a convenience; plain paste only where a provider
   offers a long-lived token (Claude). Confirm this is the intended "add
   account" experience.
2. **First three providers & order.** Claude Code (refactor, done-equivalent) →
   **Codex (ChatGPT Plus/Pro)** → **Gemini**. Confirm the set and the order.
3. **Risk acceptance (explicit).** This stores and **refreshes consumer OAuth
   sessions server-side across multiple providers** — a deeper ToS exposure than
   Claude's long-lived `setup-token`, and each provider has its own terms.
   Confirm this is accepted (the pool stays opt-in + disclosed + non-load-bearing
   regardless).

## What's left to the builder

- **Feasibility spike per provider FIRST (gates everything else).** Before
  building a provider's adapter, confirm its OAuth **refresh token is portable
  and refreshable server-side with a headless client** — OpenAI's consumer
  (ChatGPT Plus/Pro) and Google's consumer OAuth may bind tokens to the
  originating device/browser or rotate aggressively, which would make that
  provider **unpoolable**. If the spike fails for a provider, it degrades to
  **API-key-only** (no subscription pool) and the plan drops its adapter. The
  plan must be phased so a failed spike doesn't block the others. *(Elevated
  from builder-check Q2 — this is the single biggest unknown.)*
- Each provider's exact OAuth client/flow parameters, credential file format,
  and CLI credential-isolation mechanism (`CODEX_HOME` for Codex; the Gemini CLI
  equivalent), ported from 9router's MIT adapters **with attribution** and
  verified against the installed CLI versions.
- `REFRESH_SKEW`, cooldown windows, and per-provider usage/limit-detection
  (the `LIMIT_RE` / `AUTH_RE` analogues per provider).
- The schema migration of existing `HarnessAccount` (Claude) rows to the
  provider-discriminated model, additively and reversibly.
- Whether any first-three provider genuinely cannot isolate credentials per run
  via its CLI (if so, that single adapter falls back to a direct-API call with
  the pooled token — an adapter-internal detail, not a change to the interface).
- Test strategy: a fake adapter asserting login/refresh/materialize contracts;
  a provider-aware `lease()` + refresh-on-lease test; reuse of the existing
  defer-ladder tests; a migration test. (Real interactive OAuth logins are not
  unit-tested — test the token-set handling, refresh, materialize isolation, and
  the ladder, not the live login.)
- License hygiene: 9router is MIT; any vendored logic keeps its copyright notice
  and is noted in the repo's third-party attributions.
