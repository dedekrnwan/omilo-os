# Flows

> Track: **business**. What a Flow *is* for the operator and how it behaves — visual
> automation the team runs on its own. The mechanism lives in
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) and the API in
> [`../technical/02-api-contracts.md` §8](../technical/02-api-contracts.md); the entities in
> [`../technical/01-data-model.md` §9](../technical/01-data-model.md). This doc is behavior.

---

## 1. What a Flow is

A **Flow** is a visual automation: a **trigger** fires, then a chain of **steps** and
**actions** runs on a canvas until it either finishes or stops to wait for you. Think of it as
a Routine that isn't just "do this on a schedule" but "when *this* happens, think, branch, and
act — and ask me only at the points that matter."

Where a **Goal** says *what outcome you want* and lets the Chief figure out the how (see
[`goals.md`](goals.md)), and a **Routine** says *do this on a clock* (see
[`routines.md`](routines.md)), a **Flow** says *this exact shape of work, every time the
trigger fires*. It is the operator's (or the Chief's) way of freezing a repeatable play into a
reviewable diagram instead of a prose instruction.

Every Flow is scoped to one or more **Channels/Areas** (`channel_ids`, `areas`), so it shows up
on the Area-filtered Flows board and runs under the Helpers of that area.

A Flow is made of **typed nodes** connected by **edges** on a canvas. The node kinds are fixed
(`FlowNodeKind = trigger | ai_step | connector | approval | condition`), which is what makes a
Flow both *drawable* and *safe*: every node that can touch the outside world is a known kind the
gate understands.

---

## 2. Node kinds

A Flow canvas (`nodes`, `edges` on the `Flow` record) is built from exactly five kinds. Each
has one job, and three of them connect to the rest of the platform in load-bearing ways.

| Kind | What it does | Platform tie-in |
|---|---|---|
| **trigger** | The *one* thing that starts a run. One of: **schedule** (cron), **manual** (operator or an agent clicks Run), **internal event** (another flow/goal/routine finishing), or **connector poll** (a scheduled check of an outside system for anything new). Exactly one per Flow. **No inbound webhooks** — external changes are picked up by polling, not pushed. | Creates a `FlowRun`. `started_by` = `schedule`, `operator`, the upstream event, or the polled connector. |
| **ai_step** | A Helper does one unit of thinking: read, summarize, classify, extract, draft. | **Spawns a Job** (`origin=flow`). The Job runs the `worker` node of the agent loop; its `RunEvent`s stream live into the run view. |
| **connector** | A concrete outside action: post to Slack, open a PR, send WhatsApp, write a row. | Runs through the same connector/MCP surface as any agent action; **side-effecting ones pass through the gate** (`execute` node). |
| **approval** | A deliberate "wait for a human (or the Chief) here" checkpoint. | Lands a **decision InboxItem**; the run goes to `needs_you`. See [`inbox-approvals.md`](inbox-approvals.md). |
| **condition** | A yes/no branch on the output of the step before it. | No side effect; just routes. Edges leaving it carry **Yes / No** labels. |

**Edges** are the arrows. Most edges are unlabeled (just "then"). Edges leaving a **condition**
node are labeled **Yes** / **No** — that label is how the engine knows which branch to take. In
the canvas data these are literally `{ from, to, label: 'Yes' | 'No' }`.

> The node kinds map 1:1 to the engine. An `ai_step` is a `worker` turn; a side-effecting
> `connector` or a destructive `ai_step` output produces a `pending_action` that hits the
> **gate**; an `approval` node is a forced `needs_owner`/`interrupt`. So "the picture you drew"
> and "what actually runs" are the same graph. See
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) §2, §7.

### <a id="trigger"></a>How Flows start (the trigger)

A Flow starts in one of **four** ways — never from an inbound webhook. omilo runs no public
ingress; the trigger node's `kind` is one of:

| Trigger kind | Starts a run when… | Typical use |
|---|---|---|
| **schedule** | a cron time arrives (company timezone, same engine as Routines) | *"Every Monday 08:00, compile the competitor digest."* |
| **manual** | the operator clicks **Run**, or an agent calls the `flows_run` tool | ad-hoc, or an agent kicking off a sub-flow |
| **internal event** | another flow/goal/routine emits a platform event (`flow.finished`, `goal.updated`, `routine.done`) | **chaining** — one flow's end begins the next |
| **connector poll** | a scheduled check of an outside system finds **something new since last time** | *"Check the shared inbox / CRM every 15 min for new leads."* |

