# Omilo v2 — UI Foundation (Lean Vertical Slice)

**Date:** 2026-10-24
**Status:** Approved (2026-10-24) — proceeding to plan
**Author:** Dede (with Claude)

---

## 1. Intent & Why

Omilo v1 is an open-source "office for a founder and their AI staff" (FastAPI +
Next.js + Postgres, desktop via Tauri, with a Phaser-based spatial "office"
scene). Two problems drove the decision to build v2:

1. **Wrong core concept.** v1 was designed goal/task-oriented, forcing the whole
   UI to *represent an office*. But people's expectation of an AI product is
   **chatting**, roughly as polished as Claude/ChatGPT. The office metaphor got in
   the way instead of helping.
2. **Performance & structure.** Chatting felt laggy, and the codebase wasn't
   structured for clean growth.

The v2 insight: **chat is the core primitive.** "Office" is a company-wide *lens*
on top of the same chat/session primitive — not a separate spatial world. A new
omilo-v2 design already exists in pen.dev (`omilo-v2.pen`) and defines the full
product: two modes (**Chat** and **Office**) sharing one session UI, plus Goals,
Flows, Docs, Team, Control panel, Auth, Onboarding, ⌘K, and a floating Chief DM.

This document covers **only the first lean phase: a UI foundation / vertical
slice** that proves the two-mode flow feels right, with mocked data behind
adapter interfaces. No backend, no full screen inventory. We go lean and
incremental deliberately.

### Why now
v1's concept is settled as wrong; continuing to patch it wastes effort. A clean
v2 repo lets us encode the right architecture from line one and validate the
flow cheaply before investing in backend wiring.

### What success looks like (this phase)
Clicking through a running app, Dede can *feel* the Chat ↔ Office flow: pick a
channel, open a chat session that looks and behaves like a first-class chat app,
flip to Office and see a company-wide Inbox that opens **the same** session UI.
It feels instant. The architecture is obviously clean enough to keep building on.

---

## 2. Goals / Non-goals / Anti-goals

### Goals (this phase)
- A running desktop-capable app (Tauri shell + web-runnable) with the real v2
  design tokens and fonts applied.
- The **app shell**: left company rail with a Chat ↔ Office mode toggle; a
  context sidebar that changes per mode.
