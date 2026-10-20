# Omilo v2 UI Refresh — Inbox Proof Slice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2 shared shell (Sidebar v2, Topbar v2 with a working ⌘K palette, Page Header v2, token deltas) and the refreshed Inbox screen as one reviewable, sign-off-able slice that proves the refresh pattern.

**Architecture:** Front-end-only refresh of the existing Next.js App Router app. Restructure `components/Shell.tsx` (nav + topbar) onto mostly-existing CSS, add additive design tokens to `globals.css`, introduce a new `CommandPalette` component mounted globally by the shell, and rebuild the Inbox (`app/page.tsx`) board into the v2 Main+Side layout. pen.dev is the visual spec; all existing behavior/routes/data are preserved.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript, custom CSS design tokens in `app/globals.css` (no Tailwind), Remix Icon. No test framework exists in `apps/web` — verification is `npm run lint` (tsc --noEmit), `npm run build`, and **visual comparison against the named pen frame** (run `npm run dev`, screenshot the route with Playwright, compare to the pen node screenshot).

**Spec:** `docs/superpowers/specs/2026-10-20-omilo-v2-ui-refresh-design.md`
**Design source (read-only, per-screen reference):** pen.dev `omilo.pen` at `/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`. Read node detail with the `mcp__pencil__execute` tool (`Get(visitor)` / `TakeScreenshot([id])`); **never** Read/Grep the `.pen` file directly.

## Global Constraints

- **No backend/API changes.** Wire only to existing endpoints (`api<T>(path,{method,body})` → `/api{path}`). Where the design implies an endpoint that doesn't exist, surface it — do not add backend.
- **Preserve all existing behavior:** auth/bare pages (`/login`, `/setup`), onboarding redirect, 30s overview polling, inbox count + favicon dot, context menus, drawers, notifications, chat launcher, company switcher, mobile responsiveness.
- **No new styling framework.** Additive CSS vars + classes in `app/globals.css`; reuse existing classes where they fit.
- **Faithful to pen.dev** as the visual spec. Exact labels/icons/copy/spacing come from the cited pen node, read at implementation time.
- **Brand copy:** sidebar head reads "Omilo" / "Saga OS" (per pen `Qtlpq`).
- **Deferred:** Personas + Persona Studio are NOT built; their PERSONAS nav group renders disabled "Coming soon".

## Review Focus

No automated test harness exists, so each item below is a **manual/visual verification step** pinned to the task that owns the code (most likely to bite first):

1. **"Coming soon" nav items (PERSONAS) must be inert** — not focusable, no navigation, no error on click. → Task 2.
2. **⌘K global shortcut must not fire while typing** in an input/textarea/contenteditable (composer, deny-note, search fields). → Task 4.
3. **⌘K "Ask" when the AI pool is unavailable** must show the AI-unavailable state (pen `y59pKp`), not hang or throw. → Task 4.
4. **Pause control rehomed to the topbar More menu** must still show the confirm dialog and reflect paused state (Paused chip). → Task 3.
5. **Mobile (<860px / <760px):** Sidebar v2 collapses to the menu, topbar stays usable, Inbox Main+Side stacks to one column. → Tasks 2, 3, 5.

---

## File Structure

- `app/globals.css` — add token deltas; add/adjust sidebar (`.group`/`.navlink`/coming-soon), topbar v2, command-palette, and inbox Main+Side styles.
- `components/Shell.tsx` — Sidebar v2 markup + nav data; Topbar v2 (crumb + Ask bar + More); mount `<CommandPalette/>`.
- `components/nav.ts` (new) — the v2 nav model (groups → items) shared by sidebar + palette "JUMP TO".
- `components/CommandPalette.tsx` (new) — the ⌘K palette (dialog, input modes, grouped results, keyboard nav, footer).
- `app/page.tsx` — Inbox refactor to Page Header v2 + Main+Side columns (behavior preserved).

---

### Task 1: Design token deltas

**Files:**
- Modify: `app/globals.css:4-28` (the `:root` block)

