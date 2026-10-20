# Omilo v2 UI Refresh — Phase 1: Home & Work Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refresh the remaining Home & Work screens (Workspace, Monitor, Plan, Calendar, Workflows, Docs) to the v2 design, matching their pen frames, on top of the already-merged v2 shell.

**Architecture:** Front-end-only, per-screen. Each screen gets Page Header v2 (title + sub + actions in the page body) where applicable and a body layout matching its pen frame, while preserving all existing behavior and data wiring. The shared shell (Sidebar v2, Topbar v2, ⌘K, tokens) is already in `main`.

**Tech Stack:** Next.js 15 App Router, React 19, custom CSS tokens in `app/globals.css` (no Tailwind), Remix Icon. No test harness — verification is `./node_modules/.bin/tsc --noEmit` (run tsc directly; the `npm run lint` wrapper mangles output) + `npm run build` + visual-vs-pen at phase end.

**Spec:** `docs/superpowers/specs/2026-10-20-omilo-v2-ui-refresh-design.md`
**Prior slice (pattern reference):** `docs/superpowers/plans/2026-10-20-omilo-v2-inbox-proof.md` (Inbox v2 — Page Header + Main/Side established the per-screen pattern).
**Design source (read-only):** pen.dev `omilo.pen` at `/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`. Read node detail with `mcp__pencil__execute` (`Get(visitor)`, `TakeScreenshot([id])`). Never Read/Grep the `.pen` file.

## Global Constraints

- **No backend/API changes.** Wire only to existing endpoints; surface gaps, don't add backend.
- **Preserve ALL existing behavior** on each screen: data loading/polling (incl. `useBoardStream`/`usePoll`), view toggles, drawers, dialogs, context menus, keyboard handling, deep-links, charts, editors, builders, and mobile responsiveness. A refresh that drops a working feature is a failure.
- **Page Header v2** (from pen `GYW5H`): Title + Sub + Actions, rendered in the page body (NOT the topbar). Register the page's primary action via the existing `usePageActions`/`PageActionsCtx` so it ALSO appears in the Topbar v2 (the shell renders `actions.primary` + `actions.more`). Pages that render their own topbar (`/chat`, `/docs` — the shell `own` branch) keep doing so; refresh happens inside the page.
- **Faithful to pen.dev**: exact layout/copy/structure read from the cited pen node at implementation.
- Additive CSS; reuse existing classes and v2 tokens; keep responsive behavior.
- Verify each task: `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build` passes.

## Review Focus

Manual/visual checks pinned to owning tasks (no automated harness):
1. **Monitor** charts/stats still render with live data and the view/period toolbar works. → Task 2.
2. **Workflows** builder/canvas still opens and edits; templates still instantiate. → Task 5.
3. **Docs** tree + editor + backlinks/graph still work; `[[links]]` and history intact. → Task 6.
4. **Workspace** (chat) threads/compose/run-panel + `?thread=`/`?view=work` deep-links intact. → Task 1.
5. **Calendar** month/week/day views + scheduled/recurring rendering + hover cards intact. → Task 3.
6. **Plan** goals + backlog cards + edit drawer + status/priority still work. → Task 4.

---

## File Structure

Each task modifies one route page (+ its colocated components) and appends to `app/globals.css`. Screens are independent (different route files); only `globals.css` is shared, so tasks run sequentially under SDD.

- Task 1: `app/chat/page.tsx` (+ chat components) — pen `JGAmA` (Threads / Chat / Run Panel)
- Task 2: `app/monitor/page.tsx` (+ chart/office components) — pen `r9oSp` (Page Header / Toolbar / Stats / Charts / Helpers / Loops / Columns)
- Task 3: `app/calendar/page.tsx` — pen `XK5L0` (Toolbar / Body)
- Task 4: `app/plan/page.tsx` — pen `vlZH4` (Page Header / Empty / Section · Not linked to a goal / Unlinked)
- Task 5: `app/workflows/page.tsx` (+ `components/workflows/*`) — pen `mAo8c` (Page Header / Tabs / Empty / Popular templates / Templates)
- Task 6: `app/docs/page.tsx` — pen `S7MKc1` (Tree / Editor / Context)

---

### Task 1: Workspace (chat) v2

**Files:** Modify `app/chat/page.tsx` (+ any colocated chat components it owns); append `app/globals.css`. Reference pen `JGAmA`.
**Interfaces:** Consumes existing chat data (`/threads`, `/tasks`, `/staff`), `openThread`, the side Run Panel, composer tools. `/chat` is a shell `own`-topbar page — keep its own header; refresh inside.