- **Chat mode**: channel list → open a channel → a shared **ChatSession**
  showing a mock thread, with a composer (model selector, thinking, @mention
  affordances as visual-only where logic isn't needed yet).
- **Office mode**: a company-wide **Inbox** list that opens the **same**
  ChatSession for an item.
- **Shared ChatSession primitive** proven to serve both modes.
- **Ports-and-adapters** architecture with **mock adapters** (in-memory) behind
  domain port interfaces, so the real API drops in later with no UI changes.
- It must feel **instant** (directly answering v1's lag pain).

### Non-goals (deferred to later phases, not cut forever)
Goals page, Flows (list + canvas editor), Docs/Knowledge (pgvector), Control
panel, Team/hiring, Notifications page, Authentication, Onboarding, Command menu
(⌘K), Chief DM floating, real streaming, and the real backend. Also deferred:
the full ~90-screen inventory from the .pen file.

### Anti-goals (would make this a failure even if it "works")
- **No spatial/Phaser office.** The office is a data view, not a game world.
- **No SSR / Next.js.** SSR+hydration is a prime suspect for v1's perceived lag.
- **No premature backend wiring.** UI-first; mocks behind interfaces only.
- **No big-bang build** of all screens. Lean slice first.
- **No leaking framework concerns into the domain core.** The `core/` layer must
  not import React, the router, or any transport.

---

## 3. Constraints

- **Design fidelity.** Match `omilo-v2.pen` — tokens, fonts, and the Chat/Office
  layout — closely. Tokens are pinned in §6.
- **Desktop-first, web-runnable.** Keep Tauri (v1 already uses it; it's the right
  lightweight choice). The same build must also run in a browser for fast dev.
- **Performance budget.** Interactions (switching channel/mode, opening a
  session) should feel immediate; no visible hydration/route-transition jank.
- **Clean repo.** Brand-new git repo, zero v1 baggage. The v1 FastAPI/Postgres
  backend becomes an external dependency plugged in later via an HTTP adapter.
- **Maintainable & adapter-driven** as a first-class requirement, not an
  afterthought.

---

## 4. Decided "How" (the calls we made)

These are decisions taken during brainstorming (some are Claude's calls on how
it gets made; Dede can veto any):

- **New clean repo.** (Dede's call.) Proposed disk home:
  `~/Documents/works/omilo/omilo-v2`. Name final at plan time.
- **Stack:** **Vite + React (SPA)**, **TanStack Router** (routing),
  **TanStack Query** (server-state via adapters), **Zustand** (UI/client state),
  **Tailwind CSS v4** + CSS-variable tokens, **Radix UI** primitives for
  menus/dialogs/popovers. Wrapped in **Tauri v2** for desktop. *(Claude's call;
  rationale: a pure SPA removes the SSR/hydration overhead behind v1's lag, and
  Tauri stays.)*
- **Architecture:** ports-and-adapters (hexagonal) + feature-sliced UI. Domain
  core is framework-free; adapters implement ports; features compose UI from a
  shared design system. Layout in §5.
- **Data for this phase:** **in-memory mock adapters** behind port interfaces.
- **Package manager:** **bun** (Dede already uses it). pnpm acceptable fallback.
  *(Claude's call.)*
- **Lean slice** (not all screens) — confirmed by Dede.

---

## 5. Architecture & Repo Layout

Ports-and-adapters keeps the domain pure and makes "mock now, real API later" a
swap of one folder. Feature slices keep Chat and Office independent while sharing
the design system and the ChatSession primitive.

```
omilo-v2/
  src/
    app/            # shell, router, providers, mode switching (Chat/Office)
    core/           # FRAMEWORK-FREE domain
      domain/       # entities: Company, Channel, Session, Message, InboxItem, Helper, Model
      ports/        # interfaces: ChannelRepo, SessionRepo, MessageRepo, InboxRepo, ...
      usecases/     # thin orchestration if/when needed (kept minimal this phase)
    adapters/
      mock/         # in-memory implementations of every port (this phase)
      http/         # real API client (later; not built this phase)
    features/
      chat/         # chat-mode screens: channel list, channel view
      office/       # office-mode screens: inbox list
    ui/             # design system: tokens.css, primitives (Button, Avatar, Icon,
                    #   Menu, Dialog...), and the shared <ChatSession/> primitive
    lib/            # utils, formatting
  src-tauri/        # Tauri v2 shell (minimal this phase)
  docs/superpowers/specs/
```

**State split**
- *Server-state* (channels, sessions, messages, inbox) → TanStack Query, always
  fetched through a port, never a direct mock/HTTP import from a component.
- *Client/UI-state* (active mode, active channel, selected session, panel
  open/closed) → Zustand.

**Routing (TanStack Router)** — shape, finalized at plan time:
- `/chat/:channelId` and `/chat/:channelId/:sessionId`
- `/office/inbox` (and `/office/inbox/:itemId` opening the session)
- Mode toggle swaps the active branch and restores last location per mode.

**The ChatSession contract** is the keystone: one component, fed a session id +
a port, used identically by a channel view (Chat) and an inbox item (Office).
Proving this single component serves both modes is the main point of the slice.

---

## 6. Design Tokens (pinned from omilo-v2.pen)

Wire these as CSS variables; Tailwind v4 theme maps onto them.

**Neutrals / surfaces:** `app #F5F5F4`, `surface #FFFFFF`, `soft #FAFAF9`,
`line #E7E5E4A6`, `line-strong #E7E5E4`, `hover #E7E5E4A6`, `disabled-bg #E5E5E5A6`.
**Ink/text:** `ink #0C0A09`, `ink-2 #44403C`, `muted #78716C`, `faint #A8A29E`,
`on-ink-2 #D6D3D1`.
**Primary (near-black buttons):** `primary #171717`, `primary-hover #262626`,
`primary-ink #FFFFFF`. **Link:** `#2563EB`.
**Status (color / tint / line):** ok `#15803D`/`#F0FDF4`/`#BBF7D0`,
warn `#B45309`/`#FFFBEB`/`#FDE68A`, bad `#B91C1C`/`#FEF2F2`/`#FECACA`
(+`bad-solid #DC2626`), info `#1D4ED8`/`#EFF6FF`/`#BFDBFE`.
**Helper accents:** brand `#6366F1`, ops `#0EA5E9`, dev `#14B8A6`,
support `#EC4899`, finance `#65A30D`, marketing `#F97316`, sales `#8B5CF6`,
retro `#64748B`; `spark #F59E0B`, `mascot-ink #1C1917`.
**Field tints:** base `#FAFAF9`, indigo `#E0E7FF`, sky `#E0F2FE`, sage `#ECFCCB`,
amber `#FEF3C7`, rose `#FCE7F3`.
**Radii:** xs 4, sm 6, base 8, md 10, lg 12, btn 7, dialog 20, pill 999.
**Fonts:** sans **Inter**, display **Bricolage Grotesque**, mono **IBM Plex Mono**,
serif **Fraunces**.

Reference screens in the .pen: `Chat · Session`, `Office · Inbox`,
`Chat · New chat (General)`, plus the `OMILO V2 · 01 Design system` section.

---

## 7. Lean Slice — Definition of Done

1. App builds & runs (web dev + Tauri shell), tokens + fonts applied.
2. Left rail renders: company dot(s), Team/gear/bell icons (static), and a
   working **Chat ↔ Office toggle** at the bottom.
3. **Chat mode:** sidebar lists mock channels (General, Engineering, Marketing);
   selecting one opens the channel; opening/selecting a session renders the
   shared **ChatSession** with a mock thread + a composer (model-selector
   dropdown present; @mention visual affordance).
4. **Office mode:** sidebar nav shows Inbox; **Inbox** lists company-wide mock
   items; opening an item renders the **same** ChatSession.
5. Mode + last-location persist across toggles.
6. All data comes from **mock adapters behind ports**; no component imports a
   mock directly.
7. Interactions feel instant.

---

## 8. Left to the Builder

- Exact component API shapes (`<ChatSession/>`, composer, rail, sidebar).
- Micro-structure inside each feature slice.
- Which specific Radix/shadcn pieces to pull in.
- Mock fixture content (channels, a believable thread, inbox items).
- Test strategy: this is a UI foundation, so keep tests light — but any real
  logic (adapter/port contracts, mode/location persistence, the ChatSession
  data-binding) gets TDD. The port interfaces should have a contract test the
  mock satisfies, so the future HTTP adapter can reuse it.
- Final route path strings and the mode-restore mechanism.
- Final repo name.

---

## 9. Resolved Builder Questions (Claude's calls)

A builder-check raised five unknowns. All are settled here; none required Dede's
input because the `.pen` design or project context already answers them.

1. **`.pen` access.** The implementer reads `omilo-v2.pen` directly via the
   pen.dev MCP tools (tokens, screen structure, and screenshots were already
   pulled during design). The reference screens and the design-system section
   are available — no guessing of layout. (The file lives in pen.dev's document
   store, not at a plain repo path.)
2. **ChatSession ↔ Inbox contract.** An **InboxItem carries an optional
   `sessionId`**; opening an item loads that session into the shared
   `<ChatSession/>` via the same `SessionRepo`/`MessageRepo` ports a channel uses.
   This matches the design ("Chat mode and Office mode open the same thread").
   For the slice, every mock inbox item maps 1:1 to a mock session. The
   `InboxRepo` returns items; the session is fetched by id through the normal
   session port — so the "one primitive, both modes" claim is testable.
3. **Composer controls (model selector / thinking / @mention).** Built as
   **interactive but backend-inert**: real Radix dropdowns whose selection lives
   in local component/Zustand state and sends nothing. More convincing demo, no
   backend coupling.
4. **Tauri target this phase.** **`tauri dev` launching the Vite app in a
   webview** — no packaged/signed binary, no desktop CI. Packaging is a later
   phase. DoD "builds & runs" means the shell opens the app locally.
5. **Existing scaffold.** None — this is line-one in a brand-new repo (only
   `docs/` exists today). Step one is `bun create vite` + wiring the libraries
   and Tauri v2 from zero.

---

## 10. Later Phases (context, not in scope now)

Rough order once the foundation feels right: real streaming + HTTP adapter
against v1's backend → Goals → Flows (incl. canvas) → Docs/Knowledge → Team/
hiring → Control panel → Notifications → ⌘K → Chief DM → Auth → Onboarding.
Sequencing is the user's to decide later.
