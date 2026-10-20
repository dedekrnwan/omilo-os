# Workspace Chat v2, Group-Chat Components & Onboarding/Setup Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DM-per-staff workspace with a desk + work-thread group chats, build one
reusable agentic chat-component library used by both the workspace and a page-aware floating drawer,
and refresh the onboarding + company/setup screens — faithful to pen.dev, additive backend only.

**Architecture:** Next.js App Router + custom CSS tokens in `apps/web/app/globals.css` (no Tailwind),
Remix Icon. Agentic reply components render `Message.blocks`. Backend is FastAPI; the new model is
mostly already supported (`Thread.scope`/`pending`, `teamchat` @mention routing, `Task` cost/steps,
`KbSource` files, `worklog.live_state`) — additions are read-time aggregations + one add-helper POST.

**Tech Stack:** TypeScript/React 19, Next 15.5, Python 3/FastAPI/SQLAlchemy, pytest.

**Spec:** `docs/superpowers/specs/2026-10-20-workspace-chat-v2-and-onboarding-design.md`
(parent: `2026-10-20-omilo-v2-ui-refresh-design.md`)

**Design source:** pen.dev `omilo.pen`
(`/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`).
Read a node's exact copy/layout with the pencil MCP `execute` tool, e.g.:
`Get("<id>",(n,c)=>{ if(c.depth>6) return; const t=n.type==="text"?(' "'+String(n.content||'').slice(0,80)+'"'):''; const r=n.type==="ref"?(' @'+n.ref):''; const ic=n.type==="icon"?(' '+n.icon):''; Print('  '.repeat(c.depth)+n.type+(n.name?' '+n.name:'')+r+ic+t); },{depth:99})`
and `TakeScreenshot(["<id>"])`. Do NOT edit the pen file.

## Global Constraints

- All UI work in `apps/web`. No new styling framework; token/class deltas are **additive** to
  `globals.css` — never churn existing variables that already match pen.
- Backend changes **additive + non-destructive**: nullable columns with safe defaults only, and only
  where a read-time derivation provably cannot serve the design (ledger the ruling). Keep
  `scope="staff"` threads in the data layer; the UI just stops surfacing per-staff DMs.
- Preserve ALL existing behavior: auth/bare pages, onboarding redirect, polling, approvals-in-chat,
  stop/cancel, drag-drop, pool meter, notifications, context menus, command palette, deep-links
  (`/chat?view=work|thread=|task=`).
- Reuse existing components where they fit (`Conversation.tsx`, `ChatThread.tsx`, `Avatar.tsx`,
  `Markdown.tsx`, `ComposerTools.tsx`, `PoolMeter.tsx`, `MentionBox.tsx`). Restyle/restructure
  rather than rewrite when possible.
- Icons: Remix Icon (`ri-*`). Map pen lucide icon names to the nearest `ri-*`.
- Frontend must typecheck and build (`cd apps/web && npm run build`) with no new errors. Backend:
  full `pytest` suite stays green (`cd apps/api && pytest -q`).
- Faithful to pen.dev copy/layout; where a live screen has states pen doesn't depict, keep them,
  restyled in the v2 idiom.

## Review Focus

- **Model change safety:** removing the DM list must not break `/chat?thread=<id>` deep-links,
  group threads, or the approvals/stop/drag-drop flows that live in the chat surface.
- **Empty/loading/error states:** desk with no recent work; threads rail with no NEEDS YOU; drawer
  with no threads; onboarding resumed mid-interview; a thread whose linked task has no steps/cost.
- **Block coverage:** a `Message.blocks` entry of an unknown/legacy type must render gracefully
  (fallback), not crash — the agentic library must be a superset of today's `Conversation` blocks.
- **Backend derivation correctness:** NEEDS YOU vs ACTIVE vs EARLIER grouping, and COST SO FAR
  aggregation, must match reality for threads with/without a linked task.
- **No-regression:** pool meter, command palette (⌘K) and the new drawer (⌘J) coexist; Shell still
  mounts the launcher on every non-bare page.

---

### Task 1: Token + base CSS for the new surfaces

**Files:**
- Modify: `apps/web/app/globals.css` (append a clearly-commented `/* === v2 chat/workspace/onboarding === */` block; do not edit existing rules)

