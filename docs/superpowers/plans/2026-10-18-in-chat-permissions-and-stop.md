# In-chat permissions + force-stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a helper ask for access (folder, connector, skill) inline in the chat with one-tap Allow once / Always allow / Deny, and let the owner force-stop a running chat turn.

**Architecture:** A new `request_access` MCP tool posts an `access_request` message block (same mechanism as `offer_choices`) and files an `InboxItem(kind="access_request")`. A decision route applies the grant (one-off via `ThreadTools`/task allow-set, or persisted via `Folder`/`Connector`/skill frontmatter) and spawns a follow-up task so the helper continues. Force-stop adds `POST /api/threads/{thid}/cancel` that cancels the worker's `chatting[thread_id]` async task via a Redis cancel signal, ending the turn as `stopped`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Redis (bus), pytest (+ the `owner` API-client fixture); Next.js/React/TS + `tsc --noEmit`.

**Spec:** `docs/in-chat-permissions-and-stop-design.md`

## Global Constraints

- Reuse, do not rebuild: the `offer_choices` block pattern (`{"type":"choices",...}` + `Conversation.tsx` `Choices`), `services.post_message(..., blocks=)`, the proposal/Inbox/`decide` plumbing, the `allow_connectors` one-off pattern, and `Folder`/`Connector`/`ThreadTools` models + their routes.
- Grant kinds (v1): `folder`, `connector`, `skill`. Each decision is `once` (this chat/task only), `always` (persisted), or `deny`.
- Hard command denials (`rm`, `sudo`, `git push`, publish, deploy, `ssh`) stay enforced even after a folder+commands grant (unchanged in `claude_code.py`). Strict mode and the outward-action approval path are unchanged.
- Every grant and every stop writes an audit event (`services.audit`).
- Chat turns are NOT Tasks: they run via `worker.chatting[thread_id] = asyncio.create_task(answer_thread(...))`. Stop targets that, not `/tasks/{id}/cancel`.
- Tests use the `owner` API-client fixture (no `db`/`client` fixture); API routes are under `/api`. No new DB table (reuse `InboxItem`).
- Run API tests from `apps/api` with `.venv/bin/python -m pytest`; web check is `cd apps/web && node_modules/.bin/tsc --noEmit`.

## Review Focus

- **Deny records the reason as a lesson and unblocks the helper** (no silent dangling request). *(Task 3)*
- **Always-allow folder with commands still blocks `rm`/`git push`** (grant is not a blank check). *(Task 2)*
- **Stop while the engine subprocess is mid-call actually kills it within ~2s**, turn ends `stopped` with partial output. *(Task 4)*
- **A decided card cannot be decided twice** (chat card and Inbox point at one record; second decision is a no-op 409). *(Task 3)*
- **Stop signal reaches a separate worker process** (Redis channel), not only the embedded in-process worker. *(Task 4)*

---

### Task 1: `request_access` tool + access-request card + record

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (tool def + handler, near `offer_choices`)
- Modify: `apps/api/omilo_api/services.py` (add `request_access`)
- Test: `apps/api/tests/test_access.py`

**Interfaces:**
- Produces: `services.request_access(db, st, task_id, thread_id, kind, target, reason) -> InboxItem` — creates `InboxItem(kind="access_request", title=reason[:300], body=json({kind,target,reason}), level="decision", blocking=False)` and posts an agent message with a block `{"type":"access_request","request_id":item.id,"kind":kind,"target":target,"reason":reason}`.
- Produces: MCP tool `request_access(kind, target, reason, task_id?)` → `{"decision":"needs_approval","request_id":...}`; `kind in {folder,connector,skill}`.

**Status: COMPLETE** (commit 6f26677).

---

### Task 2: Grant application (once / always) for folder, connector, skill

**Files:**
- Modify: `apps/api/omilo_api/services.py` (add `apply_grant`)
- Modify: `apps/api/omilo_api/capabilities.py` (honor per-thread/task one-off grant in `resolve`)
- Test: `apps/api/tests/test_access.py`

**Interfaces:**
- Produces: `services.apply_grant(db, item, scope, thread_id) -> None`, `scope in {"once","always"}`. folder/always upserts a `Folder(default_on=True)`; folder/once adds to `ThreadTools(thread_id).folders`. connector/always sets `Connector.approval="auto"`+enabled; connector/once adds to `ThreadTools.connectors`. skill/always sets frontmatter `default_on:true`; skill/once adds slug to `ThreadTools.skills`. Hard denials unchanged.

**Status: COMPLETE** (commits ba19218, b05d272).

---

### Task 3: Decision route + unblock the helper

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `POST /api/access/{item_id}/decide`)
- Modify: `apps/api/omilo_api/services.py` (add `decide_access`)
- Test: `apps/api/tests/test_access.py`

**Interfaces:**
- Produces: `services.decide_access(db, item, scope, by, note="") -> InboxItem`, `scope in {"once","always","deny"}`. Resolves thread_id from the card Message (block with request_id==item.id). once/always: `apply_grant`, spawn a follow-up task so the helper continues, mark the block `decided`, `_close_inbox`, audit. deny: record the note as a lesson, close, audit. Second decision on a non-pending item raises `DomainError(409)`.
- Produces: route `POST /api/access/{item_id}/decide` body `{scope, note?}`.

