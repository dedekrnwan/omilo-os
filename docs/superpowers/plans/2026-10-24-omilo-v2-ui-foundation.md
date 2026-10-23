# Omilo v2 — UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, desktop-capable SPA that proves the Omilo v2 Chat ↔ Office flow, with one shared ChatSession primitive fed by in-memory mock adapters behind domain ports.

**Architecture:** Ports-and-adapters. A framework-free `core/` holds domain types and port interfaces; `adapters/mock/` implements those ports in memory and must pass a shared port-contract test; `features/chat` and `features/office` compose UI from a shared `ui/` design system whose keystone is one `<ChatSession/>`. Server-state flows through TanStack Query (always via a port, never a direct adapter import); UI-state (mode, selections, last-path-per-mode) lives in Zustand. Routing via TanStack Router. Packaged for desktop by a thin Tauri v2 shell running the Vite build in a webview.

**Tech Stack:** Vite + React + TypeScript, TanStack Router, TanStack Query, Zustand, Tailwind CSS v4, Radix UI primitives, Tauri v2. Tooling: bun, Vitest + React Testing Library + jsdom.

**Spec:** `docs/superpowers/specs/2026-10-24-omilo-v2-ui-foundation-design.md`

## Global Constraints

- New clean repo at `~/Documents/works/omilo/omilo-v2`; zero v1 code carried over.
- SPA only — **no SSR / no Next.js** (anti-goal; suspected source of v1 lag).
- **No Phaser / spatial office** (anti-goal).
- `core/` MUST NOT import React, the router, TanStack Query, or any transport/adapter.
- No component may import a mock adapter directly; data reaches components only through a port exposed via `useRepos()` + TanStack Query hooks.
- Data this phase is **mock only**; the real HTTP adapter is not built.
- Composer controls (model selector / thinking / @mention) are **interactive but backend-inert**: selection lives in local/Zustand state and sends nothing.
- Tauri this phase means `tauri dev` launching the Vite app in a webview — no packaged/signed binary, no desktop CI.
- Design tokens are fixed verbatim from spec §6 (palette, radii, fonts: Inter / Bricolage Grotesque / IBM Plex Mono / Fraunces). An InboxItem carries a `sessionId`; opening it loads that session into the shared `<ChatSession/>`.
- Package manager: **bun**.

## Review Focus

- **Unknown route id** (`:channelId` / `:sessionId` / `:itemId` not in the mock set) → a graceful "not found" panel, never a blank screen or crash. *(Tasks 7, 8)*
- **Empty states** — a channel with no sessions, an inbox with no items, a session with no messages → render an empty placeholder, never crash. *(Tasks 6, 7, 8)*
- **Stale session on channel switch** — switching channel while a session is open must swap the thread; no messages from the previous session may linger. *(Task 7)*
- **Mode toggle with no prior location** — toggling to a mode never visited yet lands on that mode's default route, not a dead path. *(Task 5)*
- **Model selection scope** — a model picked in the composer persists while that session is open and does not bleed into an unrelated session. *(Task 6)*

---

### Task 0: Project scaffold & test harness

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `vitest.config.ts`, `src/test/setup.ts`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces: a booting Vite+React+TS app; `bun test` runs Vitest with jsdom + RTL; `App` renders a root element.

- [ ] **Step 1: Scaffold** — `bun create vite omilo-v2 --template react-ts` into the repo root (or init in place), then `bun add` the runtime deps (`@tanstack/react-router @tanstack/react-query zustand @radix-ui/react-dropdown-menu @radix-ui/react-dialog`) and dev deps (`vitest @testing-library/react @testing-library/user-event jsdom @tailwindcss/vite tailwindcss @tauri-apps/cli`). Configure Vitest (`environment: 'jsdom'`, setup file importing `@testing-library/jest-dom`).

- [ ] **Step 2: Write the failing test** — `src/App.test.tsx`:
```tsx
test('App renders the root shell landmark', () => {
  render(<App />)
  expect(screen.getByRole('application')).toBeInTheDocument()
})
```

- [ ] **Step 3: Run test to verify it fails** — `bun run test src/App.test.tsx`. Expected: FAIL (no `role="application"`).