**Interfaces:**
- Produces: CSS classes consumed by Tasks 2,4,5,6,7,8,9. Name them in the established idiom
  (`.ws-*`, `.chat-*`, `.ob-*`, `.thread-*`, `.deskcard`, etc.). Reuse existing tokens
  (`--surface`, `--line`, `--ink`, `--muted`, `--primary`, `--r*`, helper-* brand colors).

- [ ] **Step 1:** Read the pen component/section styles you need: `roxVp` (chat components),
  `eyoSr` (desk), `dK9R8` (focus session), `F6hoV`/`rdn21` (drawer), `fz8K5`/`U2Krd` (onboarding).
  Note colors/radii/spacing; confirm they map to existing tokens (per parent spec, they nearly all do).
- [ ] **Step 2:** Add any genuinely-new tokens (only if absent) to `:root`, and the base classes for:
  agentic reply shell + blocks (reasoning/todos/action-card/confirmation/approval/task/sources/
  usage-meter/document/image/code/markdown/hover-actions/feedback-bar/streaming), desk cards,
  threads rail groups + rows, thread head/participants, details panel, FAB + nudge, drawer
  head/context/pool, onboarding top/stepper/notes grid. Pure additive.
- [ ] **Step 3:** Verify no existing selector was changed: `git diff` shows only additions below your
  comment banner. Build: `cd apps/web && npm run build` passes.
- [ ] **Step 4:** Commit: `style(web): v2 CSS for chat components, workspace, drawer, onboarding`.

---

### Task 2: Agentic group-chat component library

**Files:**
- Create: `apps/web/components/chat/Reply.tsx` (the agent reply shell: avatar + Who row + stacked blocks + hover row)
- Create: `apps/web/components/chat/blocks.tsx` (one renderer per block type; a `renderBlock(block)` switch with a safe fallback)
- Modify: `apps/web/components/Conversation.tsx` (route agent messages through the new library; keep owner/system rendering + existing block types working)
- Test: `apps/web/components/chat/__tests__/blocks.test.tsx` IF a frontend test runner exists; otherwise a `renderBlock` exhaustiveness guard + Storybook-free manual verification noted in the report.

**Interfaces:**
- Consumes: `Message` + `blocks` typed entries (`models.py:226`, existing `Conversation.tsx` block
  union). Reuse `Markdown.tsx`, `Avatar.tsx`, existing approval/choice/access block logic.
- Produces: `<Reply message={...} staff={...} .../>` and `renderBlock(block, ctx)` used by Tasks 5,7.
  Block types (from pen `roxVp`): `reasoning` (collapsible), `todos`, `markdown`, `code`,
  `action_card`, `confirmation` (+done), `streaming_approval`, `task`, `sources`, `usage_meter`,
  `document`, `image` (+generating), `streaming`; plus hover row = `hover_actions` + `feedback_bar`.
  Preserve today's blocks (`choices`, `access_request`, `job_proposal`, `file`, `mentions`).

- [ ] **Step 1:** Read each Section 09 component (ids in the spec: `HwExk`,`LZwtY`,`pT9bB`,`T4FR5`,
  `RvtWB`,`CGKLK`,`yp4g8`,`lrtjv`,`K4wTQ`,`SQBGY`/`Qnb06`,`Jxjui`,`c0DKyw`,`B0Ksmn`,`ihBIG`,`duDp0`)
  and the composed `GAtoS` thread. Capture copy, structure, icons.
- [ ] **Step 2:** Inventory today's `Conversation.tsx` blocks so the new library is a **superset** —
  nothing currently rendered may regress.
- [ ] **Step 3:** Implement `renderBlock` (switch with `default:` fallback that renders text/markdown
  safely) and `<Reply>` (avatar + name·role·time + blocks + hover row shown on hover).
- [ ] **Step 4:** Integrate into `Conversation.tsx`: agent messages render via `<Reply>`; owner bubble
  + system events keep their look (restyled). All existing interactions (approve/deny/choices/stop)
  still fire the same callbacks.
- [ ] **Step 5:** Verify: `npm run build`; exercise an agent message with each block type (fixture)
  and confirm no crash on an unknown block type.
- [ ] **Step 6:** Commit: `feat(web): agentic group-chat component library (Reply + blocks)`.

---

