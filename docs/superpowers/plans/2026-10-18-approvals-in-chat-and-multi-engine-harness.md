# Approvals in chat + bulk approve + multi-engine harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every helper approval (proposal, question, access) decidable inline in its chat thread, let the owner batch-approve from the Inbox with a high-risk second confirm, and turn the Harness page into a per-engine manager (Claude Code pool + a card per vendor) instead of Claude-Code-only.

**Architecture:** Approvals reuse the shipped `access_request` pattern — a typed message `block` posted into the originating thread (resolved via `events.current_run`) plus the existing decision endpoints; a new nullable `InboxItem.thread_id` column records the chat home. Bulk approve is one new `POST /api/inbox/bulk` endpoint that dispatches each id to its existing per-item decider with a risk gate. The Harness page gains a no-network `GET /api/harness/engines` summary and renders the existing Claude Code pool as one section plus vendor cards using the existing provider registry / `ProviderLogo` / `POST /ai/check`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Redis, pytest (+ the `owner` API-client fixture); Next.js/React/TS + `tsc --noEmit`.

**Spec:** `docs/approvals-in-chat-and-multi-engine-harness-design.md`

## Global Constraints

- **Reuse, do not rebuild.** The `access_request` card path is the template for proposals/questions: `events.current_run(db, st.id, task_id) -> (task_id, thread_id)`, resolve `th` (`S.get_or_create_thread(db,"task",...)` for a task or `db.get(S.Thread, thread_id)` for a chat), pass `th` pre-resolved to the service, and post via `S.post_message(db, th, "agent", st.id, text, blocks=[...])` (see `mcp_server.py:369-388` and `services.py:466-511`). Decision endpoints already exist: `POST /proposals/{pid}/decide`, `POST /inbox/{iid}/answer`, `POST /access/{item_id}/decide`.
- **Chat block renderers** live in `apps/web/components/Conversation.tsx` next to `Choices` / `AccessRequest` / `JobProposal`, wired through the existing `onDecide` prop threading on `Conversation`.
- **Risk** is `Proposal.risk ∈ {low, medium, high}` (`models.py:151`). High-risk = outward spend/send. Access grants and internal edits are non-high.
- **Bulk-eligible kinds are `proposal` and `access_request` only.** `question`, `workflow`, `skill_share` are never selectable for batch.
- `decide_proposal` requires a non-empty note on reject/changes (`services.py:360`); bulk deny must supply one.
- **No new network calls on page polls.** `GET /ai/providers` is no-network by design (`api.py:942`); the new engines summary is also no-network. A live `health()` probe happens only on an explicit Test (reuse `POST /ai/check`).
- `POST /ai` already accepts any provider in `AI_PROVIDERS` and routes via `_engine_for` (`api.py` `_apply_ai`); the Claude-Code hardcoding is only in the web page (`harness/page.tsx:57`).
- Every decision (single or batched) and engine change writes an audit event (`services.audit`). Outward-action safety and strict mode are unchanged.
- Tests use the `owner` API-client fixture; API routes under `/api`. Run API tests from `apps/api` with `.venv/bin/python -m pytest`; web check is `cd apps/web && node_modules/.bin/tsc --noEmit`.

## Review Focus

- **A proposal/question created with no thread (background shift/execution task) files to the Inbox only and never crashes the posting path.** *(Task 1, Task 2)*
- **Bulk deny with no note fails loudly and decides nothing** (not a partial/ambiguous batch). *(Task 4)*
- **A batch containing a high-risk (spend/send) proposal decides nothing until `confirm_high_risk` is set, and reports those items in `needs_confirm`.** *(Task 4)*
- **Deciding in the chat card then again in the Inbox (or via batch) is a no-op/409 on the second, never a double side-effect.** *(Task 1, Task 4)*
- **The engines summary endpoint makes zero network calls; health is "not tested" until the owner taps Test.** *(Task 6)*
- **A question swept into a bulk selection is impossible (no checkbox) — "Select all" only checks bulk-eligible items.** *(Task 5)*

---

### Task 1: `thread_id` on InboxItem + proposal card in chat

