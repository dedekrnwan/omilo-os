# P5d — Frontend Gaps (wire the live backend into the UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the completed P0–P5b backend into a usable product by closing the frontend gaps: live WebSocket chat streaming, onboarding profile fields, the area context-scope modal, the marketplace/connections/MCP-token surfaces, and the composer's live usage meter — all behind the existing `Repos`/`Commands` port so mock and HTTP both work.

**Architecture:** The app already separates a `Repos` read port + `Commands` write client (`src/core/ports`, `src/adapters/{http,mock}`) from the UI, gated by `VITE_USE_HTTP`. P5d EXTENDS that seam — new domain types, new repo/command methods with HTTP + mock implementations and contract tests — then wires existing components (Composer, CreateChannelDialog, control-panel sections, onboarding wizard) to it, and adds a WebSocket streaming client for live chat. No UI framework changes; mirror the existing design system (`ui/ds/`) and the sad-mascot `ConfirmDialog` for destructive actions.

**Tech Stack:** React 19, Vite 8, TypeScript (`tsc -b`), Tailwind 4 + tw-animate-css, Zustand, TanStack Router + Query, Radix UI, vitest + testing-library. Backend is merged P0–P5b (`main @ d886abe`).

**Spec:** docs/technical/02-api-contracts.md (endpoint shapes), 09-realtime.md (WS/SSE), docs/business/* for behavior; the memories [[omilo-ui-quality-bar]], [[omilo-modes-area-ia]], [[negative-action-confirm-sad-mascot]] are the UX bar.

## Global Constraints

- Builds on merged P0–P5b; branch off fresh `main` (`d886abe`). The **backend suite (605) must not be touched**; this plan is frontend-only except where it reads backend endpoint shapes.
- **EVERY frontend task MUST pass BOTH `npx vitest run` AND `npx tsc -b` (typecheck).** A green vitest with a red `tsc -b` is a FAILED task — this bit us in P0/P1. Also run `npx oxlint` if quick.
- Preserve the port seam: new data goes through `Repos` (reads) or `Commands` (writes) with BOTH a `createHttpRepos`/http-commands implementation AND a `createMockRepos`/mock implementation, and the shared contract test must pass for both. Components never call `fetch`/`apiFetch` directly — they use the injected port via `useRepos()`/query hooks.
- Types are camelCase in the domain; the HTTP adapter maps snake_case↔camelCase at the boundary (mirror the existing `commands.ts` mapping). Exact backend field names come from the endpoint responses (read the FastAPI routers under `apps/api/omilo/api/` when wiring each surface).
- Mirror the design system: dialogs via `ui/ds/Dialog`, destructive confirms via `ui/ds/ConfirmDialog` (sad `Mascot`), sections mirror `features/control-panel/sections/*`, motion via tw-animate-css (`animate-in/out`, `ease-soft`, `duration-200`). Do NOT introduce a new modal/animation pattern.
- Auth token is read via the existing `getToken` (`localStorage 'omilo_token'`); new HTTP calls go through `apiFetch` so the Bearer + `ApiError` handling is uniform.
- Keep mock fixtures realistic (the app defaults to mock); a new surface that only works under HTTP and breaks the mock app is a failed task.

## Review Focus

- **WS reconnect / closed socket:** if the chat WebSocket drops mid-stream or fails to open, the UI must not hang or crash — it falls back to the final message (the POST already persists it) and shows a non-blocking state, not a spinner forever. Test: socket error → no crash, message still appears. (T3)
- **Empty/else states on live data:** every newly-wired surface (usage, marketplace, connections, tokens, ai-accounts) must render a sensible empty state when the backend returns `[]` and an error state on `ApiError`, not a blank screen or a thrown render. Test each repo's empty + error path. (T1, T6)
- **Onboarding validation:** required profile fields (industry, team_size, region, currency, pic_role) must validate before submit; an invalid/empty submit shows inline errors, does not POST. Test: empty required field → no POST, error shown. (T4)
- **Destructive actions use the sad-mascot ConfirmDialog:** revoking an MCP token and disconnecting a connector must route through `ConfirmDialog` (tone="danger"), never fire immediately. Test: click revoke → dialog appears → confirm → command fires. (T6)
- **Secret shown once:** a freshly-minted MCP access token's raw secret is shown exactly once (copyable) and never re-fetched/re-displayed after dismiss. Test: mint → raw visible once; list view never shows it. (T6)

---

### Task 1: Extend the data seam — domain types + Repos read port (usage, wallet, ai-accounts, marketplace, connectors, mcp-tokens) + http & mock + contract tests

**Files:**
- Modify: `src/core/domain/types.ts` (new types)
- Modify: `src/core/ports/repos.ts` (new repo interfaces on `Repos`)
- Modify: `src/adapters/http/httpRepos.ts` (HTTP impls)
- Modify: `src/adapters/mock/mockRepos.ts`, `src/adapters/mock/fixtures.ts` (mock impls + fixtures)
- Modify: `src/adapters/mock/mockRepos.contract.test.ts` (extend the shared contract)
- Test: `src/adapters/http/httpRepos.test.ts` (unit tests for the new endpoints)

**Interfaces:**
- Consumes: existing `apiFetch`, `ApiError`, the `Repos` shape, `runReposContract`.
- Produces — new domain types (camelCase; map from the real router responses): `UsageSummary` (balance, included, usedThisPeriod, byHelper[], byDay[], pendingTopups?, lastPayment?), `WalletSettings` (autoTopupEnabled, autoTopupThresholdCredits, autoTopupPack), `AiAccount` (id, harness, name, tag, status, pctWindow, tokens, lastUsed), `Piece` (id, label, category, description, authType, actionCount, logo, status), `Connector` (id, pieceId, label, source, status, enabled), `McpToken` (id, label, helperId, scopes, expiresAt, lastUsedAt, revokedAt, active). New read repos on `Repos`: `usage.get()`→`GET /v1/usage`; `wallet.get()`→`GET /v1/wallet`; `aiAccounts.list()`→`GET /v1/ai-accounts`; `marketplace.list(params?)`→`GET /v1/marketplace`; `connectors.list()`→`GET /v1/connectors`; `mcpTokens.list()`→`GET /v1/mcp-access-tokens`.

- [ ] **Step 1: Write the failing tests** — in `httpRepos.test.ts` (mirror the existing stub-fetch pattern): each new method calls the right URL with the Bearer header and returns the mapped camelCase shape; a 404-tolerant `.get()` returns null; a non-OK non-404 throws `ApiError`. In the contract test, assert the new repos exist and return the fixture shapes under BOTH mock and http-mock.
- [ ] **Step 2: Run `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the types, port additions, HTTP impls (snake→camel mapping), and mock impls + fixtures.
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

### Task 2: Extend the Commands write seam (mint/revoke token, install/toggle connector, create/update area, wallet update, topup/change-plan, submit profile) + http & mock + tests

**Files:**
- Modify: `src/adapters/http/commands.ts` (new mutations + snake_case mapping)
- Create/Modify: a mock commands impl if one exists (mirror the repos mock pattern; if commands are http-only, add a mock for tests)
- Test: `src/adapters/http/commands.test.ts` (create if absent)

**Interfaces:**
- Consumes: `apiFetch`, the new types from T1.
- Produces — new `Commands` methods: `mintMcpToken({label, helperId, scopes, expiresAt?})`→`POST /v1/mcp-access-tokens` (returns `{...token, token: rawOnce}`); `revokeMcpToken(id)`→`DELETE`; `installConnector(pieceId)`→`POST /v1/connectors/install`; `updateConnector(id, {enabled?})`→`PATCH /v1/connectors/{id}`; `connectorCredentials(id, fields)`→`POST /v1/connectors/{id}/credentials`; `createArea({name, color, icon, purpose, contextScope})`→`POST /v1/channels`; `updateWallet(settings)`→`PUT /v1/wallet`; `topup(pack)`→`POST /v1/billing/topup`; `changePlan(planId)`→`POST /v1/billing/change-plan`; `updateCompanyProfile({industry, teamSize, region, currency, picRole})`→the company-profile endpoint (read the backend; likely `PATCH /v1/companies/{id}` or a profile route — confirm the exact path in `apps/api/omilo/api/`).

- [ ] **Step 1: Write failing tests** — each command POSTs/PATCHes/DELETEs the right URL with the right camel→snake body + Idempotency-Key where the backend expects it; mint returns the raw token once.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement.** (Confirm each backend path/shape by reading the router.)
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

### Task 3: Live WebSocket chat streaming (replace mock streaming)

**Files:**
- Create: `src/adapters/http/chatSocket.ts` (the WS client)
- Modify: `src/ui/ChatSession/ChatSession.tsx` (consume the stream) and the send path (`src/app/queries.ts`/`commands` integration)
- Modify: `src/ui/ChatSession/Composer.tsx` ONLY to wire the live usage meter (`contextUsed` from `usage.get()` / the stream) — remove the hardcoded `contextUsed=42`/`autoCompact=true`.
- Test: `src/adapters/http/chatSocket.test.ts` + a ChatSession streaming test

**Interfaces:**
- Consumes: the backend WS at `GET /v1/ws/sessions/{id}` — **read `apps/api/omilo/realtime/ws.py` for the exact frame protocol**; P1 emits frames in order `run_event` → `message_saved` → `job_done` (confirm names/shapes). Auth: the WS needs the bearer (query param or subprotocol — check ws.py).
- Produces: `openChatSocket(sessionId, getToken, handlers: {onRunEvent, onMessageSaved, onJobDone, onError, onClose}) -> {close()}`. The send flow stays: `POST /v1/sessions/{id}/messages` triggers the Chief turn; the socket streams the resulting frames; the UI appends streamed run-events then the saved assistant message, and clears the streaming state on `job_done`. On socket error/close-before-done: stop the spinner, keep whatever was streamed, and fall back to a one-shot refetch of `messages.listBySession` (the POST already persisted the final message) — never hang.

- [ ] **Step 1: Write failing tests** — `chatSocket.test.ts` with a mock WebSocket (stub `global.WebSocket`): frames dispatched to the right handlers in order; an `onerror`/early `onclose` calls `onError`/`onClose` without throwing. A ChatSession test: a simulated stream renders the streamed assistant message; a socket error falls back to the refetched message (no infinite spinner — Review Focus).
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the socket client + wire ChatSession (guard behind `VITE_USE_HTTP`; mock mode keeps the current static behavior). Live usage meter from `usage.get()`.
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

### Task 4: Onboarding profile fields (industry, team_size, region, currency, pic_role)

**Files:**
- Modify: `src/features/onboarding/StepKnowYou.tsx` (or the appropriate step) + `src/features/onboarding/data.ts`/state
- Modify: the onboarding submit path to call `commands.updateCompanyProfile(...)`
- Test: `src/features/onboarding/StepKnowYou.test.tsx` (create)

**Interfaces:**
- Consumes: T2 `updateCompanyProfile`. Company fields from the TRD: `industry` (text/select), `team_size` (select bucket), `region` (select), `currency` (select — default IDR given Doit), `pic_role` (text/select).
- Produces: user-input-driven fields (replace the hardcoded mock answers for these five) with validation; on wizard completion, submit the profile. Mirror the existing step's layout/controls; use `Segmented`/select primitives already in `ui/ds`.

- [ ] **Step 1: Write failing test** — the step renders the five fields; submitting with a required field empty shows an inline error and does NOT call `updateCompanyProfile`; a valid submit calls it with the camelCase payload. (Review Focus: validation.)
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the fields + validation + submit wiring.
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

### Task 5: Area context-scope modal (complete CreateChannelDialog — icon, purpose, context_scope + create)

**Files:**
- Modify: `src/features/chat/CreateChannelDialog.tsx`
- Test: `src/features/chat/CreateChannelDialog.test.tsx` (create)

**Interfaces:**
- Consumes: T2 `createArea({name, color, icon, purpose, contextScope})`. The dialog already has color swatches + the isolated|isolated-general radios; ADD an icon picker (a small lucide-icon grid — reuse whatever icon set the app ships), a `purpose` textarea, and wire form submission → `createArea` → close + refetch channels. Validation: name required; contextScope defaults to `isolated`.
- Produces: a complete create flow matching the design system (Dialog + primary Button; no new modal pattern).

- [ ] **Step 1: Write failing test** — the dialog renders name, icon picker, color swatches, purpose, context-scope radios; submitting a valid form calls `createArea` with the full camelCase payload and closes; empty name blocks submit.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

### Task 6: Marketplace + Connections + MCP-access-tokens surfaces (wire to live backend)

**Files:**
- Modify: `src/features/control-panel/sections/SectionConnectors.tsx` (live connectors + install-from-marketplace)
- Create: `src/features/control-panel/sections/SectionMcpTokens.tsx` (the MCP access-token list/mint/revoke) + add its route/section entry
- Modify: `src/features/control-panel/sections/SectionUsage.tsx` + `SectionAiAccounts.tsx` (wire `usage.get()` + `aiAccounts.list()`)
- Test: section tests for each (create)

**Interfaces:**
- Consumes: T1 repos (`marketplace`, `connectors`, `mcpTokens`, `usage`, `aiAccounts`), T2 commands (`installConnector`, `updateConnector`, `mintMcpToken`, `revokeMcpToken`). 
- Produces:
  - **SectionConnectors:** render the company's live `connectors.list()`; a "browse marketplace" area lists `marketplace.list()` pieces with an Install action → `installConnector(pieceId)` → refetch; disconnect/toggle via `updateConnector`, with disconnect behind the sad-mascot `ConfirmDialog`.
  - **SectionMcpTokens:** list `mcpTokens.list()` (label, acting-as helper, scopes, active, last used) mirroring `SectionConnectors`' row+menu layout; a "Mint token" dialog (label, helper, scopes) → `mintMcpToken` → show the raw secret ONCE in a copyable field (Review Focus), never again; Revoke behind `ConfirmDialog` (danger).
  - **SectionUsage / SectionAiAccounts:** replace mock with live `usage.get()` (balance, used-this-period, by-helper/day) + `aiAccounts.list()` (status/pct), each with empty + error states.

- [ ] **Step 1: Write failing tests** — SectionConnectors lists live connectors + install calls `installConnector`; disconnect opens ConfirmDialog then calls `updateConnector`. SectionMcpTokens lists tokens, mint shows the raw secret once, revoke opens ConfirmDialog → `revokeMcpToken`. Usage/AiAccounts render live data + empty + error states.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the four sections (mirror `SectionConnectors`' existing layout; use `ConfirmDialog` for all destructive actions).
- [ ] **Step 4: `npx vitest run` → pass; `npx tsc -b` → clean.**
- [ ] **Step 5: Commit.**

---

## Self-Review notes (author)

- **Spec coverage:** the five P5d gaps map to T3 (WS + composer meter), T4 (onboarding), T5 (area modal), T6 (marketplace/connections/tokens/usage/ai-accounts); T1+T2 are the data/command foundation every UI task consumes. Deliberately deferred: flows/routines/analytics live-wiring (those pages exist with mock data and are lower-value than the chat/commerce/connection surfaces) — noted for a follow-up P5e if wanted.
- **The build-gate lesson:** every task runs `tsc -b` AND vitest — a green test with a type error is a failed task (cost us two fix loops in P0/P1).
- **Port discipline:** T1/T2 keep mock and HTTP at parity via the shared contract test, so the app still runs fully in mock mode (its default) — a UI task that only works under `VITE_USE_HTTP` and breaks mock is rejected.
- **Design-system fidelity:** destructive actions (revoke token, disconnect connector) use the sad-mascot `ConfirmDialog` per [[negative-action-confirm-sad-mascot]]; dialogs/sections mirror existing exemplars (`Dialog`, `SectionConnectors`), no new modal/motion pattern — the [[omilo-ui-quality-bar]] is the bar.
- **Type consistency:** `McpToken`, `Connector`, `Piece`, `UsageSummary`, `WalletSettings`, `AiAccount` defined once in T1 and reused by T2/T6; the raw mint secret is a one-time field on the mint response, never on `McpToken`.
- **Proportion:** 6 tasks — two foundation (data/commands), four UI. The WS task (T3) carries the most risk (reconnect/fallback) and has the sharpest Review-Focus test.
