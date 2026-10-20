# Omilo OS — v2 UI Refresh (apps/web) — Design

**Date:** 2026-10-20
**Status:** Draft for approval
**Owner:** Dede Kurniawan
**Design source of truth:** pen.dev file `omilo.pen`
(`/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`)

---

## Intent & why

The team has a new "v2" visual design for Omilo OS in pen.dev. It is a full refresh of
the existing product surface, reorganized navigation, and a cleaner component kit —
plus three genuinely new feature areas. We want the live web app (`apps/web`, Next.js)
to match that new design.

The pen.dev design stays exactly as-is — it is the spec, not a thing we edit. **All work
happens in `apps/web`.** We implement the refresh faithfully: colors, spacing, layout,
and component styling should match pen.dev, reusing existing code where it already fits
and restyling where it doesn't.

## Goals

- Bring the **existing, already-shipped screens** up to the v2 look, faithfully matching pen.dev.
- Adopt **Sidebar v2**: the reorganized, flatter, grouped navigation (HOME / WORK / TEAM /
  PERSONAS / SETUP) with a company switcher on top and "Pause all helpers" at the bottom.
- Prove the approach on **one screen end-to-end first** (shell + tokens + that screen),
  get sign-off, then roll the established pattern across the remaining screens.
- Keep everything that works today working — no regressions in behavior, routing, or data.

## Non-goals

- **No changes to the pen.dev file.** It is read-only reference.
- **No backend / API changes.** This is a front-end visual refresh. Data shapes, endpoints,
  polling, and auth flows stay as they are.
- **The persona feature areas are deferred (low priority)** and are NOT built in this phase:
  - **Personas** — marketplace, persona page, try/interview, hired+setup (pen Section 03)
  - **Persona Studio** — creator side, 6 screens (pen Section 06)
  Their *navigation entries* appear in Sidebar v2 (PERSONAS group) but render as a
  disabled **"Coming soon"** state — visible structure, no functionality yet.
- **⌘K Search & Ask Chief of Staff is IN scope** (not deferred). The v2 topbar centers on
  a working "Ask Chief of Staff / search" bar, so the ⌘K command palette (pen Section 05,
  7 states) is part of the shared shell foundation and must function. It wires to existing
  APIs (search over existing data; "Ask Chief of Staff" via the existing chat/assistant
  endpoint). If a needed endpoint is missing, surface it rather than adding new backend.
- No migration to Tailwind or any new styling framework. We keep the existing custom-CSS +
  design-token system in `apps/web/app/globals.css`.

## Anti-goals (how this fails even if it "works")

- Rebuilding the design system from scratch when the tokens already align (see below).
- A big-bang rewrite that leaves the app half-broken and unreviewable.
- Pixel-chasing one screen so hard that the shared shell/kit never stabilizes.
- Shipping dead links or confusing "Coming soon" entries that look broken rather than intentional.

## Current state (what exists today)

- **Stack:** Next.js App Router (`apps/web/app/*`), custom CSS design tokens in
  `apps/web/app/globals.css` (no Tailwind), Remix Icon for icons, fonts Inter /
  Bricolage Grotesque / Fraunces / IBM Plex Mono.
- **Shell:** `apps/web/components/Shell.tsx` renders a 252px sidebar + inset white workspace.
  Today's nav uses **5 sections** (home, work, team, tools, settings) where each section is a
  single nav link; the active section expands a `subnav`, and pages also appear as tabs in the
  top bar (`SectionTabs`). Bare pages: `/login`, `/setup` (and a focused `/onboarding`).
- **Routes** map ~1:1 to the pen "Refresh ·" screens (see roadmap).

### Token alignment (key finding)

The pen.dev design variables are **nearly identical** to the current `:root` tokens in
`globals.css` — same warm stone neutrals, same four font families, same core radii.
Deltas the refresh introduces are additive/small:

- Near-black `primary #171717` (already present as `--primary`).
- Status **tints/lines** already present: `ok/warn/bad/info` + `-tint` + `-line`.
- New in pen, to add: `faint`-based `line` at 65% alpha (already present), `r-btn: 7`,
  `r-dialog: 20`, `r-pill: 999`, per-role **helper-* brand colors**
  (`helper-brand/ops/dev/support/finance/marketing/sales/retro`), field tints
  (`field-indigo/sky/sage/amber/rose`), `spark`, `wire`/`wire-strong`, `on-ink-2`.

