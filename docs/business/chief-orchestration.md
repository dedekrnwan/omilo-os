# Chief Orchestration

> Track: **business**. How the **Chief** behaves for the operator — the AI that holds the
> operator's mandate, decomposes a Goal into delegated work, reviews what the Helpers produce,
> and approves on the operator's behalf. This is the *behavior* doc; the mechanism (the
> supervisor → worker → gate → review loop) lives in
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md). Autonomy math
> is in [`autonomy.md`](autonomy.md); the approval surface is
> [`inbox-approvals.md`](inbox-approvals.md); the thing being delivered is in
> [`goals.md`](goals.md).

---

## 1. What the Chief is

Every company in omilo has **exactly one Chief**: a `Helper` with `is_chief = true`. It is not
a different kind of entity — it is a Helper that the operator has designated as their
**representative**. Where an area Helper (Dev, Growth, Finance, Ops, Support) is a specialist
that *does* one slice of work, the Chief is the **supervisor and the approval gate**: it plans,
delegates, reviews, and — within limits the operator set — says *yes* on the operator's behalf.

### The mandate

When the operator hires a Chief and sets an autonomy dial, they hand it a **mandate**: a
standing authorization to act for them up to a ceiling. The mandate is not "do anything." It is
"handle the running of the business so I don't have to be the bottleneck on every small
decision — and bring me the ones that actually need me." Concretely, the mandate is expressed
by three dials that combine into **effective autonomy**:

```
effective_autonomy = min(workspace_default, goal_override, helper_cap)
                     over the ladder  strict < ask < yolo
```

- **`workspace_default`** — the operator's baseline posture for the whole company.
- **`goal_override`** — a per-Goal loosening or tightening (a launch can run hotter; a payout
  goal stays strict).
- **`helper_cap`** (`autonomy_cap`) — the tightest a given Helper may ever act, regardless of
  the above. A junior Finance Helper can be capped at `ask` even in a `yolo` workspace.

The Chief itself has a cap like any Helper, but its job is to *apply* the whole dial to
everyone else's work. See [`autonomy.md`](autonomy.md) for the full resolution table.

### What "approve on behalf" means — and its limits

"Approve on behalf" means that when a Helper proposes a side-effecting action (send this email,
spend this ad budget, deploy this branch, publish this flow), the decision of whether a human
needs to see it is made by the **gate** using effective autonomy. When the dial permits, the
Chief approves silently, the action executes, and the operator sees it as an *update* in the
Inbox rather than a *decision* to make. That is the Chief standing in for the operator.

The limits are hard and non-negotiable:

- **SafetyLimits always win.** The operator sets hard caps in Control-Panel → Safety & limits
  (`spend_day`, `spend_month`, `messages_day`, `external_write`, `deploy`). These are enforced
  by the gate **regardless of autonomy** — even under `yolo`, the Chief cannot approve a spend
  over the daily cap or a deploy the operator has blocked. A blocked action comes back
  `refused`, not "approved." The Chief has no power to raise its own ceiling.
- **The operator can always override.** Any auto-approval can be reversed; any Chief decision
  can be countermanded; the operator can drop the whole company to `strict` in one move and the
  Chief will stop self-approving immediately.
- **Everything is audited.** Every approval the Chief makes on the operator's behalf is a logged
  `AuditEvent` with the proposal, the risk, the effective autonomy at the time, and the outcome.
  There is no silent authority.

The Chief holds a mandate, not a blank cheque. It is powerful inside a fence the operator draws
and can move at any time.

---

## 2. From Goal to delegated Jobs

The Chief's core loop is: **take a Goal, break it into the right pieces, hand each piece to the
Helper who should own it, read back what they produce, and decide whether the outcome is met or
the work needs another pass.** In engine terms this is the supervisor → (delegation) → worker →
gate → execute → review cycle; here is what it *means*.

### Decomposition

A Goal is an **outcome plus an expected end result** — "Passwordless login by Q4," not "write
code." The Chief's `supervisor` reads the Goal `target`, the company handbook (profile, voice,
rules, KPIs via `get_context`), and the roster of Helpers, then produces a **bounded plan**
(at most ~12 steps) of delegated sub-Jobs. Each step is matched to a Helper by **area/role** and
that Helper's standing `job_description`:

- Build and ship work → the **Dev** Helper (area `dev`).
- Announcements, emails, launch comms → the **Growth / Marketing** Helper.
- Money movement, invoices, reconciliation → **Finance**.
- Incident-adjacent or scheduling work → **Ops**.
- Customer-facing replies → **Support**.