**Reacting to the outside world without webhooks.** A `connector poll` flow runs on a schedule,
reads the connector (new emails, new CRM leads, overdue invoices), and compares against a stored
**watermark** (`Flow.poll_cursor` — the "last seen" marker). If nothing is new, the run ends
immediately and cheaply (no `ai_step`, no credits). If there's new work, it proceeds. This gives
you event-like reactivity — "when a lead arrives, qualify it" — with a simple cron mental model,
no public endpoint, and no third-party webhook plumbing to maintain. The trade-off is latency
(up to one poll interval) in exchange for far less operational surface.

**Lifecycle binding.** A Flow only starts when it is **published + enabled**: publishing
registers its schedule/poll with the scheduler (or its internal-event subscription); disabling
deregisters it; a `draft` never fires. See §3.

---

## 3. Draft → publish lifecycle

A Flow has a `status` of `draft` or `published`, a `version` int, and an `enabled` toggle.

```
   build on canvas ──► test-run ──► publish (flow_publish Proposal) ──► approved ──► published + enabled
        (draft)         (safe)         (needs an approval)               (Chief or you)      (live)
```

1. **Draft.** You create a Flow from scratch, from a **Template**, or by accepting a
   **Suggested** flow. It sits as `status=draft`, `enabled=false`. Nothing runs. You can drag
   nodes, add branches, and rewire edges freely — drafts have no effect on the world.

2. **Test-run** (see §7). Run the draft against sample or last-run data to see each step light
   up **without any real side effects**. This is how you build confidence before it's live.

3. **Publish.** `POST /v1/flows/{id}/publish` does **not** flip a boolean — it creates a
   **Proposal of type `flow_publish`** with the draft attached. A Flow is a standing grant of
   autonomy (it will act on its own, repeatedly), so turning one on is itself an action that
   needs approval.

4. **Approved → live.** Once the `flow_publish` proposal is approved, the Flow becomes
   `status=published` and `enabled=true`. From then on its trigger produces `FlowRun`s.

> **"Flows require approval, but the Chief's approval counts."** Publishing always needs an
> approval — but *who* approves depends on effective autonomy, exactly like every other
> Proposal. Under `strict`/`ask` the `flow_publish` proposal lands in **your** Inbox. Under
> `yolo` the **Chief approves on your behalf** server-side and you get an `update` InboxItem
> recording that a new Flow went live. The rule is uniform with the rest of the system (see
> [`autonomy.md`](autonomy.md) and [`inbox-approvals.md`](inbox-approvals.md)); Flows are not a
> special case — they just happen to produce a `flow_publish` proposal type. This is why the
> UI copy reads "flows require approval but can use Chief approval."

Editing a published Flow bumps `version`; a material change can re-trigger a `flow_publish`
proposal (you are changing a live, standing automation). Toggling `enabled` off pauses it
without deleting the canvas.

---

## 4. Agent-proposed Flows (born from repeated actions)

Flows don't only come from you drawing them. The team **watches for repetition** and offers to
turn a thing you keep doing by hand into a Flow. These arrive on the **Suggested** tab, and on
publish they carry `proposed_from_pattern=true` and `created_by=chief` (or the area Helper).

The pitch is always concrete and grounded in your own history:

- *"Triage failed deploys for you? — Dev saw you do it 4× this week."*
- *"Track referral signups from Stripe? — Growth noticed you match signups manually every
  week."*

When you open a suggested Flow, the draft is **pre-annotated** with *why each step exists*, tied
to what it observed:

- On the AI step: *"You did this step by hand 4× — usually in 5–10 min."*
- On a branch it added: *"Added because 2 of 4 fixes touched prod."*
- On the final action: *"Dev drafted this from 4 triages you did by hand. Check each step, run
  a test on last week's failures, then turn it on. Nothing runs until you do."*

This is the **learning loop surfacing as a Flow**: the `learn` node and Memory notice a pattern,
and the Chief proposes freezing it. The full learning→skills→flows story (how repeated actions
become Memory lessons, then Skills, then proposed Flows) lives in
[`learning-skills-flows.md`](learning-skills-flows.md). The key behavior here: **a proposed
Flow is still just a draft** — it is never live until you (or the Chief under `yolo`) approve the
`flow_publish` proposal. The suggestion is an offer, not a switch that's already been flipped.

---

## 5. FlowRuns — what happens when a Flow fires

Each time a trigger fires, the Flow creates a **`FlowRun`** (`frn_…`). A run has a `status`:

