# Routines

> Track: **business**. The heartbeat of a stepped-back operator: **Routines** are scheduled
> Helper work that runs on a cron in the company's timezone, so goals keep moving and nothing
> important goes unwatched while you're away. This doc is the behavior the operator sees — the
> schedule mechanism is in [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md)
> §5, the API in [`../technical/02-api-contracts.md`](../technical/02-api-contracts.md) §7, and
> the schema in [`../technical/01-data-model.md`](../technical/01-data-model.md) §8.

Related business docs: [`goals.md`](goals.md) · [`chief-orchestration.md`](chief-orchestration.md) ·
[`autonomy.md`](autonomy.md).

---

## 1. What a Routine is

A **Routine** is a standing instruction to a **Helper** that runs on a schedule. Instead of you
remembering to ask *"summarise what moved yesterday"* every morning, you set it once and the
Helper does it on time, forever, in the company's timezone.

Each Routine carries ([`01-data-model.md`](../technical/01-data-model.md) §8, `Routine` table;
mirrored by `RoutineDetail` in `src/features/routines/data.ts`):

| Field | What it means to the operator |
|---|---|
| `helper_id` | **Who** runs it — a Helper by area (Chief, Ops, Growth, Finance, Dev, Support). |
| `name` / `subtitle` | *"Morning brief"* · *"Chief · weekdays at 07:30 · managed by Chief"*. |
| `instructions` | The standing brief — *"Summarise what moved yesterday across goals, flag anything at risk, and list today's decisions. Max 5 bullets."* |
| `freq` + `at` + `days`/`monthly` | **When** it fires (§2). `freq ∈ daily · weekdays · weekly · monthly`. |
| `timezone` | The **company timezone** (e.g. `Asia/Jakarta`) — the cron is evaluated here, not in UTC. |
| `sends_to` | **Where the result lands** — WhatsApp / Slack / email / chat (§4). |
| `managed_by_chief` | Whether the **Chief** owns the schedule or **you** do (§5). |
| `goal_ids` | Which **Goals** this routine watches (ties routines to [`goals.md`](goals.md)). |
| `enabled` / `paused` | On/off and temporary hold (§8). |
| `next_at` / `last_at` | Next fire and last run, shown everywhere. |

**Every firing creates a Job** (`origin=routine`) that runs the same checkpointed loop as any
other work — worker → gate → execute → review
([`03`](../technical/03-agent-loop-engine.md) §7). So a routine isn't a dumb timer: it reads
real sources, can propose actions (subject to autonomy, see [`autonomy.md`](autonomy.md)), and
writes a **Report**. The run is recorded as a **RoutineRun** for history (§6).

> One Chief, many heartbeats. In the demo company *Sahabat Warga* the Chief *"keeps 15 routines
> running across 6 agents"* — that single banner line is the whole value: coverage without
> you babysitting.

---

## 2. Frequencies and the cron

A Routine's cadence is one of four frequencies, derived into a cron and evaluated by
`croniter` in the company timezone ([`02`](../technical/02-api-contracts.md) §7,
[`03`](../technical/03-agent-loop-engine.md) §5):

| `freq` | Picker | Example |
|---|---|---|
| **daily** | Just a time. | *On-call digest · Every day · 08:00* |
| **weekdays** | Mon–Fri at a time. | *Morning brief · Weekdays · 07:30* |
| **weekly** | A time **+ a day-select** (`days`, 0 = Mon). | *Goal check-ins · Mon & Thu · 09:00* (`days: [0, 3]`) |
| **monthly** | A time **+ date-or-last-working-day** (`monthly: 'date' \| 'last-working-day'`). | *Monthly cost review · last working day · 09:00* |

The monthly **last-working-day** option is the one operators actually want for finance work —
it skips weekends and lands on the real last business day. The detail drawer previews upcoming
fires so there's no guessing: *"Next: Fri Oct 30 · Fri Nov 27 · Thu Dec 31."*

