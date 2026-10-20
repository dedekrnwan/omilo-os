# Omilo v2 UI Refresh — Phase 3: Team & Hire — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refresh the Team (`/staff`) and Hire (`/talent`) screens to the v2 design matching their pen frames, and surface Hire from within Team (Hire is off the v2 sidebar, per the shell decision).

**Architecture:** Front-end-only, per-screen, on the already-merged v2 shell + Phases 1-2. Team gets Page Header v2 + body layout from pen `b3nYgQ`; Hire (`/talent`) gets Page Header v2 + layout from pen `tdpSy` and a reachable entry point from Team (tab/button), since the v2 sidebar has no "Hire" item.

**Tech Stack:** Next.js 15 App Router, React 19, custom CSS tokens in `app/globals.css` (no Tailwind), Remix Icon. No test harness — verification is `./node_modules/.bin/tsc --noEmit` (run tsc directly; the `npm run lint` wrapper mangles output) + `npm run build` + visual-vs-pen at phase end.

**Spec:** `docs/superpowers/specs/2026-10-20-omilo-v2-ui-refresh-design.md`
**Pattern reference:** `docs/superpowers/plans/2026-10-20-omilo-v2-phase1-home-work.md` and `...phase2-company-setup.md` (established the per-screen Page-Header-v2 + preserve-behavior + no-dead-CSS pattern; NO-DEAD-CSS is the recurring finding — grep every new class, remove orphaned old rules on rename).
**Design source (read-only):** pen.dev `omilo.pen` at `/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`. Read node detail with `mcp__pencil__execute` (`Get(visitor)`, `TakeScreenshot([id])`). Never Read/Grep the `.pen` file.

