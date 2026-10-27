# Inbox & Approvals

> Track: **business**. The **human-in-the-loop seam** — the one place the operator is asked to
> decide, and everything the system does to earn that interruption. Mechanism in
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) (gate,
> interrupt/resume), API in [`../technical/02-api-contracts.md` §6](../technical/02-api-contracts.md),
> entities in [`../technical/01-data-model.md` §7](../technical/01-data-model.md). This doc is
> behavior.

---

## 1. The Inbox is the seam

The whole product is "set a Goal, step back, let the team run it." The **Inbox** is the single
place where the team steps *forward* and asks you something — and the only place it's allowed to.
Everything the Chief and Helpers do flows through one of two outcomes at the **gate**: either
they're cleared to act (and you find out after, if at all), or they need you and it becomes an
**InboxItem**.

Design intent: the Inbox should be **short and high-signal**. If it's full of trivia, autonomy
is set too tight; if things happen you wish you'd been asked about, it's too loose. Tuning that
balance is the job of [`autonomy.md`](autonomy.md); *surfacing* it is the job of this doc.

Two populations live here, and the UI keeps them visually distinct:

- **Decisions that need you** — pinned at the top, often blocking. These carry Proposals and
  action buttons. *"Nothing runs until you approve."*
- **FYI updates** — running work and finished work, grouped by time. No buttons that matter;
  they're a record, not a request.

---

## 2. InboxItem kinds

Every item has a `kind` (`InboxKind`) that tells you *why* you're seeing it and how urgent it is.

| Kind | Means | Typical sender | Needs you? |
|---|---|---|---|
| **decision** | A Proposal is waiting on your call. The gate hit `needs_owner`. | Chief, any Helper | **Yes** — often `blocking`. |
| **question** | A Helper needs an answer to keep going (not a formal Proposal — a judgment call, a missing fact). | Any Helper | Yes, soft. |
| **mention** | Someone @-mentioned you in a plan, thread, or doc and wants a confirmation. | Any Helper | Light. |
| **update** | Something *happened*: a job is running, a job finished, or the Chief auto-approved under `yolo`. | Chief, Helper | No — FYI. |
| **alert** | A threshold or policy warning: spend spike, a `SafetyLimit` warn, something drifting. | Chief, Ops, Finance | Attention, not a gate. |
| **failure** | A job errored or a hard `SafetyLimit` **refused** an action. | Ops, the failing Helper | Yes, to recover. |

`status` is `open | snoozed | done`; `needs_you` and `blocking` are booleans the UI uses to pin
and badge. **decision** items carry inline `proposals` and `actions`; **update** items carry
`progress` (step/total/elapsed) or a `meta` line (duration · sources · steps).

Examples straight from the live Inbox:

- **decision** — *"Approve $4,800 ad budget for the referral launch"* (Growth), *"Create 3 tasks
  for the passkey rollout"* (Chief), *"Pick an offsite venue — 3 options"* (Chief, compact).
- **update / running** — *"Shipping passkeys to staging"* (Dev · step 4/7 · 12m), *"Rollback
  drill on api-prod"* (Ops · 2/5 · 3m).
- **update / done** — *"Wrote the morning brief"* (Chief · 1m 50s · 5 sources · 11 steps),
  *"Closed October books"* (Finance · 6m 12s · 3 sources · 9 steps).

---

## 3. Where a decision comes from — the gate

A **decision** InboxItem is never arbitrary. It exists because a Helper produced a
`pending_action` (a side-effecting intent) and the **gate** decided a human is required.

At the gate, for every pending action:

```
effective_autonomy = min(workspace_default, goal_override, helper_cap)
decide(effective_autonomy, risk, action_type, safety_limits)
     → allowed       → execute now (Chief auto-approves; maybe an `update` item)
     → needs_owner    → create Proposal + InboxItem, then interrupt (park the job)
     → refused        → hard SafetyLimit hit; `failure`/`alert` item, nothing runs
```

