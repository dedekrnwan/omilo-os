# Approvals in chat + bulk approve + multi-engine harness — Design

**Date:** 2026-10-18
**Status:** Draft for approval (no code until approved)

## Intent

Three gaps the owner feels day to day:

1. **Approvals only live in the Inbox.** When a helper needs a decision — approve an
   outward action (post/send/spend), answer a question, or grant access — the owner has to
   leave the chat and go to the Inbox. Only the new access-request card renders inline in
   chat; the common case (proposals) does not. The owner wants to decide where the
   conversation already is.
2. **Reviewing many items is slow.** With a pile of pending approvals the owner opens them
   one by one. There is no way to clear a batch.
3. **"Harness" is welded to one engine.** The Harness page is the per-agent *tool-execution
   runtime*, but today it only manages the **Claude Code account pool**. The engine layer is
   already vendor-agnostic (LiteLLM, 8 providers, `_engine_for`), yet the page shows only
   Claude Code. The owner wants one screen for *every* engine a helper can run on.

## Decisions (settled with the owner)

- **Approvals in chat: all kinds.** Proposals, access requests, and questions all render as
  inline cards in their thread, decidable in one tap. The Inbox stays as the catch-all mirror
  (and the only home for items that have no chat thread).
- **Bulk approve: select + batch action.** Checkboxes in the Inbox, with Select-all and
  select-by-helper / by-kind, then one Approve / Deny for the selection.
- **Batch safety: include high-risk, with an extra confirm.** High-risk items (spend money,
  send externally) *can* be in a batch, but confirming the batch shows a clear
  "this spends money / sends externally" summary and requires a second confirm.
- **Harness: full per-engine manager.** One page: the Claude Code pool as one section, plus an
  API-key card per other vendor (OpenAI, Gemini, …) showing health and which helpers use it.
- **Build order: all three in one plan**, executed via subagent-driven development.

---

## Feature A: approvals in chat (all kinds)

### The problem in the data model

`InboxItem` and `Proposal` carry `task_id`, but **`Task` has no `thread_id`** and neither do
they. So an approval cannot currently find "its" chat thread. The access-request card worked
around this by persisting the thread id in the item body and posting a card block into that
thread at creation time.

### The fix: one thread link + one card-posting path

- Add a nullable **`thread_id`** column to `InboxItem`. Any approval created inside a chat turn
  records the thread it came from; anything created by a background shift/execution task leaves
  it null and stays Inbox-only. A column (not body JSON) because every kind needs it and the
  Inbox list already loads items. New access/proposal/question items populate the column; the
  shipped `access_request` message-scan (`decide_access`) stays as the fallback for items
  created before the column existed, so no data migration is required.
- At creation time, when `thread_id` is set, post an agent message into that thread with a
  typed card block, reusing `services.post_message(..., blocks=[...])` exactly as
  `access_request` and `offer_choices` already do:
  - proposal → `{"type":"proposal","proposal_id":...,"title":...,"risk":...,"summary":...}`
  - question → `{"type":"question","item_id":...,"question":...}`
  - access → unchanged (`{"type":"access_request",...}`, already shipped)
- The card decision calls the **existing** endpoints — `POST /proposals/{id}/decide`,
  `POST /inbox/{id}/answer`, `POST /access/{id}/decide` — then refreshes. Deciding in chat or
  in the Inbox resolves the same record; the card flips to a `decided` state and disables.

### Where the thread id comes from

A chat turn runs in `worker.answer_thread(thread_id)`; the helper reaches the gateway through
its MCP token. **Only `request_access` / `offer_choices` / `share_file` / `propose_job` resolve
the current thread today** (via `events.current_run(...)` in `mcp_server.py`); `propose` and
`ask_founder` do **not**, and `S.create_proposal` / `S.ask_founder` take no `thread_id`. So
Feature A adds, following the shipped `request_access` precedent verbatim:
- `events.current_run(...)` thread resolution in the `propose` and `ask_founder` MCP handlers,
- a `thread_id` parameter on `create_proposal` and `ask_founder`,
- the card-posting path in each (post into the thread when `thread_id` is set).