The **Scheduler** (a leader-locked loop in `omilo-worker`) ticks, finds every Routine whose
`next_at ≤ now` in the company tz, enqueues a Job, and advances `next_at`
([`03`](../technical/03-agent-loop-engine.md) §5). Timezone is load-bearing: *07:30* means
07:30 in Jakarta, and daylight shifts never silently move your brief.

---

## 3. Views: the week board and the list

Routines have two views (`RoutinesView = 'week' | 'list'`,
`src/features/routines/data.ts`).

**Week board (lanes per Helper).** A calendar week (*"Oct 19 – 25"*) with **one lane per
Helper** — Chief, Dev, Ops, Growth, Finance, Support — and each scheduled run as a chip in that
lane. Recurring runs span their days (the Morning brief chip spans Mon–Fri; the On-call digest
spans the full week); one-offs sit on a single day. Today's column is highlighted. This is the
"who's doing what, when" picture at a glance, and it's where schedule **clashes** become
visible — four routines stacked on Monday morning stand out immediately.

**List view (grouped by Helper).** The same routines as rows grouped under each Helper, each row
showing `name · when · next · by (chief|you)` and an **8-run sparkline** of recent outcomes
(`ok · skip · fail · none`). Good for scanning health: *Weekly retro* shows a `skip` (a public
holiday); *On-call digest* shows a `fail` (PagerDuty was unreachable); a paused *Ad spend
review* shows `none`s then a `paused` next-run.

A banner sits above both views summarising state — the healthy default, a **failed** banner
(*"1 routine failed this week — Invoice chaser · Fri 10:00 · Xero connection expired"*), or an
**applied** banner after a schedule change lands.

---

## 4. `sends_to` — where results land

A Routine's output goes to one or more destinations (`sends_to`,
[`01`](../technical/01-data-model.md) §8). Channels are **WhatsApp**, **Slack**, **email**, and
in-app **chat**. In the UI each destination is a chip, e.g. for the Morning brief:

- *WhatsApp · you* — the personal nudge.
- *#General chat* — the team-visible copy.

So the same run can quietly land in your pocket **and** post to the team channel. Delivery is
part of the run and shows in the run detail — *"Delivered to WhatsApp & chat"*, and in the Run
output: *"WhatsApp · read 07:41 · #General."* If a Helper has to *do* something beyond sending a
report (spend, write, deploy), that's a `pending_action` and goes through the autonomy gate like
any other work — `sends_to` is only about where the **report** goes, not an approval bypass.

---

## 5. `managed_by_chief` vs operator-owned

Every Routine is owned either by the **Chief** or by **you** (`managed_by_chief`, and the
`by: 'chief' | 'you'` flag on list rows). The distinction governs who may change the schedule:

- **Managed by Chief** (`managed_by_chief: true`) — the Chief created it and may re-time it to
  balance the week. *Morning brief*, *Weekly retro*, *On-call digest*, *Backup check*,
  *Monthly cost review* are Chief-managed in the fixtures.
- **Set by you** (`managed_by_chief: false`) — you created it; it's yours. *Goal check-ins*
  (*"Chief · Mondays & Thursdays at 09:00 · set by you"*) and the paused *Ad spend review* are
  operator-owned.

The rule the Chief obeys, stated right on the suggestion card: **"Chief never moves routines
you set yourself."** The Chief can *suggest* a change to one of your routines, but it will never
silently re-time something you own. This is the same representative mandate as everywhere else
in omilo — see [`chief-orchestration.md`](chief-orchestration.md) and [`autonomy.md`](autonomy.md).

---

## 6. Run history, outcomes, skipped runs, and cost

Every firing produces a **RoutineRun** ([`01`](../technical/01-data-model.md) §8) linking the
schedule to the **Job** it spawned, with `when`, `outcome`, `duration`, `skipped`, and
`cost_credits`. This powers the 8-run sparkline, the hover tooltip, and the focused run drawer.

