# P8 — Frontend Full Integration (wire the remaining surfaces to the live backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish wiring the frontend to the live backend so no screen shows hardcoded fixtures in HTTP mode. P5d wired chat/channels/goals/sessions/inbox/connections/tokens/usage/billing; P8 wires the rest — **Flows, Routines, Docs/Knowledge, Analytics, Skills, Team/Helpers, Members** — through the `Repos`/`Commands` port, against backend endpoints that ALREADY EXIST.

**Architecture:** The backend endpoints exist (`/flows`, `/routines`, `/analytics`, `/goals`, `/helpers`, `/knowledge`, `/skills`, `/memory`). P8 is a FRONTEND-only wiring effort in two stages: (T1) extend the shared data seam — domain types + `Repos` read port + `httpRepos` + `mockRepos` fixtures + React Query hooks + `Commands` writes — for all the new surfaces; then (T2…T6, PARALLEL) refactor each disjoint page-group off its local `data.ts` fixtures onto the port. Mock stays the default (app runs standalone); HTTP mode (`VITE_USE_HTTP=1`, now the `make dev` default) goes fully live.

**Tech Stack:** React 19, Vite, TS (`tsc -b`), TanStack Query + Router, vitest. Builds on merged P0–P7 (`main`). Mirrors the P5d wiring pattern exactly.

## Global Constraints

- Branch off fresh `main`. Backend untouched (its 783 suite stays green). **Every task gates on BOTH `npx vitest run` AND `npx tsc -b --force` (exit 0).** Stale LS "cannot find module" diagnostics are false — trust `tsc -b --force`.
- **Port discipline (the whole point):** every surface goes through `Repos` (reads) + `Commands` (writes) with BOTH an `httpRepos`/http-commands impl AND a `mockRepos`/mock impl kept at parity via the shared contract test. Pages call `useRepos()`/query hooks — NEVER a local `data.ts` fixture and NEVER raw `fetch`/`apiFetch`. The mock impls keep the app fully functional in mock mode (the default).
- Types are camelCase; `httpRepos` maps snake↔camel at the boundary (exact backend field names from the real routers under `apps/api/omilo/api/` + `apps/api/omilo/flows/`). Reuse the P5d patterns (client.ts `apiFetch`, the `createCommands` factory, `src/app/queries.ts` hook style).
- Behavior-preserving UI: the pages look/behave the same; only their data SOURCE changes (fixtures → port). Keep the existing components; swap the data wiring. Empty + error states on every newly-wired list (no blank screen / thrown render).
- Parallel safety: T1 (the shared seam) lands FIRST and merges; T2…T6 then run in parallel in isolated worktrees, each touching a DISJOINT feature dir (no two touch the same file).

## Review Focus

