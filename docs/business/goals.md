# Goals

> Track: **business**. How an operator gets outcomes without doing the work: set a **Goal**
> with an expected end result, and step back while the **Chief** plans, delegates to
> **Helpers**, and approves on your behalf within the autonomy you granted. This doc is the
> behavior the operator sees and relies on — the mechanism lives in
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md), the API in
> [`../technical/02-api-contracts.md`](../technical/02-api-contracts.md) §5, and the schema in
> [`../technical/01-data-model.md`](../technical/01-data-model.md) §4.

Related business docs: [`chief-orchestration.md`](chief-orchestration.md) ·
[`autonomy.md`](autonomy.md) · [`routines.md`](routines.md).

---

## 1. What a Goal is

A **Goal** is a single desired outcome stated in plain words, plus the **expected end result**
that tells everyone — you and the AI team — when it is actually done. It is *not* a task list.
You describe where the company should be; the Chief figures out the how.

Every Goal carries, verbatim from the data model
([`01-data-model.md`](../technical/01-data-model.md) §4, `Goal` table):

| Field | What it means to the operator |
|---|---|
| `title` | The outcome in plain words — *"Passwordless login by Q4"*. |
| `target` | The **expected end result** — the measurable finish line (*"80% of logins using passkey"*). This is the single field that turns a wish into something the Chief can plan and the `review` node can check. |
| `due` | Optional deadline. Drives *"On track / At risk / Slipping"* framing, never a hard stop. |
| `progress` | `0–100`. **Computed from completed work, not typed.** The `review` node updates it as child Jobs finish (see [`03`](../technical/03-agent-loop-engine.md) §2). |
| `status` | `active` · `done` · `dropped`. The lifecycle (§6). |
| `autonomy_override` | Optional per-goal autonomy dial (§4). Lets one goal run looser or tighter than the workspace default. |
| `channel_id` | The **Channel (= Area)** the goal belongs to — Engineering, Marketing, Business… It inherits that area's Helpers and knowledge. |
| `owner_helper_id` | Usually the **Chief** (`is_chief` Helper). The owner plans and reports; it is the single throat to choke. |

In the UI the Goal is created from the **New goal** drawer (`src/features/goals`): a *Goal*
textarea ("One outcome, in plain words"), a **Channel**, a **Due** date, a **Measured by** /
**Target** pair (this is the `target` end result), the **Helpers on it**, and a toggle —
*"Let Chief draft key results: Chief proposes 3–5 key results from your docs and Monitor data.
You approve before anything starts."* There is always an escape hatch: *"or describe it in
chat"* hands the same intent to the Chief DM instead of the form.

---

## 2. The core behavior: set a goal and step back

This is the product in one sentence. **You state the outcome once; the AI team delivers it.**

What "step back" means concretely:

1. **You** write the Goal + target and pick (or accept) the Helpers.
2. The **Chief** decomposes the target into a plan of delegated **Jobs**, each assigned to a
   Helper by area/role (§3).
3. Helpers do the Jobs. Each Job is a loop that *acts, reports, and learns*
   ([`03`](../technical/03-agent-loop-engine.md) §2).
4. At each side-effecting step the **gate** computes your **effective autonomy** and either
   acts on your behalf, asks you, or refuses on a safety limit (§4).
5. You only re-enter the loop when something **needs you** — a decision, a budget, a redline.
   Everything else shows up as *updates*, not interruptions.

The operator's day is therefore: glance at **Goals** to see what's moving, clear anything
badged **Needs you**, and otherwise leave it running. The Goals board headline says it plainly:
*"What the company is pushing on."*

> The quiet promise: a goal you set on Monday keeps making progress on Tuesday without you
> opening the app. Routines (see [`routines.md`](routines.md)) are what keep nudging it.

---

## 3. Creating a Goal kicks off Chief planning → delegated Jobs

`POST /v1/goals {channel_id, title, target, due?, autonomy_override?}` is **the single
entrypoint that kicks off autonomous delivery** ([`02`](../technical/02-api-contracts.md) §5).
It does two things: persists the Goal, and **enqueues a Chief plan Job** (`origin=plan`/`goal`).

