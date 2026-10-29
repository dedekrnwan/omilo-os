# Dead-CTA & Form-Wiring Full Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every CTA across the app performs a real next-action (nav / dialog / mutation) and every form input is bound and persists to the backend — eliminating the ~90 dead CTAs and non-persisting forms found in the 2026-10-29 audit.

**Architecture:** Three-layer fix. (1) Backend: add the focused set of genuinely-missing write endpoints + one `company.settings` JSONB column; most mutations already exist. (2) Plumbing: extend `commands.ts` with the full mutation surface and add `useMutation` hooks + input-type definitions to `queries.ts`/`repos.ts`. (3) Wiring: bind every unbound input and point every dead CTA at a real command, nav, or dialog. Follow the already-wired reference sections (SectionMcpTokens, SectionConnectors, StepProfile) as the pattern.

**Tech Stack:** Backend FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2 (RLS via `get_tenant_db`/`get_context`, routers mounted `prefix="/v1"`). Frontend React 19 + TanStack Router + React Query + the Repos/Commands port. Tests: pytest (backend), vitest + `tsc -b --force` (frontend).

**Spec:** The 2026-10-29 audit (8 cluster reports) + the backend capability table (this session). Reference memory: [[omilo-frontend-integration-status]], [[omilo-v2-backend-trd]], [[negative-action-confirm-sad-mascot]].

## Global Constraints

- Billing/mutation endpoints emit **snake_case**; map camelCase→snake at the command boundary and snake→camel on response (follow existing `commands.ts` mappers). `public-config` is the only camelCase emitter.
- RLS: every new tenant-scoped endpoint uses `get_tenant_db` + `get_context`; role-guard owner/admin writes (follow `company.py` `PATCH /v1/company`).
- Destructive confirmations use `ConfirmDialog` with a **sad Mascot** (never a static icon) — [[negative-action-confirm-sad-mascot]].
- **Mock mode stays fully functional and un-gated**: every new command must have a mock implementation in `src/adapters/mock/` so `VITE_USE_HTTP!=='1'` still works offline. Mock mutations mutate the in-memory fixture and resolve.
- `@lru_cache get_settings()` → any `.env`/config change needs an API restart (not relevant to most tasks).
- Alembic head is `0020_company_onboarded_at`; new migration chains after it.
- Build gate per task: backend `cd apps/api && .venv/bin/python -m pytest -q` green; frontend `npx vitest run` + `npx tsc -b --force` exit 0.
- Do NOT regress the 603 vitest / 841 pytest baseline.

## Review Focus

- **Mock-mode parity**: a wired HTTP command whose mock counterpart is missing crashes the default (offline) app on click — every command needs both impls.
- **Optimistic-update cache invalidation**: a create/delete that doesn't `invalidateQueries` leaves the list stale (user clicks delete, row stays) — each mutation hook must invalidate its list key.
- **Role-guard on destructive endpoints**: member-remove / company-delete / role-change must 403 for non-owner/admin, else any member can nuke the workspace.
- **Last-owner protection**: changing/removing the only owner must be refused (400), else the company is orphaned.
- **Empty/validation states on now-live forms**: Create-goal/routine with blank required fields must disable submit or show an error, not POST garbage.
- **External-channel connect secrets**: Telegram bot-token / email creds must go through the encrypted connectors credential path, never plaintext columns or `VITE_*`.

---

## Phase 1 — Backend: missing endpoints + settings column

### Task 1.1: `company.settings` JSONB + GET/PATCH settings
**Files:** Modify `apps/api/omilo/models/tenancy.py` (add `settings: Mapped[dict] = mapped_column(JSONB, server_default='{}')`); new migration `apps/api/migrations/versions/0021_company_settings.py`; modify `apps/api/omilo/api/company.py` (add `GET /v1/company/settings`, `PATCH /v1/company/settings`); Test: `apps/api/tests/test_company_settings.py`.

**Interfaces:**
- Produces: `GET /v1/company/settings → {safety:{...}, notifications:{...}, ai_engine:{...}, knowledge:{...}, about?, language?, hours?}` (free-form JSON, tenant-scoped). `PATCH /v1/company/settings` deep-merges the posted partial into `company.settings`, returns the merged object. Owner/admin only.