- [ ] **Step 4: Implement** `App` in `src/App.tsx` as a `<div role="application">` placeholder; wire `main.tsx` to mount it.

- [ ] **Step 5: Run test to verify it passes** — `bun run test src/App.test.tsx`. Expected: PASS. Also confirm `bun run dev` serves the app.

- [ ] **Step 6: Commit** — `git init` if needed; `chore: scaffold vite+react+ts app with vitest harness`.

---

### Task 1: Domain types, ports, and the port-contract test factory

**Files:**
- Create: `src/core/domain/types.ts`, `src/core/ports/repos.ts`, `src/core/ports/repos.contract.ts`
- Test: the contract factory (`repos.contract.ts`) is the deliverable; it is *run* against a real adapter in Task 2.

**Interfaces:**
- Produces, in `src/core/domain/types.ts`:
```ts
export type Id = string
export type HelperArea = 'brand'|'ops'|'dev'|'support'|'finance'|'marketing'|'sales'|'retro'
export interface Company { id: Id; name: string; color: string }
export interface Helper { id: Id; name: string; area: HelperArea }
export interface Channel { id: Id; name: string; area: HelperArea }
export interface Model { id: Id; label: string }
export interface MessageAuthor { kind: 'you'|'helper'; name: string; area?: HelperArea }
export interface Message { id: Id; sessionId: Id; author: MessageAuthor; content: string; createdAt: string }
export interface Session { id: Id; title: string; channelId?: Id }
export interface InboxItem { id: Id; title: string; summary: string; sessionId: Id; kind: 'decision'|'update'|'mention'; status: 'pending'|'done'; createdAt: string }
```
- Produces, in `src/core/ports/repos.ts`:
```ts
export interface ChannelRepo { list(): Promise<Channel[]>; get(id: Id): Promise<Channel | null> }
export interface SessionRepo { get(id: Id): Promise<Session | null>; listByChannel(channelId: Id): Promise<Session[]> }
export interface MessageRepo { listBySession(sessionId: Id): Promise<Message[]> }
export interface InboxRepo { list(): Promise<InboxItem[]>; get(id: Id): Promise<InboxItem | null> }
export interface Repos { channels: ChannelRepo; sessions: SessionRepo; messages: MessageRepo; inbox: InboxRepo }
```
- Produces, in `src/core/ports/repos.contract.ts`: `export function runReposContract(name: string, makeRepos: () => Repos): void` — a Vitest `describe` block any adapter can run.

- [ ] **Step 1: Write the contract factory** in `repos.contract.ts`. It `describe`s and asserts, against `makeRepos()`: `channels.list()` returns a non-empty array; `channels.get(unknownId)` resolves `null`; `sessions.get(unknownId)` resolves `null`; `messages.listBySession(unknownId)` resolves `[]`; `inbox.list()` returns items and **every `inbox` item's `sessionId` resolves via `sessions.get` to a non-null session** (pins the keystone contract).

- [ ] **Step 2: Author the types and port interfaces** so the factory type-checks.

- [ ] **Step 3: Verify it compiles** — `bun run tsc --noEmit`. Expected: no errors. (The factory runs in Task 2 against a real adapter.)

- [ ] **Step 4: Commit** — `feat(core): domain types, repo ports, and contract test factory`.

---

### Task 2: In-memory mock adapters + fixtures

**Files:**
- Create: `src/adapters/mock/fixtures.ts`, `src/adapters/mock/mockRepos.ts`
- Test: `src/adapters/mock/mockRepos.contract.test.ts`

**Interfaces:**
- Consumes: `Repos` and all ports from Task 1; `runReposContract`.
- Produces: `export function createMockRepos(): Repos` returning in-memory repos over the fixtures. Fixtures include channels `General/Engineering/Marketing`, ≥1 session per channel, a believable multi-message thread per session, and inbox items whose `sessionId` each point at a real session.

- [ ] **Step 1: Write the failing test** — `mockRepos.contract.test.ts`:
```ts
runReposContract('mock', () => createMockRepos())
```

- [ ] **Step 2: Run to verify it fails** — `bun run test mockRepos.contract`. Expected: FAIL (`createMockRepos` undefined).

