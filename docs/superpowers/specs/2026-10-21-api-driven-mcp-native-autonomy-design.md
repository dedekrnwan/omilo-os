# API-driven + MCP-native platform, with a global autonomy toggle

**Date:** 2026-10-21
**Status:** Draft for approval
**Branch:** `dedekrnwan/bug-omilo` (rebased on `main` @ 7cf806e)

## Intent & why

Today an Omilo staff agent cannot finish work that the founder already approved at
goal-time. The trigger case: proposal `prp_b23775649d25` ("hire a Developer helper") was
approved, but there is **no MCP tool to actually create the helper** — only the founder's web
UI can. The agent had to stop and hand two minutes of clicking back to the human.

More broadly: ~21 write actions exist in the REST API but have **no native MCP equivalent**, so
autonomous agents hit a wall whenever a task needs one of them (hire/retire staff, grant folder
access, manage goals/connectors/folders/workflows, etc.). And even where a tool exists, the
approval model has no "the goals were already approved, just act" mode — `strict_mode` only makes
the gate *stricter*, never looser.

The founder's mental model (their words): *"the approval already happened when we set the goals;
the agent can work without my per-action approval."* They want one honest switch — **Strict**
(approvals required) vs **Auto/YOLO** (agents act) — in the bottom-left of the nav, and they want
**every** platform action reachable by agents through native MCP so the team "bener-bener bisa
working properly."

Two smaller UI bugs ride along because they break the same autonomy loop: approvals don't visibly
close, and the inbox "fullview" dumps users on an ugly job URL instead of the conversation.

## Goals

1. **Agents can run the whole platform via native MCP.** Every REST write action an autonomous
   agent legitimately needs has a native MCP tool, routed through the existing permission/policy
   gate and audited. Headline: staff lifecycle — hire, update, retire, grant access.
2. **One global autonomy toggle**, surfaced bottom-left in the nav: **Strict** vs **Auto**.
   - *Strict*: today's behavior — risky/external actions require founder approval.
   - *Auto*: agents act without per-action founder approval (the goal-time approval stands),
     including hiring. Every auto-action is audited and visible.
3. **Approval sync fixed**: approving a proposal inside a chat session immediately closes the
   matching item in the inbox drawer.
4. **Inbox fullview fixed**: "fullview" opens the proposal's chat thread, not `/chat/?view=work&task=…`.

## Non-goals

- Not rebuilding the approval system. Strict mode keeps working exactly as today.
- Not a raw REST→MCP passthrough. Tools are curated, each with its own schema and policy mapping.
- Not auto-enabling the few actions that default to **OFF** (`deploy`, `code.merge`, `db.write`).
  Auto mode removes *approval friction*; it does not silently switch on actions the owner has
  decided agents never take. (The Developer workflow is "a PR for every change" — PRs, not merges.)
- Not changing how engines run tasks, nor the harness pool.

## Anti-goals (these would make it a failure even if it "works")

- An agent silently mutating **credentials/trust**: adding/removing AI API keys, harness pool
  tokens, rotating another agent's MCP token, or touching founder auth. These must never be a
  frictionless agent action, even in Auto mode.
- Auto mode that an agent can turn **on for itself** (privilege escalation). The toggle is a
  founder-only setting; no MCP tool may flip it.
- A toggle that silently enables destructive/irreversible actions (delete company, reset, deploy)
  without an explicit per-staff grant.

## Constraints

- Reuse what exists: `policy.py` (OFF/ASK/DO_AND_TELL/AUTO), `services.request_action`,
  `services.create_staff` and the other service fns, the `Setting` key/value store with
  `get_setting`/`set_setting`, the MCP `TOOLS` list + `call_tool(db, st, name, args)` dispatch in
  `mcp_server.py`, the `/system` endpoint + `overview.strict_mode` on the web side.
- SQLite **and** Postgres must both work (the naive-vs-aware datetime class of bug — see
  `_lease_order`). New comparisons normalize tz.
- Auth: every MCP tool already runs as an authenticated `Staff` (`staff_from_mcp_token`); new
  tools inherit that and must check `policy.level_for` for their action type.
- Tests run on Postgres via `apps/api/tests` (pytest). New tools and the toggle need tests at the
  same altitude as `test_harness.py` / the MCP tool tests.

## Current state (what already exists — important)