**Outcomes** (`RunResult`): `ok` (Success) · `skip` (Skipped) · `fail` (Failed) · `none` (No
run yet). A **successful** run shows what it produced and where it went — e.g. Morning brief:
*"5 bullets · 1 risk flagged"*, with step timeline (*read sources → produced output →
delivered*) and logs. A **skipped** run names *why*: *"Skipped — you were on leave"*, *"Skipped
— a public holiday"*, *"Skipped — the routine was paused"* — a skip is information, not a
failure, and costs `$0.00`. A **failed** run names the cause and reassures nothing leaked: the
On-call digest failure reads *"Couldn't reach PagerDuty — the API timed out after 3 retries. No
digest was sent,"* with `attempts: 3 / 3`; the Invoice chaser failure — *"The Xero connection
expired, so 3 overdue invoices weren't chased. Nothing was sent."* Failures retry with backoff
([`03`](../technical/03-agent-loop-engine.md) §5) before giving up, and surface as a
`failure`/`alert` InboxItem so you actually find out.

**Cost** is metered, not estimated. Each run carries a real credit cost
([`02`](../technical/02-api-contracts.md) §13) — the Morning brief is *"~$0.01 a run"*, a
success detail shows *"$0.009 · 1m 50s"* — rolled up so routines never become an invisible
spend. The **Monthly cost review** routine exists precisely to keep an eye on that.

---

## 7. The Chief proposing schedule changes — "spread Monday mornings"

The Chief watches the week board for pile-ups and proposes fixes — a `ROUTINE_SUGGESTION` that
arrives as an InboxItem ([`02`](../technical/02-api-contracts.md) §7). The canonical case
(`ROUTINE_SUGGESTION` in `src/features/office/data.ts` / `SUGGESTION` in routines data):

> **Spread Monday morning routines** — *"4 routines start between 08:00 and 10:00 on Mondays.
> Moving two keeps Ops free for incidents."*
>
> | Routine | Helper | From → To |
> |---|---|---|
> | Instagram report | Growth | Mon 08:00 → **Mon 11:00** |
> | Dependency updates | Dev | Mon 10:00 → **Tue 10:00** |
>
> *"Chief never moves routines you set yourself."*

You review and apply. The applied banner confirms *"Monday is spread out — no clashes this
week,"* and a toast lets you **Undo**: *"2 routines moved · Instagram report → Mon 11:00 ·
Dependency updates → Tue 10:00 · Undo."* Under higher autonomy the Chief may apply such a change
to its **own** (Chief-managed) routines directly and tell you after; it still only *proposes*
for routines you own (§5). The whole flow is: Chief notices load → proposes a concrete move →
you approve (or it self-approves within mandate) → the week rebalances.

When you **create** a routine, the Chief does the same clash-avoidance proactively: the New
routine flow recommends a slot and flags conflicts — *"Fridays · 15:30 — recommended · Right
after Payout reconcile, uses its fresh numbers"* vs *"Fridays 15:00–15:30 clashes with Payout
reconcile."*

---

## 8. Pause / enable / run-now

Operators control a Routine through `PATCH /v1/routines/{id}` and the run-now endpoint
([`02`](../technical/02-api-contracts.md) §7):

- **Run now** — `POST /v1/routines/{id}/run-now` fires it immediately off-schedule and returns
  a `{job_id}` you can watch run live (*"Running now · step 2 of 3"* with a progress bar).
- **Pause** — a temporary hold with an end date. The drawer is explicit about the cost: *"Paused
  until Mon, Nov 3 · You paused it Oct 24 · 6 runs will be skipped."* Those skipped runs show as
  `skip` in history with reason *"the routine was paused."*
- **Enable / disable** — `enabled` turns the Routine off entirely (vs a timed pause).
- **Reassign** — hand a Routine to a different Helper (e.g. move *Goal check-ins* from Chief to
  Ops because *"reads the same goals"* and Chief is busy Monday morning).