### Task 3: Backend — thread grouping, focus details, add-helper (additive)

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (thread-list grouping fields; `GET /threads/{id}/focus`; `POST /threads/{id}/add-helper`)
- Modify: `apps/api/omilo_api/worklog.py` or a small helper (derive group + subtitle + participants)
- Modify: `apps/api/omilo_api/teamchat.py` ONLY if add-helper needs a helper (reuse `mentions`/`post`)
- Test: `apps/api/tests/test_threads_focus.py` (new) — grouping, focus aggregation, add-helper

**Interfaces:**
- Produces, consumed by Tasks 4,5,7:
  - Thread list items gain (derived, read-time): `group: "needs_you"|"active"|"earlier"`,
    `subtitle: str`, `participants: str[]` (staff ids = `pending` ∪ distinct agent authors),
    `last_at: iso`, and for job threads `task_id`, `task_status`.
  - `GET /threads/{id}/focus` → `{ progress: {label,status}[], files: {title,kind,ref}[],
    cost: {usd: float, tokens: int, minutes: int} }` from the linked task (`scope="task"`/`ref_id`)
    `Checkpoint`/runs + `KbSource(ref in {thread_id, task_id})` + task `cost_usd`/`tokens`/timings.
  - `POST /threads/{id}/add-helper {staff_id}` → promotes the helper into the thread (writes an
    `@mention` turn via `teamchat`), returns updated thread. Idempotent if already a participant.
- Prefer **derivation**; add a nullable `Thread.participants` JSON column (safe default) ONLY if
  derivation provably fails — ledger the ruling, and if added, provide a forward-only migration.

- [ ] **Step 1 (test first):** Write `test_threads_focus.py`: (a) a thread awaiting reply groups
  `needs_you`; an active non-awaiting recent thread groups `active`; an older one `earlier`;
  (b) `focus` aggregates cost/tokens/steps/files from a linked task + KbSource; (c) `add-helper`
  adds a participant and is idempotent.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement the derivation helper + the two endpoints + thread-list fields.
- [ ] **Step 4:** Run `pytest -q apps/api/tests/test_threads_focus.py` → pass; then full `pytest -q`.
- [ ] **Step 5:** Commit: `feat(api): thread grouping, focus aggregation, add-helper (additive)`.

---

### Task 4: Workspace Start — the desk (pen `eyoSr`)

**Files:**
- Modify: `apps/web/app/chat/page.tsx` (default `/chat` with no `thread`/`task`/`view` → render the desk)
- Create: `apps/web/components/workspace/Desk.tsx`

**Interfaces:**
- Consumes: `useOverview()` (greeting name, staff, inbox), `/overview`, `/threads` (recent work),
  `worklog live_state` (team-now). Composer posts to the Chief-of-Staff thread (scope `master`),
  reusing the existing send path; opens the focus session on submit.
- Produces: desk view; "Recent work" rows link to a focus thread (`/chat?thread=<id>`); team-now
  cards link into the relevant work.

- [ ] **Step 1:** Read `eyoSr` for exact copy (greeting, suggestion labels, hint, section headers).
- [ ] **Step 2:** Build `<Desk>`: greeting + CoS; big composer to Chief of Staff; Suggestions row
  (3 chips that prefill/send); "LATEST FROM CHIEF OF STAFF" + latest CoS message; Recent work list;
  right "Team now" live panel (per-helper status + CoS next + the "No DMs needed" hint).
- [ ] **Step 3:** Wire `/chat` to show `<Desk>` by default; keep `?view=work|thread=|task=` routing.
- [ ] **Step 4:** Verify `npm run build`; empty state (no recent work / idle team) renders cleanly.
- [ ] **Step 5:** Commit: `feat(web): Workspace Start desk`.

---

### Task 5: Focus chat session — Inside the work (pen `dK9R8`)

**Files:**
- Modify: `apps/web/app/chat/page.tsx` (thread/task view → three-column focus session)
- Create: `apps/web/components/workspace/ThreadsRail.tsx`, `apps/web/components/workspace/FocusThread.tsx`, `apps/web/components/workspace/FocusDetails.tsx`
- Reuse: `Conversation.tsx` (now using Task 2 `<Reply>`), `ChatThread.tsx` composer, `MentionBox.tsx`

