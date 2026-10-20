# Omilo OS — Workspace Chat Model v2, Group-Chat Components & Onboarding/Setup Refresh — Design

**Date:** 2026-10-20
**Status:** Approved (owner waived the approval gate — "do directly, I approved already")
**Owner:** Dede Kurniawan
**Design source of truth:** pen.dev file `omilo.pen`
(`/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`)
**Parent spec:** `2026-10-20-omilo-v2-ui-refresh-design.md` (this is the next phase; the v2 shell,
tokens, Sidebar v2, Topbar v2, Page Header v2, and Phase-1 Home/Work refresh already shipped to `main`).

---

## Intent & why

pen.dev gained **new designs** for three areas. Two of them change behavior, not just looks:

1. **Onboarding / setup** (pen Section 00, 5 screens) — a refreshed first-run flow built around a
   "7 notes" company-knowledge model, a 4-step stepper, and a "Your AI" step that accepts a
   local login / an existing subscription / an API key.
2. **Workspace chat model** (pen Section 02 workspace screens) — the biggest change. The old model
   was **DM-per-staff + named group channels**. The new model has **no DMs**: you talk to the
   Chief of Staff at a "desk" (Workspace Start), and every piece of **work is a group-chat thread**
   that helpers join by `@mention`. Explicit design copy: *"No DMs needed. @mention a helper in any
   work and they join it."*
3. **Floating chat drawer + group-chat components** (pen Section 05 Chat screens + Section 09) — a
   page-aware Chief-of-Staff **FAB + drawer** on every page that reuses a shared **agentic
   group-chat component library** (the building blocks of a helper's reply).

The pen.dev file stays read-only reference. **All UI work happens in `apps/web`.** Backend changes
are allowed this phase but must be **minimal and additive** — the model is already mostly supported.

## Goals

- Replace the DM-per-staff workspace with **Workspace Start (desk)** + **Focus chat session**
  (work-threads as group chats), faithful to pen.
- Build one **agentic group-chat component library** (renders `Message.blocks`) reused by both the
  focus session and the floating drawer.
- Rework the floating **Chat FAB + Drawer** to be page-aware, with a thread switcher and the new
  component library.
- Refresh **Onboarding** (5 screens) and **Company & Setup** (6 screens) to the pen "Refresh ·" look.
- No regressions: preserve routing, auth/bare pages, polling, approvals-in-chat, stop, drag-drop,
  pool meter, and existing endpoints.

## Non-goals / anti-goals

- **No pen.dev edits.** It is the read-only visual spec.
- **No destructive DB migrations, no removal of other people's in-flight work.** The `scope="staff"`
  (DM) thread type stays in the data layer; we simply stop surfacing per-staff DMs in the UI. Any new
  columns are nullable/additive with safe defaults.
- **No new styling framework.** Keep custom CSS + design tokens in `apps/web/app/globals.css` and
  Remix Icon. Token deltas are additive.
- **Personas stay deferred** ("Coming soon" nav, already in `nav.ts`).
- Not a big-bang rewrite: foundation (CSS + component library) first, then screens, each reviewable.

## Backend model: already-supported vs. additive (from code audit)

Already supports the new model (no change needed):
- `Thread.scope` ∈ {master, staff, task, proposal, group}; `Thread.pending` (JSON list) +
  `teamchat.mentions()/handover()` already route **multiple helpers** into one thread by `@mention`
  (sequential, `MAX_REPLIES=4`). (`models.py:212`, `teamchat.py:29-99`, `worker.py:636-757`)
- `Message.blocks` (JSON typed blocks) is exactly where the agentic components render from.
  (`models.py:226`)
- `Task` carries `cost_usd`, `tokens`, `status`, `Report`, `Checkpoint` (steps); a thread with
  `scope="task"` references its task via `ref_id`. (`models.py:110-155`)
- `worklog.live_state()` already unions tasks + awaiting chats + inbox. (`worklog.py:60-149`)
- `KbSource(kind, ref)` already links files/docs to a thread or task id (ref). (`models.py:549`)
- Onboarding endpoints (`/onboarding/ai|interview|team-plan|finish`) + the 7-note knowledge model
  all exist. (`routers/api.py:2237-2582`)

Additive backend needed for faithful "Focus session" + drawer (small, nullable, non-destructive):
- **Thread list grouping + summary** for the Threads rail: a thread-list payload that tags each
  thread `needs_you | active | earlier` (derived from `awaiting_reply`/`updated_at`/open inbox for
  the thread) and carries a one-line subtitle + participant staff ids + last-activity. Derivable at
  read time — **no new columns required**.
- **Focus details** for a work thread's right panel: PROGRESS (steps from the linked task's
  `Checkpoint`/runs), MADE IN THIS THREAD (`KbSource` where ref = thread id or linked task id),
  COST SO FAR (sum of linked task `cost_usd`/`tokens`). A read-only aggregation endpoint; **no new
  columns**.
