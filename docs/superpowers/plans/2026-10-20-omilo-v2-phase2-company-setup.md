# Omilo v2 UI Refresh — Phase 2: Company & Setup Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refresh the Company & Setup screens (Company, Connectors, Skills, Folders, AI accounts, Settings) to the v2 design, matching their pen frames, on the already-merged v2 shell + Phase 1.

**Architecture:** Front-end-only, per-screen. Each screen gets Page Header v2 (title + sub + actions in the body; Settings uses its own nav+content) and a body layout matching its pen frame, preserving all behavior. Shell (Sidebar/Topbar/⌘K/tokens) + Phase 1 are already in `main`.

**Tech Stack:** Next.js 15 App Router, React 19, custom CSS tokens in `app/globals.css` (no Tailwind), Remix Icon. No test harness — verification is `./node_modules/.bin/tsc --noEmit` (run tsc directly; the `npm run lint` wrapper mangles output) + `npm run build` + visual-vs-pen at phase end.

**Spec:** `docs/superpowers/specs/2026-10-20-omilo-v2-ui-refresh-design.md`
**Pattern reference:** `docs/superpowers/plans/2026-10-20-omilo-v2-phase1-home-work.md` (established the per-screen Page-Header-v2 + preserve-behavior + no-dead-CSS pattern).
**Design source (read-only):** pen.dev `omilo.pen` at `/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`. Read node detail with `mcp__pencil__execute` (`Get(visitor)`, `TakeScreenshot([id])`). Never Read/Grep the `.pen` file.

## Global Constraints

- **No backend/API changes.** Wire only to existing endpoints; surface gaps, don't add backend. (Note: `main` recently added catalog/MCP-connect backend + fields — the Connectors refresh must preserve/consume whatever the page already uses, including any new mcp-connect UI.)
- **Preserve ALL existing behavior** per screen: data loading/polling, drawers, dialogs, forms, OAuth/connect flows, context menus, markdown editors, file browsers, access controls, settings toggles, and mobile responsiveness. Dropping a working feature = failure.
- **Page Header v2** (pen `GYW5H`): Title + Sub + Actions in the page body; register the page's primary action via existing `usePageActions`/`PageActionsCtx` so the Topbar v2 shows it. (Settings has no Page Header — it uses a Settings Nav + Content two-pane; refresh that.)
- **Faithful to pen.dev**: exact layout/copy/structure read from the cited pen node at implementation.
- Additive CSS; reuse existing classes + v2 tokens; keep responsive behavior. **NO dead CSS** — every new class must be referenced in rendered markup (verify with grep before committing). Do not leave orphaned old rules when you rename classes — remove them.
- Verify each task: `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build` passes.

## Review Focus

Manual/behavior checks pinned to owning tasks:
1. **Connectors** — the connect/OAuth flow + the new MCP-connect fields/cards + marketplace grid + advanced form all still work. → Task 2.
2. **Skills** — skill list + write/edit drawer + import-from-talent + markdown preview intact. → Task 3.
3. **Folders** (`/computer`) — folder add + access level (read/write) + command-exec permission + file browser intact. → Task 4.
4. **AI accounts** (`/harness`) — Claude Code pool accounts table + direct provider cards + consent dialog intact. → Task 5.
5. **Settings** — all setting groups (Company/AI/You/Data) + toggles + subsections save correctly. → Task 6.
6. **Company** — knowledge files (markdown, folders, history/edit) + KPI board intact. → Task 1.

---

## File Structure

Each task modifies one route page (+ colocated components) and appends to `app/globals.css`. Screens are independent; only `globals.css` is shared (serial under SDD).

- Task 1: `app/company/page.tsx` — pen `uNzlj` (Page Header / KPIs / KPI Ghosts / Knowledge)
- Task 2: `app/connectors/page.tsx` — pen `rwISc` (Page Header / Filters / Rows / Callout)
- Task 3: `app/skills/page.tsx` — pen `q7NyU` (Page Header / Empty / How it works / Starter skills / Starters)
- Task 4: `app/computer/page.tsx` — pen `SAbte` (Page Header / Columns)
- Task 5: `app/harness/page.tsx` — pen `KktHp` (Page Header / Stats / Accounts / Direct providers)
- Task 6: `app/settings/page.tsx` — pen `K4jhK` (Settings Nav / Content)

---

### Task 1: Company v2

**Files:** `app/company/page.tsx` (+ colocated Knowledge/KpiBoard components if owned); append `app/globals.css`. Reference pen `uNzlj`.
**Interfaces:** Existing company knowledge data (markdown files by folder, edit/history), KPI board.