From there the loop ([`03`](../technical/03-agent-loop-engine.md) §1, §7):

```
POST /v1/goals ─► plan Job ─► supervisor (Chief) decomposes target
                                   │
                     fan-out: one child Job per step  (origin=delegation, parent_job_id)
                                   │
        Helper worker → gate → execute → review   (for each child Job)
                                   │
              parent Chief Job waits on children; review aggregates Reports
                                   │
                        Goal.progress updated · Report written · learn
```

- The **supervisor** node *is the Chief's planning brain*. It builds a **bounded plan**
  (`MAX_STEPS = 12`) of sub-Jobs, each assigned to a Helper by `area`/role and that Helper's
  standing `job_description`.
- Each planned step becomes a child **Job** with `origin=delegation` and `parent_job_id`
  pointing back at the Chief's plan Job. This is the **delegation fan-out**
  ([`03`](../technical/03-agent-loop-engine.md) §5).
- If you left the **"Let Chief draft key results"** toggle on, the plan comes back as a
  proposal first: the Chief drafts 3–5 key results and the task breakdown, and **nothing runs
  until you approve** it in the Inbox. This is the *Create 3 tasks* moment you see in chat
  (the passkey example, §7).
- The Chief owns the parent Job. Its `review` node aggregates the child Reports, recomputes
  `progress`, and decides *done* vs *loop again* — so the Goal has one accountable owner, not a
  loose pile of tasks.

To re-decompose a goal whose plan went stale, `POST /v1/goals/{id}/replan` asks the Chief to
plan again (§6).

---

## 4. Per-goal autonomy override

Autonomy is **layered**, not a single global switch. The dial has three levels, ordered
`strict < ask < yolo` ([`01`](../technical/01-data-model.md) §1):

- **strict** — the Helper drafts, you decide almost everything.
- **ask** — the Helper acts on low-risk things, asks before anything consequential.
- **yolo** — the Chief approves on your behalf; you get updates after the fact.

A Goal can carry its own `autonomy_override` so one outcome runs looser or tighter than the
rest of the workspace. But an override never wins alone. The **effective autonomy** the gate
enforces is the *tightest* of three dials
([`03`](../technical/03-agent-loop-engine.md) §2, [`autonomy.md`](autonomy.md)):

```
effective_autonomy = min(workspace_default, goal_override, helper_cap)
```

- `workspace_default` — the company dial (Control-Panel, `autonomy_default`).
- `goal_override` — this Goal's `autonomy_override` (nullable → inherits workspace).
- `helper_cap` — the tightest the assigned Helper may ever act at (`autonomy_cap`).

So raising a goal to `yolo` does **not** let a `strict`-capped Finance Helper spend freely, and
no autonomy level — not even `yolo` — can exceed a hard **SafetyLimit** the operator set
(spend/day, deploy, external_write). Safety limits always win
([`03`](../technical/03-agent-loop-engine.md) §6). The gate resolves each side-effecting action
to `allowed` → act on your behalf, `needs_owner` → create a Proposal + InboxItem and suspend,
or `refused` → hard cap hit. Full table in [`autonomy.md`](autonomy.md).

**Why per-goal matters:** *"Launch referral program"* might run at `ask` because it spends real
ad money, while *"Close October books"* runs at `yolo` because it only reads and reconciles.
One operator, one workspace, two very different risk postures — set once, per goal.

---

## 5. Progress tracking + KPIs

**Progress is earned, not typed.** `Goal.progress` (0–100) is recomputed by the `review` node
as child Jobs complete ([`03`](../technical/03-agent-loop-engine.md) §2). The operator never
drags a slider; the number reflects real finished work and the Reports behind it.

On the **Goals board** each goal shows a status ring + a one-line meta — e.g. *"On track · 40%
· 3/8 tasks · due Nov 28"* — and a derived **status**:

| Status | Meaning |
|---|---|
| **On track** | Progressing toward `target` by `due`. |
| **At risk** | A child Job is slipping or a blocker is open. |
| **Blocked** | Can't proceed — usually waiting on a decision or a broken connector. |
| **Needs you** | There's an open Proposal/question in the Inbox for this goal. Badged so you can't miss it. |