Each planned step becomes a **child Job** (`origin = delegation`, with a `parent_job_id` back to
the Chief's planning Job) carrying a tight **brief** and an optional `operator_note`. Dependencies
are explicit — "Launch comms *waits for* Ship passkeys on web + iOS" — so the Chief doesn't fan
work out that can't start yet.

### Review — done vs loop-again

When a delegated Helper finishes, it files a **Report** (headline, body, KPIs, what's next). The
Chief's `review` step reads each child Report and asks one question: **is the Goal `target`
actually met?**

- **Met** → the Goal advances (`progress` moves toward 100), the Chief writes a roll-up Report,
  and the loop ends. A *lesson* is learned if the operator corrected anything along the way.
- **Not yet** → the Chief loops: it re-plans (another `supervisor` pass), spawns the next batch
  of delegated Jobs, or sends a step back to its Helper with specific feedback. This is bounded
  by `MAX_STEPS` so a goal can never loop forever — if it stalls, the Chief surfaces *why* to the
  operator rather than burning credits in a circle.

The Chief reviews work the way a good manager does: it doesn't rubber-stamp, and it doesn't
redo the specialist's job — it checks the result against the brief and either closes it or sends
it back with a reason.

---

## 3. The Chief DM — talking strategy with your representative

The Chief isn't only a background orchestrator; it's someone the operator *talks to*. The
**Chief DM** (`Session` with `scope = chief_dm`) is a private, one-on-one thread — "Just you,"
never posted to a channel, never acted on unless the operator asks. It's where the operator
thinks out loud and the Chief answers like a trusted number-two: **candid and advisory, not
sycophantic.**

The tone is deliberately direct. From the real fixture conversation:

> **Operator:** "Honestly — are we spreading too thin this quarter? Everything feels half done."
>
> **Chief:** "A bit, yes. 7 goals are open but only 3 moved this month. The other 4 share one
> blocker: they wait on your approval, usually 2+ days. Two ways out: pause 2 of them until
> December, or let Builder approve its own small deploys."
>
> **Operator:** "Second one. Don't change anything yet, just draft it."
>
> **Chief:** "Drafted, not applied. I'll bring it to you Monday with the Q4 review — nothing
> changes until you say so."

Three things that conversation shows, and that the Chief always honors:

1. **It tells the truth about the numbers.** "7 goals open, 3 moved" — it names the real
   bottleneck (the operator's own approval latency) instead of flattering them.
2. **It proposes concrete options, not vague encouragement.** Pause two goals, or loosen one
   Helper's autonomy — each a thing the operator can actually choose.
3. **It never acts from the DM.** "Drafted, not applied." The DM produces *drafts and
   proposals*; nothing changes the live workspace until the operator says so, and even then it
   goes through the normal proposal path. Any chat can be deleted at any time.

### What the Chief proactively surfaces

The Chief doesn't wait to be asked. Driven by its own routines (see §6), it reaches out:

- **Morning brief** (weekdays, 07:30): what moved yesterday across goals, what's at risk, and
  today's decisions — capped at five bullets, delivered to WhatsApp and the General chat.
  Example output: *"Passkeys: web + iOS on staging; Android slipping 2 days. Referral launch: ad
  budget approved, first payouts Friday. At risk: Postgres 16 upgrade — 20%, due Nov 30. Decide
  today: shift launch comms to Nov 26? Invoice chaser failed — Xero needs reconnecting."*
- **Nudges** before meetings and deadlines: *"Got two minutes? Before your 3pm with Pak RT,
  there are two things he'll likely ask about — the clean-up budget and the late pickups."* A
  nudge offers "Walk me through" or "After lunch" — it's a tap on the shoulder, never a demand.
- **Spreading-too-thin and workforce checks:** the Chief watches for over-commitment ("are we
  spreading too thin"), approval backlogs, routine clashes, and gaps it could fill, and brings
  them up before they bite.
- **Quick prompts** the operator can fire anytime: "Prep my 3pm," "What am I forgetting?,"
  "Brain-dump."

The Chief DM is the relationship layer: strategy, judgment, and candor — distinct from the
Inbox, which is where *decisions* get made.

---

## 4. Worked example — the passkeys Goal, end to end

This traces one real goal from the fixtures through the full delegation and review lifecycle.

**Goal:** *"Passwordless login by Q4"* — target: passkey sign-in live on web, iOS, and Android
with a safe fallback, announced to users. Suppose `workspace_default = ask`, with a
`goal_override = ask` (a shipping goal, kept careful).

**1 · Chief plans (supervisor).** The Chief reads the target and the handbook, then decomposes it
into a bounded plan of delegated Jobs with dependencies:

| Delegated Job | Helper (area) | Brief | Depends on |
|---|---|---|---|
| Ship passkeys on web + iOS | Dev (`dev`) | Add passkey sign-in on web and iOS behind a 10% flag; keep password login as fallback until 100%. New branch `web/passkeys`. ~4 days · ~Rp 140 rb AI spend. | — |
| Android password fallback flow | Dev (`dev`) | Keep password + OTP for Android < 9 (6% of users); one-time explanatory banner; log who stays on passwords. Branch `android/password-fallback`. ~2 days · ~Rp 90 rb. | blocks 10%→100% rollout |
| Launch comms to all users | Growth (`marketing`) | Email, in-app banner, and a short help article once web + iOS reach 100%. ~1 day · ~Rp 40 rb. | waits for *Ship passkeys* |

The Chief presents these as a grouped decision in the Inbox. The operator reviews one by one and
approves — the toast confirms: **"3 tasks approved — added to 'Passwordless login by Q4.' Dev
starts with web + iOS."**

**2 · Helpers execute (worker → gate).** Each child Job runs:

- The **Dev** Helper opens `web/passkeys`, writes the flag-gated sign-in, and reaches a
  side-effecting step — *push the branch / open a PR*. That's a `deploy`-class action, so the
  worker calls `request_action` and the **gate** evaluates it. At `ask`, a non-trivial deploy is
  `needs_owner`: a **Proposal** + **InboxItem** are created, the Job **interrupts**, and the
  operator (or the Chief under higher autonomy) decides. The branch push waits.
- Low-risk reads and internal checkpoints along the way are `allowed` — the Helper gathers
  context, reads the codebase, and writes progress notes without bothering anyone.

**3 · Chief reviews (review).** As Dev's Reports land ("web + iOS on staging; Android slipping 2
days"), the Chief's review step checks them against the brief. Web + iOS are *met*; Android is
*behind* its estimate. The Chief doesn't silently absorb the slip — it surfaces it in the
morning brief (*"Android slipping 2 days"*) and holds **Launch comms** because its dependency
(100% rollout) isn't satisfied yet. The Goal `progress` advances partially, not to 100.

**4 · Loop or close.** Because the target isn't fully met, the Chief loops: it keeps the Android
fallback Job active, re-checks the dependency on the next pass, and only when web + iOS hit 100%
does it release **Launch comms** to Growth. When all three Reports clear the brief, the Chief
writes the roll-up Report, moves the Goal to done, and — if the operator corrected an estimate or
a scope call anywhere — a **lesson** is learned so the next shipping goal is estimated better.

Throughout, the operator's experience is: *approve a plan once, get a daily brief, make the one
or two real calls that needed them (the deploy, a date shift), and watch progress move* — not
babysit every branch push.

---

## 5. The Chief as approval gate — auto-approve vs escalate

Every consequential action a Helper wants to take flows through the **gate**, which resolves:

```
decide(effective_autonomy, risk, action_type, safety_limits)
   → allowed       (Chief auto-approves on the operator's behalf)
   → needs_owner   (escalate: Proposal + InboxItem, Job interrupts)
   → refused       (hard SafetyLimit hit — nobody can approve it)
```

Three inputs drive it:

- **Effective autonomy** — the `min(...)` dial from §1.
- **Action risk** — `low`, `medium`, or `high`, estimated per action. Reading a dashboard is
  low; emailing all users or spending real money is high.
- **Action type** — `message`, `spend`, `external_write`, `deploy`, `doc_write`,
  `flow_publish`, `connector_access`, `settings_change`, `skill_publish`.

The posture of each autonomy level:

- **`strict`** — the Chief auto-approves almost nothing consequential. Nearly every
  side-effecting action becomes a **decision** in the Inbox for the operator. The Chief still
  plans, drafts, and reviews, but the human holds the pen on actions. Good for money-sensitive or
  brand-sensitive goals.
- **`ask`** (the sensible default) — the Chief auto-approves **low-risk, reversible** actions
  (internal notes, draft docs, scheduling) silently, **approves medium-risk on your behalf**
  (external sends, small spend, `external_write`, publishing a flow), and **escalates only
  high-risk** — large spend, disbursements, deploys, settings changes — to you. This is the
  "representative who handles the small and medium stuff and brings you the real calls" posture.
- **`yolo`** — the Chief auto-approves the **full range** — low, medium, **and high-risk** — on
  your behalf, and only the operator's Inbox *updates* (not decisions) reflect what happened.
  There is no per-action human gate here: the **SafetyLimits** are the sole backstop (a hard-cap
  breach is still `refused`), and a Helper's `autonomy_cap` can still hold *that* Helper tighter.
  `yolo` is "move fast inside the fence" — so the operator must build the fence (SafetyLimits)
  deliberately before turning the dial up. Never "no fence."

Two rails apply at every level: a **SafetyLimit** breach is always `refused` regardless of the
dial, and a Helper can only self-authorize the `ProposalType`s listed in its `permissions`. When
the gate escalates, the operator sees a clean decision in the Inbox with the proposal body, the
risk, the cost, and what it blocks — and can approve, reject, or **request changes** (which sends
a revised brief back to the Helper). See [`inbox-approvals.md`](inbox-approvals.md) for the
decision surface and [`autonomy.md`](autonomy.md) for the full resolution matrix.

---

## 6. Chief-initiated proposals — improving the operation

The Chief doesn't only respond to goals; it proposes **improvements to how the business runs**.
These are always proposals, never unilateral changes to things the operator set.

### New routines

The Chief watches the schedule for strain and suggests fixes. The canonical example is the
**"Spread Monday morning routines"** suggestion:

> **Chief suggested (5m ago) — Spread Monday morning routines**
> "4 routines start between 08:00 and 10:00 on Mondays. Moving two keeps Ops free for
> incidents."
>
> | Area | Routine | From | To |
> |---|---|---|---|
> | Marketing | Instagram report | Mon 08:00 | Mon 11:00 |
> | Dev | Dependency updates | Mon 10:00 | Tue 10:00 |

The operator applies it with one tap ("2 routines moved · Undo") or ignores it. Two guardrails
hold: **the Chief never moves routines the operator set themselves** (only ones it manages), and
it explains the *why* (keep Ops free for incidents) rather than just rearranging the calendar.
The Chief can also **propose brand-new routines** — e.g. a Friday overdue-invoice summary — and
when it does, it offers slotted options ("Fridays 15:30 — recommended, right after Payout
reconcile; uses its fresh numbers") and flags clashes before they happen.

### New Helpers, Flows, and other improvements

- **New Helpers** — when work repeatedly stalls on a missing role, the Chief files a
  `propose_helper` ("you keep needing a field coordinator; here's the role and what it would
  own"). Hiring is the operator's call.
- **New Flows** — when it sees the same multi-step action repeated by hand, the Chief drafts a
  Flow (`flows_draft`) and proposes publishing it (`flows_publish` → gate). Repeated work becomes
  a reusable automation — with the operator's sign-off.
- **Autonomy and process tweaks** — as in the §3 DM, the Chief may propose loosening a specific
  Helper's cap to unblock a backlog, pausing stalled goals, or adjusting a budget. Each lands as
  a proposal the operator approves or declines; nothing self-applies.

The through-line: the Chief is always trying to make the operation run smoother, and it earns
trust by *proposing* those improvements with a clear rationale instead of quietly reorganizing
the business.

---

## 7. Guardrails & trust

The Chief has real authority, so the trust model is explicit and always in the operator's favor:

- **Everything is audited.** Every plan, delegation, approval, and executed action is logged —
  the Proposal, the risk, the effective autonomy at decision time, who/what decided, and the
  result. The operator can reconstruct *why anything happened* after the fact. Every MCP tool
  call the Chief or a Helper makes is recorded with its gate `decision`
  (`allowed` / `proposal` / `refused` / `error`).
- **The operator can always override.** Reverse an auto-approval, countermand a Chief decision,
  reassign a routine, pause a goal, or drop the whole company to `strict` in one move — the Chief
  yields immediately. The mandate is revocable at any granularity.
- **The Chief never exceeds hard SafetyLimits — even under `yolo`.** The daily/monthly spend
  caps, the messages-per-day cap, and the `deploy` / `external_write` blocks are enforced by the
  gate independent of autonomy. A capped action is `refused`, surfaced as an `alert`/`failure` in
  the Inbox, and *cannot* be self-approved by the Chief no matter how high the dial. The Chief
  cannot raise its own ceiling.
- **Propose, don't act.** The Chief and every Helper reach the outside world and the platform's
  own surfaces only through MCP, and side-effecting tools **propose** — the gate decides. There
  is no path for an agent to perform a consequential action by calling a tool directly. See
  [`../technical/05-mcp-surfaces.md`](../technical/05-mcp-surfaces.md).
- **Least privilege.** Each Helper (and the Chief) sees only the connectors, folders, and skills
  it's been granted, scoped to the company. It can `request_access` for more — which is, again, a
  proposal the operator approves.

The result is a representative the operator can actually step back from: it plans and runs the
business, approves the small stuff so it doesn't pile up, brings the real decisions forward with
context, and stays inside a fence that only the operator can move — with a full paper trail the
whole way.

---

**Related:** [`goals.md`](goals.md) · [`autonomy.md`](autonomy.md) ·
[`inbox-approvals.md`](inbox-approvals.md) ·
[`routines.md`](routines.md) ·
[`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) ·
[`../technical/05-mcp-surfaces.md`](../technical/05-mcp-surfaces.md)
</content>
</invoke>