This is new wiring in two handlers + two service signatures, not a drop-in — the mechanism is
copied from `request_access`, but it must be built for these two kinds.

### Rendering (web)

`Conversation.tsx` already filters `blocks` by type (`choices`, `access_request`). Add two
sibling renderers:
- `ProposalCard` — title, which helper, risk badge, one-line summary, **Approve / Request
  changes / Reject** (reusing the proposal decision verbs that already exist), reason field on
  reject.
- `QuestionCard` — the question text and a reply box → `inbox/{id}/answer`.

No URLs, keys, or "MCP" wording; keyboard-focusable; antislop UI gate on all new cards.

### Safety (unchanged)

In-chat approval is the same decision as the Inbox one — same endpoint, same audit, same
risk gating. Nothing about outward-action safety changes; this only moves *where* the owner
can tap yes. High-risk proposals still show their risk and still need an explicit tap (no
auto-approve).

---

## Feature B: bulk approve (select + batch action)

### The control

On the Inbox page, each **bulk-eligible** item gets a checkbox. Bulk-eligible = `proposal` and
`access_request` (the review volume). `question` needs a written answer and `workflow` /
`skill_share` have their own flows, so they get **no checkbox** and are never part of a batch —
this keeps "Select all" honest (every checked item will actually act). A selection bar appears
when any are checked: **N selected · Select all · Approve · Deny · Clear**, plus quick filters
**by helper** and **by kind** that drive Select-all-of-this-group.

### What "batch approve" does

Server-side, a new endpoint applies the same per-item decision used today, looped with one
audit event per item and one summary event:

```
POST /api/inbox/bulk        body: { ids: [..], decision: "approve"|"deny", note?, confirm_high_risk?: bool }
  -> { approved: [...], denied: [...], skipped: [{id, reason}], needs_confirm: [{id, risk, why}] }
```

- Each id is dispatched to the right handler by its kind (proposal → `decide_proposal`,
  access → `decide_access` with scope `once`). Non-eligible kinds that somehow arrive are
  returned in `skipped`.
- `decide_proposal` **requires a non-empty note on reject** (`services.py:360`). So a bulk
  **Deny** requires `note`; the client collects one note and applies it to every denied item.
  Bulk **Approve** of N proposals spawns N execution tasks — that is the intended effect of
  approving, same as approving them one by one.
- Items already decided return in `skipped` (idempotent; mirrors the 409-on-redecide rule).
- The existing low-risk `POST /proposals/{pid}/decide-similar` is left as-is (additive); the new
  endpoint does not replace it, so the current one-tap low-risk flow does not regress.

### Batch safety (the extra confirm)

- The endpoint classifies each selected item's risk. If any selected item is **high-risk**
  (outward: spend money / send externally) and `confirm_high_risk` is not set, it does **not**
  decide anything — it returns `needs_confirm` listing exactly those items.
- The web client then shows a second dialog: *"3 of these spend money or send messages
  externally: …"* with the list, and only on a second confirm re-calls with
  `confirm_high_risk: true`.
- Risk source: `Proposal.risk` (`low | medium | high`). Access grants and internal file edits
  are treated as non-high. This reuses the existing risk field; no new taxonomy.

### Reuse

The existing `decide-similar` (low-risk-only proposal batching) is superseded by this general
path; keep it working or route it through the new endpoint (decide in the plan).

---

## Feature C: multi-engine harness

### What "harness" means here

The per-agent tool-execution runtime. Claude Code (a rotating pool of subscription tokens) is
**one** harness; the LiteLLM vendors (OpenAI, Gemini, Mistral, …), each a single API key, are
others. The engine layer already routes all of them (`engines/__init__.py:get_engine`,
`_engine_for` in `api.py`). Only the page is behind.

### The page

`app/harness/page.tsx` becomes a list of **engine sections**, not a single pool:

