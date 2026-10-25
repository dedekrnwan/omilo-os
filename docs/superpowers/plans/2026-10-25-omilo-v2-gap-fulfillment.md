# Omilo v2 — Gap Fulfillment & Sidebar Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every navigation/interaction gap in the omilo-v2 pen-aligned UI so no CTA is a dead-end — including the Control Panel and Notifications sidebar redesigns — and make every interactive control do something sensible on mock/local state.

**Architecture:** Three-column app shell `Rail(56) → Sidebar(232) → Inset`. Each feature area owns a sidebar + `<Inset>` and mounts under the Shell layout route. Navigation is TanStack Router; cross-cutting UI state (mode, dirty flags, chat mutations) lives in the Zustand store (`src/app/store.ts`) or local component state. No backend — "functional" means navigation + UI + local/mock state only.

**Tech Stack:** React 19, TanStack Router, Zustand, Radix (dialog/dropdown/popover), lucide-react, Tailwind v4, Vitest + Testing Library. Build with Bun.

**Spec:** This document is self-contained; the "Context & Decisions" section below is the spec (derived from the 2026-10-25 brainstorming session). The dead-end inventory it argues from lives in the same session.

## Context & Decisions

- The app is a **UI-first prototype on mock repos** (`src/adapters/mock`). There is no network/OAuth/persistence. Every "save/approve/connect/send" resolves against local or Zustand state, optionally with an optimistic toast.
- **Scope = full** (Wave 1 + Wave 2): no dead-ends AND every control does something.
- **A1/A2 sidebar visuals are inferred** — pen.dev access is rate-limited. Build them to mirror the existing `Chat`/`Office` sidebar primitives (`src/ui/ds/Sidebar.tsx`); leave a `// TODO(pen): refine against omilo-v2.pen` marker. A later pass refines pixels once pen is reachable.
- **Reuse, don't reinvent:** all sidebars use `SidebarFrame`/`NavGroup`/`NavLink`/`GroupLabel`; all buttons use `ui/ds/Button`; all menus use `ui/ds/Menu` + Radix. No new design-system primitives unless a task says so.
- The dead-end inventory (chat, office, team, control-panel, notifications, rail, chief-dm, command-menu, auth, onboarding) is the task backlog; tasks reference it by area rather than re-listing every line.

## Global Constraints

- Mock-only: no real network, OAuth, or persistence. Side effects go to Zustand (`src/app/store.ts`) or local state.
- All routes are declared in `src/app/router.tsx` and must be added to the correct parent in the `routeTree`.
- Reuse `src/ui/ds/*` primitives; match existing token classes (`bg-app`, `bg-hover`, `text-ink`, `text-muted`, `outline-line-strong`, etc.). No raw hex unless mirroring an existing file's pattern.
- Keep all existing Vitest tests green. New routes get a route-smoke test (mirror `src/app/routeSmoke.test.tsx`); new key interactions get one RTL test. Do **not** write a failing-test-first cycle for every individual button — test behavior per area, not per element.
- Verification per task: `bun run lint` (oxlint), `bun run test` (vitest run), and `bunx tsc -b` must pass. Full `bun run build` runs once at the end of each wave.
- A1/A2 carry `// TODO(pen): refine against omilo-v2.pen`.

## Review Focus

- **Cross-mode deep-links** (chat "Manage channels" → `/control-panel/channels`, inbox "See all activity" → `/control-panel/activity`): after navigating, the Rail's `currentPage`/`mode` must highlight the destination correctly — Task 4's test asserts the rail reflects `settings` after the jump.
- **`/office/routines` active state:** `OfficeLayout` currently derives `activeNav` only for Goals/Inbox; Routines will render with no active sidebar item unless the derivation is extended — Task 3's test asserts the Routines NavLink is `aria-current` on that route.
- **Control Panel sidebar promotion** must preserve `$section` URL sync and all 15 sections + 8 dialogs — Task 1's test visits a deep `/control-panel/$section` and asserts both the 232px sidebar and the right section render.
- **Auth back/forward links & branches** ("sign out", "use a different email", two-step vs choose-company): a wrong target creates a loop or 404 — Task 6's test walks sign-up → confirm → company and asserts each lands on the declared route.
- **Command Menu selection:** navigating from a result must close the menu and land on an existing route; keyboard Enter on the active row must behave like click — Task 10's test asserts menu closes + route changes.