- **Add a helper to a thread**: `POST /threads/{id}/add-helper {staff_id}` → posts/promotes the
  helper into the thread's participant set by writing an `@mention` system turn (reuses
  `teamchat`). No schema change.
- Thread **participants** displayed in the head are derived from `pending` ∪ distinct agent message
  authors. If, and only if, review shows derivation is insufficient for "persistent membership",
  add a nullable `Thread.participants` (JSON) with a safe default — decided by the implementer at
  T-backend with a ledger note; prefer derivation first.

The owner's "might change schema/business process" is honored by **deriving first, adding nullable
columns only where derivation provably fails** — recorded as a ruling in the ledger.

## The new surfaces (read node-by-node from pen at implementation)

### A. Agentic group-chat component library (pen Section 09 `roxVp`)
The building blocks of a helper's reply, each a reusable component instance in the pen doc. Render
them from `Message.blocks` typed entries. Component ids:
- Message shell `U2Lljm`; Hover Actions `B0Ksmn`; Usage Meter `lrtjv`; Feedback Bar `ihBIG`
  (+expanded `MJprW`); Streaming `duDp0`; Reasoning `HwExk` (+open `mEXXW`); Action Card `pT9bB`;
  Confirmation `T4FR5` (+done `kMvfJ`); Streaming Approval `RvtWB`; Task `CGKLK`; Todos `LZwtY`;
  Document `K4wTQ`; Sources `yp4g8`; Markdown `c0DKyw`; Code `Jxjui`; Image/Generating `SQBGY`,
  Image `Qnb06`. Composed example "Full reply" thread: `GAtoS` (owner bubble → Builder reply with
  Reasoning+Todos+Markdown+Code+Action Card+Sources+Usage Meter + Hover row(Hover Actions+Feedback)
  → Grower reply with Streaming Approval).
- A reply = avatar + "Who" row (name · role · time) + stacked blocks + hover row.

