# API-driven + MCP-native platform with autonomy toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents native MCP tools for every write action they need (headline: staff lifecycle), gated by a founder-only Strict/Auto toggle, and fix the approval-sync and inbox-fullview UI bugs.

**Architecture:** One `gated_execute` helper generalizes the existing `request_action` gate — it acts inline, files a proposal, or refuses based on `policy.level_for` + the autonomy mode. Every new MCP tool is a thin `TOOLS` entry + `call_tool` branch that calls a service function through `gated_execute`. Actions whose write logic lives inline in router handlers are first extracted into reusable services, then called by both REST and MCP. The toggle writes the two existing autonomy keys coherently and is surfaced in the nav; it has no MCP tool.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy (apps/api), Next.js + React/TS (apps/web), pytest (Postgres-backed), MCP over Streamable HTTP.

**Spec:** `docs/superpowers/specs/2026-10-21-api-driven-mcp-native-autonomy-design.md`

## Global Constraints

- Reuse the two existing autonomy keys — do **not** invent a third. Toggle writes both: **Strict** → `strict_mode=true` + `autonomy_mode="strict"`; **Auto** → `strict_mode=false` + `autonomy_mode="permissive"`.
- Every MCP tool routes through `gated_execute` → `policy.level_for`. No tool bypasses the gate.
- `OFF` actions (`deploy`, `code.merge`, `db.write`) never auto-run — refused even in Auto.
- Credential/auth/company-delete actions get **no MCP tool** (excluded). `ALWAYS_ASK` forces a proposal even in Auto, as defense-in-depth.
- `grant_staff_access`: **Auto → inline, zero confirm** (founder decision); Strict → files a proposal. Not in `ALWAYS_ASK`.
- The toggle is founder-only: settable only via the authenticated `/system` endpoint. No MCP tool may set `autonomy_mode`/`strict_mode`/`paused`.
- SQLite **and** Postgres must both work; normalize tz on any new datetime comparison (`_aware` pattern).
- Backend tests run via `apps/api` pytest (Postgres). MCP tools are tested through the `call_tool` path as an authenticated `Staff`.
- Bug B is **replace** (drop the `?view=work&task=` job link from that path), not keep-both.

## Review Focus

- **No Chief of Staff present, Auto mode:** `gated_execute` must still execute inline (not fall back to owner approval). → Task 1 test.
- **Self-escalation:** no MCP tool can set `autonomy_mode`/`strict_mode`/`paused`; the restricted system-setting tool excludes them. → Task 5 test.
- **OFF action in Auto:** `deploy`/`code.merge`/`db.write` stay refused, never elevated. → Task 1 test.
- **Invalid `create_staff` via MCP** (duplicate/invalid slug, missing field): surfaces as a clean tool error, not a 500. → Task 4 test.
- **`grant_staff_access` to a non-existent folder/staff via MCP:** the extracted service keeps the router's 404/400 validation → clean error. → Task 4 test.

---

### Task 1: Policy action types + `gated_execute` gate

**Files:**
- Modify: `apps/api/omilo_api/policy.py` (add action defaults + `ALWAYS_ASK`)
- Modify: `apps/api/omilo_api/services.py` (add `gated_execute`, near `request_action` @ 1008)
- Test: `apps/api/tests/test_gated_execute.py` (create)

**Interfaces:**
- Produces: `policy.ALWAYS_ASK: frozenset[str]`; new `policy.DEFAULTS` keys `staff.create`, `staff.retire`, `staff.grant`, `folder.grant`, `workflow.change` (all `ASK` except `workflow.change` = `DO_AND_TELL`).
- Produces: `services.gated_execute(db, st, action: str, do: Callable[[], Any], *, task_id: str | None = None, summary: str = "") -> dict` returning one of:
  `{"decision":"done","result":<json>, "level":str}`, `{"decision":"needs_approval","proposal_id":str,...}`, `{"decision":"refused","level":"off",...}`.