- **Global settings**: `Setting` table; `S.get_setting`/`S.set_setting` (audited). Existing keys
  include `paused`, `self_tuning`, `strict_mode`, `max_concurrent_tasks`. Written via `POST /system`
  (`SystemIn`), read via `overview` → web `useOverview()`.
- **Policy gate**: `policy.level_for(action, permissions, strict)` → OFF/ASK/DO_AND_TELL/AUTO.
  `DEFAULTS` set per action family; `staff.change` = ASK, `code.pr` = DO_AND_TELL, `deploy`/
  `code.merge`/`db.write` = OFF. `strict=True` drops EXTERNAL actions above ASK to ASK.
- **Approval routing**: `services.request_action` + the graph `delegation.gate()`; low/medium risk
  can be **auto-approved by the Chief of Staff** (`_cos_rule`), high risk escalates to the owner.
- **Per-staff autonomy**: `Staff.autonomy` (`guided|standard|trusted`) — today only shapes graph
  prompt text, not the gate.
- **MCP surface**: 38 tools in `mcp_server.py` (`whoami`, `propose`, `request_action`, `create_task`,
  `report`, docs/kb, workflows, etc.). **No** staff lifecycle, settings, goals CRUD, connectors,
  folders, workflow CRUD, KPI-def tools.
- **Bottom-left nav**: `apps/web/components/Shell.tsx` — a single Pause/Resume button in a
  `secblock` pushed down with `marginTop:auto`. Room for the toggle beside it.

## Design decisions

### A. The autonomy toggle (Strict ⇄ Auto)

**Reuse the two existing keys — do not invent a third.** The codebase already has both
`strict_mode` (bool; read by `policy.strict_mode()` / `level_for(strict=…)`) and `autonomy_mode`
(`"strict" | "permissive"`, default `"permissive"`; read by `services.autonomy_policy()` which
drives the escalation/CoS gate). The toggle is the single founder-facing control over **both**,
written coherently so every existing reader stays correct:
- **Strict** → `strict_mode = true`, `autonomy_mode = "strict"`.
- **Auto** → `strict_mode = false`, `autonomy_mode = "permissive"`.

An install that has set neither keeps today's default (`autonomy_mode` → "permissive",
`strict_mode` → config). Persisted via `POST /system` (extend `SystemIn` with one field,
e.g. `autonomy: "strict" | "auto"`, which sets both keys server-side), read via `overview`
(expose a derived `autonomy: "strict" | "auto"` for the switch).

**MCP tools execute INLINE through a gate check — not via the proposal/CoS/execution-task path.**
This is the key correction: a direct tool call must either act now and return the result, or stop
for approval. Add a shared `gated_execute(db, st, action, service_fn, *, external=False)` helper:
1. `level = policy.level_for(action, st.permissions, strict=strict_mode(db))`.
2. `OFF` → refuse (DomainError).
3. `ASK` →
   - Strict mode, **or** `action ∈ ALWAYS_ASK` → file a proposal (`needs_approval`), return pending.
   - Auto mode → execute `service_fn` inline, audit, post a do-and-tell notice to the owner.
4. `DO_AND_TELL` → execute inline, audit, notify. `AUTO` → execute inline, audit.

No dependency on a Chief of Staff existing; no second async execution task. The MCP call returns the
real result (e.g. the created helper). The existing CoS auto-approval / graph escalation path is
untouched and still governs graph-brain reasoning actions (defense in depth).

**Hiring in Auto.** `staff.create` (new action type, default ASK) therefore **executes inline** in
Auto mode and **files a proposal** in Strict mode — exactly the founder's ask (pure-auto hiring in
YOLO, gated in Strict). Every auto-hire is audited and appears immediately in Team.

**Safety by construction (no separate gate needed).** Auto never elevates OFF actions; credential/
trust actions are OFF or in `ALWAYS_ASK` (see §Security); the toggle itself is founder-only, settable
only via the authenticated `/system` endpoint, with no MCP tool. So "pure auto" is safe without a
special confirm step.

### B. Native MCP tool coverage

**Architecture.** Keep the explicit, curated style of `mcp_server.py`: each tool is a `TOOLS` entry
(name/description/`inputSchema`) plus a branch in `call_tool` that calls the shared
`gated_execute(db, st, action, service_fn)` helper from §A. Tools stay individually declared (clear
schemas) but share one gate-then-act-or-propose path.