- [ ] **Step 1: Write failing tests** (use `owner`):

```python
def test_decide_access_always_grants_and_unblocks(owner):
    # after request_access(folder,...), POST /api/access/{id}/decide {scope:"always"} ->
    # Folder persisted; inbox item closed; a follow-up task for the helper exists
    ...
def test_decide_access_deny_records_reason(owner):
    # {scope:"deny", note:"no"} -> item closed as denied; note recorded; no grant applied
    ...
def test_decide_access_twice_conflicts(owner):
    # deciding an already-decided request -> 409
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `decide_access` + the route.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(access): decision route, grant-and-continue, deny-as-lesson`.

---

### Task 4: Force-stop a running chat turn

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `POST /api/threads/{thid}/cancel`)
- Modify: `apps/api/omilo_api/worker.py` (cancel `chatting[thid]`; subscribe to a Redis cancel channel)
- Modify: `apps/api/omilo_api/bus.py` (add a subscribe helper if missing)
- Modify: `apps/api/omilo_api/services.py` (mark the turn `stopped`)
- Test: `apps/api/tests/test_access.py` (or `test_chat_stop.py`)

**Interfaces:**
- Produces: route `POST /api/threads/{thid}/cancel` → sets `Thread.awaiting_reply=False`/`pending=None`, publishes `bus.publish("cancel:chat", {"thread_id": thid})`, returns `{"status":"stopping"}`.
- Produces: a worker subscriber on `cancel:chat` that calls `self.chatting[thid].cancel()` (in-process worker may cancel directly). `answer_thread`'s `CancelledError` path ends the turn: post a short "stopped" note, keep partial output, `awaiting_reply=False`. The engine subprocess is killed by existing teardown.

- [ ] **Step 1: Write failing tests:**

```python
def test_cancel_thread_route_clears_awaiting_and_signals(owner, monkeypatch):
    # POST /api/threads/{thid}/cancel -> thread.awaiting_reply False, a cancel:chat publish happened
    ...
def test_worker_cancel_signal_cancels_chatting_task():
    # given a fake worker with chatting[thid]=<pending asyncio task>, the cancel handler cancels it
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** the route, worker subscriber + direct-cancel, and the `answer_thread` `CancelledError` → `stopped` path.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(chat): force-stop a running turn (route + worker cancel signal)`.

---

### Task 5: Permission card UI (Allow once / Always allow / Deny)

**Files:**
- Modify: `apps/web/components/Conversation.tsx` (render the `access_request` block, next to `Choices`)
- Modify: `apps/web/app/chat/page.tsx` (wire the decision call + refresh)
- Test: `cd apps/web && node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: the `access_request` block shape (Task 1); `POST /api/access/{id}/decide` (Task 3).
- Produces: an `AccessRequest` component rendering the helper's ask (path/access/commands, or connector/skill name) + reason, with **Allow once**, **Always allow**, **Deny** (Deny opens a note field). Calls `api("/access/${request_id}/decide",{body:{scope,note}})` then refreshes; a `decided` block shows the outcome and disables buttons. No URLs/keys/"MCP" wording; keyboard-focusable; antislop UI gate.

- [ ] **Step 1: Implement** the `AccessRequest` component (mirror `Choices` at ~line 99) + decide call.
- [ ] **Step 2: Verify** — `tsc --noEmit` exits 0; block-shape check against Task 1's output.
- [ ] **Step 3: Commit** — `feat(web): inline permission card with Allow once / Always / Deny`.

---

### Task 6: Stop button on the live chat turn

**Files:**
- Modify: `apps/web/components/Conversation.tsx` or `app/chat/page.tsx` (show Stop while the turn runs)
- Test: `cd apps/web && node_modules/.bin/tsc --noEmit`

**Interfaces:**
- Consumes: `th.awaiting_reply` (turn-is-running signal); `POST /api/threads/{thid}/cancel` (Task 4); the Stop-button pattern in `TaskDrawer.tsx`.
- Produces: a **Stop** control shown while `th.awaiting_reply` is true, calling `api("/threads/${thid}/cancel",{body:{}})`, letting the stream settle to `stopped`. Reuse `ri-stop-circle-line` + the confirm pattern.

- [ ] **Step 1: Implement** the Stop control gated on `th.awaiting_reply`.
- [ ] **Step 2: Verify** — `tsc --noEmit` exits 0; button appears only while a turn runs.
- [ ] **Step 3: Commit** — `feat(web): Stop button for a running chat turn`.

---

## Self-Review

- Spec coverage: request_access+card → T1; grants once/always → T2; decide/approve/deny/unblock → T3; force-stop → T4; card UI → T5; Stop button → T6.
- Type consistency: block type `access_request`+`request_id` identical T1↔T5; `apply_grant`/`decide_access` signatures consistent T2↔T3; `cancel:chat` channel identical T4 route↔worker.
- Review Focus: deny-unblocks (T3), commands-grant-keeps-denials (T2), stop-kills-subprocess (T4), decide-twice-409 (T3), cross-process stop (T4). All owned.