- [ ] Write failing tests: PATCH merges partial without clobbering siblings; GET returns defaults for a fresh company; non-admin PATCH → 403.
- [ ] Add `settings` column + migration (`alembic revision`, chain after 0020); run `alembic upgrade head`.
- [ ] Implement GET/PATCH with a deep-merge helper; role-guard via the `company.py` pattern.
- [ ] Run tests green. Commit.

### Task 1.2: Goal update + delete
**Files:** Modify `apps/api/omilo/api/goals_write.py` (add `PATCH /v1/goals/{id}`, `DELETE /v1/goals/{id}`); Test: `apps/api/tests/test_goals_write.py` (extend).

**Interfaces:**
- Produces: `PATCH /v1/goals/{id}` body `{title?, target?, due?, status?, channel_id?}` → updated Goal; `DELETE /v1/goals/{id}` → 204. Tenant-scoped.

- [ ] Write failing tests: patch title/status persists; delete removes + 404 on re-get; cross-tenant 404.
- [ ] Implement PATCH/DELETE following `routines_write.py` PATCH/DELETE shape.
- [ ] Tests green. Commit.

### Task 1.3: Flow delete (+ reuse create for duplicate)
**Files:** Modify `apps/api/omilo/api/flows_write.py` (add `DELETE /v1/flows/{id}`); Test: extend `apps/api/tests/test_flows_write.py`.

**Interfaces:**
- Produces: `DELETE /v1/flows/{id}` → 204, tenant-scoped. (Duplicate is frontend re-`POST /v1/flows` with the copied body — no new endpoint.)

- [ ] Failing tests: delete removes flow; 404 cross-tenant; delete cascades/ignores runs safely.
- [ ] Implement DELETE. Tests green. Commit.

### Task 1.4: Routine schedule fields in PATCH + skip-next-run
**Files:** Modify `apps/api/omilo/api/routines_write.py` (extend `PatchRoutineBody` with `freq?, at?, days?, monthly?, timezone?`; recompute cron/next_at when schedule changes; add `POST /v1/routines/{id}/skip-next`); Test: extend `apps/api/tests/test_routines_write.py`.

**Interfaces:**
- Produces: `PATCH /v1/routines/{id}` now accepts schedule fields and recomputes `cron`+`next_at`; `POST /v1/routines/{id}/skip-next` advances `next_at` past the next occurrence → `{next_at}`.

- [ ] Failing tests: patching `freq`/`at` updates cron + next_at; skip-next moves next_at forward one period.
- [ ] Implement (reuse the create-path cron computation). Tests green. Commit.

### Task 1.5: Member role change + remove (+ last-owner guard)
**Files:** Modify `apps/api/omilo/api/members.py` (add `PATCH /v1/members/{id}` `{role}`, `DELETE /v1/members/{id}`); Test: new `apps/api/tests/test_members_write.py`.

**Interfaces:**
- Produces: `PATCH /v1/members/{id}` body `{role: owner|admin|member|viewer}` → updated member; `DELETE /v1/members/{id}` → 204. Owner/admin only. Refuse (400) demoting/removing the **last owner**.

- [ ] Failing tests: admin changes a member's role; non-admin → 403; removing last owner → 400; remove member → 204 + gone from list.
- [ ] Implement with role-guard + last-owner count check. Tests green. Commit.

### Task 1.6: Company (workspace) delete
**Files:** Modify `apps/api/omilo/api/company.py` (add `DELETE /v1/company`); Test: extend company tests.

**Interfaces:**
- Produces: `DELETE /v1/company` → 204, **owner only**, cascades tenant rows (or soft-deletes — follow existing deletion norms; if none, hard-delete Member+company-scoped rows in a transaction). Requires the typed-confirm already in `DialogDeleteWorkspace`.

- [ ] Failing tests: owner deletes company; non-owner → 403; deletion removes members.
- [ ] Implement. Tests green. Commit.