**Scope reality — service extraction (raises effort vs the first estimate).** Several target actions
do **not** have reusable service functions today; the write logic lives **inline in router handlers**
entangled with Pydantic bodies / `HTTPException` / `current_user` — confirmed for: staff access grant
(`PUT /staff/{sid}/access`), connectors (`/connectors/*`), company folders, shift PATCH/DELETE, and
KPI defs. For each, the builder must first **extract a plain service function** (`db, …args` →
result, no HTTP concerns), then have **both** the REST route and the MCP tool call it. This is a
deliberate refactor (router → service) and must preserve existing REST behavior (covered by existing
API tests). `create_staff`, `update_staff`, `retire_staff`, `add_shift`, `write_knowledge` already
exist as services and need no extraction.

**Every tool runs through the gate.** No tool bypasses `policy.level_for`. A tool whose action
resolves to ASK in Strict mode returns `needs_approval` (files a proposal) rather than acting;
in Auto mode it executes inline — per §A.

**Tool set (grouped; each maps to an existing service/REST path).**

*Staff lifecycle (headline)* — action family `staff.*`:
- `create_staff` → `services.create_staff` (name, role, job, engine, budget, max_task_minutes,
  initial access). Action `staff.create` (ASK).
- `update_staff` → `PATCH /staff` service (name/job/permissions/budget/status). Action
  `staff.change` (ASK).
- `retire_staff` → `DELETE /staff` service. Action `staff.retire` (ASK).
- `grant_staff_access` → `PUT /staff/{id}/access` service (folders/terminal/connectors/skills for
  *another* helper). Action `staff.grant` (ASK): Strict → files a proposal; **Auto → executes inline
  with zero confirm** (founder decision 2026-10-21 — grants are audited and visible, but not gated).
  Not in `ALWAYS_ASK`.
- `manage_shift` (create/update/delete a shift) → shift service. Action `staff.change` (ASK).

*Planning & ops* :
- `manage_goal` (create/update/complete/delete) → goal service. `goal.create` (OFF default; CoS /
  planning staff get DO_AND_TELL+).
- `set_kpi_def` → KPI defs service. `kpi.write` (OFF; Finance AUTO).
- `update_system_setting` → **restricted** subset of `/system` (e.g. `max_concurrent_tasks`,
  `timezone`); **excludes** `autonomy_mode`, `paused`, `company budget`→ ASK-always or excluded.

*Integrations & assets*:
- `manage_connector` (install/configure/remove) → connector service. `connector.install` /
  `connector.grant` (ASK).
- `manage_folder` (add/update/remove a folder grant at company scope) → folder service.
  New action `folder.grant` (ASK; external).
- `manage_skill` (save/delete) → skill service. `skill.change` (ASK). (`skill_save` exists; add delete.)
- `manage_workflow` (create/update/delete/enable) and `cancel_workflow_run` → workflow service.
  `workflow.change` (DO_AND_TELL) / run-cancel (DO_AND_TELL).
- `manage_knowledge_file` (upload/attach a knowledge doc) → knowledge service. `knowledge.write` (ASK).

*Credential/trust — NOT frictionless (see Security)*:
- AI provider keys, harness pool accounts/tokens, rotating another staff's MCP token, founder auth,
  company delete/reset: **no auto path**. Either excluded from MCP entirely or ASK-always regardless
  of Auto mode.

**`whoami`/roster.** Add `list_team` (read-only roster: ids, roles, status) so an agent can see who
exists before proposing to hire/delegate. Action `knowledge.read`-class (AUTO).

### C. Bug A — approval doesn't sync to the drawer

Backend already closes the inbox item (`services.decide_proposal` → `_close_inbox`,
`services.py:407`), so this is frontend-only. **Root cause needs one confirmation before the fix is
locked:** the web client already broadcasts `omilo:changed` on every non-GET (`api.ts`) and the
board poller (`usePoll`) refreshes on it — so a naive "add a refresh call" may be a no-op. The real
cause is likely one of: (a) `/proposals/*/decide` sits in the `QUIET` list that suppresses
`announceChange`; (b) the chat approve handler (`ChatThread.tsx:127-128`) refetches only the thread
and the drawer isn't subscribed where this is observed; or (c) the board SSE `tick` doesn't fire for
proposal decisions. **Implementation starts by reproducing and checking the QUIET list**, then
applies the minimal correct fix (un-QUIET the decide call, or have the approve handler trigger the
shared board/inbox refresh). No backend change expected.