**Files:**
- Modify: `apps/api/omilo_api/models.py` (add `InboxItem.thread_id`)
- Modify: `apps/api/omilo_api/services.py` (`create_proposal` gains `thread_id` + `th` and posts a `proposal` card block)
- Modify: `apps/api/omilo_api/mcp_server.py` (`propose` handler resolves thread via `current_run`, passes `th`)
- Test: `apps/api/tests/test_approvals_chat.py`

**Interfaces:**
- Consumes: `events.current_run(db, st_id, task_id) -> (task_id, thread_id)`; `S.post_message(db, th, role, author, text, blocks=)`; `S.get_or_create_thread`.
- Produces: `InboxItem.thread_id: str | None` (nullable column, no migration script — `Base.metadata.create_all` adds it on boot for fresh DBs; existing rows read null). `create_proposal(db, st, task_id, title, type_, risk, body, actor=None, thread_id=None, th=None) -> Proposal` — when `th` is given, posts an agent message into it with blocks `[{"type":"text","text":...}, {"type":"proposal","proposal_id":p.id,"title":p.title,"risk":risk,"summary":<first line of body>}]`, and sets `item.thread_id=thread_id` on the created `InboxItem`. Signature stays backward-compatible (new args keyword-only with defaults).

- [ ] **Step 1: Write failing tests** (use `owner`):

```python
def test_propose_in_chat_posts_proposal_card(owner):
    # a staff with a chat thread calls propose via MCP -> the thread has a message whose
    # blocks include {"type":"proposal","proposal_id":...}; the InboxItem.thread_id == that thread
    ...
def test_propose_without_thread_files_inbox_only(owner):
    # create_proposal(..., th=None) -> Proposal + InboxItem created, no message posted, thread_id is None, no error
    ...
def test_decide_proposal_from_inbox_after_chat_card_is_idempotent(owner):
    # decide once -> ok; decide again -> 409 (unchanged decide_proposal guard)
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the column, the `create_proposal` card path, and the `propose` MCP handler thread resolution (copy the `request_access` block at `mcp_server.py:369-388`, minus the "no open chat" hard error — a proposal with no thread is allowed, so fall back to `th=None`).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(approvals): proposal cards in chat + InboxItem.thread_id`.

---

### Task 2: Question card in chat

**Files:**
- Modify: `apps/api/omilo_api/services.py` (`ask_founder` gains `thread_id` + `th`, posts a `question` card block)
- Modify: `apps/api/omilo_api/mcp_server.py` (`ask_founder` handler resolves thread via `current_run`)
- Test: `apps/api/tests/test_approvals_chat.py`

**Interfaces:**
- Produces: `ask_founder(db, st, task_id, question, blocking, thread_id=None, th=None) -> InboxItem` — when `th` given, posts blocks `[{"type":"text","text":question}, {"type":"question","item_id":item.id,"question":question}]` and sets `item.thread_id`. Backward-compatible defaults.
- Consumes: same `current_run` resolution as Task 1.

- [ ] **Step 1: Write failing tests:**

```python
def test_ask_founder_in_chat_posts_question_card(owner):
    # ask_founder via MCP with a chat thread -> message block {"type":"question","item_id":...}; item.thread_id set
    ...
def test_answer_question_from_chat_closes_item(owner):
    # POST /inbox/{id}/answer -> item.status == "done" (unchanged answer_question)
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the `ask_founder` card path + MCP handler resolution (fall back to `th=None` when no thread).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(approvals): question cards in chat`.

---

### Task 3: Render proposal + question cards in chat (web)