### Task 1.7: Helper model/engine field
**Files:** Modify `apps/api/omilo/api/helpers.py` (`PatchHelperBody` + `model?`); migration if `model` column absent on Helper (`0022_helper_model.py`); Test: extend helper tests.

**Interfaces:**
- Produces: `PATCH /v1/helpers/{id}` accepts `model?` (engine id) and persists it; GET helper returns it.

- [ ] Failing test: patch model persists + round-trips.
- [ ] Add column+migration if needed; implement. Tests green. Commit.

### Task 1.8: Doc create
**Files:** Modify `apps/api/omilo/api/memory.py` or `knowledge.py` (add `POST /v1/memory` create → new MemoryDoc); Test: extend memory tests.

**Interfaces:**
- Produces: `POST /v1/memory` body `{title, content, kind?}` → created doc (company KB-scoped), indexes it. Pairs with existing `PATCH /v1/memory/{id}`.

- [ ] Failing test: create returns doc + appears in knowledge list.
- [ ] Implement. Tests green. Commit.

---

## Phase 2 — Command + hook plumbing (frontend)

### Task 2.1: Extend the Commands port + HTTP + mock impls
**Files:** Modify `src/adapters/http/commands.ts` (add commands below), `src/adapters/mock/` command impls, `src/core/ports/repos.ts` / `src/core/domain/types.ts` as needed. Test: extend `src/adapters/http/commands.test.ts` (or create) + mock parity test.

**Interfaces — add these commands (camelCase in, snake out), both HTTP + mock:**
`createGoal, updateGoal, deleteGoal, createRoutine, updateRoutine, deleteRoutine, skipRoutineNext, createFlow, updateFlow, deleteFlow, duplicateFlow(=create from copy), createHelper, updateHelper, changeMemberRole, removeMember, inviteMember, deleteCompany, getCompanySettings/updateCompanySettings, checkAiAccounts, testAiAccount, createDoc, updateDoc`. (`topup`, `changePlan`, `updateWallet`, `createSession`, `sendMessage`, `createAiAccount` already exist — reuse.)

- [ ] Write failing tests: each command maps camel→snake body + snake→camel response; mock impl mutates fixture + resolves.
- [ ] Implement HTTP commands (follow existing post/patch/del helpers) + mock impls.
- [ ] `tsc -b --force` + vitest green. Commit.

### Task 2.2: `useMutation` hooks in queries.ts
**Files:** Modify `src/app/queries.ts` (add mutation hooks); Test: extend query hook tests.

**Interfaces — add hooks that call the Task 2.1 commands and invalidate the right list key:**
`useCreateGoal/useUpdateGoal/useDeleteGoal` (inv `['goals']`), routine trio + skip (inv `['routines']`/`['routine',id]`), flow create/update/delete/duplicate (inv `['flows']`), `useCreateHelper/useUpdateHelper` (inv `['helpers']`), `useChangeMemberRole/useRemoveMember/useInviteMember` (inv `['members']`), `useCompanySettings` (query) + `useUpdateCompanySettings`, `useCheckAiAccounts/useTestAiAccount` (inv `['aiAccounts']`), `useCreateDoc/useUpdateDoc` (inv `['knowledge']`), `useTopup/useChangePlan/useUpdateWallet` (inv `['billingSubscription']`/`['usage']`).

- [ ] Failing tests: a mutation hook calls its command and invalidates its query key.
- [ ] Implement. vitest + tsc green. Commit.

---

## Phase 3 — Wire core CRUD surfaces

### Task 3.1: Chat new-chat hero actually sends
**Files:** `src/features/chat/ChatRoute.tsx`, `src/ui/ChatSession/Composer.tsx` (file-attach), chat store.
- [ ] Hero Composer `onSend` → `createSession` then `sendMessage`, navigate `/chat/$sessionId`; "start from a goal" chips prefill + send. Fix Composer file-attach to retain files (or hide if unsupported). Test: sending creates a session + navigates. Commit.