| `FlowRunStatus` | Meaning | Operator sees |
|---|---|---|
| **running** | Executing nodes right now. | Live progress, current step, cost so far. |
| **needs_you** | Hit an `approval` node (or a gate `needs_owner`) and is **waiting**. | A row that says *"waiting for you · 3m"* and a matching **decision** in the Inbox. |
| **done** | Reached the end of its branch successfully. | Duration, total cost, summary. |
| **failed** | A step errored or a hard `SafetyLimit` refused an action. | The failing step + a `failure` InboxItem. |

A `FlowRun` carries a `trigger_summary` (e.g. *"CRM poll · 3 new leads"* or *"Schedule · Mon
08:00"*), `started_by`,
`cost_credits`, `duration`, `waiting_for` (what it's blocked on), and `job_ids` — the list of
Jobs its `ai_step` nodes spawned. So the run view is really a **timeline of Jobs and actions**,
each with its own streamed RunEvents.

**"Needs you" waiting states.** When a run reaches an `approval` node, it does not spin or
time out silently — it parks. The `approval` node config can set a patience window (the canvas
sublabel reads *"Lands in Inbox, wait up to 1h"*). While parked:

- the run row shows **Needs you** with a live "waiting Nm" counter;
- a **decision InboxItem** is created so you can act from the Inbox *or* from the run view —
  same proposal, two surfaces;
- the underlying Job is **checkpointed and suspended** (LangGraph `interrupt`), so it costs
  nothing while it waits and resumes from the exact node when you decide.

**Cost.** Every run meters real credits as its `ai_step` Jobs burn tokens and its connectors
act. Run rows show cost precisely (*"$0.018 so far"* mid-run, *"$0.014"* when done) — these come
straight from the `CreditLedger`, never estimated. Suggested flows preview an expected cost up
front (*"~$0.02 a run"*) so you know the ongoing price before you turn it on.

**Run history.** `GET /v1/flows/{id}/runs` returns the recent runs (the sparkline bars on each
Flow card are this history). A healthy Flow is a column of mostly-green **Done** runs with the
occasional **Needs you**; a run that went **Failed** stays in history with its cause so you can
see what broke.

---

## 6. Test-run (prove it before it's live)

Before publishing — and any time you edit — you can **test-run** a draft:
`POST /v1/flows/{id}/test-run {sample}`. This produces an **ephemeral** `FlowRun` that walks
the canvas with real inputs but **no real side effects**. Connector actions are *simulated*;
nothing is actually sent, written, or deployed.

The test-run result reads back step by step, so you can see exactly where it would branch and
where it would stop for you. A real example (a "new resident message" support flow run with last
run's data, *"14s · nothing was sent"*):

| Step | Outcome | Detail |
|---|---|---|
| Trigger · new resident message | ok | 1 message |
| Support drafts a reply | ok | 143 words |
| Check dues in `sahabat-db` | ok | Rp 700,000 unpaid |
| Ask owner before sending payment link | ok | **Would wait for you** |
| Send on WhatsApp | **skipped** | **Skipped in test** |

Two things to notice, because they're the whole point of a test-run:

- the **approval** step reports *"Would wait for you"* — it shows you *where* the Flow will stop
  for a human, without actually stopping;
- the final **connector** step is **skipped** — *"nothing was sent."* You see the plan light up
  end to end with zero risk.

This is the recommended ritual for a suggested Flow: *check each step → run a test on last week's
real failures → then turn it on.*

---

## 7. Worked example — "New lead triage"

A business Flow that exercises **all five node kinds** and the `connector poll` trigger (no
webhook). The Growth helper watches the shared inbox / CRM for new leads, qualifies them, and —
with your OK — sends a personalized first reply. Canvas, in order:

```
            ┌──────────────────────────────┐
  trigger   │ New lead (poll CRM, every 15m)│   (checks for leads newer than poll_cursor)
            └──────────────┬───────────────┘
                           ▼
  ai_step   │ Qualify the lead              │   → spawns a Job (Growth). Output: fit score,
            │ score · segment · summary      │     segment, one-line summary.
                           ▼
  condition │ If fit score is high           │
            └──────┬───────────────┬────────┘
             Yes   │               │   No
                   ▼               ▼
  approval  │ You approve   │   connector │ Tag in CRM "nurture later"   │
            │ the outreach   │             │ + add to the weekly digest   │
            │ (Inbox, 2h)    │             └──────────────────────────────┘
                   ▼
            ┌──────┴────────────────────────┐
            ▼                                ▼
  ai_step  │ Draft the reply │   connector │ Send the outreach │
           │ personalized to │             │ email / WhatsApp   │
           │ their segment   │             │ to the lead        │
```

Walk a real run (`FlowRun frn_214`, started by the 15-minute poll):

1. **trigger** — the scheduled poll runs, reads the CRM, and finds **1 lead newer than
   `poll_cursor`** (*"Arunika Studio · submitted the contact form 6m ago"*). A `FlowRun` is born,
   `started_by="CRM poll"`; the cursor advances so this lead won't be picked up twice. (If the
   poll had found nothing new, the run would end here — no `ai_step`, no credits.) (0.1s)

2. **ai_step** — `Qualify the lead` spawns a **Growth** Job. It reads the submission + any CRM
   history and returns structured fields (streamed live as the Job's `worker` output):
   - *fit score:* "High — matches the mid-market segment we're targeting"
   - *segment:* "Agency, 10–50 staff, Jakarta"
   - *summary:* "Wants help automating weekly client reports — strong match for our offer."
   - metered at *8.4s · ~12 credits*.

3. **condition** — `Fit score is high`. High → takes the **Yes** edge toward the approval. (A low
   score takes the **No** edge: the lead is tagged *"nurture later"* in the CRM and added to the
   weekly digest, and the run ends — no outreach, no Inbox noise.)

4. **approval** — `You approve the outreach`. The run goes **needs_you** and **parks**
   (*"waiting 3m"*). A decision lands in your Inbox and in the run view with Growth's
   recommendation and the draft angle: *"Growth suggests a warm first reply offering a 15-min
   report-automation demo. Draft ready on approve."* The next two steps sit **queued**; the Job
   is checkpointed and burning nothing while it waits.

5. On **Approve**, the checkpoint resumes and the two downstream nodes run:
   - **ai_step** `Draft the reply` → an **execution** Job writes the personalized message;
   - **connector** `Send the outreach` → sends it by email/WhatsApp to the lead.

   The run flips to **done** with its final duration and cost.

Why this example matters: it's the smallest canvas that exercises **all five node kinds** and
shows the two seams that make Flows safe — the **condition** that keeps low-fit leads out of your
Inbox, and the **approval** that stops an outbound customer message until a human says go.
Everything before the approval is read-only thinking; the only side effect (the sent message)
happens *after* you approve. That ordering is deliberate and is the same `gate`-before-`execute`
discipline every agent action follows. Note the trigger: there is **no webhook** — the Flow reacts
to new leads by *polling* on a schedule and comparing against its `poll_cursor`.

---

## 8. How Flows relate to the rest of the platform

- **Autonomy still governs every action.** A Flow doesn't bypass the gate — each side-effecting
  node computes `effective autonomy = min(workspace_default, goal_override, helper_cap)` against
  its `risk`, exactly as an ad-hoc agent action would. A Flow under `yolo` runs end to end with
  the Chief auto-approving; the same Flow under `ask` parks at the risky steps. See
  [`autonomy.md`](autonomy.md).
- **SafetyLimits always win.** A hard cap (spend/day, messages/day, deploy, external_write)
  refuses the action *inside the Flow* regardless of autonomy, failing that run and raising an
  `alert`/`failure` — see [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md)
  §6.
- **The Chief orchestrates Flows too.** It's the Chief that proposes pattern-born Flows,
  approves `flow_publish` under `yolo`, and can suggest edits (e.g. "spread these triggers out")
  the same way it suggests routine changes. See
  [`chief-orchestration.md`](chief-orchestration.md).
- **Approvals are the shared seam.** Every `approval` node and every gated action surfaces
  through the Inbox. How those decisions look and what each button does is in
  [`inbox-approvals.md`](inbox-approvals.md).

---

## 9. Vocabulary recap

- **Flow** — a published, trigger-driven visual automation (`flw_…`); draft until a
  `flow_publish` proposal is approved.
- **FlowNodeKind** — `trigger | ai_step | connector | approval | condition`.
- **FlowRun** — one firing (`frn_…`); status `running | needs_you | done | failed`.
- **Job** — the unit of work an `ai_step` spawns (`origin=flow`); carries its own cost, tokens,
  and streamed RunEvents.
- **flow_publish** — the Proposal type that gates turning a Flow on (or materially changing it).
- **proposed_from_pattern** — marks a Flow the team offered you from watching repeated actions.