**Files:**
- Modify: `apps/web/components/Conversation.tsx` (add `ProposalCard`/`QuestionCard`, extend `Msg.blocks` type, render next to `AccessRequest`)
- Modify: `apps/web/app/chat/page.tsx` (handlers: proposal decide → `/proposals/{id}/decide`; question answer → `/inbox/{id}/answer`)
- Test: `cd apps/web && node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: block shapes from Tasks 1-2 (`{type:"proposal",proposal_id,title,risk,summary}`, `{type:"question",item_id,question}`); endpoints `POST /proposals/{id}/decide` (body `{decision:"approve"|"reject"|"changes", note}`), `POST /inbox/{id}/answer` (body `{answer}`).
- Produces: `ProposalCard` — title, helper, risk badge, summary, **Approve / Request changes / Reject** (reject/changes open a required note field); `QuestionCard` — question text + reply box. Both show a `decided` state and disable after acting. Follow the `AccessCard` structure (`Conversation.tsx:99`). No URLs/keys/"MCP" wording; keyboard-focusable; antislop UI gate.

- [ ] **Step 1: Implement** the two cards + thread them through the existing `onDecide`-style prop on `Conversation` (add a sibling callback, e.g. `onProposal`/`onAnswer`, mirroring `onDecide` at `Conversation.tsx:188,218`), and wire the calls in `chat/page.tsx`.
- [ ] **Step 2: Verify** — `tsc --noEmit` exits 0; block shapes match Tasks 1-2 exactly.
- [ ] **Step 3: Commit** — `feat(web): inline proposal & question approval cards in chat`.

---

### Task 4: Bulk decide endpoint

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `POST /api/inbox/bulk`)
- Modify: `apps/api/omilo_api/services.py` (add `bulk_decide` helper if the route needs it)
- Test: `apps/api/tests/test_bulk_decide.py`

**Interfaces:**
- Produces: `POST /api/inbox/bulk` body `{ids: list[str], decision: "approve"|"deny", note: str = "", confirm_high_risk: bool = False}` → `{approved: [...], denied: [...], skipped: [{id, reason}], needs_confirm: [{id, risk, why}]}`.
  - Per id, load `InboxItem`; dispatch by kind: `proposal` → `S.decide_proposal(db, p, "approve"|"reject", note, by)`; `access_request` → `S.decide_access(db, item, "once"|"deny", by, note)`. Non-eligible kind or missing/closed item → `skipped`.
  - **Risk gate:** before applying, collect ids whose kind is `proposal` and `Proposal.risk == "high"`. If any and not `confirm_high_risk` → return them in `needs_confirm`, apply **nothing**.
  - **Deny requires note:** if `decision=="deny"` and `note` is blank → `HTTPException(400)` (so nothing is half-applied; mirrors `decide_proposal`).
  - One audit event per applied item + one `inbox.bulk` summary audit.

- [ ] **Step 1: Write failing tests** (use `owner`):

```python
def test_bulk_approve_low_medium(owner):
    # two low/medium proposals -> approved both; each Proposal.status == "approved"; inbox items closed
    ...
def test_bulk_deny_requires_note(owner):
    # decision="deny", note="" -> 400, nothing decided
    ...
def test_bulk_high_risk_needs_confirm(owner):
    # selection incl. a high-risk proposal, confirm_high_risk False -> needs_confirm lists it, approved == []
    # then confirm_high_risk True -> it is approved
    ...
def test_bulk_skips_ineligible_and_decided(owner):
    # a question id and an already-decided proposal id -> both in skipped with reasons; others still approved
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the route (+ helper). Keep `POST /proposals/{pid}/decide-similar` untouched.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(inbox): bulk approve/deny with high-risk confirm gate`.

---

### Task 5: Bulk-select UI on the Inbox

**Files:**
- Modify: `apps/web/app/page.tsx` (checkboxes on bulk-eligible `needs` cards + selection bar + batch dialog)
- Test: `cd apps/web && node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `POST /api/inbox/bulk` (Task 4); the `needs: NeedCard[]` board data (`page.tsx:23,26`); `confirmDialog`.
- Produces: a checkbox on each `NeedCard` whose `kind ∈ {proposal, access_request}` only (no checkbox otherwise). A selection bar: **N selected · Select all (bulk-eligible) · by helper · by kind · Approve · Deny · Clear**. Deny opens a shared note field. If the response returns `needs_confirm`, show a second dialog listing those items ("these spend money or send externally") and on confirm re-POST with `confirm_high_risk:true`. Refresh the board + count after. Keyboard-focusable; antislop UI gate.