### Task 3.2: Goals create / edit / delete / row-open
**Files:** `src/features/goals/GoalsRoute.tsx`.
- [ ] GoalRow title → navigate to the goal's session (or open detail); NewGoalDialog "Create goal" → `useCreateGoal` (reads all bound fields); add edit + delete (sad-mascot confirm) via `useUpdateGoal`/`useDeleteGoal`; "Group: Area" → real grouping toggle or remove. Tests. Commit.

### Task 3.3: Routines create / update / delete / skip / drawer saves
**Files:** `src/features/routines/Drawers.tsx`, `Overlays.tsx`, `RoutinesRoute.tsx`.
- [ ] NewRoutineDrawer → `useCreateRoutine` (bind the prompt textarea); WhatItDoes + Schedule + WhoDoesIt Save → `useUpdateRoutine`; DeleteConfirm → `useDeleteRoutine` (removes row); "Skip next run" → `useSkipRoutineNext`; Re-send/Discuss → nav to run/chat; FailurePopover Retry→`runRoutineNow`, Reconnect→nav connectors. Tests. Commit.

### Task 3.4: Flows delete / duplicate / NewFlow description / inspector + settings persist
**Files:** `src/features/office/flows/OfficeFlowsRoute.tsx`, `editor/SettingsPage.tsx`, `editor/Inspector.tsx`.
- [ ] Delete-flow confirm → `useDeleteFlow` + nav `/flows`; Duplicate → `useDuplicateFlow`; NewFlowDialog → pass description/area/runs-as into `createFlow`; Inspector ApprovalBody/ConnectorBody/Trigger "only on branch" → `updateNode`/`updateFlow` persist; Suggested "Preview" → open draft or remove. Tests. Commit.

---

## Phase 4 — Settings, members, billing persistence

### Task 4.1: Control-panel settings sections persist
**Files:** `sections/SectionGeneral.tsx`, `SectionSafety.tsx`, `SectionNotifications.tsx`, `SectionAiEngine.tsx`, `SectionKnowledge.tsx`, `ControlPanelShared.tsx` (`useDirtyState.save`).
- [ ] Each section's Save → `useUpdateCompanySettings` (safety→also `autonomy_default` via PATCH /v1/company where applicable; General name/timezone→PATCH /v1/company, about/language/hours→settings). SaveBar reflects real pending/success. Tests per section. Commit.

### Task 4.2: Members role / remove / invite + Account SaveBar + delete-workspace
**Files:** `sections/SectionMembers.tsx`, `sections/SectionAccount.tsx`, `dialogs/DialogInvite.tsx`, `dialogs/DialogDeleteWorkspace.tsx`.
- [ ] Role dropdown → `useChangeMemberRole`; row Remove → `useRemoveMember` (sad-mascot confirm); DialogInvite (bind email input + chips) → `useInviteMember`; Account `<SaveBar>` wired to real dirty/save (profile PATCH); DialogDeleteWorkspace confirm → `useDeleteCompany` → sign-out. Tests. Commit.

### Task 4.3: Billing dialogs + AI-accounts + connectors reconnect
**Files:** `dialogs/DialogBuyCredits.tsx`, `DialogChangePlan.tsx`, `DialogConnectKey.tsx`, `DialogAddMcp.tsx` (if endpoints exist), `sections/SectionAiAccounts.tsx`, `sections/SectionConnectors.tsx`, `sections/SectionSkills.tsx`.
- [ ] BuyCredits → `useTopup` (bind pack radios, redirect to hosted_url); ChangePlan Upgrade/Downgrade → `useChangePlan`; AiAccounts "Run check"/"Test" → `useCheckAiAccounts`/`useTestAiAccount`; ConnectKey "Save key" → `createAiAccount`; Connectors "Reconnect" → credentials/connect; Skills enable/disable Toggle → `useUpdateSkill` or publish path. Tests. Commit.

---

## Phase 5 — Input binding, team, onboarding, docs, analytics, nav/decorative cleanup