So a decision in your Inbox means: *effective autonomy × this action's risk landed on
`needs_owner`.* The job that raised it is **checkpointed and suspended** (LangGraph
`interrupt`) — it costs nothing while it waits and will resume from the exact step when you
decide. The full resolution table is in [`autonomy.md`](autonomy.md); the engine side is
[`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) §2.

### Risk types, tied to concrete decisions

The action's `ProposalType` and `risk` are what make the gate fire. The ones you'll actually
see:

| Proposal type | Example decision | Why it's gated |
|---|---|---|
| **spend** | *"Approve $4,800 ad budget for the referral launch"* | Real money. *"Charged only when ads run"*; Growth stops at the cap. |
| **message** | *"Chief needs your OK to send 214 messages"* (WhatsApp blast to RT heads) | Outbound to real people, at volume — reputationally irreversible. |
| **external_write** | *"Pilot contract redlines from Arunika"* — two redlines need a yes/no | Writing to a system/contract outside the workspace. |
| **deploy** | *"Publish the new pricing page to the live site"* | Touches a live/production surface customers see. |
| **doc_write** / **flow_publish** / **skill_publish** | Publishing a Flow, accepting an agent doc suggestion, shipping a Skill | Standing changes that act on their own later. |
| **connector_access** / **settings_change** | Granting a Helper a new connector, changing a workspace setting | Expands what the team can do. |

A low-risk **message** to an internal channel under `ask` may clear the gate silently; a
high-risk **deploy** under `ask` escalates to you. (Under `yolo` even the deploy auto-approves —
there the only thing that stops it is a `deploy` SafetyLimit; see [`autonomy.md`](autonomy.md)
§4.) Same action, different risk/autonomy math, different outcome.

---

## 4. The four actions — and exactly what each does

Open a decision and you get up to four moves. Each maps to a real API call and a real state
change on the `Proposal` (`pending → …`).

### Approve
`POST /v1/proposals/{id}/approve {note?}`

- Proposal `status: pending → approved → executing`.
- **Resumes the interrupted checkpoint** and **spawns an `execution` Job** (`origin=execution`,
  `proposal_id` set) that carries out the action — sends the message, moves the money, opens the
  PR. Idempotent via `Idempotency-Key`, so a retried approve never double-acts.
- The InboxItem goes `done`; if the action was part of a Flow, the `FlowRun` leaves `needs_you`
  and continues.
- When it finishes, you typically get an **update** item recording the outcome.

### Review
Reads the full Proposal and its **revision history** (`GET /v1/proposals/{id}` →
`{proposal, revisions[]}`). For multi-part decisions ("Review one by one") this is where you
step through each sub-proposal with its detail — branch, time/credit cost, blockers — before
approving the set. Review changes nothing; it's how you look before you leap.

### Request changes
`POST /v1/proposals/{id}/request-changes {note}`

- Proposal `status → changes_requested`.
- Creates a **new `ProposalRevision`** (author `operator`) carrying your note. The Helper picks
  it up, reworks the proposal, and comes back with a **new revision** (author `agent`) for you to
  look at. The job stays parked across the round-trip.
- This is the "not no, but not like that" path — a conversation, not a rejection. Every turn is
  kept in `revisions[]` so the "Review" view shows the whole back-and-forth.

### Reject
`POST /v1/proposals/{id}/reject {note}` (note required)

- Proposal `status → rejected`. The checkpoint resumes only to **unwind** — the action does not
  happen, and the parent job's `review` node decides whether to try another approach or stop.
- Your note is a signal: the `learn` node may turn a rejection into a **Memory lesson** so the
  team proposes differently next time (see [`learning-skills-flows.md`](learning-skills-flows.md)).

> Rejecting and other destructive confirmations use the **sad-mascot ConfirmDialog**, never a
> bare icon — a deliberate UX choice for negative actions.

---

## 5. Proposal revisions — the history

A `Proposal` keeps a `current_revision` pointer and an append-only list of `ProposalRevision`s
(`n`, `body_md`, `author` = `agent | operator`, `summary`, `at`). This is what makes
**request-changes** a real workflow instead of a dead end:

```
rev 1 (agent)     "Send $4,800 across Meta + TikTok, 14 days"
   │  you: request-changes "start smaller, cap daily"
rev 2 (operator)  note: tighten the budget
   │  Growth reworks
rev 3 (agent)     "Send $3,000, 14 days, $215/day cap — top up if week 1 is good"
   │  you: approve
→ approved → execution Job
```

The "Change amount" affordance on the ad-budget decision is exactly this: the dialog offers
preset amounts (1500 / 3000 / 4800), defaults to a smaller 3000 with the note *"Start smaller,
we'll top up if week 1 looks good"* — picking one files a new revision rather than approving the
original. The **Review** panel always shows every revision so the trail of who-asked-what is
auditable.

---

## 6. Snooze + the notification ladder

Not every decision needs an answer *now*. `POST /v1/inbox/{id}/snooze {until}` sets
`status: open → snoozed` and `snooze_until` — the item leaves the pinned list and comes back when
the timer elapses. The parked job keeps waiting the whole time (it's a checkpoint, it's patient).
Compact decisions offer a **"Later"** action that snoozes with a sensible default.

Decisions don't just sit silently. A **notification ladder** escalates a `blocking` decision the
longer it waits, through the realtime surface (`Notice` → `Notification` → Web Push; see
[`../technical/02-api-contracts.md` §9](../technical/02-api-contracts.md) and `09-realtime.md`):

1. in-app badge + the Inbox pin (immediate);
2. a push notification if it stays open past its patience window (an `approval` node can set
   this, e.g. *"wait up to 1h"*);
3. for a Flow run, the run row's live *"waiting Nm"* counter climbing in parallel.

The ladder is **per-decision**, not spammy: snoozing resets it, approving/rejecting ends it.

---

## 7. `yolo` — the Chief approves for you

Under `yolo` effective autonomy, the gate resolves routine, in-policy actions to **`allowed`**.
The **Chief approves on your behalf** server-side — no decision is created, the job never parks,
the work just happens. This is the "trusted" setting: you've delegated the approval itself to
your representative.

But `yolo` is not invisible. After the fact, the gate logs an `AuditEvent` and (for anything
worth knowing about) files an **`update`** InboxItem — *"Chief sent the Saturday clean-up blast
(214 messages)"* — so there's always a record of what was auto-approved and by whom. You can
scroll your Inbox and see everything the Chief did in your name; nothing is hidden, it's just not
*blocking*.

Under `yolo` the Chief approves the **full range** — low, medium, **and high-risk** actions
(deploys, large spend, disbursements, mass external messages) — on your behalf. There is **no
per-action human gate** at this dial; `yolo` means "set a goal, touch nothing." High-risk
auto-approvals are still logged as `update` items, so you can always see what was done.

Two guardrails keep `yolo` honest, both covered in [`autonomy.md`](autonomy.md):

- **SafetyLimits are the backstop — and the only one.** Because the Chief auto-approves even
  high-risk actions under `yolo`, your control over dangerous actions is the **hard caps you set
  in advance** (spend/day, spend/month, messages/day, deploy, external_write). The gate evaluates
  them **before** honoring the Chief's approval and **refuses** on breach, raising a
  `failure`/`alert`. Autonomy can never buy past a wall the operator built — so set those walls
  deliberately before moving a workspace to `yolo`.
- **helper_cap clamps it.** A Helper whose `autonomy_cap` is `ask` (or `strict`) never reaches
  `yolo` behavior even inside a `yolo` workspace — `effective = min(...)` takes the strictest
  layer. Cap a sensitive Helper to keep *its* actions gated while the rest of the workspace runs
  hands-off.

---

## 8. Decisions that need you vs FYI updates

The Inbox deliberately separates *"act on this"* from *"know this,"* and the UI mirrors it:

- **Needs you** (pinned, badged, laddered): `decision`, most `question`s, `failure`s. These block
  something until you move. The Notifications page pins these at the very top — e.g. *"Chief needs
  your OK to send 214 messages,"* *"Grower wants you to pick Friday's post,"* *"Support handed you
  2 WhatsApp chats"* — each with a primary action (Approve / Compare drafts / Open chats) and a
  soft one (Review / Later / Assign).
- **FYI** (grouped by TODAY / YESTERDAY): `update`, `mention`, most `alert`s. These are a
  record — *"Builder mentioned you in Passkey rollout plan," "Finance closed October's books."*
  Running `update`s show a live progress bar; done ones show a `meta` line (*"1m 50s · 5 sources ·
  11 steps"*) and link to the Report.

Rule of thumb: if the system is **waiting on you**, it's a decision/needs-you; if the system is
**telling you**, it's an update. A `yolo` auto-approval is always the second kind.

---

## 9. Worked example — "Ship passkeys" (a 3-proposal decision)

The richest shape: one decision that bundles **several proposals**, approved as a set.

**The item.** Chief, 2m ago, `#engineering`: **"Create 3 tasks for the passkey rollout."**
Summary: *"From your chat 'Passkey rollout plan.' Splits the goal so web + iOS ship before the
Nov 28 freeze; Android follows with a fallback."* Reassurance: *"Nothing runs until you
approve."* It carries three inline proposals:

| Who | Proposal | Due | Detail (in Review) |
|---|---|---|---|
| Dev | **Ship passkeys on web + iOS** | Nov 14 | New branch `web/passkeys`. ~4 days Dev · Rp 140rb AI. **Blocks:** Launch comms. |
| Dev | **Android password fallback flow** | Nov 21 | New branch `android/password-fallback`. ~2 days · Rp 90rb. **Blocks:** 10%→100% rollout. |
| Growth | **Launch comms to all users** | Nov 24 | ~1 day Growth · Rp 40rb. **Waits for:** web + iOS shipping. |

**Actions.** `Approve all 3` (primary), `Review one by one`, `Reply`.

Three ways it plays out:

- **Approve all 3.** Each proposal → `approved → executing`; three `execution` Jobs spawn and the
  work is added to the goal *"Passwordless login by Q4."* Toast: *"3 tasks approved — Dev starts
  with web + iOS."* The ordering is respected because the proposals declare their
  **blocks/waits-for** dependencies — Launch comms won't start until web + iOS lands.
- **Review one by one.** Opens each sub-proposal with its detail (branch, time, credit cost,
  blockers) so you can approve two and **request changes** on the third — say, push the Android
  fallback's scope. That files a revision on just that one; the other two proceed.
- **Reply.** Kicks it back to a conversation in the source session (*"Passkey rollout plan"*)
  without approving anything — for when the split itself is wrong.

This example shows why the Inbox is more than an approve button: a single decision can be a
**coordinated plan** with dependencies, and your options are *all*, *some*, or *talk about it*.

### Shorter worked example — "send 214 WhatsApp messages" (a single high-risk message)

Chief, `#general`: **"Chief needs your OK to send 214 messages"** — *"WhatsApp blast to RT heads
about Saturday's clean-up is drafted and waiting."* This is a single **message**-type Proposal,
`risk: high` (214 real people, external, irreversible). Under `ask`/`strict` it stops here:

- **Approve** → resumes the checkpoint, spawns one **execution** Job that sends all 214 (idempotent
  — a retry won't double-send), item → `done`, and you later get an **update**: *"Sent the
  Saturday clean-up blast (214)."*
- **Review** → see the drafted message and the recipient list before you commit.
- **Request changes** → *"soften the ask, add the rain plan"* files a revision; Chief redrafts.
- Under **`yolo`**, this never reaches you at all — the Chief sends it and you find the same
  outcome as an `update` item after the fact.

Same decision, two autonomy worlds: a blocking approval under `ask`, an after-the-fact receipt
under `yolo`. That is the entire human-in-the-loop dial in one card.

---

## 10. Vocabulary recap

- **InboxItem** — one thing surfaced to you; `kind` ∈ decision/update/mention/question/alert/
  failure, `status` ∈ open/snoozed/done.
- **Proposal** — a gated action awaiting a decision (`prp_…`); `type` ∈ message/spend/
  external_write/deploy/doc_write/flow_publish/connector_access/settings_change/skill_publish/
  other; `risk` ∈ low/medium/high; `status` ∈ pending/approved/rejected/changes_requested/
  executing/done/failed.
- **ProposalRevision** — one turn of the request-changes conversation (`agent` or `operator`).
- **gate** — the engine node that turns effective-autonomy × risk into allowed / needs_owner /
  refused.
- **execution Job** — the `origin=execution` Job an approval spawns to actually do the thing.
- **effective autonomy** — `min(workspace_default, goal_override, helper_cap)`; see
  [`autonomy.md`](autonomy.md).

See also: [`flows.md`](flows.md) (approval nodes and `flow_publish`),
[`chief-orchestration.md`](chief-orchestration.md) (who proposes and who approves),
[`autonomy.md`](autonomy.md) (the dial), and
[`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) (interrupt/resume).