**Interfaces:**
- Consumes: Task 3 thread-list grouping (`ThreadsRail` groups NEEDS YOU/ACTIVE/EARLIER), the thread
  detail + messages (`FocusThread`), `GET /threads/{id}/focus` (`FocusDetails`), `POST
  /threads/{id}/add-helper` (Add helper button). Head participants from thread `participants`.
- Produces: the replacement for the old DM-list workspace. **Remove** the DM-per-staff + channel
  list UI; threads = work. Keep group threads. Preserve stop/approval/drag-drop.

- [ ] **Step 1:** Read `dK9R8` (rail groups + row anatomy; thread head + People + Add helper + More;
  Details PROGRESS/MADE IN THIS THREAD/COST SO FAR copy).
- [ ] **Step 2:** `ThreadsRail`: segmented filter + grouped rows from Task 3 list; selecting a row
  sets `?thread=<id>`.
- [ ] **Step 3:** `FocusThread`: head (title + participant avatars + Add-helper menu over staff +
  More) + messages via `<Reply>` incl. system join Events + composer (reuse ChatThread composer with
  `@mention`).
- [ ] **Step 4:** `FocusDetails`: render `/threads/{id}/focus` (progress checklist, files, cost).
- [ ] **Step 5:** Replace the old DM/channel workspace body with rail+thread+details; delete/retire
  the DM list markup (keep code paths for group/thread deep-links). Verify `?thread=` and `?task=`
  deep-links resolve into the focus session.
- [ ] **Step 6:** Verify `npm run build`; a thread with no linked task hides/greys the Details cards.
- [ ] **Step 7:** Commit: `feat(web): focus chat session (threads rail + thread + details)`.

---

### Task 6: Chat FAB + nudge + ⌘J (pen `dg0fg`)

**Files:**
- Modify: `apps/web/components/ChatLauncher.tsx`

**Interfaces:**
- Consumes: `useOverview()` (CoS), unread count (existing poll), a nudge source (an open
  proposal/question from `/inbox` or `live_state`; show the most relevant one, dismissible).
- Produces: FAB (CoS avatar + badge) + optional nudge bubble (title/body + Yes/Later). Opens the
  Task 7 drawer. Registers a global **⌘J** toggle (coexisting with ⌘K palette).

- [ ] **Step 1:** Read `dg0fg` nudge copy + anatomy.
- [ ] **Step 2:** Add the nudge bubble (shown when there's a relevant pending item; "Yes" opens the
  drawer to that item, "Later"/x dismisses for the session). Keep the badge behavior.
- [ ] **Step 3:** Add a `keydown` ⌘J/Ctrl-J toggle; ensure it doesn't collide with ⌘K.
- [ ] **Step 4:** Verify `npm run build`; no nudge when nothing pending.
- [ ] **Step 5:** Commit: `feat(web): chat FAB nudge + ⌘J toggle`.

---

### Task 7: Chat Drawer rework (pen `F6hoV`, `rdn21`, `nfuNY`)

**Files:**
- Modify: `apps/web/components/ChatSessionsDrawer.tsx`
- Reuse: Task 2 `<Reply>`/blocks, `PoolMeter.tsx`, `Conversation.tsx`, `ChatThread.tsx` composer

**Interfaces:**
- Consumes: current route (page awareness — the Shell crumb/title or `usePathname`), `/threads`
  (switcher groups HELPERS/TEAM/JOBS via Task 3 fields), thread detail + messages, pool status
  (`PoolMeter`). "Open in Workspace" → `/chat?thread=<id>`.
- Produces: page-aware drawer: Head (thread switcher dropdown + New chat + Open in Workspace +
  Close); Context row ("Looking at {page}" + dismiss); Messages via `<Reply>` (empty state = CoS
  intro + Suggestions + "PICK UP WHERE YOU LEFT OFF" recents); Composer + Pool row (⌘J to close).
  Job-thread variant shows a Job Card header.

