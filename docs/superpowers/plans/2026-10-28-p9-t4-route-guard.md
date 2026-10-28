# P9 T4 — Route Guard (auth gate, mode-aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the app shell's `<Outlet />` behind `AuthGate`, redirecting anonymous HTTP-mode users to `/auth/sign-in` (hybrid/cloud) or `/onboarding` (local), while being a complete no-op in mock mode.

**Architecture:** A single `AuthGate` component wraps `<Outlet />` inside `Shell.tsx`. It reads `useSession` reactively: in mock mode it always renders children (isMockMode() short-circuit); in HTTP mode + `status==='anon'` it issues a TanStack Router `<Navigate>` based on `mode`; `status==='authed'` renders children. Auth/onboarding routes live outside the shell (off root) so they are never wrapped and cannot loop. Deep-link preservation is deferred (T5 navigates to home post-login); redirect is deterministic.

**Tech Stack:** React 19, Vite, TS, TanStack Router (`Navigate`), zustand (`useSession`), vitest + @testing-library/react.

**Spec:** P9 plan `docs/superpowers/plans/2026-10-28-p9-auth-onboarding-gate.md` T4 section; Wave 2 task description in the user message.

## Global Constraints

- Touch ONLY: `src/app/router.tsx`, `src/app/Shell.tsx`, new `src/app/AuthGate.tsx`, new `src/app/authGate.test.tsx`.
- Do NOT touch `src/features/**` or `src/ui/Rail.tsx`.
- Both gates must exit 0: `npx vitest run` (all 527 baseline + new tests) AND `npx tsc -b --force`.
- Mock mode is always a no-op (VITE_USE_HTTP !== '1' or store always-authed; both guard against redirect).
- `/auth/*` and `/onboarding` are outside shellRoute — AuthGate is never applied to them.

## Review Focus

- **Mock-mode regression:** AuthGate must not redirect in mock mode. Covered by test (a).
- **Redirect loop:** anon on /auth/sign-in must render sign-in, not loop. Covered by placing AuthGate only inside shellRoute.
- **Authed renders content:** HTTP mode + authed must render children normally. Covered by test (d).
- **mode=local redirect target:** anon + mode='local' → /onboarding, not /auth/sign-in. Covered by test (c).
- **mode=hybrid/cloud redirect target:** anon + mode='hybrid' → /auth/sign-in. Covered by test (b).

---

### Task 1: AuthGate component + Shell integration

**Files:**
- Create: `src/app/AuthGate.tsx`
- Modify: `src/app/Shell.tsx` (wrap `<Outlet />` with `<AuthGate>`)

**Interfaces:**
- Consumes: `useSession` from `./session`, `isMockMode` from `./useAuth`, `Navigate` from `@tanstack/react-router`
- Produces: `export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement`

- [ ] **Step 1: Implement `AuthGate` in `src/app/AuthGate.tsx`**

  Logic:
  - Call `isMockMode()` — if true, return `<>{children}</>` immediately.
  - Read `status` and `mode` from `useSession`.
  - If `status === 'anon'`: return `<Navigate to={mode === 'local' ? '/onboarding' : '/auth/sign-in'} />`.
  - Otherwise (`status === 'authed'`): return `<>{children}</>`.
  - `status === 'loading'` cannot reach here (SessionProvider blocks render until resolved) but treat as "render children" as a safe fallback.

- [ ] **Step 2: Wrap `<Outlet />` in `Shell.tsx`**

  In `Shell.tsx`, replace `<Outlet />` with `<AuthGate><Outlet /></AuthGate>`. Import `AuthGate` from `./AuthGate`.

- [ ] **Step 3: Run `npx tsc -b --force`**

  Expected: exit 0.

- [ ] **Step 4: Commit scaffolding**

```bash
git add src/app/AuthGate.tsx src/app/Shell.tsx
git commit -m "feat(auth): AuthGate component — mode-aware shell guard"
```

### Task 2: authGate.test.tsx — four cases

**Files:**
- Create: `src/app/authGate.test.tsx`

**Interfaces:**
- Consumes: `useSession` (store), `_overrideAdapter`, `_overrideTokenStorage` (from `./session`), `vi.stubEnv`, TanStack Router test harness (same pattern as `routeSmoke.test.tsx`), `Shell` from `./Shell`, `AuthGate` from `./AuthGate`.

- [ ] **Step 1: Write test (a) — mock mode, app route renders content**

  Pattern: same as `routeSmoke.test.tsx` `makeRoot()`. Build a router with shellRoute (component: Shell) → child route at `/inbox` that renders `<div data-testid="inbox-content">inbox</div>`. Don't stub VITE_USE_HTTP (default = mock mode). Assert `screen.getByTestId('inbox-content')` is present; assert `screen.queryByText('sign-in')` or navigation to `/auth/sign-in` did NOT happen.

- [ ] **Step 2: Write test (b) — HTTP mode + anon + mode='hybrid' → redirect to /auth/sign-in**

  `vi.stubEnv('VITE_USE_HTTP', '1')`. Reset modules + fresh session import. Set store state: `{ status: 'anon', mode: 'hybrid' }`. Build router same as (a) but with `/auth/sign-in` route also registered (renders `<div data-testid="sign-in-page" />`). Navigate to `/inbox`. Assert `screen.getByTestId('sign-in-page')` is present.

- [ ] **Step 3: Write test (c) — HTTP mode + anon + mode='local' → redirect to /onboarding**

  Same as (b) but `mode: 'local'`. Register `/onboarding` route rendering `<div data-testid="onboarding-page" />`. Assert `screen.getByTestId('onboarding-page')` is present.

- [ ] **Step 4: Write test (d) — HTTP mode + authed → renders app content**

  `vi.stubEnv('VITE_USE_HTTP', '1')`. Set store state: `{ status: 'authed', mode: 'cloud' }`. Navigate to `/inbox`. Assert `screen.getByTestId('inbox-content')` is present.

- [ ] **Step 5: Run `npx vitest run src/app/authGate.test.tsx`**

  Expected: 4 passing.

- [ ] **Step 6: Run full suite `npx vitest run`**

  Expected: ≥531 passing (527 baseline + 4 new), 0 failing.

- [ ] **Step 7: Run `npx tsc -b --force`**

  Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/authGate.test.tsx
git commit -m "test(auth): AuthGate — mock no-op, anon redirect, authed renders"
```