- **Delete** — a **negative action**: confirmed with the sad Mascot, never a bare icon. The copy
  is honest — *"Chief stops sending it from Monday. Past runs and outputs stay in the activity
  log. You can't undo this — pause it instead if you might want it back."*

---

## 9. Worked example — the Morning brief routine

The *Morning brief* (`morning-brief`, `src/features/routines/data.ts`) is the archetype: the
first thing the stepped-back operator reads each day.

**Set-up.** Helper **Chief**; `freq: weekdays` at **07:30** in **Asia/Jakarta**;
`managed_by_chief: true`. Instructions: *"Summarise what moved yesterday across goals, flag
anything at risk, and list today's decisions. Max 5 bullets."* `sends_to`: *WhatsApp · you* and
*#General chat*. Cost: *~$0.01 a run*. It watches the company's Goals (`goal_ids`), so it reads
goal progress, Inbox items, and recent flow runs.

**A firing (Fri 23, 07:30).** The scheduler sees `next_at ≤ now` in Jakarta time, enqueues a
`routine` Job, and the Chief runs the loop:

1. *Read yesterday's goals & Inbox* — pulls **4 goals · 3 Inbox items · 6 flow runs**.
2. *Write 5 bullets* — the brief.
3. *Send to WhatsApp & #General* — delivered; WhatsApp *read 07:41*.

The produced brief (from `RUN_OUTPUT`):

> Good morning, Mas Dede ☀️
> - Passkeys: web + iOS on staging; Android slipping 2 days.
> - Referral launch: ad budget approved, first payouts Friday.
> - At risk: Postgres 16 upgrade — 20%, due Nov 30.
> - Decide today: shift launch comms to Nov 26?
> - Invoice chaser failed — Xero needs reconnecting.

Notice the brief does the operator's triage for them: it surfaces the one **decision** ("shift
launch comms?"), the one **at-risk goal**, and the one **broken routine** (the Invoice chaser /
Xero failure from §6) — tying straight back to Goals ([`goals.md`](goals.md)) and the Inbox.

**History.** The run is recorded as a RoutineRun: *"Fri 23 · 07:30 · 5 bullets · 1 risk flagged
· 1m 50s · $0.009."* The prior days show *Thu 22 · 4 bullets* and *Wed 21 · Skipped — you were
on leave*. The 8-run sparkline is all green.

**Later that day** the done-update lands in the Inbox — *"Wrote the morning brief · Quiet night.
2 goals moved, 1 at risk (Postgres 16). Brief sent to WhatsApp · 1m 50s · 5 sources · 11
steps."* That's the full loop: the routine fired on time, read the real state, produced a brief,
delivered it two ways, logged its cost, and told you it was done — all without you asking.

---

## 10. Operator cheat-sheet

- **Create:** New routine → *who · when (freq/at/days/monthly) · instructions · sends_to*. The
  Chief recommends a non-clashing slot.
- **Watch:** the **week board** (lanes per Helper) for load, the **list** for per-routine
  health (8-run sparkline + next).
- **Read results:** wherever `sends_to` points — WhatsApp, Slack, email, chat.
- **Respond to the Chief:** apply or dismiss *"spread Monday mornings"* suggestions; the Chief
  never moves routines you own.
- **Control:** **Run now** to fire off-schedule · **Pause** with an end date (skipped runs are
  logged) · **Reassign** to another Helper · **Delete** (sad-Mascot confirm; history is kept —
  prefer Pause).
- **Mind cost:** every run is metered; the Monthly cost review keeps it honest.

See also: [`goals.md`](goals.md) for the outcomes routines keep moving ·
[`chief-orchestration.md`](chief-orchestration.md) for the Chief's mandate ·
[`autonomy.md`](autonomy.md) for what a routine may do on your behalf ·
[`../technical/02-api-contracts.md`](../technical/02-api-contracts.md) §7 for the endpoints.
