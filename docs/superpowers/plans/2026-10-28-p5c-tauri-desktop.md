# P5c — Tauri Desktop Native Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make omilo-v2 a native macOS desktop app via its existing Tauri shell — secure token storage in the macOS Keychain (not localStorage), `omilo://` deep links, and native notifications — behind a single platform seam so the same `src/` runs identically as web (mock/localStorage default) and desktop.

**Architecture:** A thin Tauri shell wraps the built SPA. All platform-specific behavior lives behind ONE frontend seam (`src/platform/`): a `Platform` with `tokenStorage`, `notifications`, and `deepLinks` services, chosen by `isTauri()` at startup — a web impl (localStorage / Web Notification / in-app routing) and a Tauri impl (Rust IPC `invoke` / plugin). The Rust side (`src-tauri/`) adds a keychain-backed token broker (get/set/clear commands via the `keyring` crate), the deep-link + notification plugins, and `tauri.conf.json` bundle/scheme config. The backend is unchanged; desktop is a superior client, not a local backend (per docs/technical/10).

**Tech Stack:** Tauri 2 (Rust 1.99, tauri-cli 2.12), `keyring` crate (OS keychain), tauri-plugin-deep-link, tauri-plugin-notification, @tauri-apps/api (JS). Frontend React 19/TS/Vite (vitest + `tsc -b`). Builds on merged P0–P5d (`main @ 4020d26`).

**Spec:** docs/technical/10-tauri-desktop.md (the complete desktop spec: keychain, `omilo://`, native notifications, local-MCP bridge, auto-update, macOS-only v1).

## Global Constraints

- Builds on merged P0–P5d; branch off fresh `main` (`4020d26`). The web app stays the DEFAULT and must keep working unchanged (frontend 373 vitest + `tsc -b` clean) — desktop is additive.
- **Frontend tasks gate on BOTH `npx vitest run` AND `npx tsc -b --force` (exit 0).** The Rust task gates on **`cargo check`** (from `src-tauri/`, exit 0) — note the FIRST cargo build compiles all Tauri deps and can take several minutes; that's expected, let it finish.
- **One platform seam, no scattered `isTauri()` checks.** All platform branching goes through `src/platform/` (`platform.tokenStorage`, `platform.notifications`, `platform.deepLinks`). The existing ~8 inline `localStorage.getItem('omilo_token')` call sites (ReposProvider.tsx:9, client.ts, chatSocket.ts:58, ChatSession.tsx:271, CreateChannelDialog.tsx:24, SectionConnectors.tsx:19, SectionMcpTokens.tsx:26, StepProfile.tsx:19) are refactored to read through the seam.
- Token storage interface is ASYNC (`getToken(): Promise<string|null>`) because the Tauri keychain read is async — but the web impl must stay synchronous-fast and existing synchronous `getToken: () => string|null` consumers (apiFetch, chatSocket) must keep working. Resolve this: keep a synchronous cached accessor for the hot path (apiFetch/WS) hydrated at startup from the async source, OR adapt consumers — pick the approach that does NOT break the existing sync call sites or their tests. Document the choice.
- Desktop ships macOS v1 only (Windows out of scope — a config change later, not a rewrite). Real code-signing + notarization + the auto-update feed need Apple certs + CI and are OUT of scope here — T3 configures them and documents the steps; it does not produce a signed release. The **local-MCP bridge** (doc 10 §5) is explicitly OUT of scope for P5c (optional, substantial tunnel work) — noted as a follow-up.
- Keep the Rust minimal and idiomatic; mirror the existing `src-tauri/src/lib.rs` builder style. Secrets: the keychain service/account names are fixed constants; never log token values.

## Review Focus

- **Web app unchanged when Tauri absent:** with `window.__TAURI__` undefined (normal web/test), `isTauri()` is false, the web platform is selected, token reads hit localStorage, and NO `@tauri-apps/api` `invoke` is called (importing it must not throw at module load in a browser). Test: in jsdom (no __TAURI__), the seam resolves to web and existing flows work. (T1)
- **Token seam parity:** every refactored call site still gets the token it used to get from localStorage under web; a wrong/empty token from the seam would break every authed request + the WS. Test: the seam's web impl returns the same value `localStorage.getItem('omilo_token')` did; set/clear round-trip. (T1)
- **Deep-link parsing is safe:** an `omilo://` URL with an unexpected/malformed host/path must be parsed without throwing and routed to a safe default (not a crash, not an open-redirect into an arbitrary external URL). Test: malformed `omilo://` → no throw, safe no-op/default route. (T1)
- **Rust compiles with all plugins + commands:** `cargo check` from `src-tauri/` is exit 0 with the keychain/deep-link/notification plugins and the get/set/clear_token commands registered in the builder. (T2)
- **Config validity:** `tauri.conf.json` remains valid (parses; `tauri` CLI accepts it) with `bundle.active=true`, the `omilo` deep-link scheme, and the macOS bundle section — a malformed config breaks every desktop build. (T3)