- Consumes: `policy.level_for`, `services.strict_mode`, `services.autonomy_policy`, `services.create_proposal`, `services.audit`.

- [ ] **Step 1: Write the failing tests** (`test_gated_execute.py`)

```python
# auto = autonomy_policy(db)["mode"]=="permissive" (company default); strict set via set_setting.
def test_off_action_refused_even_in_auto():       # action resolving to OFF (e.g. "deploy")
    r = gated_execute(db, staff, "deploy", do=boom); assert r["decision"]=="refused" and not ran
def test_ask_in_strict_files_proposal_not_executed():
    set_setting(db,"strict_mode",True); set_setting(db,"autonomy_mode","strict")
    r = gated_execute(db, staff, "staff.create", do=mark_ran)
    assert r["decision"]=="needs_approval" and r["proposal_id"] and not ran
def test_ask_in_auto_executes_inline():
    set_setting(db,"strict_mode",False); set_setting(db,"autonomy_mode","permissive")
    r = gated_execute(db, staff, "staff.create", do=lambda: {"id":"stf_x"})
    assert r["decision"]=="done" and r["result"]=={"id":"stf_x"}
def test_always_ask_action_files_proposal_even_in_auto():
    # an action in policy.ALWAYS_ASK must not auto-run in Auto
    r = gated_execute(db, staff, next(iter(ALWAYS_ASK)), do=mark_ran)
    assert r["decision"]=="needs_approval" and not ran
def test_auto_executes_with_no_chief_of_staff():  # no CoS in the DB
    r = gated_execute(db, staff, "staff.create", do=lambda:{"ok":True})
    assert r["decision"]=="done"
def test_do_and_tell_executes_inline():
    r = gated_execute(db, staff, "workflow.change", do=lambda:{"ok":True}); assert r["decision"]=="done"
```

- [ ] **Step 2: Run tests, verify they fail** — `cd apps/api && .venv/bin/python -m pytest tests/test_gated_execute.py -v` → FAIL (`gated_execute`/`ALWAYS_ASK` undefined).

- [ ] **Step 3: Add policy defaults + `ALWAYS_ASK` in `policy.py`**

Add the five `DEFAULTS` keys above. `ALWAYS_ASK = frozenset({"ai.key","harness.account","staff.token_rotate","founder.auth","company.delete"})` (credential/auth/infra action types that must never auto-run).

- [ ] **Step 4: Implement `gated_execute` in `services.py`**

Model it on `request_action` (services.py:1010-1024). Logic: `level = policy.level_for(action, st.permissions, strict_mode(db))`; `auto = autonomy_policy(db)["mode"]=="permissive"`. `OFF` → refused (audit `action.refused`). If `action in policy.ALWAYS_ASK` **or** (`level==ASK` and not `auto`) → `create_proposal(...)` and return `needs_approval` (do **not** call `do`). Otherwise call `result = do()`, `audit("action.done", ...)`, `db.commit()`, return `{"decision":"done","result":result,"level":policy.describe(level)}`. Never routes through `_cos_rule`/execution tasks.

- [ ] **Step 5: Run tests, verify pass; commit** — `git commit -m "feat(policy): gated_execute gate + autonomy action types"`

---

### Task 2: Autonomy toggle — backend (`/system` + `overview`)

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (`SystemIn` ~90-97, `update_system` ~118-129, `overview`)
- Test: `apps/api/tests/test_autonomy_toggle.py` (create)

**Interfaces:**
- Produces: `POST /system {autonomy: "strict"|"auto"}` sets both keys; `overview(...)` returns `autonomy: "strict"|"auto"` (derived: `"strict"` iff `autonomy_mode=="strict"`, else `"auto"`).
- Consumes: `S.set_setting`.

- [ ] **Step 1: Write failing tests**