## Scope note — what is NOT in this phase (deferred)
The Section 07 "You" pages (Profile menu `Wpq5w`, Account `UGXA0`, Notifications `g0oafn`, Email/SMTP `x51oB`, Help & guides `nRHse`, Guide article `ipDJM`) are **deferred**. They are reached from a new profile dropdown on the user avatar and would be **new standalone routes** (`/account`, `/notifications`, `/help`, etc. don't exist today) that overlap the already-refreshed Settings "You" group — new surface area + a nav restructure needing owner product decisions, not a mechanical refresh. They join the deferred list (Personas, Persona Studio, chat-bubble restyle) for a future brainstorm.

## Global Constraints

- **No backend/API changes.** Wire only to existing endpoints; surface gaps, don't add backend.
- **Preserve ALL existing behavior** per screen: staff list + detail drawer, helper state/access/budget, regular-jobs, first-job prompt, LookEditor (avatar), hire-from-talent, agent cards + drawer, division filter, playbook, hire/turn-into-skill actions, polling, context menus, mobile responsiveness. Dropping a working feature = failure.
- **Page Header v2** (pen `GYW5H`): Title + Sub + Actions in the body; register the page's primary via existing `usePageActions`/`PageActionsCtx` so the Topbar v2 shows it.
- **Hire reachable from Team:** since the v2 sidebar has no "Hire" item, add a clear entry point from the Team screen (a tab, a "Hire a helper" primary/button, or a section) to reach the refreshed `/talent`. Keep `/talent` addressable.
- **Faithful to pen.dev**: exact layout/copy/structure read from the cited pen node at implementation.
- Additive CSS; reuse existing classes + v2 tokens; keep responsive behavior. **NO DEAD CSS** — every new class referenced in markup (grep before committing); remove orphaned old rules on rename.
- Verify each task: `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build` passes.

## Review Focus

1. **Team** — staff list + detail drawer (state/access/budget/regular-jobs), LookEditor, first-job prompt, context menus all preserved. → Task 1.
2. **Hire reachable** — the refreshed `/talent` is reachable from Team (tab/button) and `/talent` still works directly. → Task 2.
3. **Hire** — agent cards by division, division filter, agent drawer (profile + hire form), playbook, hire + turn-into-skill actions preserved. → Task 2.

---

## File Structure

- Task 1: `app/staff/page.tsx` (+ colocated StaffDetail/HelperState/HelperAccess/LookEditor if owned) — pen `b3nYgQ`
- Task 2: `app/talent/page.tsx` (+ colocated AgentCard/AgentDrawer) — pen `tdpSy`; plus the Team→Hire entry point (small edit in `app/staff/page.tsx` or shared nav)

Only `app/globals.css` is shared (serial under SDD). Task 2 touches `app/staff/page.tsx` only to add the Hire entry point — a small, additive edit that must not disturb Task 1's work.

---

### Task 1: Team v2 (/staff)

**Files:** `app/staff/page.tsx` (+ colocated components it owns); append `app/globals.css`. Reference pen `b3nYgQ`.
**Interfaces:** Existing staff list + `StaffDetail` drawer (helper state, access, budget, regular jobs), `LookEditor`, first-job prompt, context menus, polling.

- [ ] Step 1: Read pen `b3nYgQ` ("Refresh · Team") — dump the `Scroll` subtree deep (`maxd` 6+) and `TakeScreenshot(['b3nYgQ'])`.
- [ ] Step 2: Add Page Header v2 (title + sub + primary via `usePageActions` — e.g. "Hire a helper" linking to the Hire entry). Refresh the team/helper list + layout to match `b3nYgQ`. **Preserve:** staff list, detail drawer (state/access/budget/regular-jobs), LookEditor avatar customization, first-job prompt, context menus, polling.
- [ ] Step 3: Append v2 CSS; reuse existing classes; NO dead CSS (grep each new class; remove orphaned old rules on rename).
- [ ] Step 4: Verify `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Report + confirm detail drawer + LookEditor + all helper controls preserved + no dead CSS.
- [ ] Step 5: Commit `feat(web): Team v2 — Page Header + helper list/detail layout`.

### Task 2: Hire v2 (/talent) + fold into Team

**Files:** `app/talent/page.tsx` (+ colocated AgentCard/AgentDrawer); a small entry-point edit in `app/staff/page.tsx`; append `app/globals.css`. Reference pen `tdpSy`.
**Interfaces:** Existing agent cards (emoji/division/description), division filter, agent drawer (profile + hire form), playbook (markdown), hire action, turn-into-skill action, polling. Consumes Task 1's Team page (adds the Hire entry point there).

- [ ] Step 1: Read pen `tdpSy` ("Refresh · Hire") deep + `TakeScreenshot(['tdpSy'])`.
- [ ] Step 2: Add Page Header v2 (title + sub + primary via `usePageActions`). Refresh the agent/division browse + agent drawer to match `tdpSy`. **Preserve:** agent cards by division, division filter, agent drawer (profile + hire form), playbook, hire + turn-into-skill actions, polling.
- [ ] Step 3: Add the **Hire entry point from Team** — a tab/button/section in `app/staff/page.tsx` that navigates to `/talent` (keep `/talent` addressable). Match how the pen presents Hire relative to Team (read `b3nYgQ`/`tdpSy` to see if Hire is a Team tab or a separate page with a Team CTA). Minimal, additive edit to the Team page — do not disturb Task 1's layout.
- [ ] Step 4: Append v2 CSS; NO dead CSS.
- [ ] Step 5: Verify tsc + build. Report + confirm agent cards/filter/drawer/hire/turn-into-skill preserved, Hire reachable from Team, `/talent` still works (Review Focus #2, #3).
- [ ] Step 6: Commit `feat(web): Hire v2 — Page Header + agents layout; reachable from Team`.

---

## Self-review notes
- Spec coverage: Team + Hire (Section 03 refresh items) covered; Hire-into-Team linkage addressed (per the shell decision that dropped Hire from the sidebar). Section 07 "You" explicitly deferred (new surface area; see Scope note).
- Each task is one screen = independently testable; shared `globals.css` ⇒ sequential under SDD. Task 2's small edit to `app/staff/page.tsx` is additive (entry point only) — low collision risk with Task 1.
- Verification adapted to the no-test-harness reality (tsc direct + build + visual-vs-pen at phase end).
- NO-DEAD-CSS emphasized per task (the recurring finding across Phases 1-2).