Implication: the token layer is a **small additive diff**, not an overhaul. Most refresh
effort is **layout/structure/component markup**, not color.

### Sidebar v2 vs today (key finding)

The v2 sidebar is a **flat, grouped list**: every page is a direct nav link under a group
header — HOME (Inbox, Workspace, Monitor), WORK (Plan, Calendar, Workflows, Docs),
TEAM (Team, Company), PERSONAS (Marketplace, Hired), SETUP (Connectors, Skills, Folders,
AI accounts, Settings) — company switcher on top, user + "Pause all helpers" at the bottom.

`globals.css` **already has** the CSS for this exact pattern (`.group > p`, `.navlink`,
`.navlink.on`, `.navlink .count`) — it just isn't what `Shell.tsx` currently renders
(it renders `secblock`/`subnav`/`sublink` + top `tabs`). So Sidebar v2 is largely a
**markup restructure in `Shell.tsx`** onto CSS that mostly exists, plus the new PERSONAS
group and Folders/AI-accounts labeling.

Exact v2 sidebar structure (read from pen `Qtlpq`):
- **Head:** Mark + brand "Omilo" / "Saga OS"
- **Company switcher**
- **HOME:** Inbox (`/`), Workspace (`/chat/`), Monitor (`/monitor/`)
- **WORK:** Plan (`/plan/`), Calendar (`/calendar/`), Workflows (`/workflows/`), Docs (`/docs/`)
- **TEAM:** Team (`/staff/`), Company (`/company/`)
- **PERSONAS:** Marketplace, Hired — **"Coming soon"** (deferred, no routes yet)
- **SETUP:** Connectors (`/connectors/`), Skills (`/skills/`), Folders (`/computer/`), AI accounts (`/harness/`)
- **Footer:** Settings (`/settings/`), Pause all helpers
- **Foot:** Avatar + user name + Log out

Notable changes from today: it's a **flat grouped list** (no per-section top tabs); **Settings
moves to the footer**; `/computer` is relabeled **"Folders"**, `/harness` is **"AI accounts"**;
there is **no "Hire" item** (see resolved decisions — Hire folds into the Team screen).

### Topbar v2 (key finding)