- [ ] Step 1: Read pen `JGAmA` (Threads / Chat / Run Panel) detail via `mcp__pencil__execute`; screenshot it for reference.
- [ ] Step 2: Refresh the three-pane layout (threads list / chat thread / run panel) to match `JGAmA`, restyling with v2 tokens. Preserve: thread list + groups, compose + composer "+" tools, @mentions, the panel tabs (progress/output/browser), `?thread=` and `?view=work` deep-links, polling, run/step rendering.
- [ ] Step 3: Append v2 CSS for the refreshed workspace panes (reuse `.ws-*` classes where they fit).
- [ ] Step 4: Verify `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Report structure + confirm deep-links/compose/run-panel intact.
- [ ] Step 5: Commit `feat(web): Workspace v2 — refreshed threads/chat/run-panel`.

### Task 2: Monitor v2

**Files:** Modify `app/monitor/page.tsx` (+ chart components: StackedBars/DataTable/BarList/Legend/Segments, office view); append `app/globals.css`. Reference pen `r9oSp`.
**Interfaces:** Consumes existing monitor data endpoints + charts (recharts/d3). 

- [ ] Step 1: Read pen `r9oSp` (Page Header / Toolbar / Stats / Charts / Helpers / Loops / Columns); screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + period/view actions; register primary via `usePageActions`). Restructure body into the v2 sections (Stats tiles → Charts → Helpers table → Loops → Columns) matching `r9oSp`. **Preserve all charts, tiles, pool/token/job data, helper table, failure breakdown, and the period/view toolbar.**
- [ ] Step 3: Append v2 CSS for the stat tiles / chart cards / sections.
- [ ] Step 4: Verify tsc + build. Report + confirm charts render and toolbar works (Review Focus #1).
- [ ] Step 5: Commit `feat(web): Monitor v2 — Page Header + v2 dashboard layout`.

### Task 3: Calendar v2

**Files:** Modify `app/calendar/page.tsx`; append `app/globals.css`. Reference pen `XK5L0`.
**Interfaces:** Consumes existing calendar data (scheduled jobs, recurring, workflows); month/week/day grids, hover cards.

- [ ] Step 1: Read pen `XK5L0` (Toolbar / Body); screenshot.
- [ ] Step 2: Refresh the toolbar (view switch month/week/day, nav, "upcoming" panel) and the grid Body to match `XK5L0`, v2 tokens. **Preserve month/week/day rendering, recurring/scheduled blocks, hover cards, avatars, and the upcoming list.**
- [ ] Step 3: Append v2 CSS for the calendar toolbar + grid.
- [ ] Step 4: Verify tsc + build. Report + confirm all three views + scheduling render (Review Focus #5).
- [ ] Step 5: Commit `feat(web): Calendar v2 — refreshed toolbar + grid`.

### Task 4: Plan v2

**Files:** Modify `app/plan/page.tsx`; append `app/globals.css`. Reference pen `vlZH4`.
**Interfaces:** Consumes existing goals/backlog data; edit drawer; status/priority/size/role chips.

- [ ] Step 1: Read pen `vlZH4` (Page Header / Empty · Set your first goal / Section · Not linked to a goal / Unlinked); screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + "New goal" primary via `usePageActions`). Refresh goals (60/30/10 splits), current focus, the "not linked to a goal" section, and backlog/unlinked cards to match `vlZH4`. **Preserve the edit drawer, priority/size/role chips, status, and markdown.**
- [ ] Step 3: Append v2 CSS for plan cards/sections/empty state.
- [ ] Step 4: Verify tsc + build. Report + confirm edit drawer + card data intact (Review Focus #6).
- [ ] Step 5: Commit `feat(web): Plan v2 — Page Header + goals/backlog layout`.

### Task 5: Workflows v2

**Files:** Modify `app/workflows/page.tsx` (+ `components/workflows/*` as needed for the list/templates view, NOT the canvas internals); append `app/globals.css`. Reference pen `mAo8c`.
**Interfaces:** Consumes existing workflows list + templates + the builder/canvas. 

- [ ] Step 1: Read pen `mAo8c` (Page Header / Tabs / Empty / Popular templates / Templates); screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + "New workflow" primary via `usePageActions`). Refresh the list view: Tabs, empty state ("Automate something you do every week"), "Popular templates" section, template cards — matching `mAo8c`. **Do NOT rebuild the canvas/Builder internals; preserve the builder, trigger/action nodes, preview, and template instantiation.** Restyle the list/templates shell only.
- [ ] Step 3: Append v2 CSS for workflow tabs/templates/empty.
- [ ] Step 4: Verify tsc + build. Report + confirm the builder still opens and templates instantiate (Review Focus #2).
- [ ] Step 5: Commit `feat(web): Workflows v2 — Page Header + list/templates refresh`.

### Task 6: Docs v2

**Files:** Modify `app/docs/page.tsx`; append `app/globals.css`. Reference pen `S7MKc1`. `/docs` is a shell `own`-topbar page.
**Interfaces:** Consumes existing notes tree, markdown editor, `[[links]]`, backlinks, outline, graph, history.

- [ ] Step 1: Read pen `S7MKc1` (Tree / Editor / Context); screenshot.
- [ ] Step 2: Refresh the three-pane docs layout (tree / editor / context: outline+backlinks+graph+history) to match `S7MKc1`, v2 tokens. **Preserve markdown editing, `[[link]]` suggestions, backlinks, the graph, outline, and version history.**
- [ ] Step 3: Append v2 CSS for the docs panes.
- [ ] Step 4: Verify tsc + build. Report + confirm editor/links/graph/history intact (Review Focus #3).
- [ ] Step 5: Commit `feat(web): Docs v2 — refreshed tree/editor/context`.

---

## Self-review notes
- Spec coverage: all 6 Phase-1 "Refresh ·" screens (Section 02) covered; Inbox already shipped in the prior slice.
- Each task is one screen = independently testable; shared `globals.css` ⇒ sequential under SDD.
- Verification adapted to the no-test-harness reality (tsc direct + build + visual-vs-pen at phase end).
- Review Focus: 6 behavior-preservation checks, one per owning task.
- Interface note: Page Header v2 primary actions register through the existing `usePageActions`/`PageActionsCtx` the shell already renders (from the prior slice).