- [ ] **Step 3: Implement** `fixtures.ts` (typed to Task 1 entities) and `createMockRepos()` resolving against them with small `async`/`Promise.resolve` returns; unknown ids return `null`/`[]` per the contract.

- [ ] **Step 4: Run to verify it passes** — `bun run test mockRepos.contract`. Expected: PASS (all contract assertions, incl. inbox→session resolution).

- [ ] **Step 5: Commit** — `feat(adapters): in-memory mock repos and fixtures passing port contract`.

---

### Task 3: Design tokens, Tailwind theme, fonts

**Files:**
- Create: `src/ui/tokens.ts`, `src/ui/tokens.css`, `src/index.css` (imports tokens + Tailwind), font setup
- Modify: `vite.config.ts` (add `@tailwindcss/vite`)
- Test: `src/ui/tokens.test.ts`

**Interfaces:**
- Produces:
  - `src/ui/tokens.css` — CSS custom properties for every token in spec §6 (`--app`, `--ink`, `--primary`, `--helper-*`, radii, …) plus a Tailwind v4 `@theme` mapping.
  - `src/ui/tokens.ts` — `export const helperColor: Record<HelperArea, string>` and `export const radii`, typed, mirroring §6, for logic that needs a token value (e.g. an avatar ring color).
  - Fonts Inter / Bricolage Grotesque / IBM Plex Mono / Fraunces loaded (via `@fontsource/*` or CSS `@import`).

- [ ] **Step 1: Write the failing test** — `tokens.test.ts`:
```ts
test('helperColor maps every helper area to its spec hex', () => {
  expect(helperColor.brand).toBe('#6366F1')
  expect(helperColor.dev).toBe('#14B8A6')
  expect(helperColor.support).toBe('#EC4899')
})
```

- [ ] **Step 2: Run to verify it fails** — `bun run test tokens`. Expected: FAIL.

- [ ] **Step 3: Implement** `tokens.ts` (all eight areas), `tokens.css`, the `@theme` block, font imports, and wire `index.css`.

- [ ] **Step 4: Run to verify it passes** — `bun run test tokens`; also `bun run dev` and eyeball that the app bg is `--app #F5F5F4` and body font is Inter.

- [ ] **Step 5: Commit** — `feat(ui): design tokens, tailwind theme, and fonts from spec`.

---

### Task 4: App providers, Repos context, query hooks, UI store

**Files:**
- Create: `src/app/ReposProvider.tsx`, `src/app/queries.ts`, `src/app/store.ts`, `src/app/providers.tsx`
- Modify: `src/main.tsx`
- Test: `src/app/store.test.ts`, `src/app/queries.test.tsx`

**Interfaces:**
- Consumes: `Repos` (Task 1), `createMockRepos` (Task 2).
- Produces:
  - `ReposProvider` + `useRepos(): Repos` (React context; default value `createMockRepos()`), the only sanctioned path to data.
  - `src/app/queries.ts` hooks over `useRepos()` + TanStack Query: `useChannels()`, `useChannel(id)`, `useChannelSessions(channelId)`, `useSession(id)`, `useMessages(sessionId)`, `useInbox()`, `useInboxItem(id)`.
  - `src/app/store.ts` Zustand:
```ts
export type Mode = 'chat' | 'office'
export interface UIState {
  mode: Mode
  lastPath: Record<Mode, string>
  defaultPath: Record<Mode, string>   // { chat: '/chat', office: '/office/inbox' }
  rememberPath(mode: Mode, path: string): void
  toggleTarget(): { mode: Mode; path: string }  // flips mode, returns remembered-or-default path
}
```

- [ ] **Step 1: Write the failing store tests** — `store.test.ts`: toggling from `chat` returns `mode:'office'` and its `defaultPath` when office was never visited; after `rememberPath('office','/office/inbox/x')`, toggling to office returns that remembered path; toggling never returns a dead/empty path.

- [ ] **Step 2: Run to verify it fails** — `bun run test store`. Expected: FAIL.

- [ ] **Step 3: Implement** the Zustand store, `ReposProvider`/`useRepos`, `providers.tsx` (QueryClientProvider + ReposProvider), and the query hooks.

