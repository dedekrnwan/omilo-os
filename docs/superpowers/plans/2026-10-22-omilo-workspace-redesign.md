# Omilo Workspace Redesign (Team Board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Workspace with a Team board (By helper / By goal), a continuity-fixed focused work view with a populated right rail, and a restyled greeting home — pixel-faithful to pen Section 02.

**Architecture:** Two new read-only backend aggregations (`GET /api/plan` wrapping `plan.tree()` for By-goal; `GET /api/team/board` grouping each helper's live work into cards for By-helper) feed a new board surface at `?view=board&group=helper|goal` in `app/chat/page.tsx`. The focused view and right rail are restyled in place (`FocusThread`/`FocusDetails`) with a one-field `/focus` contract fix. The inbox→workspace "empty chat" is fixed by seeding `ChatThread`'s first paint from a passed-in thread instead of showing "Loading…". The greeting home (`Desk`) is restyled with a new @mention helper picker (personas disabled).

**Tech Stack:** Next.js 15 App Router / React 19 / custom CSS tokens in `app/globals.css` (no Tailwind) / Remix Icon (`ri-*`); FastAPI + SQLAlchemy backend; backend tests `uv run pytest`; frontend verification `./node_modules/.bin/tsc --noEmit` + `npm run build` + `TakeScreenshot` vs pen (no web unit harness).

**Spec:** `docs/superpowers/specs/2026-10-22-omilo-workspace-redesign-design.md`

## Global Constraints

- No Tailwind; all styling via custom CSS classes in `apps/web/app/globals.css`. **No dead CSS** — grep each new class; remove orphaned rules on rename.
- Icons: Remix `ri-*` only; map pen lucide names to the nearest `ri-*`. One icon system.
- **Personas stay disabled/"coming soon"** everywhere they appear (helper picker). Non-interactive, not merely unstyled — reuse the disabled pattern at `components/Shell.tsx:108` + `lib/nav.ts:47`. Personas becoming selectable is a declared failure.
- No new backend models; new endpoints are read-only and backward-compatible. Keep existing callbacks and polling behavior.
- Keep the Section 09 chat library (`components/chat/*`, `Conversation → Reply → renderBlocks`) as the single renderer for in-thread content.
- Board route: `?view=board` with `group` ∈ {`helper` (default), `goal`}.
- Status→label precedence when a card qualifies for several: **NEEDS YOU > RUNNING > WAITING > done/failed**.

## Review Focus

- **Personas selectable in the composer picker** (owner-declared failure) — the PERSONAS group must render disabled and non-clickable. → pinned in Task 6.
- **Board card with no resolvable task** (a chat-only or task-less card) must not dead-end — it still opens *something* (its thread) or is non-actionable, never a blank route. → pinned in Task 3.
- **Company paused** — `office.state().paused === true` must surface as a board banner with greyed/non-actionable cards, not a normal board. → pinned in Task 2 (data) + Task 3 (render).
- **Idle helper** — a helper with no active work renders an empty column ("No work for {name}"), not a hidden/absent column. → pinned in Task 2 (data) + Task 3 (render).
- **Inbox→workspace first paint** — opening any inbox item kind (proposal, question, access_request, alert, workflow) shows that thread's prior messages on first paint with no empty/"Loading…" flash. → pinned in Task 5.

---

### Task 1: Backend — `GET /api/plan` (By-goal board data)

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (register the route near the other read endpoints)
- Test: `apps/api/tests/test_plan_endpoint.py`

**Interfaces:**
- Consumes: `plan.tree(db, days=30) -> {days, goals:[{id,title,target,due,status,position,jobs,work:[node],progress:{total,...,proposals,approved},kpis}], unlinked, shifts}` (already exists in `apps/api/omilo_api/plan.py:125`). A `node` = `{id,title,staff_id,staff,status,origin,created_at,headline,proposals:[{id,title,status}],children}`.
- Produces: `GET /api/plan` → the `plan.tree(db)` dict verbatim. Consumed by Task 3's By-goal view.

- [ ] **Step 1: Write the failing test**

```python
# test_plan_endpoint.py
async def test_get_plan_returns_goals_with_work(client, db):
    # seed: one active Goal, one Staff, one Task linked to the goal via TaskGoal
    # (follow existing test seeding patterns in tests/)
    r = await client.get("/api/plan")
    assert r.status_code == 200
    body = r.json()
    assert "goals" in body and "unlinked" in body
    g = next(x for x in body["goals"] if x["title"] == "Launch")
    assert g["progress"]["total"] >= 1
    assert any(n["id"] == TASK_ID for n in g["work"])
```

- [ ] **Step 2: Run it, verify it fails** — `uv run pytest apps/api/tests/test_plan_endpoint.py -v` → FAIL (404 / route missing).
- [ ] **Step 3: Add the route** in `routers/api.py`: `@router.get("/plan")` → `return plan.tree(db)` (import the `plan` module; use the same `db` dependency and company-scoping as neighboring GET routes). No new logic.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `feat(api): expose GET /api/plan (team board by goal)`

---

### Task 2: Backend — `GET /api/team/board` (By-helper cards)

**Files:**
- Create: `apps/api/omilo_api/team_board.py`
- Modify: `apps/api/omilo_api/routers/api.py` (register `GET /team/board`)
- Test: `apps/api/tests/test_team_board.py`

**Interfaces:**
- Consumes: `office.state(db)` (`office.py:191`) for helper list + `paused`; `Task`, `Checkpoint`, `TaskGoal`, `Goal`, `Thread`, `InboxItem`, `Proposal` models; the plan link map (`TaskGoal.task_id→goal_id`).
- Produces:
  - `card_progress(db, task) -> {"done": int, "total": int}` — from the task's latest `Checkpoint.plan` (count steps whose status=="done" vs total; `{0,0}` when no checkpoint).
  - `board(db, days=14) -> {"paused": bool, "server_time": str, "helpers": [Helper]}` where
    `Helper = {"id","name","role","is_chief","status" (working|blocked|failed|queued|idle|paused), "cards":[Card]}` and
    `Card = {"id": task_id, "title", "staff_id", "status" (running|needs_you|waiting|done|failed), "needs_proposal": bool, "awaiting_reply": bool, "progress": {done,total}, "goal": {id,title}|null, "cost_usd": float, "updated_at": str|null}`.
  - A helper's cards = their tasks from the last `days` with status in {running, queued, waiting} PLUS tasks with an open proposal (→ `needs_proposal`, status `needs_you`) PLUS tasks whose task-scoped thread is `awaiting_reply` (→ `awaiting_reply`, status `needs_you`), newest first. An idle helper gets `cards: []` (still listed). Status derivation obeys the precedence in Global Constraints.
- Consumed by: Task 3's By-helper view.

- [ ] **Step 1: Write the failing tests**

```python
# test_team_board.py
async def test_board_groups_cards_under_helper(client, db):
    # seed: Staff S, one running Task T (staff_id=S) with a Checkpoint plan [done, pending]
    r = await client.get("/api/team/board"); assert r.status_code == 200
    h = next(x for x in r.json()["helpers"] if x["id"] == S_ID)
    c = next(x for x in h["cards"] if x["id"] == T_ID)
    assert c["status"] == "running"
    assert c["progress"] == {"done": 1, "total": 2}

async def test_idle_helper_listed_with_empty_cards(client, db):
    r = await client.get("/api/team/board")
    h = next(x for x in r.json()["helpers"] if x["id"] == IDLE_ID)
    assert h["cards"] == [] and h["status"] == "idle"

async def test_open_proposal_makes_card_needs_you(client, db):
    # seed: Task + open Proposal for it
    r = await client.get("/api/team/board")
    c = find_card(r.json(), PROPOSAL_TASK_ID)
    assert c["status"] == "needs_you" and c["needs_proposal"] is True

async def test_paused_company_flag(client, db):
    # seed company paused
    r = await client.get("/api/team/board")
    assert r.json()["paused"] is True
```

- [ ] **Step 2: Run them, verify they fail** — `uv run pytest apps/api/tests/test_team_board.py -v`.
- [ ] **Step 3: Implement `card_progress` and `board` in `team_board.py`** per the Interfaces block; derive card `status` with the precedence rule; pull `paused`/helper list from `office.state(db)`; attach `goal` from the `TaskGoal→Goal` link. Register `@router.get("/team/board")` → `return team_board.board(db)`.
- [ ] **Step 4: Run them, verify they pass.**
- [ ] **Step 5: Commit** — `feat(api): GET /api/team/board — per-helper work cards`

---

### Task 3: Frontend — Team board surface (By helper / By goal)

**Files:**
- Modify: `apps/web/app/chat/page.tsx` (add the `view==="board"` branch in `WorkspaceInner`)
- Create: `apps/web/components/workspace/TeamBoard.tsx` (board shell + toggle + columns/rows)
- Create: `apps/web/components/workspace/WorkCard.tsx` (one work card, shared by both groupings)
- Modify: `apps/web/lib/api.ts` (add `PlanTree`, `TeamBoard`, `BoardCard` types)
- Modify: `apps/web/app/globals.css` (board classes)
- Verify: `tsc --noEmit` + `build` + `TakeScreenshot(["xIJbp","Zv3Y4"])` vs pen

**Interfaces:**
- Consumes: `GET /api/team/board` (Task 2 shape) and `GET /api/plan` (Task 1 shape).
- Produces: at `/chat/?view=board` a `By helper | By goal` segmented toggle (default `helper`). **By helper** = one column per helper with its `cards`; **By goal** = one group per `goals[]` with its `work[]` nodes rendered as cards and the goal's `progress` as a header %. `+ New work` opens a **Chief-of-Staff chat** — the `DeskComposer` behavior, NOT `startJob` (which creates a task): `POST /threads {scope:"master"}` → navigate to `/chat/?thread={id}` (the composer there posts the first message). Every card's primary action resolves to the card's **task-scoped thread** (`POST /threads {scope:"task", ref_id: card.id}` → `/chat/?thread={id}`) and opens the focused view.
- `WorkCard` derives its chip label + primary-action label from status/flags (client-side): `needs_you`+`needs_proposal`→"Review"; `needs_you`+`awaiting_reply`→"Reply"; `running`→"Open"; `waiting`→"Open"; `failed`→"Open". Progress bar from `progress.done/progress.total` when `total>0`.

- [ ] **Step 1: Add types** to `lib/api.ts` matching Task 1/Task 2 responses (`BoardCard`, `TeamBoard`, `PlanTree`/goal/node). Run `tsc --noEmit` → clean.
- [ ] **Step 2: Build `WorkCard.tsx`** — title, helper avatar (reuse `Avatar`), status chip (map status→existing chip classes `chip run|warn|up|idle`), progress bar, primary-action button that calls the task-thread resolver. For a card with no `id`/resolvable task, render the card non-actionable (no dead route) — **Review Focus**. `tsc` clean.
- [ ] **Step 3: Build `TeamBoard.tsx`** — segmented toggle (reuse existing `.seg` markup from `page.tsx` Panel), fetch both endpoints via `usePoll`/`api`, render By-helper columns (idle helper → empty-column state "No work for {name}" — **Review Focus**) and By-goal groups (goal % from `progress`). When `board.paused`, render a top banner and grey the cards (**Review Focus**).
- [ ] **Step 4: Wire the route** — in `WorkspaceInner`, compute `isBoard = view === "board"`; `const group = params.get("group")==="goal" ? "goal" : "helper"`; `if (isBoard) return <TeamBoard group={group} ... />`. Keep `isDesk`/`isFocus` branches intact. Add a board entry point (e.g. a "Board" affordance in the existing workspace chrome / ThreadsRail header) so the surface is reachable.
- [ ] **Step 5: Add CSS** for `.team-board`, `.board-col`, `.work-card`, progress bar, paused banner — faithful to `xIJbp`/`Zv3Y4`. Grep each new class (no dead CSS).
- [ ] **Step 6: Verify** — `./node_modules/.bin/tsc --noEmit` clean; `npm run build` passes; `TakeScreenshot(["xIJbp","Zv3Y4"])` and diff the board against pen; fix spacing/colors.
- [ ] **Step 7: Commit** — `feat(web): Team board (by helper / by goal) matches Section 02`

---

### Task 4: Right rail — `/focus` contract fix + focused-view restyle

**Files:**
- Modify: `apps/api/omilo_api/thread_extras.py:184` (`focus()` files include `url`)
- Modify: `apps/web/components/workspace/FocusDetails.tsx` (read `progress` + `title`/`url`)
- Modify: `apps/web/components/workspace/FocusThread.tsx` (work header to `fmF8G`)
- Modify: `apps/web/app/globals.css` (right-rail + header classes)
- Test: `apps/api/tests/test_focus_contract.py`; Verify: `tsc` + `build` + `TakeScreenshot(["fmF8G"])`

**Interfaces:**
- Consumes: `GET /api/threads/{id}/focus` (now `{progress:[{label,status}], files:[{title,kind,ref,url}], cost:{usd,tokens,minutes}}`).
- Produces: a populated right rail — PROGRESS (from `progress`, not `steps`), MADE IN THIS THREAD (label from `title`, link from `url` when present else non-clickable), COST unchanged. `FocusDetails`'s `FocusData` interface renamed field `steps`→`progress`; `FocusFile` = `{title, kind, ref, url?}`.

- [ ] **Step 1: Write the failing backend test**

```python
# test_focus_contract.py
async def test_focus_files_include_url(client, db):
    # seed: task-scoped Thread + KbSource(ref=task_id, kind="pr", title="PR #4", url="https://…")
    r = await client.get(f"/api/threads/{THREAD_ID}/focus")
    f = r.json()["files"][0]
    assert f["title"] == "PR #4" and f["url"] == "https://…" and f["kind"] == "pr"
```

- [ ] **Step 2: Run it, verify it fails** (current `files` dict omits `url`).
- [ ] **Step 3: Add `"url": k.url` to the files dict** in `thread_extras.focus()` (keep `title`,`kind`,`ref`).
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Fix `FocusDetails.tsx`** — rename `FocusData.steps`→`progress`; read `data.progress`; `FocusFile` reads `title`/`url` (drop `name`); keep the `url?` clickable/non-clickable branch. Restyle progress/files/cost sections to `fmF8G`.
- [ ] **Step 6: Restyle `FocusThread` `ThreadHead`** to the pen work-header (title, participants, status) — markup/CSS only, keep `onAddHelper`/menu callbacks.
- [ ] **Step 7: Verify** — `uv run pytest apps/api/tests/test_focus_contract.py`; `tsc --noEmit`; `npm run build`; `TakeScreenshot(["fmF8G"])` diff; grep new CSS classes.
- [ ] **Step 8: Commit** — `fix(web): populate + restyle focus right rail; focus() files carry url`

---

### Task 5: Inbox → Workspace continuity (no empty/Loading flash)

**Files:**
- Modify: `apps/web/components/ChatThread.tsx` (seed first paint from a passed-in thread)
- Modify: `apps/web/components/workspace/FocusThread.tsx` (pass the already-loaded thread down)
- Modify: `apps/web/app/chat/page.tsx` (hand the list's thread for `tid` into `FocusThread` as a seed)
- Verify: `tsc --noEmit` + `build` + manual trace of each inbox item kind

**Interfaces:**
- Consumes: the `threads` list already loaded in `WorkspaceInner` (`loadLists`) and `current` state.
- Produces: `ChatThread` accepts an optional `seed?: FullThread | null`; initial `current` state = `seed ?? null`; the `setCurrent(null)` on `threadId` change only fires when the new `threadId !== seed?.id`. The "Loading…" return (`ChatThread.tsx:164`) is reached only when there is genuinely no thread yet. Net effect: opening an item whose thread is already in the list paints its history immediately; a brand-new thread still shows its first (optimistic) message as soon as the post resolves.

- [ ] **Step 1: Thread a `seed` prop** from `page.tsx` `isFocus` branch → `FocusThread` → `ChatThread`. The seed = `threads.find(t => t.id === tid)` cast to `FullThread` when it already carries messages, else the last `current` for that id. (Do not break the existing `onThread` reporting.)
- [ ] **Step 2: Initialize `current` from `seed`** and guard the `threadId`-change reset so it does not blank a matching seed. Keep the poll (it refreshes/【ETag-304】s as before).
- [ ] **Step 3: Verify first paint** — `tsc --noEmit`; `npm run build`; trace opening each inbox item kind (proposal via `InboxItemDetail.discuss`, question/alert/workflow/access via their open paths) and the composer-new-thread path: assert no empty/"Loading…" flash when the thread exists; optimistic first message for brand-new — **Review Focus**.
- [ ] **Step 4: Commit** — `fix(web): inbox→workspace shows thread history on first paint`

---

### Task 6: Greeting home restyle + @mention helper picker

**Files:**
- Modify: `apps/web/components/workspace/Desk.tsx` (`DeskComposer` → mention picker; restyle to `vxOp0`)
- Modify: `apps/web/app/globals.css` (greeting/composer/picker classes)
- Verify: `tsc --noEmit` + `build` + `TakeScreenshot(["vxOp0"])`

**Interfaces:**
- Consumes: `MentionBox` (`components/MentionBox.tsx`) + `useMentions` (`components/Mentions.tsx`) — the existing @mention machinery used by `ChatThread`; `overview.staff` for the helper list; the disabled pattern from `Shell.tsx:108`.
- Produces: the greeting composer renders through `MentionBox` with an @mention picker listing real helpers (selectable) and a **HIRES · PERSONAS** group rendered **disabled/"coming soon"** (non-interactive). Send still does `POST /threads {scope:"master"}` → message → navigate. "Your team right now", "Latest from Chief of Staff", "Your work" restyled to `vxOp0`.

- [ ] **Step 1: Replace the plain `<textarea>` in `DeskComposer` with `MentionBox`** (same value/onChange/onKeyDown send wiring); confirm `useMentions` drives the helper autocomplete. `tsc` clean.
- [ ] **Step 2: Add the disabled PERSONAS group** to the mention/picker menu — a non-selectable section labeled "coming soon" (reuse `Shell.tsx:108` disabled styling). Assert the group is non-interactive (no onClick, `aria-disabled`) — **Review Focus**.
- [ ] **Step 3: Restyle** greeting, composer, "Your team right now", "Latest from CoS", "Your work" to `vxOp0`. Grep each new/renamed CSS class (no dead CSS).
- [ ] **Step 4: Verify** — `./node_modules/.bin/tsc --noEmit`; `npm run build`; `TakeScreenshot(["vxOp0"])` diff; confirm personas disabled.
- [ ] **Step 5: Commit** — `feat(web): greeting home + @mention helper picker match Section 02`

---

### Task 7: Backend — v2 block producer (read-time mapping for the focused view)

**Files:**
- Modify: the thread/message serializer that builds `Message.blocks` for `GET /api/threads/{id}` (locate it — likely `routers/api.py`'s thread serializer or a `serializers.py`/`X.thread()` helper; it is where today's `choices`/`proposal`/`file` blocks are assembled)
- Reference (read, do not edit): `apps/web/components/chat/blocks.tsx` — match the EXACT field names `ActionCardBlock` and `CodeBlock` read (so the produced blocks render through the Section 09 pipeline)
- Test: `apps/api/tests/test_v2_blocks.py`

**Interfaces:**
- Consumes: the thread's task (`scope="task"` → `ref_id`), that task's open `Proposal`(s), and PR/diff artifacts (`KbSource.kind=="pr"`, and any stored diff/result on the proposal/task).
- Produces: at read time, agent messages in a task-scoped thread gain derived v2 blocks the renderer already supports:
  - an open **Proposal** → an **`action_card`** block carrying the proposal `id` + title + decision actions, shaped so `ActionCardBlock`'s `onProposal`/`onDecide` wiring works (same `id` the decide endpoints expect).
  - a **PR / diff** artifact → a **`code`** block with `diff` lines, shaped to what `CodeBlock` reads.
  - This REPLACES the legacy `proposal` block for that content (do not emit both — avoid a double-render); existing non-task threads are unchanged.
- Scope limit: only `action_card` and `code` (the blocks `fmF8G` actually shows). Streaming/reasoning/todos/usage-meter stay for a later harness pass — NOT produced here. Log nothing silently dropped (`log()`/comment the limit).

- [ ] **Step 1: Read `blocks.tsx`** to pin the exact `action_card` and `code`/diff field names, then write the failing tests:

```python
# test_v2_blocks.py
async def test_open_proposal_becomes_action_card(client, db):
    # seed: task-scoped Thread + open Proposal P on that task + an agent Message
    r = await client.get(f"/api/threads/{THREAD_ID}")
    blocks = [b for m in r.json()["messages"] for b in (m.get("blocks") or [])]
    ac = next(b for b in blocks if b["type"] == "action_card")
    assert ac["id"] == P_ID                      # decide callbacks target the real proposal
    assert not any(b["type"] == "proposal" for b in blocks)   # no double-render

async def test_pr_artifact_becomes_code_block(client, db):
    # seed: task-scoped Thread + a PR artifact carrying a diff
    r = await client.get(f"/api/threads/{THREAD_ID}")
    blocks = [b for m in r.json()["messages"] for b in (m.get("blocks") or [])]
    assert any(b["type"] == "code" and b.get("diff") for b in blocks)
```

- [ ] **Step 2: Run them, verify they fail** — `uv run pytest apps/api/tests/test_v2_blocks.py -v`.
- [ ] **Step 3: Implement the read-time mapping** in the thread serializer: when a thread is task-scoped, map its open proposal → `action_card` (with the proposal id/actions) and a PR/diff artifact → `code`, and suppress the legacy `proposal` block for the same content. Match `blocks.tsx` field names exactly.
- [ ] **Step 4: Run them, verify they pass.** Also run the existing thread/focus tests to confirm non-task threads are untouched.
- [ ] **Step 5: Commit** — `feat(api): derive action_card/code v2 blocks for task threads`

---

## Notes for the executor

- Build order: Tasks 1–3 (board) → Task 4 (right rail) → **Task 7 (v2 block producer)** → Task 5 (continuity) → Task 6 (greeting). Tasks 1 and 2 are independent; 3 depends on both; 4 and 7 pair (the focused view + the blocks it renders); 5/6 independent.
- Shared-file touch points (serial, additive): `app/globals.css` (T3,T4,T6 add their own classes), `app/chat/page.tsx` (T3 board branch, T5 seed prop — distinct edits), `lib/api.ts` (T3 types). Each task touches only its own classes/branches.
- Task 7 scope is deliberately narrow — only the `action_card`/`code` blocks `fmF8G` shows, via read-time mapping of existing proposals/PRs. The full live-streaming v2 vocabulary (streaming/reasoning/todos/usage meter) remains a separate later harness pass; that limit is intentional and should be noted in code, not silently assumed complete.