### Task 5.1: Team field primitives + hire flow + roles/models
**Files:** `src/features/team/ui.tsx` (`InputField`/`SelectField`/`TextareaField` → controlled `value`+`onChange`), `HireDialog.tsx`, `SetupDialog.tsx`, `RolesModelsDialog.tsx`, channel-dialogs, `tabs/ProfileTab.tsx`.
- [ ] Make the three primitives controlled; hire flow → `useCreateHelper`; RolesModels Save → `useUpdateHelper` (role+model); ProfileTab picture input → real handler; bind all consumer fields. Tests. Commit.

### Task 5.2: Auth CreateCompany + Payment + minor
**Files:** `src/features/auth/CreateCompanyPage.tsx`, `PaymentPage.tsx`, `AuthPrimitives.tsx` (AuthCheckbox), `ChooseCompanyPage.tsx`.
- [ ] CreateCompany → bind fields + call create-company path (sign-up already creates company; this page should PATCH company profile for the just-created tenant, or be removed from the flow if redundant — ruling: wire to `updateCompanyProfile`); Payment → bind + `changePlan`/`topup` (redirect to hosted checkout); AuthCheckbox controlled + read on submit; ChooseCompany → `switchCompany`. Tests. Commit.

### Task 5.3: Onboarding StepKnowYou / StepYourAI / StepTeam persistence
**Files:** `src/features/onboarding/StepKnowYou.tsx`, `StepYourAI.tsx`, `StepTeam.tsx`, `StepCheck.tsx`, `StepInbox.tsx`, `OnboardingRoute.tsx`.
- [ ] StepKnowYou answer form → persist (company settings/about) or explicitly mark optional and bind inputs; StepYourAI → persist selected pool account / cloud pick; StepTeam → pass selected helper set into `completeOnboarding` (→ `useCreateHelper` per selected); wire/remove Edit + "Add something" toasts. Tests. Commit.

### Task 5.4: Docs create/edit + Analytics budget + navigate-only + decorative
**Files:** `src/features/office/docs/OfficeDocsRoute.tsx`, `GraphView.tsx`, `KnowledgeView.tsx`, `src/features/analytics/BudgetDrawer.tsx`, `tabs.tsx`, `parts.tsx`, plus the navigate-only/decorative CTAs enumerated in the audit.
- [ ] New doc → `useCreateDoc`; doc edit/save → `useUpdateDoc`; "Open in Docs"/"Open goal"/"Open profile" → real nav; BudgetDrawer Save → `useUpdateWallet`; analytics helper filter actually filters; failure-row actions → retry/nav; remove or wire decorative pills (idea chips, provider pills, mic/paperclip). Tests. Commit.

---

## Phase 6 — External channel connect (scope-gated)

### Task 6.1: Channel connect — Telegram (bot token) via connectors
**Files:** `src/features/team/channel-dialogs/ConnectTelegramDialog.tsx`; backend reuse connectors credential path (`POST /v1/connectors/{id}/credentials`) or a new `POST /v1/channels/connect`.
- [ ] Bind bot-token input → store via encrypted connectors credentials; validate via Telegram `getMe`; show connected state. Test. Commit.

### Task 6.2: Email connect — config-persist + pending state
**RULING (user, 2026-10-29):** Telegram full (6.1). **Email**: bind the inputs and persist the connection intent/config through the connectors credential path, then show an honest "pending provider setup" state — no faked live OAuth handshake. **WhatsApp: DEFERRED** — leave `ConnectWhatsAppDialog` as-is (out of scope this round; revisit as its own effort).
- [ ] Email: bind From-name/signature inputs, persist via connectors credentials, show pending state. Leave WhatsApp dialog untouched. Commit.

---

## Self-Review notes
- Spec coverage: every audit HIGH/MED item maps to a task (Phase 3–5 cover frontend dead CTAs; Phase 1 covers the 8 missing endpoints; Phase 2 is the bridge). LOW decorative items are folded into Task 5.4.
- Proportion: plan stays at interface+test-intent altitude; implementers write detailed tests following existing pytest/vitest patterns (603/841 baseline).
- Biggest risk: mock-mode parity (Review Focus #1) — enforced as a Global Constraint and a Task 2.1 test.
- Sequencing: Phase 1→2 are prerequisites; Phases 3/4/5 are largely independent and parallelizable across worktrees; Phase 6 is optional/last.