- [ ] **Step 1:** Read `F6hoV`,`rdn21`,`nfuNY` for exact structure/copy.
- [ ] **Step 2:** Rework the Head into the thread switcher (avatar + name + "Idle · can see this
  page" + chevron) with the dropdown Thread Menu (search + HELPERS/TEAM/JOBS + New chat).
- [ ] **Step 3:** Add the Context "Looking at {page}" row (from the current route), the empty-state
  (CoS intro + Suggestions + recents), and the Pool status row; messages via `<Reply>`.
- [ ] **Step 4:** Job-thread variant: a Job Card (schedule/Done chip/asked quote/meta) above the
  result message when the active thread is a job (`task_id`).
- [ ] **Step 5:** Verify `npm run build`; ESC + ⌘J close; "Open in Workspace" navigates correctly;
  pool meter renders.
- [ ] **Step 6:** Commit: `feat(web): page-aware chat drawer with agentic components`.

---

### Task 8: Onboarding refresh — 5 screens (pen `fz8K5`,`G46NN`,`U2Krd`,`lnp4R`,`M59bq`)

**Files:**
- Modify: `apps/web/app/onboarding/page.tsx`
- Create (if it keeps the file readable): `apps/web/components/onboarding/Stepper.tsx`, `Notes.tsx`

**Interfaces:**
- Consumes existing endpoints unchanged: `/onboarding` (state/draft), `/onboarding/ai`,
  `/onboarding/interview`, `/onboarding/team-plan`, `/onboarding/finish`; the 7-note knowledge model
  (company/customers/goals/offer/rules/systems/voice). Preserve the onboarding redirect in `Shell`.
- Produces: the refreshed 5-screen flow with the top bar ("Setting up {Company}" + "Saved as you
  go" + Log out) and the 4-step Stepper.

- [ ] **Step 1:** Read the five nodes for exact copy (step labels, the 7 note names, Your-AI options,
  interview header, Check grid, team toggles, button labels).
- [ ] **Step 2:** Build the shared top bar + `<Stepper>`; map the existing step state to the 4 steps.
- [ ] **Step 3:** Screen 1 Welcome + 7-notes rail; Screen 2 Your AI (local/subscription/API key +
  GOOD TO KNOW), reusing the existing provider/key logic; Screen 3 interview + live `<Notes>` panel
  + speed-up/upload; Screen 4 Check 7-note editable grid; Screen 5 Your team toggles + persona hint.
- [ ] **Step 4:** Preserve resume ("Saved as you go"/draft), skip-topic/finish-later, and finish →
  `/chat`. Verify `npm run build` and a resumed mid-interview state renders.
- [ ] **Step 5:** Commit: `feat(web): onboarding v2 (5-screen, 7-notes, stepper)`.

---

### Task 9: Company & Setup refresh — 6 screens (pen `uNzlj`,`rwISc`,`q7NyU`,`SAbte`,`KktHp`,`K4jhK`)

**Files:**
- Modify: `apps/web/app/company/page.tsx`, `connectors/page.tsx`, `skills/page.tsx`,
  `computer/page.tsx`, `harness/page.tsx`, `settings/page.tsx` (restyle to v2; preserve behavior)

**Interfaces:**
- Consumes existing page data/endpoints unchanged. Uses Sidebar v2 + Topbar v2 + Page Header v2
  (already in the shell) + the Task 1 CSS.

- [ ] **Step 1:** For each screen, read its pen node for the section structure/copy.
- [ ] **Step 2:** Restyle each page body to match (Company: KPIs + "What your helpers know";
  Connectors: filters + rows + callout; Skills: empty/how-it-works/starters; Folders: columns;
  AI accounts: stats + accounts + direct providers; Settings: settings-nav + content). Keep all
  existing data, actions, and states; restyle in the v2 idiom.
- [ ] **Step 3:** Verify `npm run build`; spot-check each route renders with live data.
- [ ] **Step 4:** Commit per screen or as one reviewable batch: `refresh(web): Company & Setup v2`.

---

## Self-review notes

- Coverage: onboarding (T8), setup (T9), workspace model change (T4 desk + T5 focus), drawer + group
  components (T2 + T6 + T7), backend support (T3). Matches the owner's three named areas.
- Type consistency: `<Reply>`/`renderBlock` (T2) is the single agent-message renderer used by T5 + T7;
  thread-list grouping fields (T3) are consumed identically by T4/T5/T7.
- Dependency order: T1 → T3 → T2 → T4 → T5 → T6 → T7 → T8 → T9. (T6 pairs with T7.)
- Review Focus items each map to a task's verify step (empty states, unknown-block fallback,
  deep-links, derivation correctness, ⌘J/⌘K coexistence).