---

### Task 1: Frontend platform seam (token storage + notifications + deep links) + refactor call sites

**Files:**
- Create: `src/platform/index.ts` (the `Platform` type + `isTauri()` + `platform` singleton), `src/platform/web.ts` (web impl), `src/platform/tauri.ts` (Tauri impl, lazy)
- Modify: `src/app/ReposProvider.tsx`, `src/adapters/http/client.ts`, `src/adapters/http/chatSocket.ts`, `src/ui/ChatSession/ChatSession.tsx`, `src/features/chat/CreateChannelDialog.tsx`, `src/features/control-panel/sections/SectionConnectors.tsx`, `src/features/control-panel/sections/SectionMcpTokens.tsx`, `src/features/onboarding/StepProfile.tsx`, `src/app/push.ts`
- Modify: `package.json` (add `@tauri-apps/api` dependency)
- Test: `src/platform/platform.test.ts` (+ update any affected call-site tests)

**Interfaces:**
- Produces:
  - `isTauri(): boolean` → `typeof window !== 'undefined' && '__TAURI__' in window` (or `'__TAURI_INTERNALS__'`) — safe in jsdom.
  - `interface TokenStorage { getToken(): string | null; getTokenAsync(): Promise<string | null>; setToken(t: string): Promise<void>; clearToken(): Promise<void> }` — `getToken()` is the SYNC hot-path accessor (reads an in-memory cache; the web impl backs the cache with localStorage synchronously; the Tauri impl returns the last-hydrated cached value and `hydrate()` fills it from the keychain at startup). `getTokenAsync()` is the source of truth. (Pick the exact cache shape so apiFetch/chatSocket's existing `getToken: () => string|null` keep working unchanged.)
  - `interface NotificationService { send(title: string, body?: string): Promise<void>; setBadge(count: number): Promise<void> }` — web: `new Notification(...)` when permitted (guarded, no throw if denied); Tauri: plugin.
  - `interface DeepLinkService { parse(url: string): { route: string; params: Record<string,string> } | null; onOpen(cb: (parsed) => void): () => void }` — `parse` is a PURE, throw-safe parser for `omilo://<host>/<path>?<query>` → a safe internal route (map known hosts e.g. `approve`, `auth`, `inbox`; unknown → null). Tauri wires `onOpen` to the deep-link plugin; web is a no-op `onOpen`.
  - `const platform: Platform = isTauri() ? createTauriPlatform() : createWebPlatform()` (the Tauri module's `invoke` import is dynamic/lazy so a web bundle never evaluates it).
- Consumes: `@tauri-apps/api` (`invoke`, the deep-link/notification plugin JS bindings) — ONLY inside `src/platform/tauri.ts`, lazily.
- Refactor: replace the inline `localStorage.getItem('omilo_token')` reads with `platform.tokenStorage.getToken()`; `push.ts` notification path → `platform.notifications`. Keep each call site's existing behavior under web.

- [ ] **Step 1: Write failing tests** — `platform.test.ts`: in jsdom (no `__TAURI__`) `isTauri()` is false and `platform` is the web impl; `tokenStorage.getToken()` returns what `localStorage.getItem('omilo_token')` holds; `setToken`/`clearToken` round-trip; importing the module does NOT call any Tauri `invoke` (stub/spy it to assert zero calls). `deepLinks.parse('omilo://approve/prop_123')` → a safe route object; `parse('omilo://%%bad')` / unknown host → null (no throw). A notification `send` when permission denied does not throw.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the seam (web + lazy Tauri impls) + refactor the call sites + add `@tauri-apps/api`.
- [ ] **Step 4: `npx vitest run` → pass (≥373); `npx tsc -b --force` → exit 0. Confirm existing ChatSession/section/onboarding tests still pass (the token-read refactor must be behavior-preserving under web).**
- [ ] **Step 5: Commit.**

### Task 2: Rust — keychain token broker + deep-link + notification plugins

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `keyring`, `tauri-plugin-deep-link`, `tauri-plugin-notification`)
- Modify: `src-tauri/src/lib.rs` (register plugins + the three commands)
- Create: `src-tauri/src/token.rs` (the keychain commands) — or inline in lib.rs if small
- Modify: `src-tauri/capabilities/default.json` if present (permit the new plugins/commands) — check what the Tauri 2 skeleton uses for capabilities/permissions and grant the minimum.

**Interfaces:**
- Produces three Tauri commands (invoked from `src/platform/tauri.ts`):
  - `#[tauri::command] fn get_token() -> Option<String>` — read from the OS keychain (`keyring::Entry::new("omilo", "auth_token")`), return None if absent/not-found (never panic).
  - `#[tauri::command] fn set_token(token: String) -> Result<(), String>` — store in the keychain; map errors to a string.
  - `#[tauri::command] fn clear_token() -> Result<(), String>` — delete the keychain entry (treat not-found as success).
  - The builder registers `tauri_plugin_deep_link` + `tauri_plugin_notification` + `.invoke_handler(tauri::generate_handler![get_token, set_token, clear_token])`, keeping the existing `tauri_plugin_shell`.
- Fixed constants: keychain service `"omilo"`, account/key `"auth_token"`. Never log the token.

- [ ] **Step 1: Add deps + write the commands + register them** (there is no Rust unit-test harness here; the gate is a clean compile + the commands existing and registered).
- [ ] **Step 2: `cd src-tauri && cargo check`** → exit 0 (FIRST run compiles all Tauri deps — may take several minutes; let it finish). Fix any compile errors until clean.
- [ ] **Step 3: Verify** the three commands are in the `generate_handler!` macro and the plugins are `.plugin(...)`-registered in `lib.rs` (grep). Confirm no token value is logged.
- [ ] **Step 4: Commit.**

### Task 3: tauri.conf.json — bundle, `omilo://` scheme, updater config + signing/notarization docs

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Create: `docs/technical/10a-desktop-release.md` (the signing/notarization/release runbook — documentation, since certs aren't available here)
- Modify: `package.json` scripts (add `"tauri:dev"` / `"tauri:build"` convenience scripts)

**Interfaces:**
- Produces: `tauri.conf.json` with `bundle.active=true`; a macOS bundle section (`identifier` e.g. `app.omilo.desktop`, `category`, `minimumSystemVersion`); the deep-link scheme registered (the Tauri 2 way — a `plugins.deep-link` `desktop.schemes: ["omilo"]` entry and/or the bundle `macOS` URL scheme); an `updater` block (active, `endpoints` placeholder + a `pubkey` placeholder, clearly marked TODO — no real key committed). `10a-desktop-release.md` documents: generating the updater keypair, Apple Developer signing identity + notarization (`xcrun notarytool`), the `tauri build` → dmg flow, and the version-parity rule. Convenience npm scripts for dev/build.

- [ ] **Step 1: Edit `tauri.conf.json`** — enable bundle, add the macOS section, the `omilo` scheme, and the updater placeholder block. Keep it valid JSON.
- [ ] **Step 2: Validate** the config parses — run `npx tauri --help`/`npx tauri build --help` won't validate the conf, so run a quick parse check (e.g. `node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8'))"`) AND, if feasible within time, `cd src-tauri && cargo check` still passes (config is read by tauri-build). If a full `tauri build` is attempted it will fail at the SIGNING step for lack of certs — that is expected; capture that the config/compile is sound up to signing.
- [ ] **Step 3: Write `10a-desktop-release.md`** (the runbook) and the npm scripts.
- [ ] **Step 4: Commit.**

