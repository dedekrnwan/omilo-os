# P9 — Auth / Onboarding Gate + Real Session + Company Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a fresh HTTP-mode start gate through real authentication/onboarding instead of dropping straight into a fixture-populated app with two hardcoded demo companies — by wiring the already-built auth screens + backend to a real session, guarding the app routes, and sourcing the company switcher from the live `/me` companies.

**Architecture:** The backend auth is built (`POST /auth/sign-up`, `POST /auth/sign-in` → token + companies, `GET /me` → active company + companies). P9 adds (a) a tiny **public pre-auth config** endpoint exposing `OMILO_MODE` so the gate can branch, (b) a **switch-active-company** token re-issue endpoint, then on the frontend: a **session seam** (`useSession` store hydrated from `/me`, token lifecycle via `platform.tokenStorage`), a **route guard** on the shell, real **sign-in/sign-up/sign-out** mutations, a **company switcher** wired to live companies, and a wired **onboarding finish**. **Mock mode stays un-gated** (synthetic session) so the standalone design app is unchanged; only HTTP mode (`VITE_USE_HTTP=1`) enforces auth.

**Tech Stack:** React 19, Vite, TS (`tsc -b`), TanStack Query + Router, zustand, vitest; FastAPI + SQLAlchemy + Pydantic v2 (backend tasks). Builds on merged P0–P8 (`main`).

**Spec:** This plan is self-contained (no separate spec doc); the backend auth router `apps/api/omilo/auth/router.py` and the control-plane modes (`docs/technical/12-control-plane-runtime-split.md` §10: `local` = no account required; `hybrid`/`cloud` = cloud identity) are the authority it argues from.

## Global Constraints

- Branch off fresh `main`. **Every task gates on BOTH `npx vitest run` AND `npx tsc -b --force` (exit 0)**; backend tasks also gate on `cd apps/api && pytest`. Stale LS "cannot find module" diagnostics are false — trust `tsc -b --force`.
- **Mock mode is never gated.** When `VITE_USE_HTTP !== '1'`, the session is a synthetic always-authed demo session and the guard is a no-op — the standalone app (default) renders exactly as today. Only HTTP mode enforces real auth. Any test that renders a gated route must pick the mode explicitly.
- **No secrets in client code.** Tokens live only in `platform.tokenStorage` (localStorage `omilo_token`); never logged.
- Types are camelCase; HTTP adapters map snake↔camel at the boundary using the exact field names from `apps/api/omilo/auth/router.py` (`SignInResponse`, `MeResponse`, `CompanyOut {id,name,industry,team_size,region,currency,pic_role}`, `session.access`, `session.expires_at`).
- **Mode-aware gate:** `local` → first-run onboarding (NO cloud login); `hybrid`/`cloud` → sign-in/sign-up. The gate reads the mode from the public-config endpoint (T1).
- Behavior-preserving for already-live surfaces: P8/P5d data wiring is untouched; P9 only adds the gate + session + switcher.

## Review Focus

- **Mock-mode regression:** the default (mock) app must still boot straight into `/inbox` with no auth screen — a guard that fires in mock mode breaks every existing route/smoke test. (T4 tests render a mock-mode route and assert no redirect.)
- **Token-expiry / invalid-token boot:** HTTP mode with a stale or malformed `omilo_token` must redirect to sign-in, not white-screen on a thrown `/me` 401. (T3 hydration maps 401→anon; T4 redirects anon.)
- **Pre-auth endpoints must not require a token:** sign-in/sign-up/public-config calls must use a tokenless fetch — attaching a (missing/invalid) Bearer must not 401 the login itself. (T3 auth adapter uses bare fetch for these three.)
- **Switch-company authorization:** `POST /auth/switch-company` must reject a company the user is not a member of (403), never issue a token for it. (T2 test: non-member → 403.)
- **Deep-link after login:** signing in on a guarded deep link (e.g. `/goals`) should land there, not always `/inbox` — or, if deferred, redirect to home deterministically. (T4 test pins the chosen behavior.)