```python
def test_set_auto_sets_both_keys(owner):
    owner.post("/api/system", json={"autonomy":"auto"})
    assert S_get("strict_mode") is False and S_get("autonomy_mode")=="permissive"
    assert owner.get("/api/overview").json()["autonomy"]=="auto"
def test_set_strict_sets_both_keys(owner):
    owner.post("/api/system", json={"autonomy":"strict"})
    assert S_get("strict_mode") is True and S_get("autonomy_mode")=="strict"
    assert owner.get("/api/overview").json()["autonomy"]=="strict"
```

- [ ] **Step 2: Run, verify fail** — `pytest tests/test_autonomy_toggle.py -v`.

- [ ] **Step 3: Implement** — add `autonomy: Literal["strict","auto"] | None = None` to `SystemIn`. In `update_system`, when `autonomy` present: set `strict_mode` + `autonomy_mode` to the paired values (Global Constraints). Add `"autonomy"` to the `overview` dict (derive from `autonomy_mode`). Add `autonomy` to the web `Overview` type (`apps/web/lib/api.ts`).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(api): Strict/Auto autonomy toggle on /system + overview"`

---

### Task 3: Autonomy toggle — frontend (nav switch)

**Files:**
- Modify: `apps/web/components/Shell.tsx` (bottom `secblock` ~194-198; `togglePause` pattern ~126)

**Interfaces:**
- Consumes: `overview.autonomy` (Task 2), `api("/system",{autonomy})`, `useOverview().refresh`.

- [ ] **Step 1: Add the switch** — in the bottom-left `secblock` beside Pause, a two-state control bound to `overview.autonomy`; on toggle call `api("/system",{ autonomy: next })` then `refresh()`. Label the ends **Strict** / **Auto**; match existing `navlink` styling.

- [ ] **Step 2: Verify** — build/typecheck (`cd apps/web && npm run build`), then confirm in the running app (Playwright MCP or manual): toggling flips the pill and persists across reload; `overview.autonomy` changes. Expected: PASS.

- [ ] **Step 3: Commit** — `git commit -m "feat(web): Strict/Auto autonomy toggle in nav"`

---

### Task 4: Staff-lifecycle MCP tools (headline)

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (extract access logic from `staff_access_set` @ 308-326)
- Modify: `apps/api/omilo_api/services.py` (add `set_staff_access`)
- Modify: `apps/api/omilo_api/mcp_server.py` (`TOOLS` list + `call_tool` branches)
- Test: `apps/api/tests/test_mcp_staff_tools.py` (create)

**Interfaces:**
- Produces: `services.set_staff_access(db, st: Staff, change: dict, actor: str) -> dict` — the body of `staff_access_set` minus HTTP (validation raises `S.DomainError`, not `HTTPException`); the router handler calls it and maps `DomainError`→HTTPException.
- Produces MCP tools (each via `gated_execute`): `list_team` (read, `knowledge.read`), `create_staff` (`staff.create`→`S.create_staff(db,data,actor=f"staff:{st.id}")`), `update_staff` (`staff.change`→`S.update_staff`), `retire_staff` (`staff.retire`→`S.retire_staff`), `grant_staff_access` (`staff.grant`→`S.set_staff_access`), `manage_shift` (`staff.change`→`S.add_shift` / shift edit-delete).
- Consumes: `gated_execute` (Task 1).