- **Claude Code pool** — the current UI unchanged (accounts table, add-token drawer, usage
  meter, auto-rotation). It is just the first section now.
- **One card per other vendor** — the vendor name + brand icon (`ProviderLogo`, already
  exists), whether a key is set, a **health** dot, the model in use, and **which helpers run on
  it**. Actions: add / replace key (reuse the existing AI-key setting path), set as default for
  all helpers, and a per-card **Test** button.
- **Health is on-demand, not polled.** The existing `GET /ai/providers` makes *no* live network
  calls by design (`api.py:942`), and the Harness page polls every 15s — so the list must not
  probe every vendor on every poll. The list shows `key_set` + the last known health; a live
  `health()` probe runs only when the owner taps **Test** on a card (mirroring the Claude Code
  account "Test" button). Last-known health is cached per vendor.

### Backend (small)

- `GET /api/harness/engines` — one list combining the Claude Code pool summary and, per
  vendor, `{id, label, key_set, last_health, model, helpers: [...]}`. Assembles from the
  existing provider registry, the AI-key store, and a per-staff engine scan (which helpers have
  that provider in `staff.engine`). **No network calls.**
- `POST /api/harness/engines/{provider}/test` — runs the engine's async `health()` once and
  caches the result.
- **No backend change for "use for all":** `POST /ai` already accepts any provider in the
  registry and calls `_engine_for` (`api.py:975-1001`). The only hardcoding is in the **web**
  page — `harness/page.tsx:57` posts `provider:"claude-code"`. The fix is to pass the selected
  vendor id there; the endpoint is already general.

No change to how engines actually run — this is surfacing and managing what already works.

### Non-goal (C)

Multi-key *pools* for non-Claude vendors (rotation across several OpenAI keys). v1 is one key
per vendor; the Claude Code pool stays the only rotating pool. Documented, not built.

---

## Reuse (not rebuilt), across all three

- Inline cards: the message `blocks` mechanism (`offer_choices`, `access_request`).
- Decision plumbing: `decide_proposal`, `decide_access`, `answer_question`, and their routes.
- Risk: `Proposal.risk`.
- Engine routing: `get_engine`, `_engine_for`, `GET /api/ai/providers`, `ProviderLogo`.
- Pool UI: the current Harness page becomes the "Claude Code" section verbatim.

## Risks and mitigations

- **Proposal with no thread** (background shift/execution) → `thread_id` null, Inbox-only; the
  card path is skipped cleanly. Tested.
- **Double decide (chat card + Inbox + batch)** → all paths hit one record; second decision is
  the existing no-op/409. Tested.
- **Batch silently approving a paid/outward action** → high-risk items force the second
  confirm; without it the batch decides nothing and reports `needs_confirm`. Tested.
- **Questions in a batch** → cannot be bulk-approved (need a written answer); returned in
  `skipped`, never silently closed.
- **Harness page showing a vendor with no key as "ready"** → the dot shows `key_set` + last
  known health (from the on-demand Test), never "ready" purely from registry presence; an
  untested vendor reads "not tested", matching the Claude Code account pattern.

## Non-goals (v1)

- Auto-approving outward actions (unchanged: posting/sending/spending still ask).
- Multi-key pools for non-Claude vendors.
- Revoking access from chat (still done on the Capabilities pages).
- Changing how any engine executes.

## Verification

- A chat helper proposes an outward action → a proposal card appears **in the thread** and in
  the Inbox; Approve in the chat card closes both and the helper continues; same for a
  question (reply in chat) and an access request (already shipped).
- A proposal created by a background shift (no thread) appears only in the Inbox.
- Selecting 10 low/medium items + Approve clears them in one call with per-item audit.
- Selecting a set that includes a high-risk (spend/send) item surfaces the second confirm and
  decides nothing until confirmed.
- The Harness page shows the Claude Code pool **and** a card per vendor with correct key/health
  state and the helpers on each; "use for all" works for a non-Claude vendor.
- Audit log shows each decision (single or batched) and each engine change with the actor.