---

### Task 1: Public pre-auth config endpoint (backend) — FOUNDATION for the gate

**Files:** Create `apps/api/omilo/api/public_config.py`; modify the app router registration (`apps/api/omilo/api/__init__.py` or wherever routers are included); Test `apps/api/tests/test_public_config.py`.

**Interfaces — Produces:** `GET /v1/public-config` (NO auth dependency) → `{ "mode": "local"|"hybrid"|"cloud", "signupEnabled": bool }`. `mode` from `_normalize_mode(settings.omilo_mode)` (reuse `omilo.control.factory._normalize_mode`, same as `telemetry_config.py:84`). `signupEnabled` = `mode != "cloud"` for now (cloud self-serve signup gated later) — or `True` if a simpler default is preferred; pick one and pin it in the test.

- [ ] **Step 1: Write the failing test** — `test_public_config.py`: `GET /v1/public-config` with NO Authorization header returns 200 and `{mode, signupEnabled}`; assert `mode` equals the normalized `OMILO_MODE` for a `local` and a `cloud` app config; assert the route is NOT behind `get_context` (no 401 without a token).
- [ ] **Step 2: Run `pytest tests/test_public_config.py` → fail.**
- [ ] **Step 3: Implement** the router (mirror `telemetry_config.py` minus the auth dependency) and register it.
- [ ] **Step 4: `pytest tests/test_public_config.py` + full `pytest` green; `tsc` unaffected.** Commit.

### Task 2: Switch-active-company endpoint (backend)

**Files:** Modify `apps/api/omilo/auth/router.py` (add route + request/response models); Test `apps/api/tests/test_auth_switch_company.py`.

**Interfaces — Produces:** `POST /auth/switch-company {companyId: str}` (Bearer required) → `SignInResponse`-shaped `{user, session:{access,expires_at}, companies}`. Verifies the authed user has a `Member` row for `companyId`; if not → 403. Re-issues a token via `make_access_token(user.id, companyId, member.role)` (same helper `sign_in` uses). camelCase in, snake stays internal.

- [ ] **Step 1: Write the failing test** — member of 2 companies switches → new token's `cmp` claim is the target; a non-member company → 403; unknown company → 404.
- [ ] **Step 2: Run the test → fail.**
- [ ] **Step 3: Implement** `switch_company`.
- [ ] **Step 4: Targeted + full `pytest` green.** Commit. *(If backend scope must shrink, this task may be deferred — note it; T6 then shows companies without active-switch. Rule on it before T6.)*

### Task 3: Frontend session seam (auth adapter + useSession + token lifecycle) — FOUNDATION

**Files:** Create `src/core/domain/session.ts` (types), `src/adapters/http/auth.ts` (auth adapter), `src/app/session.ts` (zustand `useSession`), `src/app/SessionProvider.tsx`; modify `src/app/providers.tsx` to mount the provider; Tests `src/adapters/http/auth.test.ts`, `src/app/session.test.tsx`.