**KPIs** make `target` measurable over time. The data model carries `Kpi` / `KpiValue` tables
([`01`](../technical/01-data-model.md) §4) tied to a `goal_id`: a KPI has a `label`, `unit`,
`target`, and `direction` (`up`|`down`); each `KpiValue` is a datapoint written by a Helper
with its `source` and timestamp. `GET /v1/goals/{id}` returns
`GoalDetail {goal, jobs[], kpis[], proposals[]}` — so opening a goal shows its live KPI trend,
the Jobs doing the work, and any pending approvals in one place. The **Measured by / Target**
pair in the New-goal drawer (*"% of logins using passkey" → "80%"*) is exactly this KPI seed.

Reports feed the numbers: every finished Job writes a `Report` with `kpis` and `sources`
([`01`](../technical/01-data-model.md) §5), and analytics are **computed from
Jobs/Reports/CreditLedger**, never estimated ([`02`](../technical/02-api-contracts.md) §13) —
so the progress ring and the KPI line are exact, not vibes.

---

## 6. Goal states and replan

A Goal is always in one of three states (`status`):

- **active** — being worked. The default after creation.
- **done** — `target` met. The `review` node marks it when the expected end result is
  satisfied; the Chief typically posts a closing Report to the Inbox.
- **dropped** — soft-deleted. `DELETE /v1/goals/{id}` sets `status→dropped` (the history and
  Reports stay). Dropping is a **negative action** — the UI confirms it with the sad Mascot,
  never a bare icon.

Operators change state through `PATCH /v1/goals/{id}` (`title`, `target`, `due`, `status`,
`autonomy_override`, `position`). Reordering by `position` is how you say *"this matters most
this quarter"* on the board.

**Replan** is the key recovery move. When a goal is **At risk** or **Blocked**, or the
situation changed (a blocker cleared, a date moved, scope grew), `POST /v1/goals/{id}/replan`
asks the Chief to **re-decompose the target** — it returns a `{job_id}` for a fresh plan Job
that runs the supervisor again and fans out new/updated child Jobs
([`02`](../technical/02-api-contracts.md) §5, [`03`](../technical/03-agent-loop-engine.md) §7).
Replanning respects the same `MAX_STEPS = 12` bound, so it tightens the plan rather than
sprawling it. You can also just tell the Chief in chat — *"this slipped, what now?"* — and it
will offer a replan.

---

## 7. How Goals relate to Channels, Routines, and Flows

Goals are the spine; the other objects hang off them.

- **Channels (= Areas).** Every Goal lives in exactly one Channel
  ([`01`](../technical/01-data-model.md) §4). The Channel supplies the Helpers, folders, and
  knowledge the goal draws on. On the board, goals group by Area (*Engineering · Marketing ·
  Business*), and the Goals page is the same board whether you're in Chat mode (area-filtered)
  or Office mode (company-wide). Pick the right Channel and the goal inherits the right team.

- **Routines.** A **Routine** (see [`routines.md`](routines.md)) is scheduled Helper work that
  keeps goals honest between your check-ins. Routines can reference `goal_ids`
  ([`01`](../technical/01-data-model.md) §8), so a *Goal check-ins* routine reviews progress on
  a cadence, and the *Morning brief* summarizes what moved across goals and flags anything at
  risk. Routines are the heartbeat that makes "step back" safe.

- **Flows.** A **Flow** is a visual automation (trigger → steps). Where a Goal is an outcome
  and a Routine is a schedule, a Flow is a repeatable multi-step process a goal's work may
  trigger (e.g. the passkey launch kicking off a comms flow). Publishing a Flow needs approval
  — operator, or the Chief under higher autonomy ([`02`](../technical/02-api-contracts.md) §8).

- **Jobs & the loop.** Underneath, everything is Jobs. A Goal's plan fans out `delegation`
  Jobs; Routines fire `routine` Jobs; Flows spawn `flow` Jobs. They all run the same
  checkpointed loop and roll their Reports back up to the goal's progress.

---

## 8. Worked example — "Passwordless login by Q4"

This goal is live in the fixtures (`src/adapters/mock/fixtures.ts`:
`g-passkeys` · `channelId: ch-engineering` · `progress: 40`) and drives the passkey story
across Chat and Inbox. Here is the full arc.