---

## WAVE 1 — Structure, new screens, zero dead-ends

### Task 1: Control Panel sidebar promotion (A1)

Move the section list out of the 144px in-Inset `ControlPanelNav` into a standard 232px app sidebar, so the layout matches Chat/Office: `Rail → ControlPanelSidebar → Inset(section content)`.

**Files:**
- Create: `src/features/control-panel/ControlPanelSidebar.tsx`
- Modify: `src/features/control-panel/ControlPanel.tsx` (layout: sidebar sibling of Inset, not child nav)
- Modify: `src/features/control-panel/ControlPanelRoute.tsx` (render sidebar + ControlPanel content)
- Keep: `src/features/control-panel/ControlPanelNav.tsx` only if still referenced; otherwise delete and update imports
- Test: `src/features/control-panel/ControlPanelRoute.test.tsx`

**Interfaces:**
- Consumes: `NAV_GROUPS` from `./data`, `SidebarFrame`/`NavGroup`/`NavLink`/`GroupLabel` from `../../ui/ds/Sidebar`, `ControlPanelSection` from `./types`.
- Produces: `ControlPanelSidebar({ section, onSection }: { section: ControlPanelSection; onSection: (s: ControlPanelSection) => void })` — a `SidebarFrame label="Control panel"` with workspace header, the "Find a setting" search, and `NAV_GROUPS` rendered as `GroupLabel` + `NavLink`s (badge supported), active = `section === item.id`.

- [ ] **Step 1:** Write `ControlPanelSidebar.tsx` using `SidebarFrame`/`NavGroup`/`NavLink`/`GroupLabel`; port the header + search from `ControlPanelNav.tsx`; render `NAV_GROUPS` with `NavLink` (map `item.badge` to the count/badge slot).
- [ ] **Step 2:** Rewrite `ControlPanel.tsx` so it returns `<><ControlPanelSidebar .../><Inset label="Control panel">{SectionContent + DialogOverlay}</Inset></>` — remove the inner `ControlPanelNav` + 144px flex row.
- [ ] **Step 3:** Confirm `ControlPanelRoute.tsx` still owns `$section` ↔ URL sync and passes `section`/`onSection` down.
- [ ] **Step 4:** Write a route-smoke test: render router at `/control-panel/members`; assert a `nav[aria-label="Control panel sections"]` (or the new label) of width class `w-[232px]` is present AND the Members section heading renders.
- [ ] **Step 5:** Run `bun run test` + `bun run lint`; expect PASS.
- [ ] **Step 6:** Commit `feat(control-panel): promote section nav into the 232px app sidebar`.

### Task 2: Notifications sidebar (A2)

Give Notifications a left sidebar (currently none). Inferred method: a filter rail — `All`, `Needs you`, `Mentions`, then per-area rows — that scopes the decisions + grouped lists.

**Files:**
- Create: `src/features/notifications/NotificationsSidebar.tsx`
- Modify: `src/features/notifications/NotificationsRoute.tsx` (render sidebar + filtered Inset)
- Modify: `src/features/notifications/data.ts` (add a `NotifFilter` type + a `filterNotifs` helper)
- Test: `src/features/notifications/NotificationsRoute.test.tsx`

**Interfaces:**
- Produces: `type NotifFilter = 'all' | 'needs-you' | 'mentions' | string /* area */`; `NotificationsSidebar({ filter, onFilter }: { filter: NotifFilter; onFilter: (f: NotifFilter) => void })`; `filterNotifs(filter: NotifFilter): { decisions: Decision[]; groups: NotifGroup[] }`.
- Consumes: `DECISIONS`, `NOTIF_GROUPS`, `SidebarFrame`/`NavLink`/`GroupLabel`.