**Interfaces — Produces:**
- `interface SessionUser {{ id; email; name }}`, `interface Company {{ id; name; industry?; teamSize?; region?; currency; picRole? }}` (camelCase; reuse/extend any existing `Company` type — confirm no clash with `src/app/companies.ts`'s `CompanyRecord`, which T6 removes).
- `createAuthAdapter(baseUrl, {{getToken,setToken,clearToken}})`: `signIn(email,password): Promise<SignInResult>` (bare fetch, no Bearer) `POST /auth/sign-in`; `signUp(name,email,password): Promise<SignUpResult>` `POST /auth/sign-up`; `me(): Promise<MeResult>` (Bearer) `GET /me`; `switchCompany(companyId): Promise<SignInResult>` (Bearer) `POST /auth/switch-company`; `publicConfig(): Promise<{{mode,signupEnabled}}>` (bare) `GET /v1/public-config`. On sign-in/sign-up/switch success, persist `session.access` via `setToken`. Map snake→camel.
- `useSession` store: `{{ status: 'loading'|'authed'|'anon', user: SessionUser|null, company: Company|null, companies: Company[], mode: string|null, hydrate(): Promise<void>, applySignIn(result), signOut(): void }}`. `hydrate()`: HTTP mode → fetch public-config (set mode) then, if a token exists, `me()` → authed (401/clear → anon); no token → anon. **Mock mode → synthetic authed demo session** (`status:'authed'`, a demo user + one demo company, `mode:'local'`), no network.
- `SessionProvider`: calls `hydrate()` on mount; renders children once `status !== 'loading'` (or a splash while loading).

- [ ] **Step 1: Write failing tests** — `auth.test.ts`: signIn posts `/auth/sign-in` with NO Authorization header and returns camelCase `{user,companies,token}`, and calls `setToken(access)`; me() sends Bearer and maps `MeResponse`; a 401 from me() rejects with a recognizable error. `session.test.tsx`: mock mode → `hydrate()` yields `status:'authed'` with the demo session and makes no fetch; HTTP mode + no token → `anon`; HTTP mode + token + stubbed `/me` → `authed` with company+companies; HTTP mode + token + `/me` 401 → `anon` and token cleared.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the adapter, store, provider (reuse `platform.tokenStorage`; use a fake fetch/transport in tests — no real network).
- [ ] **Step 4: `npx vitest run` + `npx tsc -b --force` green.** Commit. **(Merge before T4+ fan out.)**

### Task 4: Route guard (gate the shell in HTTP mode, mode-aware) — depends on T1+T3

**Files:** Modify `src/app/router.tsx` (shell/root guard), create `src/app/AuthGate.tsx` if a component guard is cleaner than `beforeLoad`; Test `src/app/authGate.test.tsx`.

**Interfaces — Consumes:** `useSession` (status, mode) from T3. **Produces:** in HTTP mode, when `status==='anon'`, redirect: `mode==='local'` → `/onboarding`; else → `/auth/sign-in`. `status==='authed'` → render app. Mock mode → always render (no redirect). Keep `/auth/*` and `/onboarding` reachable while anon (they must NOT be guarded). Preserve the attempted path for post-login return if feasible (else redirect to `MODE_HOME` deterministically — pin whichever in the test).

- [ ] **Step 1: Write failing tests** — mock mode: rendering `/inbox` shows the app, NO redirect to `/auth` (guards the Review-Focus regression). HTTP mode + anon + `mode='hybrid'` → redirect `/auth/sign-in`; `mode='local'` → `/onboarding`. HTTP mode + authed → app renders. `/auth/sign-in` renders while anon (not a redirect loop).
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** the guard.
- [ ] **Step 4: vitest + `tsc -b --force` green; existing route/smoke tests still pass (mock).** Commit `feat/p9-guard`.

### Task 5: Wire sign-in / sign-up / sign-out to the real session — depends on T3

**Files:** Modify `src/features/auth/SignInPage.tsx`, `SignUpPage.tsx` (+ the `AuthButton`/form primitives as needed), and the sign-out control (Rail/SectionAccount); Test `src/features/auth/authFlow.test.tsx`.

**Interfaces — Consumes:** `useSession.applySignIn`, the auth adapter (via a hook `useAuth()` or the Commands port), `useNavigate`. **Produces:** SignInPage submit → `signIn(email,password)` → on success `applySignIn` + navigate into app (`MODE_HOME`); on 401 show an inline error. SignUpPage submit → `signUp` → token stored → navigate to `/onboarding` (local) or next step. Sign-out → `useSession.signOut()` (clear token+state) → navigate `/auth/sign-in`. Replace the navigate-only `<AuthButton to=…>` wiring on the primary submit; keep the visual design identical.

- [ ] **Step 1: Write failing tests** — sign-in with good creds (stubbed adapter) stores token, sets session authed, navigates to home; bad creds → inline error, stays on page, no token; sign-out clears token + returns to sign-in.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: vitest + `tsc -b --force` green.** Commit `feat/p9-authflow`.

### Task 6: Company switcher from live companies (remove the fixture) — depends on T3 (+T2 for switching)

**Files:** Modify `src/ui/Rail.tsx` (consume session companies); delete/retire `src/app/companies.ts` (or keep only as the mock-session's demo data); Test `src/ui/railCompanies.test.tsx`.

**Interfaces — Consumes:** `useSession` (`companies`, `company`, `switchCompany`), the auth adapter's `switchCompany`. **Produces:** Rail maps `session.companies` (not `COMPANIES`), highlights `session.company.id` as active, and on tile click calls `switchCompany(id)` (re-hydrates session + invalidates React Query so data reloads for the new company). The hardcoded two-company fixture no longer drives the live Rail. In mock mode the synthetic session supplies one demo company (so the Rail still renders standalone).

- [ ] **Step 1: Write failing test** — with a session of 2 companies the Rail renders both by live name and marks the active one; clicking the inactive tile calls `switchCompany` with its id. Grep proves `COMPANIES` from `src/app/companies.ts` is gone from `Rail.tsx`.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement.** (If T2 deferred: render companies live but make switching a no-op/disabled with a NOTE — do not invent a token re-issue client-side.)
- [ ] **Step 4: vitest + `tsc -b --force` green.** Commit `feat/p9-switcher`.

### Task 7: Wire onboarding finish (local first-run) — depends on T3

**Files:** Modify `src/features/onboarding/OnboardingRoute.tsx` + the final step(s) (`StepProfile`/`StepInbox`); Test `src/features/onboarding/onboardingFinish.test.tsx`.

**Interfaces — Consumes:** `useSession`, the Commands port (`PATCH /v1/company` already exists for profile; BYO key via the existing AI-keys command/endpoint — confirm the verb, else NOTE). **Produces:** completing onboarding persists the collected company profile (industry/region/pic_role) via `PATCH /v1/company`, marks the session onboarded (a `company`-level flag or client `onboardedAt` in the store if no backend field — NOTE which), and enters the app (`MODE_HOME`). Sign-up already created the Company, so onboarding configures it; it does NOT create a second company. Keep the wizard UI/steps identical; only wire the finish + any profile persistence.

- [ ] **Step 1: Write failing test** — finishing onboarding (stubbed commands) calls `PATCH /v1/company` with the entered profile and navigates into the app; a user who is already onboarded is not forced back through the wizard.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** (wire what the backend supports; NOTE any collected field with no endpoint rather than inventing one).
- [ ] **Step 4: vitest + `tsc -b --force` green.** Commit `feat/p9-onboarding`.

---

## Self-Review notes (author)

- **Coverage:** the three gaps diagnosed — hardcoded company switcher (T6), no auth gate (T4), navigate-only auth/onboarding (T5/T7) — each get a task; the two backend prerequisites (public mode config T1, switch-company T2) precede them.
- **Mock-mode safety is the highest risk** (it would break every existing test) → it's the first Review-Focus item and is pinned by explicit mock-mode tests in T3 (synthetic session) and T4 (no redirect).
- **Dependencies:** T1 + T3 are foundations and merge before the rest. T4/T5/T6/T7 depend on T3 and touch mostly disjoint dirs (`router/AuthGate` vs `features/auth` vs `ui/Rail` vs `features/onboarding`) → parallelizable in worktrees, with T6 also wanting T2. Order backend T1→T2, then T3, then fan out T4–T7.
- **Backend is nearly ready:** only two small additive endpoints; existing sign-in/sign-up/me are reused as-is.
- **Proportion:** 2 small backend + 1 foundation + 4 frontend wiring tasks; the sharpest tests are mock-no-gate, invalid-token→anon, pre-auth-tokenless, switch-company-403, and fixture-gone-from-Rail.