The v2 topbar (pen `vCbnG`) replaces today's section tabs with: **Crumb** (icon + page
title + a meta line, e.g. "Inbox · 1 needs you"), a spacer, the **Ask bar** ("Ask Chief of
Staff or search…" + ⌘K kbd), and a **More** menu. Per-page sub-navigation (tabs) is gone —
the flat sidebar replaces it. The per-screen title/subtitle/actions move into **Page Header
v2** (pen `GYW5H`: Title + Sub + Actions) rendered in the page body. Today's `PageActionsBar`,
the global Pause action, and the Paused chip need a home in this new topbar/more-menu.

## Resolved owner decisions

- **Sequencing:** prove on **Inbox** end-to-end first (shell + token deltas + Inbox), sign-off,
  then roll out.
- **Hire (`/talent`):** **folds into the Team screen** — refreshed and surfaced from within
  Team (tab/button); removed from the primary sidebar.
- **Topbar ⌘K Ask/search bar:** **functional**, not coming-soon. Pulls ⌘K Search (Section 05)
  into the shell foundation.
- **PERSONAS nav:** visible but disabled **"Coming soon"** (greyed nav item + small "Soon"
  pill, non-clickable, no route). Personas + Persona Studio deferred.
- **Fidelity:** faithful to pen.dev; reuse existing components/classes where they fit.
- **Drift policy (builder's call):** pen.dev is the *visual* spec; preserve **all** existing
  behavior, routes, data, and states. Where a live screen has states the pen frame doesn't
  depict, keep them, restyled in the v2 idiom. Where pen depicts a deferred feature, show the
  "Coming soon" treatment.
- **Brand:** match pen — "Omilo" / "Saga OS" in the sidebar head.

## Decided approach (the "how" we're committing to)

1. **Proof-first on Inbox (`/`).** First deliverable is the shared shell + token deltas +
   the Inbox screen, matched faithfully to pen `y9zI6S` (Refresh · Inbox). This exercises
   Sidebar v2, Topbar v2 **including the working ⌘K Ask/search bar**, Page Header v2, the
   token additions, and a representative content screen in one reviewable slice. Get sign-off
   before rolling out.
2. **Faithful match**, reusing existing components/classes where they already fit; restyle
   or restructure markup where they don't. Read each screen's spec directly from the pen
   nodes (ids listed in the roadmap) at implementation time.
3. **Sidebar v2 as a markup restructure** in `Shell.tsx` onto the existing `.group`/`.navlink`
   CSS, adding the PERSONAS group as disabled "Coming soon".
4. **Token deltas are additive** to `:root` in `globals.css` — add new variables, don't
   churn existing ones that already match.
5. **Deferred features stay deferred** — PERSONAS nav is visible-but-disabled; no persona /
   studio / ⌘K screens or routes in this phase.

## Roadmap (priority order, after Inbox proof is approved)

Each screen is matched faithfully to its pen node. High priority = existing-feature refresh.

**Phase 0 — Shared foundation (part of the Inbox proof)**
- Token deltas in `globals.css`
- `Shell.tsx` → Sidebar v2 (grouped flat nav, company switcher, Settings+Pause footer,
  PERSONAS coming-soon)
- Topbar v2 (crumb + More menu, with Pause / Paused-chip / PageActions rehomed)
- **⌘K command palette** (pen Section 05) — the working Ask/search bar: opened, searching,
  asking, answer, AI-unavailable, no-results, commands states; wired to existing APIs
- Page Header v2 treatment in page bodies

**Phase 1 — Home & Work** (pen Section 02)
- Inbox `/` (`y9zI6S`) ← proof screen
- Workspace `/chat` (`JGAmA`), Monitor `/monitor` (`r9oSp`), Plan `/plan` (`vlZH4`),
  Calendar `/calendar` (`XK5L0`), Workflows `/workflows` (`mAo8c`), Docs `/docs` (`S7MKc1`)
- "What changed" (`rdscC`) — confirm whether this is a new route or a section of Inbox.

**Phase 2 — Company & Setup** (pen Section 04)
- Company `/company` (`uNzlj`), Connectors `/connectors` (`rwISc`), Skills `/skills` (`q7NyU`),
  Folders `/computer` (`SAbte`), AI accounts `/harness` (`KktHp`), Settings `/settings` (`rwISc`/`K4jhK`)

**Phase 3 — Team & You** (pen Section 03 refresh + Section 07)
- Team `/staff` (`b3nYgQ`) — **with Hire (`/talent`, `tdpSy`) folded in** as a tab/section
- You · Account / Notifications / Email (SMTP) / Help & guides / Guide article
  (`UGXA0`, `g0oafn`, `x51oB`, `nRHse`, `ipDJM`) — these map into `/settings` "You" group.

**Deferred (low priority, separate future phase) — NOT in this project**
- Personas (Section 03: `a3LvwQ`, `mXXAY`, `S9wONt`, `XF12W`)
- Persona Studio (Section 06: `bz3FV`, `b1omtU`, `p8U6VG`, `eDtrU`, `oMDK2`, `CLaPo`)

(⌘K Search, Section 05, is **in scope** — see Phase 0 / Resolved owner decisions.)

## Constraints

- Next.js App Router; keep route structure and client/server component boundaries intact.
- Custom CSS in `globals.css` + Remix Icon; no new styling framework.
- Preserve all existing behavior: auth/bare pages, onboarding redirect, polling, page actions,
  context menus, drawers, notifications, chat launcher.
- Faithful to pen.dev as the visual spec.

## Open questions for the owner

None outstanding — the owner decisions above are resolved. Remaining unknowns are the
builder's to settle at implementation (below).

## Left to the builder

- Exact per-screen markup/structure, read node-by-node from the pen frames at implementation.
- The precise set of token variables to add and their final names in `:root`.
- The mechanics of restructuring `Shell.tsx` nav (flat grouped `.navlink` list) while preserving
  "last page per section" memory, mobile menu, counts/badges, and rehoming page actions / the
  Pause control / Paused chip into Topbar v2 + its More menu.
- Which existing API endpoints the ⌘K palette uses for search and "Ask Chief of Staff," and
  surfacing any gap (no new backend is in scope).
- Where the "You" sub-screens and "What changed" land (route vs. section) — verify against pen.
- Mechanics of folding Hire (`/talent`) into the Team screen (tab vs. section) and whether the
  `/talent` route stays addressable.