- [ ] **Step 1:** Add `NotifFilter` + `filterNotifs` to `data.ts` ("needs-you" → decisions only; "mentions" → notifs whose title/preview contains "@"; area → match `senderArea`).
- [ ] **Step 2:** Build `NotificationsSidebar.tsx` (SidebarFrame "Notifications" + header + NavLinks for All/Needs you/Mentions with counts, then a `GroupLabel "AREAS"` group of per-area NavLinks with `areaDot`). `// TODO(pen): refine against omilo-v2.pen`.
- [ ] **Step 3:** Rewrite `NotificationsRoute` to hold `filter` state, render `<><NotificationsSidebar .../><Inset>…</Inset></>`, and drive the pinned decisions + grouped lists from `filterNotifs(filter)`.
- [ ] **Step 4:** Test: render at `/notifications`; click the "Needs you" NavLink; assert grouped notif rows are hidden and only decision cards remain.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS.
- [ ] **Step 6:** Commit `feat(notifications): add filter sidebar and scope lists by filter`.

### Task 3: Routines screen (B)

`OfficeSidebar` and `JobTab` already navigate to `/office/routines`, which 404s. Build the screen + route.

**Files:**
- Create: `src/features/office/routines/OfficeRoutinesRoute.tsx`
- Create: `src/features/office/routines/data.ts` (mock routines: name, cadence, lastRun, nextRun, owner area, status)
- Modify: `src/app/router.tsx` (add `officeRoutinesRoute` under `officeRoute`)
- Modify: `src/features/office/OfficeLayout.tsx` (extend `activeNav` derivation to include Routines)
- Test: `src/features/office/routines/OfficeRoutinesRoute.test.tsx`

**Interfaces:**
- Produces: `OfficeRoutinesRoute()` rendering an `<Inset>` + `Topbar` (icon `CalendarSync`, title "Routines") + a list of routine cards. `ROUTINES: Routine[]` in `data.ts`.
- Consumes: `Inset`/`Topbar` from `ui/ds/Frame`, `Button`.

- [ ] **Step 1:** Add `officeRoutinesRoute = createRoute({ getParentRoute: () => officeRoute, path: 'routines', component: OfficeRoutinesRoute })` and include it in `officeRoute.addChildren([...])`.
- [ ] **Step 2:** In `OfficeLayout`, add `const onRoutines = !!matchRoute({ to: '/office/routines', fuzzy: false })` and feed `'Routines'` into `activeNav`.
- [ ] **Step 3:** Build `OfficeRoutinesRoute` + `ROUTINES` data; each card has a "Pause"/"Run now" button wired to local state (no-op toast acceptable here, real toggle in Wave 2 Task 9 if desired).
- [ ] **Step 4:** Test: render at `/office/routines`; assert the Routines NavLink has `aria-current="true"` and the first routine name renders.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS.
- [ ] **Step 6:** Commit `feat(office): add Routines screen and route`.

### Task 4: Cross-mode deep-links & missing destinations (B)

Point every CTA whose target is an *existing* screen (just unwired) at that screen.

**Files (modify):**
- `src/features/chat/ChannelSidebar.tsx` — "Manage channels" → `navigate({ to: '/control-panel/$section', params: { section: 'channels' } })` (close popover first).
- `src/features/chat/DocsRoute.tsx` — "Open the Knowledge View" → `/office/docs` (knowledge graph lives there); the in-doc `[[links]]`/outline buttons scroll or navigate to the referenced doc.
- `src/features/office/InboxRoute.tsx` — "See all activity →" → `/control-panel/$section` `activity`.
- `src/features/team/tabs/JobTab.tsx` — "Open in Routines" → `/office/routines`.
- `src/features/team/tabs/ToolsTab.tsx` — "Open Connectors" → `/control-panel/$section` `connectors`.
- `src/features/team/RolesModelsDialog.tsx` + `tabs/ProfileTab.tsx` — "Open AI accounts" → `/control-panel/$section` `ai-accounts`.
- Test: `src/features/chat/ChannelSidebar.test.tsx` (new) or extend an existing chat test.

**Interfaces:** Consumes `useNavigate` from `@tanstack/react-router`. No new exports.

- [ ] **Step 1:** Wire each CTA above to `navigate(...)`; where the control sits in a popover/menu, close it in the same handler.
- [ ] **Step 2:** Test: render the chat shell, open the channel menu, click "Manage channels"; assert the URL is `/control-panel/channels` and the Rail shows `settings` as current (`aria-current="page"` on the Settings rail button).
- [ ] **Step 3:** `bun run test` + `bun run lint` PASS.
- [ ] **Step 4:** Commit `feat(nav): wire cross-mode deep-links to existing screens`.