**Interfaces:**
- Produces: new CSS custom properties available app-wide. Names (verbatim from pen `GetVariables`): `--faint` (exists), `--line`/`--line-strong`/`--hover` (exist), `--primary`/`--primary-hover`/`--primary-ink`, `--on-ink-2`, `--ok/-tint/-line`, `--warn/-tint/-line`, `--bad/-tint/-line/--bad-solid`, `--info/-tint/-line`, `--disabled-bg`, `--field-base/-indigo/-sky/-sage/-amber/-rose`, `--wire`/`--wire-strong`, `--helper-brand/-ops/-dev/-support/-finance/-marketing/-sales/-retro`, `--mascot-ink`, `--spark`, `--r-xs/-sm/-btn/(-)/-md/-lg/-dialog/-pill`.

- [ ] **Step 1: Read the authoritative token values** from pen: run `mcp__pencil__execute` → `GetVariables()`. Copy exact hex/number values.
- [ ] **Step 2: Add the missing variables** to `:root` in `app/globals.css`, matching pen values. Only ADD or reconcile; do not churn existing vars that already match (`--app`, `--surface`, `--soft`, `--ink`, `--ink-2`, `--muted`, `--primary #171717`, `--link`, radii `--r-sm/r/r-md/r-lg`). Add `--primary-hover`, `--r-xs/-btn/-dialog/-pill`, all `--helper-*`, `--field-*`, `--wire*`, `--on-ink-2`, `--bad-solid`, `--disabled-bg`, `--mascot-ink`, `--spark`.
- [ ] **Step 3: Verify lint + build.** Run: `npm run lint && npm run build`. Expected: both pass.
- [ ] **Step 4: Verify vars present.** Run: `grep -E "\-\-helper-brand|\-\-field-indigo|\-\-r-dialog|\-\-spark" app/globals.css`. Expected: all four found.
- [ ] **Step 5: Commit.** `git add app/globals.css && git commit -m "feat(web): add v2 design tokens"`

---

### Task 2: Sidebar v2

**Files:**
- Create: `components/nav.ts`
- Modify: `components/Shell.tsx:17-47` (nav model + `SectionTabs`), `:154-205` (sidebar markup)
- Modify: `app/globals.css` (sidebar: `.group`/`.navlink` spacing, footer, coming-soon pill)
- Reference: pen `Qtlpq` (Sidebar v2), read node-by-node for icons/labels/order.

**Interfaces:**
- Produces (`components/nav.ts`):
  - `type NavItem = { href: string; label: string; icon: string; soon?: boolean; count?: "inbox" }`
  - `type NavGroup = { id: string; label: string; items: NavItem[] }`
  - `export const NAV: NavGroup[]` — groups in order: HOME (Inbox `/`, Workspace `/chat/`, Monitor `/monitor/`), WORK (Plan `/plan/`, Calendar `/calendar/`, Workflows `/workflows/`, Docs `/docs/`), TEAM (Team `/staff/`, Company `/company/`), PERSONAS (Marketplace + Hired, both `soon:true`, no real route), SETUP (Connectors `/connectors/`, Skills `/skills/`, Folders `/computer/`, AI accounts `/harness/`). Settings `/settings/` + Pause render in the footer, not a group.
  - `export const navItemFor(path: string): NavItem` — longest-prefix match (Inbox only on exact `/`).
- Consumes: `useOverview()` for `inbox.open` (Inbox count badge) and `paused`.