- [ ] Step 1: Read pen `uNzlj` (Page Header / Section·KPIs / KPI Ghosts / Section·What your helpers know / Knowledge) + `TakeScreenshot(['uNzlj'])`.
- [ ] Step 2: Add Page Header v2 (title + sub + any primary via `usePageActions`). Refresh the KPIs section (+ empty "ghost" state) and the Knowledge section to match `uNzlj`. **Preserve:** markdown knowledge files, folder organization, edit + history, KPI board data.
- [ ] Step 3: Append v2 CSS; reuse existing classes; NO dead CSS (grep each new class).
- [ ] Step 4: Verify `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Report + confirm knowledge editor + KPI board intact + no dead CSS.
- [ ] Step 5: Commit `feat(web): Company v2 — Page Header + KPIs/knowledge layout`.

### Task 2: Connectors v2

**Files:** `app/connectors/page.tsx` (+ colocated); append `app/globals.css`. Reference pen `rwISc`.
**Interfaces:** Marketplace grid, connect/OAuth flow (polling), advanced MCP-server form, the NEW mcp-connect fields/cards recently added on `main`, template picker, restorable banner.

- [ ] Step 1: Read pen `rwISc` (Page Header / Filters / Row / Callout) + screenshot. ALSO read the CURRENT `app/connectors/page.tsx` carefully — `main` recently added MCP-connect fields/cards; preserve them.
- [ ] Step 2: Add Page Header v2 (title + sub + primary via `usePageActions`). Refresh the Filters + connector Rows + Callout to match `rwISc`. **Preserve:** marketplace grid, OAuth connect flow + polling, advanced form, MCP-connect fields/cards, template picker, restorable banner.
- [ ] Step 3: Append v2 CSS; NO dead CSS.
- [ ] Step 4: Verify tsc + build. Report + confirm connect/OAuth + MCP-connect preserved (Review Focus #1).
- [ ] Step 5: Commit `feat(web): Connectors v2 — Page Header + filters/rows layout`.

### Task 3: Skills v2

**Files:** `app/skills/page.tsx` (+ colocated); append `app/globals.css`. Reference pen `q7NyU`.
**Interfaces:** Skill list, write/edit drawer, import-from-talent, markdown preview/editor.

- [ ] Step 1: Read pen `q7NyU` (Page Header / Empty / How it works / Section·Starter skills / Starters) + screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + "New skill" primary via `usePageActions`). Refresh the empty state, "How it works", starter-skills section/cards to match `q7NyU`. **Preserve:** skill list, write/edit drawer, talent import, markdown preview.
- [ ] Step 3: Append v2 CSS; NO dead CSS.
- [ ] Step 4: Verify tsc + build. Report + confirm drawer + import + preview intact (Review Focus #2).
- [ ] Step 5: Commit `feat(web): Skills v2 — Page Header + starters layout`.

### Task 4: Folders v2 (/computer)

**Files:** `app/computer/page.tsx` (+ colocated); append `app/globals.css`. Reference pen `SAbte`.
**Interfaces:** Folder list + add, access level (read/write), command-exec permission, file browser, drawer.

- [ ] Step 1: Read pen `SAbte` (Page Header / Columns) + screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + primary via `usePageActions`). Refresh the Columns layout to match `SAbte`. **Preserve:** folder add, access-level chips (read/write), command-exec permission, file browser, drawer.
- [ ] Step 3: Append v2 CSS; NO dead CSS.
- [ ] Step 4: Verify tsc + build. Report + confirm folder/access/exec/browser intact (Review Focus #3).
- [ ] Step 5: Commit `feat(web): Folders v2 — Page Header + columns layout`.

### Task 5: AI accounts v2 (/harness)

**Files:** `app/harness/page.tsx` (+ colocated PoolMeter etc.); append `app/globals.css`. Reference pen `KktHp`.
**Interfaces:** Claude Code pool accounts table, direct provider cards, consent dialog, pool meter.

- [ ] Step 1: Read pen `KktHp` (Page Header / Stats / Accounts / Direct providers) + screenshot.
- [ ] Step 2: Add Page Header v2 (title + sub + primary via `usePageActions`). Refresh Stats + Accounts table + Direct providers to match `KktHp`. **Preserve:** pool accounts table, pool meter, direct provider cards (OpenAI/Gemini/etc.), consent dialog.
- [ ] Step 3: Append v2 CSS; NO dead CSS.
- [ ] Step 4: Verify tsc + build. Report + confirm accounts table + providers + consent intact (Review Focus #4).
- [ ] Step 5: Commit `feat(web): AI accounts v2 — Page Header + pool/providers layout`.

### Task 6: Settings v2

**Files:** `app/settings/page.tsx` (+ colocated); append `app/globals.css`. Reference pen `K4jhK`.
**Interfaces:** Setting groups (Company/AI/You/Data), row components, switches, knowledge/notify subsections.

- [ ] Step 1: Read pen `K4jhK` (Settings Nav / Content) + screenshot.
- [ ] Step 2: Refresh the Settings layout to the v2 Nav + Content two-pane matching `K4jhK` (left nav of groups, right content). **Preserve:** every setting group + row + switch/toggle, the "You" subsections (account/devices/notifications), Data (activity log/storage), and their save behavior. (If pen shows a page header, add it; otherwise match the nav+content.)
- [ ] Step 3: Append v2 CSS; NO dead CSS.
- [ ] Step 4: Verify tsc + build. Report + confirm all setting groups + toggles save (Review Focus #5).
- [ ] Step 5: Commit `feat(web): Settings v2 — nav + content layout`.

---

## Self-review notes
- Spec coverage: all 6 Phase-2 "Refresh ·" screens (Section 04) covered.
- Each task is one screen = independently testable; shared `globals.css` ⇒ sequential under SDD.
- Verification adapted to the no-test-harness reality (tsc direct + build + visual-vs-pen at phase end).
- Review Focus: 6 behavior-preservation checks, one per owning task.
- NO-DEAD-CSS is emphasized per task (Phase 1's most common finding) — grep each new class + remove orphaned old rules on rename.
- Connectors (Task 2) must preserve `main`'s recently-added MCP-connect fields/cards.