- [ ] **Step 1: Implement** selection state, the eligible-only checkboxes, the selection bar, and the two-step high-risk confirm.
- [ ] **Step 2: Verify** — `tsc --noEmit` exits 0; checkboxes appear only on proposal/access cards; "Select all" selects only those.
- [ ] **Step 3: Commit** — `feat(web): bulk-select approvals with batch approve/deny`.

---

### Task 6: Engines summary endpoint (no network)

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `GET /api/harness/engines`)
- Test: `apps/api/tests/test_harness_engines.py`

**Interfaces:**
- Produces: `GET /api/harness/engines` → `{claude_code: <existing pool summary shape>, vendors: [{id, label, key_set, model, helpers: [{id, name}]}]}`. Assemble from `_providers_reg` (labels/ids), `S.ai_api_key(db, pid)` (key_set), and a scan of `Staff.engine` via `_provider_of` (which helpers run each provider). **No network calls, no `health()`.** The Claude Code pool summary reuses whatever `GET /harness` already returns (call the same assembly).
- Note: per-vendor live health reuses the existing `POST /ai/check` (`api.py:86` region) — no new test endpoint.

- [ ] **Step 1: Write failing tests** (use `owner`, `monkeypatch`):

```python
def test_harness_engines_lists_vendors_and_keys(owner):
    # GET /api/harness/engines -> vendors includes the 8 ids; key_set reflects stored keys; helpers map by provider
    ...
def test_harness_engines_makes_no_network_calls(owner, monkeypatch):
    # monkeypatch each engine.health to raise; endpoint still returns 200 (proves health is not called here)
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the endpoint (pure assembly).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(harness): no-network engines summary (pool + vendors)`.

---

### Task 7: Multi-engine Harness page

**Files:**
- Modify: `apps/web/app/harness/page.tsx` (render engine sections; fix the hardcoded `claude-code`)
- Test: `cd apps/web && node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `GET /api/harness/engines` (Task 6); `GET /api/ai/providers`; `ProviderLogo`; `POST /ai/check` (Test a vendor); `POST /ai` (set a vendor as default for all helpers — pass the selected provider id, **not** a hardcoded `"claude-code"`, fixing `harness/page.tsx:57`); the existing AI-key setting path for add/replace key.
- Produces: the page as sections — **Claude Code pool** (the entire current UI, unchanged, as section one) and a **vendor card** per non-Claude provider: brand icon, key state, a Test button (→ `/ai/check`, shows the result inline, "not tested" until tapped), the model, which helpers use it, add/replace key, and "use for all". Keyboard-focusable; antislop UI gate.

- [ ] **Step 1: Implement** the sectioned layout, vendor cards, Test wiring, and the `useForAll` provider-id fix.
- [ ] **Step 2: Verify** — `tsc --noEmit` exits 0; the Claude Code pool still renders and works; vendor cards show correct key/health state; "use for all" sends the chosen provider.
- [ ] **Step 3: Commit** — `feat(web): per-engine Harness page (Claude Code pool + vendor cards)`.

---

## Self-Review

- **Spec coverage:** Feature A (approvals in chat) → Tasks 1-3; Feature B (bulk approve) → Tasks 4-5; Feature C (multi-engine harness) → Tasks 6-7. Batch high-risk confirm → Task 4 + 5. `thread_id` link → Task 1.
- **Type consistency:** block shapes `{type:"proposal",proposal_id,...}` / `{type:"question",item_id,...}` identical across Task 1/2 (produce) and Task 3 (consume); `POST /api/inbox/bulk` body + response identical Task 4 ↔ Task 5; `GET /api/harness/engines` shape identical Task 6 ↔ Task 7. `create_proposal` / `ask_founder` new args are keyword-only with defaults, so existing callers (shift/execution) keep working.
- **Review Focus:** no-thread fallback (T1/T2), deny-needs-note (T4), high-risk-confirm (T4), idempotent re-decide (T1/T4), no-network engines (T6), question-not-selectable (T5) — all owned.
- **Proportion:** 7 tasks, backend-first within each feature, each with its own test cycle; the plan carries signatures and test names, not full bodies.