- [ ] **Step 1: Write failing tests** (through the MCP `call_tool` path as a permitted staff agent; follow existing MCP tests' harness)

```python
async def test_create_staff_auto_executes_and_creates_helper():
    set_auto()
    out = await call_tool(db, agent, "create_staff", {"name":"Developer","role":"developer","job":"..."})
    assert out_decision(out)=="done"; assert db.get(Staff, out_id(out)) is not None
async def test_create_staff_strict_files_proposal_and_does_not_create():
    set_strict()
    out = await call_tool(db, agent, "create_staff", {"name":"Developer2","role":"developer2","job":"..."})
    assert out_decision(out)=="needs_approval"; assert staff_count unchanged
async def test_create_staff_invalid_slug_is_clean_error():   # Review Focus
    with pytest.raises(S.DomainError): await call_tool(db, agent, "create_staff", {"name":"X","role":"Bad Slug!","job":""})
async def test_grant_access_auto_inline_strict_proposal():
    set_auto();  a = await call_tool(db, agent, "grant_staff_access", {"staff_id":other.id,"folders":{fld.id:{"access":"write","commands":True}}})
    assert out_decision(a)=="done"
    set_strict(); s = await call_tool(db, agent, "grant_staff_access", {"staff_id":other.id,"folders":{fld.id:{"access":"read"}}})
    assert out_decision(s)=="needs_approval"
async def test_grant_access_unknown_folder_clean_error():    # Review Focus
    set_auto(); 
    with pytest.raises(S.DomainError): await call_tool(db, agent, "grant_staff_access", {"staff_id":other.id,"folders":{"fld_nope":{"access":"read"}}})
async def test_tool_denied_without_permission():
    # agent lacking staff.* permission in strict/off → refused
    assert out_decision(await call_tool(db, weak_agent, "create_staff", {...}))=="refused"
```

- [ ] **Step 2: Run, verify fail** — `pytest tests/test_mcp_staff_tools.py -v`.

- [ ] **Step 3: Extract `set_staff_access`** — move the validation + `C.set_helper_access` + audit from `staff_access_set` into `services.set_staff_access(db, st, change, actor)`, raising `S.DomainError(msg, code)` instead of `HTTPException`. Update the router handler to call it and translate `DomainError`.

- [ ] **Step 4: Add the tools** — add `TOOLS` entries (inputSchema mirrors `StaffIn`/`AccessIn`; keep args minimal) and `call_tool` branches that resolve the target staff where relevant and call the mapped service via `gated_execute`. Return the gate dict; on `done`, include the service result (serialized helper / access view).

- [ ] **Step 5: Run, verify pass; commit** — `git commit -m "feat(mcp): staff-lifecycle tools (hire/update/retire/grant/shift/list_team)"`

---

### Task 5: Planning/ops MCP tools + extractions (goals, KPI defs, folders, restricted system)

**Files:**
- Modify: `apps/api/omilo_api/services.py` (extract `manage_goal`, `set_kpi_def`, `set_folder_grant` where logic is inline in routers)
- Modify: `apps/api/omilo_api/mcp_server.py`
- Test: `apps/api/tests/test_mcp_ops_tools.py` (create)

**Interfaces:**
- Produces MCP tools via `gated_execute`: `manage_goal` (`goal.create`), `set_kpi_def` (`kpi.write`), `manage_folder` (`folder.grant`), `update_system_setting` (restricted: `max_concurrent_tasks`, `timezone` only — **rejects** `autonomy`/`strict_mode`/`paused`).
- Consumes: `gated_execute`, services extracted from the goal/KPI/folder/connector router handlers.

- [ ] **Step 1: Write failing tests** — representative per tool: Auto→`done`, Strict→`needs_approval`; **plus** Review-Focus self-escalation:

```python
async def test_update_system_setting_rejects_autonomy_keys():
    set_auto()
    with pytest.raises(S.DomainError):  # or decision=="refused"
        await call_tool(db, agent, "update_system_setting", {"autonomy":"auto"})
    with pytest.raises(S.DomainError):
        await call_tool(db, agent, "update_system_setting", {"paused": True})
async def test_set_kpi_def_auto_executes(): ...
async def test_manage_goal_strict_files_proposal(): ...
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Extract services + add tools** — for each domain whose write logic is inline in a router handler (goals, KPI defs, folder grant), extract a `db,…→result` service (raising `DomainError`), repoint the router at it, then add the MCP tool via `gated_execute`. `update_system_setting` whitelists only the two safe keys and raises on anything else.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): goals/KPI/folders/restricted-system tools + service extractions"`

---

### Task 6: Integrations MCP tools + extractions (connectors, skills, workflows, knowledge files)

**Files:**
- Modify: `apps/api/omilo_api/services.py` / relevant modules (extract connector + skill-delete + workflow CRUD + knowledge-file services as needed)
- Modify: `apps/api/omilo_api/mcp_server.py`
- Test: `apps/api/tests/test_mcp_integration_tools.py` (create)

**Interfaces:**
- Produces MCP tools via `gated_execute`: `manage_connector` (`connector.install`/`connector.grant`), `manage_skill` (delete; `skill.change`), `manage_workflow` (`workflow.change`), `cancel_workflow_run` (`workflow.change`), `manage_knowledge_file` (`knowledge.write`).
- Note: credential/harness/AI-key tools are intentionally **not** added (excluded per Global Constraints).

- [ ] **Step 1: Write failing tests** — one representative per tool (Auto→`done`, Strict→`needs_approval`); assert **no** tool exists for AI keys / harness accounts (guard against accidental credential exposure): `assert "add_ai_key" not in {t["name"] for t in TOOLS}`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Extract services where inline + add tools** (same pattern as Task 5).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(mcp): connector/skill/workflow/knowledge tools + extractions"`

---

### Task 7: Bug A — approval syncs to the drawer

**Files:**
- Investigate: `apps/web/lib/api.ts` (`QUIET` list, `announceChange`), `apps/web/lib/poll.ts`, `apps/web/components/ChatThread.tsx` (~127-128), `apps/web/app/page.tsx` (board/inbox)
- Modify: whichever the repro identifies.

- [ ] **Step 1: Reproduce + locate root cause** — approve a proposal from a chat session with the inbox drawer open; confirm the drawer stays stale. Check whether `/proposals/*/decide` is in `QUIET` (suppressing `announceChange`), whether the drawer subscribes to `omilo:changed`, and whether the board SSE `tick` fires. Record the actual cause before changing code (systematic-debugging).

- [ ] **Step 2: Write the failing check** — a Playwright MCP scenario (or component test if the repo has one): approve-in-chat → assert the drawer item disappears/closes without a manual reload. Run; verify it fails against current code.

- [ ] **Step 3: Apply the minimal fix** — the one the root cause dictates: either remove `/proposals/decide` from `QUIET`, or have the chat approve handler trigger the shared board/inbox refresh (the same `refresh()`/`load()` the drawer uses). No backend change.

- [ ] **Step 4: Verify** the scenario passes; no regression to the inbox-drawer approve path.

- [ ] **Step 5: Commit** — `git commit -m "fix(web): approving in chat closes the inbox drawer item"`

---

### Task 8: Bug B — inbox fullview opens the chat thread

**Files:**
- Modify: `apps/web/app/page.tsx` (fullview control) and/or `apps/web/components/InboxItemDetail.tsx` (~214-256)

- [ ] **Step 1: Write the failing check** — Playwright MCP: open an inbox proposal item → fullview; assert the URL becomes `/chat/?thread=<id>` (not `/chat/?view=work&task=…`). Run; verify it fails.

- [ ] **Step 2: Implement** — the fullview control ensures the proposal thread exists (`POST /threads {scope:"proposal", ref_id: pid}`, mirroring `InboxItemDetail.tsx:214-215`) and navigates to `/chat/?thread=${thread.id}`. **Remove** the `?view=work&task=` target from that path (replace, per decision). Non-proposal kinds route to their natural thread where one exists.

- [ ] **Step 3: Verify** the scenario passes.

- [ ] **Step 4: Commit** — `git commit -m "fix(web): inbox fullview opens the chat thread, not the job view"`

---

## Notes for the executor

- Tasks 1→2→3 are a dependency chain (gate → toggle API → toggle UI). Tasks 4, 5, 6 each depend on Task 1 but are independent of each other (can be reviewed/accepted per domain). Tasks 7, 8 are independent of everything.
- Run backend tests with the project venv: `cd apps/api && .venv/bin/python -m pytest <file> -v` (Postgres + Redis must be up: `docker compose -f docker-compose.dev.yml up -d --wait postgres redis`, DB `omilo_test` with the `vector` extension).
- For any new datetime handling, normalize tz (see `_lease_order`/`_aware`) — SQLite returns naive datetimes.