### D. Bug B — inbox fullview routing

Several controls build `/chat/?view=work&task=${…}` (`page.tsx:425` "Open the job",
`page.tsx:196/454`, `InboxItemDetail.tsx:222/256`). The fix targets the **inbox-item fullview** path the founder described (open item → drawer →
fullview lands on the ugly job URL). **Decision (2026-10-21): replace** — fullview goes to the chat
thread, the `/chat/?view=work&task=…` job view is dropped from that path (not kept alongside). For a
**proposal** item, ensure the proposal thread exists (`POST /threads {scope:"proposal", ref_id: pid}`,
the pattern `InboxItemDetail.tsx:214-215` already uses) and navigate to `/chat/?thread=${thread.id}`.
Non-proposal inbox kinds (alert/question/access-request/workflow) route to their natural thread where
one exists; otherwise unchanged.

## Security model

- **Gate every tool.** `policy.level_for` is the single chokepoint; Auto mode elevates only ASK (not
  OFF), Strict mode only tightens.
- **Credential/trust carve-out.** A fixed `ALWAYS_ASK` set — **AI API keys, harness pool tokens,
  rotating another agent's MCP token, founder auth, company delete/reset, and `deploy`/`code.merge`/
  `db.write`** — is forced to ≥ASK **even in Auto mode**. (Note: folder/terminal access grants are
  *not* in this set — the founder chose zero-confirm grants in Auto on 2026-10-21.) Auto removes
  founder friction for ordinary work and for handing out folder/terminal scope, but never for
  credentials, auth, or irreversible infra actions.
- **Toggle is founder-only.** `autonomy_mode` is settable only via the authenticated web `/system`
  endpoint (founder session), never via MCP. No `set_autonomy` tool exists.
- **Audit everything.** Every gated-execute writes an audit event (actor `staff:<id>`), and
  auto-approved actions still create a proposal record + owner notice, so Auto mode is fully
  reviewable after the fact.

## Testing strategy

- **Policy**: unit tests for `level_for(..., auto=True)` — ASK→allowed, OFF stays OFF, DO_AND_TELL/
  AUTO unchanged; `ALWAYS_ASK` stays ASK in Auto.
- **MCP tools**: for each new tool, a test calling it via the MCP path as a staff agent: (a) Strict
  mode → `needs_approval` files a proposal; (b) Auto mode → executes + audits; (c) permission denied
  without the action grant. Headline e2e: approve-then-`create_staff` actually creates a helper.
- **Toggle**: `/system` sets `autonomy_mode`; `overview` reflects it; derived `strict_mode` stays
  consistent.
- **Bugs A/B**: frontend behavior — approving in chat closes the drawer item; fullview routes to
  `/chat/?thread=…`. (Component tests or a Playwright check, matching how the web app is tested.)
- SQLite + Postgres parity for any new datetime handling.

## What's left to the builder

- Exact `inputSchema` for each tool (mirror the REST request models; keep args minimal).
- The precise shape of the gated-execute helper and how it reuses `request_action` vs calling
  `policy.level_for` directly.
- Whether `manage_*` tools take an `op` discriminator (`create|update|delete`) or split into
  separate tools — builder's call for clarity per domain.
- Final `ALWAYS_ASK` membership and which credential tools are excluded entirely vs ASK-always.
- The exact web refresh mechanism for Bug A (shared context refresh vs poll event) and the
  non-proposal inbox routing target for Bug B, per the web app's current data-flow.
- Visual design of the toggle (pill/switch) in `Shell.tsx` — follows existing nav styling.

## Founder decisions (resolved 2026-10-21)

1. **Granting another agent write+terminal access in Auto mode → zero confirm (fully YOLO).**
   `grant_staff_access` executes inline in Auto (audited, visible, not gated); files a proposal only
   in Strict. Not in `ALWAYS_ASK`. Credentials/auth/infra remain walled.
2. **Inbox fullview → replace with "go to chat".** The job (`?view=work&task=…`) view is dropped from
   that path; fullview opens the proposal's chat thread.

Earlier settled (founder): pure-auto hiring in YOLO (gated in Strict); build in this worktree
rebased on main; scope = everything in one pass.
