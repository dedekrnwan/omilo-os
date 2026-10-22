# Omilo — Workspace Redesign (Team Board) — Design

**Date:** 2026-10-22
**Status:** Draft (pending owner approval)
**Owner:** Dede Kurniawan
**Design source of truth:** pen.dev `omilo.pen`, **Section 02 · Home & Work** (frame `YYtzF`). Read nodes via the `mcp__pencil__execute` / `TakeScreenshot` MCP; never Read/Grep the `.pen` file. The four canonical frames:
- `vxOp0` — **Workspace · greeting home** ("Good afternoon, Dede" + composer with @mention helper picker + "Your team right now" right rail + "Latest from Chief of Staff" + "Your work").
- `xIJbp` — **Workspace · Team board · By helper** (columns per helper; work cards with status chips + progress + primary action; `By helper | By goal` toggle; `+ New work`).
- `Zv3Y4` — **Workspace · Team board · By goal** (goal rows with % progress; work cards grouped under each goal).
- `fmF8G` — **Workspace · Inside the work (focused)** (work header; chat thread; right rail: PROGRESS checklist / MADE IN THIS THREAD / per-thread cost).

---

## Intent & why

Today's Workspace fails the owner in three concrete moments:

1. **Triage collapses under load.** When many tasks are running at once, there is no way to see and manage the whole team's workload as a set — what's running, what's waiting, what needs the owner. Work is buried in a flat thread list.
2. **Inbox → Workspace loses the thread.** Opening an item from Inbox shows its details in the Inbox view, but landing in the Workspace chat the session is **completely empty** — the context does not follow across surfaces.
3. **The right rail is dead weight.** The right sidebar shows nothing useful. While focused on a task it should carry the three things the owner actually needs: **PROGRESS** (what's done / in-flight on this thread), **MADE IN THIS THREAD** (the concrete artifacts the AI produced — PR, branch, file), and the **total cost** for the task in focus.

This redesign adopts the pen.dev **Section 02 · Home & Work** visual standard to fix all three: a **Team board** (By helper / By goal) for triage, a **focused work view** whose chat renders the actual thread (continuity), and a **restyled right rail** populated from data that already exists.

## Goals

- **Team board** surface: group live work **By helper** and **By goal**, each work card stamped with a status (RUNNING / NEEDS YOU / WAITING), a progress bar, and its primary action (e.g. Review PR / Approve / Open). A `By helper | By goal` segmented toggle; a `+ New work` entry.
- **Fix inbox → workspace continuity**: opening an Inbox item lands the owner in that item's **actual thread**, with its conversation and history already present — never an empty chat.
- **Restyle the right rail** (focused work view) to the pen `fmF8G`: PROGRESS checklist, MADE IN THIS THREAD artifacts, per-thread cost — populated from `GET /api/threads/{id}/focus`, which already returns this shape.
- **Restyle the greeting home** (`vxOp0`): composer with the @mention helper picker, "Your team right now" rail, "Latest from Chief of Staff", "Your work" list.
- **Pixel-faithful** to the four pen frames (fonts, spacing, colors, status chips, progress bars), consistent with the v2 refresh already shipped.

## Non-goals / anti-goals

- **Personas stay "Coming soon."** The @mention helper picker (which IS being built — see decisions) shows personas (e.g. "Rina") under a **HIRES · PERSONAS** group as **disabled / non-interactive / "coming soon"** (standing owner instruction; reuse the existing disabled pattern at `Shell.tsx:108` + `nav.ts:47`). No Persona Studio. It is a declared *failure* if personas become selectable/functional here — verification must confirm the PERSONAS group is disabled, not merely unstyled.
- **No data-flow rewrite.** Interactive chat blocks (choices, proposals, access, confirmations, approval, feedback) keep their existing callbacks. The focused work view renders through the **already-shared** `Conversation → Reply → renderBlocks` (Section 09) pipeline — this is a restyle + new board surface, not a messaging rewrite.
- **No heavy new backend.** The right rail and By-helper board are already served (`/api/threads/{id}/focus`, `/api/office/state`). Any backend work is narrow and backward-compatible (expose By-goal cleanly if needed; optional artifact-type enhancement). It is an anti-goal to introduce a parallel work/task model.
- **Not** a redesign of Inbox, Plan, Team, or other sections — only the Workspace surfaces listed.

**Scope addendum (owner, 2026-10-22):** the focused view's pen frame `fmF8G` shows a v2 **action card + code diff** as its hero element, but the Section 09 components for these have no backend producer. In scope: a **narrow read-time producer** that maps existing data (an open **Proposal** → `action_card`; a **PR/diff** artifact → `code`) so `fmF8G` renders for real — no agent-formatting-layer change. Still out of scope / later pass: the fully-live v2 vocabulary (streaming tokens, reasoning, todos, usage meter) that requires harness emission.

## Constraints

- Stack: Next.js 15 App Router, React 19, **custom CSS design tokens in `app/globals.css` (no Tailwind)**, Remix Icon (`ri-*`). The pen uses lucide names → map each to the nearest Remix glyph; keep one icon system.
- No web test harness → verify with `./node_modules/.bin/tsc --noEmit` + `npm run build` + visual-vs-pen (`TakeScreenshot` the four frames). **No dead CSS** (grep each new class; remove orphaned rules on rename).
- Backend: FastAPI + SQLAlchemy. Any additions backward-compatible; **no new endpoints unless a gap genuinely blocks a surface.** Backend tests via `uv run pytest`.
- Preserve all existing interactive callbacks and polling behavior; keep the Section 09 chat library as the single chat renderer.

## Current state (from code + backend recon)

**Frontend already has three workspace views** (`app/chat/page.tsx`): **Desk** (greeting — `components/workspace/Desk.tsx`), **Focus** (thread chat `FocusThread.tsx` + right sidebar `FocusDetails.tsx` wired to `/focus`), **Work** (task detail). So this is largely **restyle existing surfaces + add the new board grouping**, not greenfield.

**Backend — partially ready (builder-check corrected my first recon; do not over-trust "it's served"):**
- Right rail data exists but the **contract is mis-aligned with the frontend today**: `thread_extras.focus()` returns `progress` (not `steps`) and `files` as `{title, kind, ref}` (**no `name`, no `url`**), while `FocusDetails.tsx` reads `data.steps` and `files[].name/.url` — so the rail currently renders no progress and unlabeled, non-clickable artifacts. The builder MUST reconcile this one contract (align field names; give artifacts an openable `url`/`ref` where one resolves, else render as a non-clickable label).
- By helper: `GET /api/office/state` gives, per helper, **one** `current` item + `waiting[]` + `queued` count + status (`working/blocked/failed/queued/idle/paused`) — **not** a list of work cards each with a progress bar and a computed primary action. Producing N cards-per-helper (the pen columns) **requires new backend aggregation** — this is real work, not a restyle.
- By goal: `Goal` + `TaskGoal` models exist; `plan.tree()` (plan.py) groups work under goals with per-goal progress but is behind **no clean endpoint** (only `/api/board` = the *Inbox* board). Needs a backward-compatible `GET /api/plan`-style endpoint.
- Cost & progress are real fields (`Task.cost_usd`, `Task.tokens`, `Checkpoint.plan`).

**Real gaps:**
1. **Team board data is net-new backend work** (above): per-helper work-card lists + a By-goal endpoint. This is the largest backend item and was understated in the first recon.
2. **Inbox → workspace "empty chat"** — likely a *render-gap* (ChatThread shows "Loading…" until the first fetch resolves; no eager first paint) on the get-or-create-existing-thread paths (`InboxItemDetail.discuss`/`askCos` → `POST /threads {scope,ref_id}`), rather than a truly empty new thread. Builder diagnoses the exact cause against the real load path; acceptance below.
3. **Artifact provenance is thin**: "made in this thread" comes from `KbSource.kind`; there is no *typed* artifact (PR/branch/file). `fileIcon()` already switches on `pr|chart|image`. Use `kind` as-is for v1; defer `artifact_type` (builder-settled).
4. **`/focus` contract reconciliation** (above) — mechanical but load-bearing.

## Status→label mapping

The pen's card states map onto existing backend status values:

| Pen label | Backend source |
|---|---|
| **RUNNING** | `office.state` agent `working`; task `running`; thread not awaiting |
| **NEEDS YOU** | `office.state` `blocked`; thread `awaiting_reply` / group `needs_you`; proposal `pending` |
| **WAITING** | `office.state` `queued`/`waiting`; task `queued` |
| done / failed | `done` / `failed` |
| **IDLE** | `office.state` `idle` — helper's column renders with an empty/idle state (no active cards), not hidden |
| **PAUSED** (company) | `company_paused` — show a board-level banner; cards render greyed/non-actionable (builder-settled) |

**Precedence** when a card could satisfy several rows: **NEEDS YOU > RUNNING > WAITING > done/failed** (builder-settled). Builder maps the full set to the pen's chip components (`eTICs` Run, `vQSCj` Up, `Zjvf0` Warn, `qskOc` Idle, status dots `d7napP/A1S9kc/SEWeh/FMi5e/SqGW8`).

## Owner decisions (resolved)

1. **By goal is in scope for v1 — build both groupings now.** Add a backward-compatible `GET /api/plan`-style endpoint wrapping `plan.tree()` for the By-goal view.
2. **Build the @mention helper picker now** in the greeting-home composer: real helpers selectable; PERSONAS group disabled/"coming soon."
3. **Cards always open the task's thread.** Every board card resolves to its **task-scoped thread** (get-or-create `{scope:"task", ref_id}`, as `TaskView.discuss` already does at `page.tsx:123`) and opens the **focused work view** — guaranteeing the right rail (`/focus`) is populated. (Resolves the "card dead-ends / rail empty" failure mode.)
4. **"+ New work" opens a Chief-of-Staff chat** — a free-text message that starts/continues a CoS thread (the current greeting-composer behavior), not a task-assign form.

## Decided approach (the "how")

1. **Team board (new surface).** Add a board view to the Workspace at route `?view=board` with `group` param (`helper` default | `goal`) (builder-settled; add a third branch to the existing `view` switch at `app/chat/page.tsx:192`, keep `isDesk`/`isFocus` intact). A `By helper | By goal` segmented toggle (pen `Z51YB`).
   - **By helper** (`xIJbp`): one column per helper; each column lists that helper's **work cards** (title, status chip, progress bar, primary action). **Requires new backend aggregation** to produce the per-helper card list with progress + a computed primary action (the existing `office.state` gives only one `current` + counts). Primary-action label derives from status: NEEDS YOU+proposal→Review/Approve, NEEDS YOU+awaiting→Reply, RUNNING/WAITING→Open (builder-settled).
   - **By goal** (`Zv3Y4`): one row/group per goal with % progress, work cards grouped under it, from the new `GET /api/plan`-style endpoint (`plan.tree()`).
   - **Every card's primary action resolves to the task's task-scoped thread and opens the focused work view** (decision 3). `+ New work` opens a CoS chat (decision 4).
   - Empty states reuse existing patterns (`Desk` RecentWork/TeamNow empties, `FocusDetails` empty).
2. **Fix inbox → workspace continuity.** Opening an Inbox item lands in the item's **actual thread** with history present at **first paint** — no empty/"Loading…" flash. Eager-load (or cache-seed) the thread's messages before/at first render; diagnose the exact cause against the real load path (`InboxItemDetail.discuss`/`askCos`, `lib/open.ts`, `ChatThread.tsx:63,164`). Keep existing `openThread` / drawer-vs-navigate routing.
   - **Acceptance (builder-settled):** opening **each** inbox item kind (proposal, question, access_request, alert, workflow) shows that thread's prior messages on first paint with no empty/Loading flash; a brand-new CoS-composer message shows an immediate optimistic first message.
3. **Restyle the focused work view** (`FocusThread` + `FocusDetails`) to `fmF8G`: work header (title, participants, status), the thread chat rendered through the shared Section 09 pipeline, and the right rail (PROGRESS / MADE IN THIS THREAD / cost) from `/focus` — **reconciling the `/focus` contract** (progress field name; artifact `name`/`url` so items are labeled and clickable where a target resolves).
4. **Restyle the greeting home** (`Desk`) to `vxOp0`: composer with the **new** @mention helper picker (personas disabled/"coming soon"), "Your team right now" rail, "Latest from Chief of Staff", "Your work".
5. Reuse pen reusable components where they map to existing ones (Segmented `Z51YB`, Chip/*, Status Dot/*, Card `Kjz4H`, Run Meter `viSgz`, Helper/*, Mini/*). Keep the chat library (Section 09) as the single renderer for all in-thread content.

**Build order (core three first, polish last):** (A) Team board — backend aggregation (per-helper cards + `GET /api/plan`) → By helper / By goal UI + status mapping + card→thread resolution; (B) focused work view restyle + right rail + `/focus` contract fix; (C) inbox→workspace continuity fix; (D) greeting-home restyle + @mention picker.

## What's left to the builder

- Exact per-frame pixels/spacing/colors read from each pen frame at implementation (`TakeScreenshot` `xIJbp`, `Zv3Y4`, `fmF8G`, `vxOp0` and their reusable children).
- The lucide→Remix icon mapping per component.
- The route/URL shape for the board view (e.g. `?view=board&group=helper|goal`) and how `+ New work` and card actions navigate into the focused view.
- Whether **By goal** is served by an existing endpoint or needs `plan.tree()` exposed as a clean `GET /api/plan`-style endpoint (backward-compatible if added).
- The exact root cause + lowest-risk fix of the empty-chat continuity bug (diagnose against the real thread-load path).
- **Artifact typing**: use `KbSource.kind` as-is vs a small typed enhancement (`artifact_type`) for crisper "MADE IN THIS THREAD" styling — pick the lowest-risk path that matches the pen; keep backward-compatible.
- How much of the greeting-home composer picker reuses the existing `MentionBox`/`Mentions` component (used by `ChatThread`) vs a new build — lowest-risk path to the standard look, with the disabled PERSONAS group.

## Builder-settled calls (my call, not the owner's)

- Board route = `?view=board&group=helper|goal` (default `helper`); third branch in the `view` switch.
- Status precedence NEEDS YOU > RUNNING > WAITING > done/failed; IDLE column renders empty-state; PAUSED company → banner + greyed cards.
- Primary-action label derivation from status (see approach 1).
- Continuity acceptance = first-paint history for every inbox item kind, no empty/Loading flash (see approach 2).
- Artifact typing deferred — use `KbSource.kind` + existing `fileIcon()`; no `artifact_type` in v1.
- Empty states reuse existing Desk/FocusDetails patterns.
- lucide→Remix (`ri-*`) icon mapping per component; one icon system.
- Verification: `tsc --noEmit` + `build` + `TakeScreenshot` the four frames (`vxOp0,xIJbp,Zv3Y4,fmF8G`) diffed vs pen; grep each new CSS class (no dead CSS).

## Open questions for the owner

None outstanding — the four consequential forks were resolved (see "Owner decisions"). Remaining ambiguities are builder-settled above.