- [ ] **Step 1: Create `components/nav.ts`** with the types and `NAV` array above; icons copied from pen `Qtlpq` nav items (Remix Icon names matching the current Shell set where equivalent, e.g. Inbox `ri-inbox-2-line`). Include `navItemFor`.
- [ ] **Step 2: Replace the sidebar body in `Shell.tsx`** (the `<nav className="sections">…` block) with a flat grouped list: for each `NAV` group, render `<div className="group"><p>{label}</p>` then each item as `<Link className="navlink">` (active when `navItemFor(path).href === item.href`), inbox count badge via `<span className="count">`. Render `soon` items as a non-interactive element (e.g. `<span className="navlink soon" aria-disabled>` with a `<span className="soon-tag">Soon</span>`), NOT a `<Link>` — no href, `tabIndex={-1}`. Keep the mobile `.side.open` toggle, `CompanySwitcher`, and brand head (now "Omilo" / "Saga OS").
- [ ] **Step 3: Move Settings + Pause to the footer** region above the user `.foot`: a `Settings` `navlink` and the existing `togglePause` button. Keep the user avatar/name/logout `.foot` row.
- [ ] **Step 4: Remove per-section tab logic** no longer used (`SectionTabs` is replaced by the flat nav; its topbar role is handled in Task 3). Keep "last page per section" only if still meaningful; otherwise delete `LAST`/`lastIn`/`remember` and simplify. (Builder's call — remove dead code.)
- [ ] **Step 5: Add/adjust CSS** in `globals.css` for `.group` spacing within `.side nav`, `.navlink.soon` (muted, `cursor:default`, no hover nav), `.soon-tag` (small pill using `--faint`/`--disabled-bg`, `--r-pill`), and the footer nav block. Reuse existing `.navlink`, `.navlink.on`, `.navlink .count`.
- [ ] **Step 6: Verify lint + build.** Run: `npm run lint && npm run build`. Expected: pass.
- [ ] **Step 7: Visual verify vs pen `Qtlpq`.** Run `npm run dev`; screenshot the sidebar on `/` with Playwright; compare group order, labels, "Saga OS", PERSONAS "Soon", Settings+Pause in footer. **Manual check (Review Focus #1):** Tab through the sidebar — PERSONAS items are not focusable and clicking them does nothing. **Manual check (#5):** at <860px the sidebar collapses to the menu.
- [ ] **Step 8: Commit.** `git add components/nav.ts components/Shell.tsx app/globals.css && git commit -m "feat(web): Sidebar v2 — flat grouped nav, PERSONAS coming-soon"`

---

### Task 3: Topbar v2 (crumb + Ask bar + More)

**Files:**
- Modify: `components/Shell.tsx:148-224` (the topbar / `own` branch + `PageActionsBar` placement)
- Modify: `app/globals.css` (topbar v2: `.topbar` crumb/meta, `.ask`, `.topbar .more`)
- Reference: pen `vCbnG` (Topbar v2), `GYW5H` (Page Header v2).

**Interfaces:**
- Consumes: `navItemFor(path)` (Task 2) for crumb icon+title; `useOverview()` for the crumb meta (e.g. "N needs you") and `paused`; `useCommand()` (Task 4) to open the palette from the Ask bar.
- Produces: a consistent Topbar v2 across non-bare pages. The per-page title/subtitle/actions move into the page body as **Page Header v2** (owned per-screen; Inbox does it in Task 5).

- [ ] **Step 1: Rebuild the topbar** in `Shell.tsx`: left `crumb` = item icon + title + a `.meta` line (page-supplied or the inbox count on `/`); spacer; center/right **Ask bar** button (`<button className="ask">` with search icon + "Ask Chief of Staff or search…" + a `⌘K` kbd) that calls the command-open handler; a **More** menu button (`.iconbtn`) hosting the global actions — **Pause/Resume all helpers** (via `togglePause`, keeping its confirm dialog) and anything from `PageActionsBar`'s `extra`. Keep the Paused chip visible when `overview.paused`.
- [ ] **Step 2: Reconcile the `own` branch.** Pages that rendered their own topbar (`/chat`, `/docs`) keep working — ensure they still render under the new shell without a doubled topbar. (Builder's call per pen; minimal change.)
- [ ] **Step 3: Rehome `PageActionsBar`.** The per-page primary action belongs in Page Header v2 (page body). Keep `PageActionsCtx` so pages can still register actions; render registered primary action in the page header area and secondary/global ones in the topbar More menu.
- [ ] **Step 4: Add CSS** for `.topbar` crumb + `.meta`, `.ask` (pill input-look button, `--r-btn`, muted placeholder text, kbd on the right), `.topbar .more` menu. Reference pen `vCbnG`.
- [ ] **Step 5: Verify lint + build.** `npm run lint && npm run build`. Expected: pass.
- [ ] **Step 6: Visual verify vs pen `vCbnG`.** Screenshot the topbar on `/`. **Manual check (Review Focus #4):** open More → Pause all → confirm dialog appears; after pausing, the Paused chip shows. **Manual (#5):** topbar usable at mobile widths.
- [ ] **Step 7: Commit.** `git add components/Shell.tsx app/globals.css && git commit -m "feat(web): Topbar v2 — crumb, Ask bar, More menu"`

---

### Task 4: ⌘K command palette

**Files:**
- Create: `components/CommandPalette.tsx`
- Modify: `components/Shell.tsx` (mount `<CommandPalette/>` in the non-bare tree; expose open handler to the topbar Ask bar)
- Modify: `app/globals.css` (command dialog, scrim, input/modes, groups, footer, AI status)
- Reference: pen `osYyq` (Opened), `JxYA6` (Answer), `ZgE2O` (Commands), `C5jiI`, `VUgN5`, `y59pKp` (AI unavailable), `xesVS` (No results), `s7iC8i` (Command Kit).

**Interfaces:**
- Produces:
  - `export function useCommand(): { open: () => void; close: () => void }` (context hook) so the topbar Ask bar opens it.
  - `export default function CommandPalette(): JSX.Element` — renders nothing until opened.
- Consumes: `NAV` + `navItemFor` (Task 2) for JUMP TO; `useRouter` for navigation; `useOverview()` + `api` for pause (`POST /system {paused}`) and AI/pool status in the footer; existing threads list for RECENT; `askCos`-style thread creation to route "Ask" into chat.
- Behavior (modes, from pen):
  - Default: input "Search, or ask Chief of Staff anything…"; grouped results ASK-suggestions / RECENT / JUMP TO / ACTIONS; footer key hints + AI status.
  - `>` prefix → **command mode** (HELPERS: pause all / pause one; LOOPS) with inline Confirm for destructive ones (pen `ZgE2O`).
  - `@` → helper filter, `#` → chat filter (scope to what existing data supports; builder's call).
  - **Tab / "Ask Chief of Staff"** → ask mode. Submit creates a chat thread (existing `/inbox/:id/ask-cos` is per-item; for free-text use the existing thread-create path and **open the chat** — `⌘↵` "continue in chat"). The pen inline-answer state (`JxYA6`: answer + sources + token/cost) requires a backend `ask`/`search` endpoint that **does not exist** → implement ask-opens-chat now and **log a plan-level gap** (see note). Show the **AI-unavailable** state (`y59pKp`) when `overview` indicates the pool is down.

- [ ] **Step 1: Build the palette shell** — `useCommand` context + provider, global `keydown` listener for ⌘K/Ctrl-K that opens it, scrim + dialog, Esc to close. **Guard (Review Focus #2):** ignore the shortcut when `document.activeElement` is an input/textarea/`[contenteditable]`.
- [ ] **Step 2: Build default results** — ASK suggestions (static prompts from pen `osYyq`), RECENT (recent threads via existing API if available, else omit the group), JUMP TO (from `NAV`, excluding `soon` items), ACTIONS (New goal → `/plan`, Pause all → `/system`). Arrow-key navigation + Enter to run/navigate; footer key hints + AI status line from `overview`.
- [ ] **Step 3: Command mode (`>`)** — filter to HELPERS/LOOPS commands; inline Confirm row for Pause all (pen `ZgE2O`); wire pause to `POST /system`.
- [ ] **Step 4: Ask mode (Tab)** — switch input to "Asking Chief of Staff"; on submit, create/open a chat thread (existing capability) rather than an inline answer. Render the **AI-unavailable** state when the pool is down. Add a code comment + a line in the plan's gap note that the inline-answer state needs a backend endpoint (out of scope).
- [ ] **Step 5: Mount** `<CommandPalette/>` in `Shell.tsx` (non-bare tree) and wire the topbar Ask bar (Task 3) to `useCommand().open`.
- [ ] **Step 6: Add CSS** for `.cmd-scrim`, `.cmd-dialog` (`--r-dialog`), `.cmd-input` + mode chip + caret, `.cmd-group` label/count, `.cmd-item`/`.cmd-item.on`, `.cmd-ask-row`, `.cmd-foot` key hints + AI status dot. Reference pen `osYyq`/`ZgE2O`.
- [ ] **Step 7: Verify lint + build.** `npm run lint && npm run build`. Expected: pass.
- [ ] **Step 8: Visual + interaction verify.** Screenshot opened palette vs `osYyq` and command mode vs `ZgE2O`. **Manual checks:** ⌘K opens from anywhere except while typing (#2); arrow/Enter navigate; `>` enters command mode; Tab enters ask mode; AI-unavailable state renders when pool down (#3).
- [ ] **Step 9: Commit.** `git add components/CommandPalette.tsx components/Shell.tsx app/globals.css && git commit -m "feat(web): ⌘K command palette — search, commands, ask-to-chat"`

---

### Task 5: Inbox screen v2 (Main + Side)

**Files:**
- Modify: `app/page.tsx` (the `Inbox` default export + `BoardView`)
- Modify: `app/globals.css` (inbox: Page Header v2, Main+Side columns, cards)
- Reference: pen `y9zI6S` (Refresh · Inbox) — read `Main` and `Side` children for exact layout/content.

**Interfaces:**
- Consumes: existing `api<Board>("/board")`, `useOverview`, all existing handlers (bulk approve/deny, drawer, context menus) — preserved.
- Produces: the Inbox rendered as Page Header v2 (Title "Inbox" + Sub "Your helpers propose, you decide." + Actions) over a **Main + Side** layout: **Main** = "Needs you" list; **Side** = "Running now" + a secondary panel (Done/Community per pen). List and Map views remain reachable (view toggle in the page header actions).

- [ ] **Step 1: Read pen `y9zI6S`** Main/Side subtrees for exact structure and copy. Confirm what the Side panel contains (Running + Done vs Running + Community).
- [ ] **Step 2: Add a Page Header v2** block at the top of `Inbox` (Title + Sub + Actions with the Board/List/Map `seg` toggle), matching pen `GYW5H` placement.
- [ ] **Step 3: Refactor `BoardView`** from the 3-column `.board` into the Main+Side layout (new `.inbox2` / `.inbox2-main` / `.inbox2-side` classes). Keep `Column`/`Card` internals and ALL behavior: bulk bar, selection, deny dialog, detail `Drawer`, context menus, polling, `useNow`.
- [ ] **Step 4: Add/replace CSS** for the Main+Side grid and refreshed card styling per pen `y9zI6S`; keep responsive collapse to one column at <760px.
- [ ] **Step 5: Verify lint + build.** `npm run lint && npm run build`. Expected: pass.
- [ ] **Step 6: Visual verify vs pen `y9zI6S`.** Screenshot `/` (board view) and compare layout, header, Main/Side split. **Manual checks:** Board/List/Map toggle still works; open a card → detail drawer; bulk select → approve/deny still work (#5: stacks to one column on mobile).
- [ ] **Step 7: Commit.** `git add app/page.tsx app/globals.css && git commit -m "feat(web): Inbox v2 — Page Header + Main/Side layout"`

---

## Gap note (surface to owner, do not fix here)

The pen ⌘K **inline answer** state (`JxYA6`: Chief-of-Staff answer with sources, token count, and cost, rendered inside the palette) requires a backend "ask/search" endpoint that does not exist (`askCos` only creates a chat thread; there is no `/search`). Per the spec's "no new backend — surface the gap" rule, Task 4 ships ask-opens-chat and this inline-answer state is deferred pending a backend endpoint. Raise with the owner.

## Self-review notes

- **Spec coverage:** Phase 0 (tokens T1, Sidebar v2 T2, Topbar v2 T3, ⌘K T4, Page Header T3/T5) + Inbox proof (T5) — all covered. Personas/Studio correctly excluded. Hire-into-Team is a later phase (not this slice), consistent with "Inbox proof first."
- **Verification honesty:** no unit-test harness exists; steps use lint/build + visual-vs-pen + manual interaction checks rather than fabricated unit tests.
- **Review Focus:** 5 items each pinned to an owning task's verification step.
- **Interface consistency:** `NAV`/`navItemFor` defined in T2 and consumed by T3/T4; `useCommand` defined in T4 and consumed by T3's Ask bar (T3 lists it as consumed, T4 as produced).