- **No fixture left in the wired path:** after each UI task, its page-group imports data from the `Repos`/query hooks, not from `features/<x>/data.ts`; grep proves the fixture import is gone from the live path (a fixture may remain only as the mock-repo's source). (T2–T6)
- **Mock + HTTP parity:** the app runs identically in mock mode (default) AND HTTP mode for each wired surface; the shared contract test covers both. (T1)
- **Field mapping correct:** camelCase types match the real router responses (a wrong field → the UI shows undefined). (T1)
- **Empty/error states:** each wired list renders a sensible empty state on `[]` and an error state on `ApiError` — not blank/thrown. (T2–T6)
- **Write actions hit the backend:** flow publish/run/test-run, routine run-now, skill publish go through `Commands` to the real endpoints (not a local no-op). (T2, T3, T6)

---

### Task 1: Extend the shared data seam (types + Repos + httpRepos + mock + query hooks + Commands) — FOUNDATION

**Files:** Modify `src/core/domain/types.ts`, `src/core/ports/repos.ts`, `src/adapters/http/httpRepos.ts`, `src/adapters/mock/{mockRepos.ts,fixtures.ts}`, `src/core/ports/repos.contract.ts`, `src/app/queries.ts`, `src/adapters/http/commands.ts`; tests `src/adapters/http/httpRepos.test.ts`, `commands.test.ts`.

**Interfaces — add read repos (camelCase types mapped from the real routers):**
- `flows: { list(): Promise<Flow[]>; get(id): Promise<Flow|null>; runs(id): Promise<FlowRun[]> }` → `GET /v1/flows`, `/v1/flows/{id}`, `/v1/flows/{id}/runs`
- `routines: { list(): Promise<Routine[]>; get(id): Promise<Routine|null> }` → `GET /v1/routines`, `/v1/routines/{id}`
- `knowledge: { sources(): Promise<KbSource[]>; list(params?): Promise<KbItem[]> }` → `GET /v1/knowledge/sources`, `/v1/knowledge`
- `analytics: { overview(range?): Promise<AnalyticsOverview>; helpers(range?): Promise<HelperStat[]> }` → `GET /v1/analytics/overview`, `/v1/analytics/helpers`
- `skills: { list(): Promise<Skill[]>; get(id): Promise<Skill|null> }` → `GET /v1/skills`, `/v1/skills/{id}`
- `helpers: { list(): Promise<Helper[]>; get(id): Promise<Helper|null> }` → `GET /v1/helpers`, `/v1/helpers/{id}`
- `goals` already exists (P0) — add `get(id)`/`replan` if the pages need them.
**Add Commands (writes):** `publishFlow(id)`→`POST /v1/flows/{id}/publish`; `runFlow(id)`→`/run`; `testRunFlow(id, input?)`→`/test-run`; `runRoutineNow(id)`→`POST /v1/routines/{id}/run-now`; `replanGoal(id)`→`POST /v1/goals/{id}/replan`; `publishSkill(id)`→`POST /v1/skills/{id}/publish`; (create/update where a page edits — confirm the backend verb exists first; if not, note it).
**Query hooks (src/app/queries.ts):** `useFlows/useFlow/useFlowRuns`, `useRoutines/useRoutine`, `useKnowledgeSources/useKnowledge`, `useAnalyticsOverview/useAnalyticsHelpers`, `useSkills/useSkill`, `useHelpers/useHelper` — mirror the existing `useChannels` style.
**Mock impls + fixtures** for all of the above so the app runs fully in mock mode; extend the contract test.

- [ ] **Step 1: Write failing tests** — `httpRepos.test.ts`: each new repo method calls the right URL + Bearer + returns the mapped camelCase shape; a 404-tolerant get → null. `commands.test.ts`: each new command POSTs the right URL. Contract test exercises the new repos under mock + http-mock.
- [ ] **Step 2: `npx vitest run` → fail.**
- [ ] **Step 3: Implement** types/port/http/mock/hooks/commands (read the real routers for exact fields).
- [ ] **Step 4: `npx vitest run` green + `npx tsc -b --force` 0.** Commit. **(Merge to main before T2+ fan out.)**

### Tasks 2–6 (PARALLEL after T1 merges — isolated worktrees, disjoint dirs): refactor each page-group off fixtures onto the port

Each task: replace the page-group's local `data.ts` fixture imports with the T1 `useRepos()`/query hooks + `createCommands` writes; add empty/error states; keep the UI behavior identical; gate on `npx vitest run` + `npx tsc -b --force`; commit to its own branch. The fixture file may stay ONLY as the mock-repo's data source (moved/referenced from `src/adapters/mock/`), not imported by the live page.

### Task 2: **Flows** — `src/features/office/flows/**` (editor: OfficeFlowsRoute, CanvasPage, RunsPage, SettingsPage, Inspector, Palette, store/boardStore, editor/data.ts)
- Wire the flow list + the flow detail (canvas/steps/settings) + runs from `repos.flows`; publish/run/test-run via `Commands`. Replace `office/flows/editor/data.ts` + `office/flows/shared.tsx` fixture reads.
- [ ] TDD a flows list/detail test (renders live-shaped data via mock repo; publish calls the command) → implement → vitest + tsc green → commit `feat/p8-flows`.

### Task 3: **Routines** — `src/features/routines/**` (ListView, WeekView, Drawers, Overlays, RoutinesRoute, RoutineDetailRoute)
- Wire from `repos.routines`; run-now via `Commands`. Replace the routines fixture reads.
- [ ] TDD → implement → green → commit `feat/p8-routines`.

### Task 4: **Docs / Knowledge** — `src/features/office/docs/**` (OfficeDocsRoute, KnowledgeView)
- Wire from `repos.knowledge` (sources + items); replace the docs/knowledge fixtures.
- [ ] TDD → implement → green → commit `feat/p8-docs`.

### Task 5: **Analytics** — `src/features/analytics/**` (AnalyticsPage, OfficeAnalyticsRoute, ChatAnalyticsRoute, parts/tabs, data.ts)
- Wire from `repos.analytics` (overview + helpers, range param); replace `analytics/data.ts`. Keep BudgetDrawer on `usage`/`wallet` (P5d).
- [ ] TDD → implement → green → commit `feat/p8-analytics`.

### Task 6: **Team / Helpers + Members + Skills** — `src/features/team/**`, `src/features/control-panel/sections/Section{Members,Handbook,Skills}.tsx`
- Team roster + HelperDetail from `repos.helpers`; SectionSkills from `repos.skills` (publish via Commands); SectionMembers from `/me` companies + `repos.helpers`; SectionHandbook from the handbook/knowledge source. Replace the respective fixtures.
- [ ] TDD → implement → green → commit `feat/p8-team`.

---

## Self-Review notes (author)

- **Coverage:** the unwired surfaces (flows/routines/docs/analytics/skills/team/members) all get a Repo + hooks (T1) and their pages refactored off fixtures (T2–T6). Chat/channels/goals/inbox/connections/tokens/usage/billing were P5d.
- **Parallelism is safe by construction:** T1 (shared seam) merges first; T2–T6 touch DISJOINT feature dirs (office/flows vs routines vs office/docs vs analytics vs team) → no file overlap → parallel worktrees merge cleanly. Each gates on vitest + `tsc -b --force`.
- **Backend is ready:** every endpoint exists; P8 writes no backend code. If a page needs a write verb that doesn't exist (e.g. flow create/edit persistence), the task NOTES it rather than inventing a frontend no-op.
- **Mock stays the default:** mock impls + contract test keep the app fully functional offline/standalone; HTTP mode goes fully live. No fixture in the live path after P8.
- **Proportion:** 1 foundation + 5 parallel UI refactors; the sharpest tests are per-surface "fixture-gone + live-shaped data + write-hits-backend + empty/error states."