### Task 5: Flows navigation wiring (C1/C2)

The canvas/draft/runs routes exist but nothing links to them and their back buttons are dead. Connect the island.

**Files (modify):**
- `src/features/office/flows/OfficeFlowsRoute.tsx` — flow cards/rows `onClick` → `/office/flows/$flowId/canvas`; template "Use"/"Create" and "New flow" → create a draft id and navigate to `/office/flows/$flowId/draft`.
- `src/features/office/flows/OfficeFlowCanvasRoute.tsx`, `OfficeFlowDraftRoute.tsx`, `OfficeFlowRunsRoute.tsx` — "Back"/breadcrumb → `/office/flows`.
- `src/features/chat/FlowsRoute.tsx` — "New flow" + cards → `/office/flows` (and template create → office draft).
- Test: `src/features/office/flows/FlowsNav.test.tsx` (new)

**Interfaces:** Consumes `useNavigate`, existing `$flowId` params. A helper `newDraftId()` (timestamp-free; derive from template id or a counter) may live in `flows/data.ts`.

- [ ] **Step 1:** Wire flow card/row click → canvas; back breadcrumbs → flows list.
- [ ] **Step 2:** Wire template "Use"/"Create" + "New flow" → draft route (use the template's id, or a `draft-<slug>` id).
- [ ] **Step 3:** Mirror the chat-side FlowsRoute CTAs into office flows.
- [ ] **Step 4:** Test: render at `/office/flows`, click the first flow card, assert URL matches `/office/flows/<id>/canvas`; from canvas click Back, assert URL is `/office/flows`.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS.
- [ ] **Step 6:** Commit `feat(flows): connect flows list ↔ canvas/draft/runs navigation`.

### Task 6: Auth + Onboarding flow wiring (E)

Every auth CTA is visual-only. Wire the full clickable flow and land onboarding in the app.

**Files (modify):** all of `src/features/auth/*Page.tsx` + `AuthPrimitives.tsx` (so `AuthButton`/`AuthLink` accept and forward an `onClick`/`to`), and `src/features/onboarding/OnboardingRoute.tsx` + `StepInbox.tsx` + `OnboardingHeader.tsx`.
- Test: `src/features/auth/authFlow.test.tsx` (new)

**Flow map (targets):** sign-in → (two-step | choose-company); sign-in links → forgot-password / check-email / sign-up. sign-up → confirm-email → onboarding/company → onboarding/plan → onboarding/payment → onboarding/all-set → `/chat/ch-general`. forgot-password → sent; reset-password → success → `/chat/ch-general`; expired → sent. check-email/two-step → choose-company → `/office/inbox`. invite → accept → `/office/inbox`. All "Sign out" → `/auth/sign-in`. In-app `/onboarding` final step ("Approve all") → `/office/inbox`.

**Interfaces:** `AuthButton`/`AuthLink` gain optional `to?: string` (renders a router `Link`/navigates) and keep `onClick?`. No business validation — navigation only.

- [ ] **Step 1:** Extend `AuthPrimitives` so `AuthButton`/`AuthLink` can navigate via `to`.
- [ ] **Step 2:** Wire every page's primary CTA + secondary links per the flow map.
- [ ] **Step 3:** Wire `OnboardingHeader` "Log out" → `/auth/sign-in` and `StepInbox` "Approve all"/terminal → `/office/inbox`; replace the pseudo-link `<span>`s in onboarding steps with real skip/advance handlers.
- [ ] **Step 4:** Test: render at `/auth/sign-up`, click "Create account" → assert `/auth/confirm-email`; click "Confirm email" → assert `/auth/onboarding/company`; click "Continue" → assert `/auth/onboarding/plan`.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS.
- [ ] **Step 6:** Commit `feat(auth): wire end-to-end auth + onboarding navigation`.

### Wave 1 gate
- [ ] Run `bun run build` (tsc + vite). Expect success.
- [ ] Manual smoke: no route in the app 404s from a visible CTA.

---

## WAVE 2 — In-screen interactions (mock/local state)

Each task makes the remaining no-op controls in an area do something on local/Zustand state. Where an action implies persistence, resolve optimistically (update store/local state, optional toast). Add a lightweight toast helper if none exists (`src/ui/ds/Toast.tsx`) in the first task that needs it.

### Task 7: Chat in-screen actions (D)

**Files (modify):** `ui/ChatSession/ChatMenu.tsx` (+ its parent that owns the session so the 8 callbacks are supplied), `ui/ChatSession/Composer.tsx`, `features/chat/ChatRoute.tsx`, `features/chat/GoalsRoute.tsx`, `features/chat/FolderRoute.tsx`, `features/chat/ArchivedRoute.tsx`, `features/chat/ChannelSidebar.tsx` ("New folder"), `ui/ChatSession/ComposerPopovers.tsx` (context tab state), `ui/ChatSession/MessageList.tsx` (suggested actions). Store: add chat mutations to `src/app/store.ts` (archive/restore/delete/rename/pin/move-to-folder on mock sessions).
- Test: `ui/ChatSession/ChatMenu.test.tsx`, extend `features/chat/ChatRoute.test.tsx`.

- [ ] **Step 1:** Add chat-session mutations to the store (or mock repo) + selectors; supply ChatMenu's 8 callbacks from the session owner.
- [ ] **Step 2:** Wire ChatMenu items: Rename (inline prompt/dialog), Move to folder (folder picker popover), Link to goal (goal picker), Pin, Export as Markdown (client-side download), Copy link (clipboard), Archive, Delete (confirm).
- [ ] **Step 3:** Wire Composer: attach (file input), mic (toggle recording state), "View full history" (expand), "Turn off auto" (store flag); goal→chat buttons; folder ops (edit/rename/share/add-file/sort); archived restore/delete + "Delete all"; context picker tab switching; suggested actions.
- [ ] **Step 4:** Tests: ChatMenu fires each callback; archiving a chat moves it to `/archived` and restore returns it.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS. Commit `feat(chat): wire chat menu, composer, folder & archived actions`.

### Task 8: Team in-screen actions (D)

**Files (modify):** `features/team/tabs/*` (ProfileTab appearance pickers, JobTab edit, BehaviorTab add-topic/handoff/language dropdowns, PlaybookTab view/edit/history/keep/undo, SkillsTab permission selects), `features/team/HelperDetail.tsx` (Pause, more-options menu, role selector, model menu), `features/team/TeamRoster.tsx` (more-options), `features/team/SetupDialog.tsx` + `HireDialog.tsx` + `RolesModelsDialog.tsx` dropdowns, `features/team/channel-dialogs/*` (method toggles/confirm).
- Test: `features/team/HelperDetail.test.tsx` (new) covering the dropdown menus open + selection updates local state.

- [ ] **Step 1:** Convert the chevron "dropdown" buttons (reports-to / model / role / handoff / language) into Radix dropdown menus backed by local state.
- [ ] **Step 2:** Wire ProfileTab appearance pickers (color/shape/prop) to update the previewed mascot locally; "Use a picture"/"Back to original"; Pause + more-options menus.
- [ ] **Step 3:** Wire tab edit/view/history/keep/undo buttons (open editor dialog or toggle edit mode) and channel-dialog method toggles + confirm.
- [ ] **Step 4:** Test: open a helper, open the Model dropdown, pick an option, assert the trigger label updates.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS. Commit `feat(team): wire helper detail menus, tabs & dialogs`.

### Task 9: Control Panel in-screen actions (D)

**Files (modify):** `features/control-panel/ControlPanelShared.tsx` (SaveBar dirty state), each `sections/Section*.tsx` with toggles/menus (Members role + options, Connectors connect/options, Notifications checkboxes + weekend toggle, General "Open handbook"), and existing dialog triggers already wired via `onDialog`.
- Test: `features/control-panel/SaveBar.test.tsx` (new).

- [ ] **Step 1:** Add a dirty-state hook (local per section or store) so SaveBar's Save/Discard enable + act (Save → clear dirty + toast; Discard → reset).
- [ ] **Step 2:** Wire toggles/checkboxes (controlled inputs) and the role/options dropdown menus (Radix) with local state.
- [ ] **Step 3:** Wire Connectors "Connect" → open the existing connector dialog; "Open handbook" → `/control-panel/handbook` or the handbook doc.
- [ ] **Step 4:** Test: toggle a setting → SaveBar enables; click Save → SaveBar clears.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS. Commit `feat(control-panel): wire SaveBar, toggles & section menus`.

### Task 10: Notifications, Rail, Chief DM & Command Menu actions (D)

**Files (modify):** `features/notifications/NotificationsRoute.tsx` (decision actions → resolve+remove/toast, "Mark all read", Settings icon → `/control-panel/notifications`, rows → navigate to source), `ui/Rail.tsx` (ProfileMenu items → navigate/actions, "Add company" → dialog), `features/chief-dm/ChiefDm.tsx` (search, history, "start new private chat"), `features/command-menu/CommandMenu.tsx` (all result rows navigate + close menu; action rows run handlers; keyboard Enter parity).
- Test: `features/command-menu/CommandMenu.test.tsx` (navigate + close), extend notifications test.

- [ ] **Step 1:** Command Menu: give each result row an `onSelect` that navigates to its route (pages/chats/helpers/channels) and closes the menu; wire action rows (New chat, etc.); ensure Enter on the highlighted row matches click.
- [ ] **Step 2:** Notifications: decision actions resolve against local state (remove card / toast); "Mark all read" clears unread; Settings icon + row click-through navigate.
- [ ] **Step 3:** Rail: ProfileMenu items navigate (Account/Settings/Notification settings → control-panel sections; Keyboard shortcuts → dialog; Log out → `/auth/sign-in`); "Add company" → a simple dialog.
- [ ] **Step 4:** Chief DM: search toggles a search field, history opens a thread list, "start new private chat" creates a thread locally.
- [ ] **Step 5:** Test: open Command Menu, select a page result, assert menu closed + URL changed. `bun run test` + `bun run lint` PASS. Commit `feat(ui): wire notifications, rail, chief-dm & command-menu actions`.

### Task 11: Canvas editing (C3)

Make the flow canvas interactive on local state (visual builder, not a real engine).

**Files (modify):** `features/office/flows/OfficeFlowCanvasRoute.tsx`, `OfficeFlowDraftRoute.tsx`, `OfficeFlowRunsRoute.tsx`, `features/office/flows/shared.tsx`; add canvas state to `flows/data.ts` or a local reducer.
- Test: `features/office/flows/Canvas.test.tsx` (new).

- [ ] **Step 1:** Node selection → detail/edit panel reflects the selected node; edits update local canvas state.
- [ ] **Step 2:** Palette add-step, connect, and toolbar (Move/Connect/Settings) mutate the local node/edge model.
- [ ] **Step 3:** Draft "Test run" / Canvas "Run again" / "View full log" drive a mock run state; Runs "Approve/Decline/Cancel/Publish" update run status locally.
- [ ] **Step 4:** Test: select a node → detail panel shows its label; add a step → node count increases.
- [ ] **Step 5:** `bun run test` + `bun run lint` PASS. Commit `feat(flows): interactive canvas editing on local state`.

### Wave 2 gate
- [ ] `bun run build` passes.
- [ ] Full click-through: every control in the dead-end inventory now performs a visible action or navigation.

---

## Self-Review notes

- **Spec coverage:** A1→T1, A2→T2, B(Routines)→T3, B(deep-links)→T4, C(flows nav)→T5, E(auth/onboarding)→T6; D is split by area T7–T10; C3(canvas)→T11. All five buckets covered.
- **Type consistency:** `ControlPanelSection`, `NotifFilter`, `OfficeNav` reused from existing/stated definitions; `activeNav` extension in T3 matches `OfficeNav` which already includes `'Routines'`.
- **Review Focus:** each of the five items has an owning task + assertion (T4 rail highlight, T3 routines active, T1 section URL sync, T6 flow targets, T10 command-menu close).
- **Proportion:** plan references the inventory instead of transcribing ~90 handlers; code blocks avoided in favor of signatures + flow maps.
- **Pen dependency:** T1/T2 visuals are inferred and marked for a later pen-refinement pass (not a separate task — fold into whichever session regains pen access).