- [ ] **Step 4: Write & run a query-hook test** — `queries.test.tsx`: `useChannels()` wrapped in providers returns the mock channels; assert with `waitFor`. Run `bun run test app/`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(app): repos context, query hooks, and ui store with mode/last-path`.

---

### Task 5: App shell, left rail, and Chat↔Office toggle (with router)

**Files:**
- Create: `src/app/router.tsx`, `src/app/routes/*` (root + `chat`, `office` layout routes), `src/ui/Rail.tsx`, `src/app/Shell.tsx`
- Modify: `src/App.tsx` (render `RouterProvider`)
- Test: `src/ui/Rail.test.tsx`

**Interfaces:**
- Consumes: `useUIStore` (Task 4), router.
- Produces: `Shell` (rail + sidebar slot + main outlet); `Rail` with a company dot, static Team/gear/bell icon buttons, and a bottom mode toggle that on click calls `toggleTarget()`, navigates to the returned path, and reflects the active mode. Routes: `/chat`, `/chat/$channelId`, `/chat/$channelId/$sessionId`, `/office/inbox`, `/office/inbox/$itemId`.

- [ ] **Step 1: Write the failing test** — `Rail.test.tsx` (render within a test router + providers): the toggle shows the current mode; clicking it when office was never visited navigates to `/office/inbox` (Review Focus: mode toggle with no prior location); clicking back returns to the remembered chat path.

- [ ] **Step 2: Run to verify it fails** — `bun run test Rail`. Expected: FAIL.

- [ ] **Step 3: Implement** `router.tsx` (route tree + a `notFoundComponent` placeholder), `Shell`, `Rail`; a route `onLeave`/`loader` or effect calls `rememberPath(mode, location)` so the store tracks last path per mode.

- [ ] **Step 4: Run to verify it passes** — `bun run test Rail`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(app): shell, left rail, and chat/office mode toggle`.

---

### Task 6: Shared `<ChatSession/>` primitive + composer

**Files:**
- Create: `src/ui/ChatSession/ChatSession.tsx`, `src/ui/ChatSession/MessageList.tsx`, `src/ui/ChatSession/Composer.tsx`, `src/ui/ChatSession/ModelMenu.tsx`
- Test: `src/ui/ChatSession/ChatSession.test.tsx`

**Interfaces:**
- Consumes: `useSession`, `useMessages` (Task 4); `helperColor` (Task 3); Radix dropdown.
- Produces: `export function ChatSession({ sessionId }: { sessionId: Id })`. Renders the thread from `useMessages(sessionId)`, an empty placeholder when there are none, and a `Composer` whose `ModelMenu` (Radix dropdown) holds the selected `Model` in local state. Models come from a small static list in this component (backend-inert). `@mention` and thinking are visual affordances.

- [ ] **Step 1: Write the failing tests** — `ChatSession.test.tsx`: given a sessionId with messages, each message's content renders; given a session with no messages, an empty placeholder (`getByText(/no messages/i)` or test-id) renders and no crash (Review Focus: empty session); opening the model menu and selecting a model updates the trigger label; re-rendering `<ChatSession/>` with a *different* sessionId resets the selected model to default (Review Focus: model-selection scope).

- [ ] **Step 2: Run to verify it fails** — `bun run test ChatSession`. Expected: FAIL.

- [ ] **Step 3: Implement** `ChatSession`, `MessageList` (helper messages tinted via `helperColor[author.area]`), `Composer`, `ModelMenu`. Key the model's local state to `sessionId` (or reset on `sessionId` change) so selection doesn't bleed across sessions.

- [ ] **Step 4: Run to verify it passes** — `bun run test ChatSession`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(ui): shared ChatSession primitive with composer and model menu`.

---

### Task 7: Chat mode feature

**Files:**
- Create: `src/features/chat/ChannelSidebar.tsx`, `src/features/chat/ChatRoute.tsx` (binds `$channelId`/`$sessionId` routes)
- Test: `src/features/chat/ChatRoute.test.tsx`

**Interfaces:**
- Consumes: `useChannels`, `useChannel`, `useChannelSessions`, `useSession` (Task 4); `<ChatSession/>` (Task 6); router params.
- Produces: `ChannelSidebar` listing channels (active-area dot via `helperColor`); `ChatRoute` that, for `$channelId`, shows its sessions and, for `$sessionId`, renders `<ChatSession sessionId={...}/>`.

- [ ] **Step 1: Write the failing tests** — `ChatRoute.test.tsx` (test router + providers): the sidebar lists `General/Engineering/Marketing`; navigating to a channel+session renders that session's messages; navigating to a **different** channel's session swaps the thread so a message unique to the first session is gone (Review Focus: stale session on channel switch); navigating to an **unknown** `$channelId` shows a not-found panel, not a crash (Review Focus: unknown route id); a channel with no sessions shows an empty placeholder (Review Focus: empty states).

- [ ] **Step 2: Run to verify it fails** — `bun run test ChatRoute`. Expected: FAIL.

- [ ] **Step 3: Implement** `ChannelSidebar` and `ChatRoute`, wiring the route params to the query hooks and to `<ChatSession/>`; render the router `notFound` panel for unknown ids and an empty placeholder for empty session lists.

- [ ] **Step 4: Run to verify it passes** — `bun run test ChatRoute`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(chat): channel sidebar and session route over ChatSession`.

---

### Task 8: Office mode feature (company-wide Inbox)

**Files:**
- Create: `src/features/office/OfficeSidebar.tsx`, `src/features/office/InboxRoute.tsx`
- Test: `src/features/office/InboxRoute.test.tsx`

**Interfaces:**
- Consumes: `useInbox`, `useInboxItem` (Task 4); `<ChatSession/>` (Task 6); router params.
- Produces: `OfficeSidebar` with an Inbox nav entry; `InboxRoute` listing company-wide inbox items and, for `$itemId`, rendering `<ChatSession sessionId={item.sessionId}/>` — the **same** primitive Chat mode uses.

- [ ] **Step 1: Write the failing tests** — `InboxRoute.test.tsx`: the inbox lists the mock items; opening an item renders `<ChatSession/>` whose messages match that item's `sessionId` (proves one primitive serves both modes); an **unknown** `$itemId` shows a not-found panel (Review Focus: unknown route id); an empty inbox shows an empty placeholder (Review Focus: empty states).

- [ ] **Step 2: Run to verify it fails** — `bun run test InboxRoute`. Expected: FAIL.

- [ ] **Step 3: Implement** `OfficeSidebar` and `InboxRoute`, resolving `useInboxItem($itemId)` → `item.sessionId` → `<ChatSession/>`; not-found + empty placeholders as above.

- [ ] **Step 4: Run to verify it passes** — `bun run test InboxRoute`. Expected: PASS. Then `bun run dev` and click Chat↔Office end-to-end once.

- [ ] **Step 5: Commit** — `feat(office): company-wide inbox opening the shared ChatSession`.

---

### Task 9: Tauri dev shell

**Files:**
- Create: `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/build.rs`
- Modify: `package.json` (add `tauri` scripts)

**Interfaces:**
- Consumes: the Vite dev server / build output.
- Produces: `bun run tauri dev` opens the app in a native webview pointed at the Vite dev server; window titled "Omilo".

- [ ] **Step 1: Init** — `bun run tauri init`, setting `build.devUrl` to the Vite dev server and `build.frontendDist` to the Vite build dir; set the window title/size.

- [ ] **Step 2: Verify** — run `bun run tauri dev`; confirm the webview opens and the Chat↔Office flow works inside it. (Manual verification step — no unit test; this is a shell.)

- [ ] **Step 3: Commit** — `feat(desktop): tauri v2 dev shell running the vite app`.

---

## Notes for the executor

- Work tasks in order; each later task's Interfaces block names the exact symbols it consumes from earlier ones.
- Keep `core/` pure — if a test needs React, it belongs in `ui/`, `app/`, or a feature, not `core/`.
- Visual fidelity to `omilo-v2.pen` is checked by eye against the reference screens (`Chat · Session`, `Office · Inbox`, `OMILO V2 · 01 Design system`), read via the pen.dev MCP tools during implementation — not by pixel tests.