**Set it (step back).** The operator opens **New goal** and writes:

- Goal: *"Passwordless login for 80% of users by Q4"*
- Channel: **Engineering** · Due: **31 Dec 2026**
- Measured by: *"% of logins using passkey"* · Target: **80%**
- Helpers on it: **Chief, Builder** · *"Let Chief draft key results"*: **on**

`POST /v1/goals` persists it and enqueues the Chief's plan Job.

**Chief plans → delegates.** In the *Passkey rollout plan* session the operator asks *"Can we
ship passkeys to everyone before the Q4 code freeze on Nov 28?"* The Chief answers with the
state of the goal — *"at 40%, the blocker is WebAuthn on legacy Android"* — pulls **Dev** in,
Dev sizes it, and the Chief offers: *"Want me to turn this into 3 tasks under the goal?"* The
supervisor has decomposed `target` into three delegated Jobs:

| Task (child Job) | Helper | Due |
|---|---|---|
| Ship passkeys on web + iOS | Dev | Nov 14 |
| Android password fallback flow | Dev | Nov 21 |
| Launch comms to all users | Growth | Nov 24 |

**Nothing runs until you approve.** Because key-result drafting was on, this arrives as a
**decision** InboxItem — *"Create 3 tasks for the passkey rollout"* — with the reassurance
*"Nothing runs until you approve."* Approving (`POST /v1/proposals/{id}/approve`) resumes the
checkpoint and spawns the `delegation` Jobs. The toast confirms: *"3 tasks approved — added to
'Passwordless login by Q4'. Dev starts with web + iOS."*

**Work happens; you only see what needs you.** Dev's *"Shipping passkeys to staging"* shows as
a **running** update (step 4 of 7, 12m elapsed) — an update, not an interruption. The *Morning
brief* routine later reports: *"Passkeys: web + iOS on staging; Android slipping 2 days,"* and
flags the one real decision — *"Decide today: shift launch comms to Nov 26?"*

**Progress + status, earned.** As the web + iOS Job finishes, `review` moves `progress` and the
board shows *"Passwordless login by Q4 · On track · 40% · 3/8 tasks · due Nov 28,"* with the
Android sub-task marked *Slipping 2d* and a **Needs you** badge for the open comms decision.

**Replan if it slips.** If Android slides past the freeze, the operator (or the Chief) calls
`POST /v1/goals/{id}/replan`: the Chief re-decomposes — perhaps shipping web + iOS to 100% now
and moving Android behind a fallback to a December milestone — without the operator hand-editing
a single task.

**A second, looser example — "Close October books"** (`g-books` / `g-octbooks`,
`progress: 70`): a read-and-reconcile goal owned by **Finance**. It can run at `yolo` because it
doesn't spend or deploy — Finance closes the books, and the result lands as a **done** update:
*"Closed October books — 2 variances flagged for review: cloud spend +18%, contractor invoices
late."* No approval needed to do the work; the *variances* are surfaced for you precisely
because they're the part a human should look at. Same goal machinery, opposite autonomy posture
— which is the whole point of the per-goal override (§4).

---

## 9. Operator cheat-sheet

- **Create:** New goal drawer → *Goal* + *Measured by/Target* + *Channel* → **Create goal**.
  Or *"describe it in chat"* and let the Chief shape it.
- **Watch:** the Goals board — status ring, %, tasks, due, owner. Filter by **Needs you · At
  risk · Blocked · On track**.
- **Decide:** clear **Needs you** items in the Inbox; everything else is an update.
- **Tune risk:** set `autonomy_override` per goal; remember effective = `min(workspace, goal,
  helper)` and safety limits always win.
- **Recover:** **Replan** when At risk/Blocked. **Drop** (sad-Mascot confirm) when it no longer
  matters — history is kept.

See also: [`chief-orchestration.md`](chief-orchestration.md) for how the Chief plans and
represents you · [`autonomy.md`](autonomy.md) for the full decision table ·
[`routines.md`](routines.md) for the schedules that keep goals moving ·
[`../technical/02-api-contracts.md`](../technical/02-api-contracts.md) §5 for the endpoints.