### B. Workspace Start — "desk" (pen `eyoSr`)
Sidebar v2 + Topbar v2 + two columns:
- **Desk (center):** greeting ("Good afternoon, {name}") with CoS avatar; big **Composer** to the
  Chief of Staff; **Suggestions** row (Review what's waiting / Plan next week / What did we spend?);
  "LATEST FROM CHIEF OF STAFF" + a CoS message; **Recent work** list (each = title + helper + meta).
- **Team now (right):** "Your team right now" + live; per-helper status cards (what they're doing +
  track/progress + link into the work); CoS "Next: …"; hint "No DMs needed. @mention a helper in any
  work and they join it."

### C. Focus chat session — "Inside the work" (pen `dK9R8`)
Three columns inside the inset:
- **Threads rail (left):** Back + segmented filter; groups **NEEDS YOU / ACTIVE / EARLIER TODAY**;
  each thread row = title + status dot + meta.
- **Thread (center):** Head (title + participant avatars + **Add helper** + More); **Messages** =
  system join **Events** + agent messages (component library B) + owner bubbles; **Composer**.
- **Details (right):** **PROGRESS** (step checklist), **MADE IN THIS THREAD** (files/PR/notes),
  **COST SO FAR** ($ · tokens · minutes).

### D. Floating Chat FAB + Drawer (pen `dg0fg`, `F6hoV`, `rdn21`, `nfuNY`)
- **FAB (`dg0fg`):** Chief-of-Staff avatar + unread badge; optional **nudge** bubble (title + body +
  Yes/Later). Opens the drawer. ⌘J toggles.
- **Drawer:** Head = **Thread switcher** (avatar + name + "Idle · can see this page" + chevron) +
  New chat + Open in Workspace + Close. **Context** row = "Looking at {current page}" chip (page
  awareness) with dismiss. **Messages** = component library B (empty state shows CoS intro +
  Suggestions + "PICK UP WHERE YOU LEFT OFF" recents). **Composer** + **Pool** status row
  ("Claude Code pool · 2/2 ready" + "⌘J to close"). Switcher dropdown (`rdn21` Thread Menu):
  search + **HELPERS** / **TEAM** (General) / **JOBS** + New chat. **Job thread** variant (`nfuNY`)
  shows a Job Card (regular job · schedule · Done chip · asked quote · meta 8m/34 steps/$0.12) then
  the helper's result message.

### E. Onboarding refresh (pen `fz8K5`,`G46NN`,`U2Krd`,`lnp4R`,`M59bq`)
Top bar (Mark + "Omilo · Setting up {Company}" + "Saved as you go" + Log out) + a 4-step **Stepper**
(Your AI · Get to know you · Check · Your team). Screens:
1. **Welcome:** crew avatars; "Let's build your AI team"; 3 steps; Let's start; right rail
   "WHAT YOUR TEAM WILL KNOW" → the 7 notes (Company, Customers, Goals, Offer, Rules, Systems, Voice).
2. **Your AI:** "Already signed in on this computer" (local login, detected) / "A subscription you
   already pay for" / "An API key" (providers); right rail "GOOD TO KNOW" tiles. Back / "No AI yet?
   Try with fixed questions" / Connect and continue.
3. **Get to know you:** left = interview chat (Topic N of 7 · {topic}, progress, ~min left, skip/
   finish-later, CoS/owner messages, composer with mic); right = **"What I've learned"** live 7-note
   panel (filled/next/empty) + "Speed up" (read website/doc, upload).
4. **Check:** CoS head; editable **7-note grid**; Back to our chat / "Took N min · M answers" /
   "Looks right, build my team".
5. **Your team:** picked helpers with on/off switches (CoS, Builder, Grower, Support, Finance…);
   Persona browse hint; Back / "N helpers · they sleep until they have work" / Create my team.

Wire to existing `/onboarding/*` endpoints; the 7-note model already exists server-side.

### F. Company & Setup refresh (pen `uNzlj`,`rwISc`,`q7NyU`,`SAbte`,`KktHp`,`K4jhK`)
Restyle existing screens to the "Refresh ·" look using Sidebar v2 + Topbar v2 + Page Header v2:
Company (KPIs + "What your helpers know"), Connectors (filters + rows + callout), Skills (empty/
how-it-works/starters), Folders (columns), AI accounts (stats + accounts + direct providers),
Settings (settings-nav + content). Preserve all existing behavior/data.

## Constraints

- Next.js App Router; preserve client/server boundaries, routes, polling, drawers, notifications.
- Custom CSS in `globals.css` + Remix Icon; token deltas additive only.
- Faithful to pen.dev; reuse existing components/classes where they fit, restyle/restructure where
  they don't. Read each screen's exact copy/layout from its pen node at implementation time.
- Backend changes additive + non-destructive; derive before adding columns; keep `scope="staff"`.
- Before merge: rebase onto `main`, resolve conflicts preserving others' changes, run the full
  test suite green.

## Left to the builder

- Exact per-screen markup read node-by-node from pen; final token/class names.
- Whether thread participants can be fully derived or need a nullable `Thread.participants` column
  (prefer derivation; ledger the ruling).
- How the drawer's "page awareness" is sourced (current route → crumb/title already in the shell).
- Mapping the Threads rail groups (NEEDS YOU/ACTIVE/EARLIER) onto thread state at read time.
- Keeping `/chat` deep-links (`?view=work`, `?thread=`, `?task=`) working through the model change.