---

## Self-Review notes (author)

- **Spec coverage (doc 10):** keychain token storage → T1 seam + T2 Rust broker; `omilo://` deep links → T1 parser + T2 plugin + T3 scheme; native notifications → T1 `NotificationService` + T2 plugin; auto-update + signing → T3 config + runbook (not executed — no certs). Explicitly DEFERRED: the local-MCP bridge (doc 10 §5, optional) and the actual signed/notarized release (needs Apple certs + CI) — both documented, not built.
- **The seam is the point:** one `src/platform/` boundary means the web app is provably unchanged (Review Focus #1/#2) and desktop behavior is isolated + testable without a running Tauri app. The sync-vs-async token read is the one real design hazard — the plan pins a cached sync accessor so the existing `getToken: () => string|null` consumers (apiFetch, WS) don't break.
- **Verification reality:** T1 is fully vitest/tsc-gated; T2 is cargo-check-gated (real compile); T3 is config-validity + runbook. No task claims a signed build. This keeps every task honestly verifiable in this environment.
- **Safety:** deep-link parsing is throw-safe and allow-lists known hosts (no open-redirect); keychain names are fixed constants; token values are never logged (T2).
- **Proportion:** 3 tasks — the frontend seam (the bulk + all the tests), the Rust broker/plugins (compile-gated), and the config/runbook. Small and focused; the heavy native-release machinery is correctly left as a documented follow-up.
