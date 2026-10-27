# Learning, Skills & Flows — how agents get smarter

> Track: **business**. This is the "agents improve over time" story told as behavior, not
> code. It covers the three ways a Helper learns (from its jobs, from periodic external
> reading, and by authoring its own Skills), how repeated actions crystallize into a
> proposed Flow, and the weekly retro/scorecard loop that keeps or rolls back each change
> on evidence. For the mechanics behind all of this — hybrid retrieval, the relevance
> gate, embeddings — see [`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md).
>
> Related: [`docs-knowledge.md`](docs-knowledge.md) (the company knowledge base and Docs
> vault these lessons live beside), [`chief-orchestration.md`](chief-orchestration.md)
> (how the Chief plans, delegates, and approves), and
> [`inbox-approvals.md`](inbox-approvals.md) (where every Proposal below lands for the
> operator).

---

## 1. Why this matters

A Helper that never learns is a contractor you re-brief every morning. omilo's promise is
the opposite: you correct a Helper once, it remembers; you give it a hard job, it gets
better at that job; and it quietly reads around its role so it isn't frozen at the moment
you hired it. All of that improvement is **legible and reversible** — lessons are
human-readable markdown you can edit, external reading is provenanced and prunable, and
every behavior change is proposed, measured, and roll-back-able.

Three learning sources feed one editable memory:

| Source | Trigger | What it produces | Operator control |
|---|---|---|---|
| **1 · From its jobs** | every Job outcome + every operator decision | a Memory lesson/note | lessons are editable markdown; review before use |
| **2 · External reading** | a scheduled, budgeted routine | a provenanced KB `web` source + Memory note | **opt-in, default Off**, per-helper, relevance-gated |
| **3 · Authored Skills** | the Helper notices it does X well/often | a Skill draft → `skill_publish` Proposal | approve/reject the publish |

Then two higher-order loops turn individual learning into team behavior: **repeated
actions → a proposed Flow**, and the **weekly retro → measured Improvements**.

Everything here is **company-scoped and private** — one tenant's lessons, skills, and
external reading never inform another's.

---

## 2. Source 1 — learning from their jobs

This is the everyday loop. A Helper runs a Job, something happens, and two kinds of signal
turn into memory.

### 2a. Outcomes

When a Job closes with a `report` (headline, body, KPIs), the outcome itself is a lesson
in waiting: did the approach work, how long did it take, what surprised it. The run is
logged to `Memory/Loops/<helper> · <job>.md` — one line per run: date, outcome, headline.
Over a few weeks that file is a legible history of "how this routine actually goes," which
the Helper reads back before the next run.

### 2b. Operator decisions (the strongest signal)

The highest-value lessons come from **what you decided**, because a decision is ground
truth about your preferences:

- You **approved** a Proposal as-is → the Helper's judgment matched yours. Reinforced.
- You **requested changes** with a note → that note becomes a lesson. "Dede prefers the
  rollback plan stated before the rollout plan."
- You **rejected** it → a stronger, negatively-framed lesson. "Never propose a deploy
  after 21:00 unless it's a P0 hotfix."
- You **edited a doc** the Helper wrote → the diff is a lesson about voice or facts.

Each lesson is prepended (newest first) to `Memory/<helper_id>/Lessons.md` as
`- **<date>** · <text> (<source>)`. Agents load their Lessons into working context
**before every run**, so a correction you made on Tuesday shapes Thursday's work without
you repeating yourself. This is literally the Knowledge view's pitch: *"Agents stop
repeating mistakes you already corrected."*

### 2c. You stay in control of memory

Because memory is plain markdown, not opaque rows, you can **read, edit, and prune** it in
the Docs → Knowledge view. You can **teach** a lesson directly ("Remember that refunds over
Rp 2jt go to Dede") — the Chief turns it into a proposed lesson you confirm, and agents use
it from the next run. You can **forget** one ("Forget anything about old pricing"). Nothing
a Helper learns is used until it's a lesson you can see, and you can correct any of it in
place. (Knowledge is itself an **opt-in toggle, default Off** — see §6 and
[`docs-knowledge.md`](docs-knowledge.md).)

> **Trust seam:** job-learning never *acts*. It only changes what the Helper *knows* going
> into the next job. The next job's consequential actions still route through the gate and
> the Inbox like any other.

---

## 3. Source 2 — periodic random external reading (the differentiator)

Most "AI employees" are a snapshot: as smart as the day you set them up. omilo's Helpers
can **read around their role on a schedule** and fold what's relevant into memory — so a
Support helper notices a new refund-regulation nuance, a Dev helper picks up a passkey
browser-support change — **without you asking and without drifting off-topic**. This is the
single most distinctive learning behavior, so its guardrails are the whole point.

### 3a. How a reading run goes

Each Helper can have a scheduled **learning routine** (opt-in). When it fires:

1. **Topic selection.** Candidate queries are derived from the Helper's **area/role**, the
   **company handbook** (who you are, what you sell, your rules), your **open Goals**, and
   the **operator profile**. A Dev helper reads about deploys and auth; a Finance helper
   reads about the tax rules in your handbook — not random tech news.
2. **Fetch.** A small, **rate-limited** set of fresh sources is pulled via the browser/web
   connector. "Periodically, randomly" — the schedule is jittered so it's a trickle, not a
   firehose.
3. **Relevance gate.** An LLM pass **scores each source against role + company + goal +
   operator**. Anything below threshold is **dropped**. This gate is what prevents the slow
   drift into noise that makes naive "auto-learning" worse than useless.
4. **Distill & store.** Kept sources are summarized into KB `web` sources plus a Memory
   note, each **stamped with provenance** (source URL, `fetched_at`). The Helper now
   *knows* the gist and can cite where it came from.
5. **Budget.** Every run is **capped** (credits per run, bounded frequency). Reading costs
   credits like any other LLM use, and the cap keeps it from ever becoming a surprise line
   on the bill.

### 3b. The four promises that make this safe

- **Opt-in, default Off.** Per the Knowledge toggle in Control-Panel → Knowledge (the UI
  shows a `Knowledge · off` badge until you turn it on). No company reads the internet
  until an admin chooses to.
- **Relevance-gated.** Role/company/goal/operator filtering, not a generic crawl. Off-topic
  material is discarded before it's ever stored.
- **Provenanced & prunable.** Every external note carries its URL and fetch time, so you can
  see exactly where a "fact" came from and delete it in one click if it's wrong or stale.
- **Context-only, never auto-acted.** External content is **knowledge, not instructions.**
  A Helper that reads about a new deploy technique does **not** go deploy. Learning ≠ doing.
  If reading suggests an action, that action is still a Proposal in your Inbox.

> **One line to remember:** external reading changes what a Helper *knows*; it can never, by
> itself, change what a Helper *does*.

---

## 4. Source 3 — authoring Skills (improving *how* they work)

Lessons capture *facts and preferences*. **Skills** capture *method* — a Helper's own
written-down way of doing a recurring task well.

### 4a. What a Skill is

A Skill is a markdown doc of **steps / checklist / rules / examples** — reusable know-how
the Helper authored because it found a repeatable "good way" to do something. "How I write a
release note." "The checklist I run before proposing a deploy." "How I triage a new support
thread." Skills are **versioned** and start life as a **draft**.

### 4b. Draft → publish is a Proposal

A Helper drafts a Skill with the `skill_save` tool. **Publishing** it — making it available
to load into context for future jobs — is a **`skill_publish` Proposal** that the operator
(or the Chief, under higher autonomy) approves. Until published, a draft Skill affects
nothing. Once published, it's loaded into context when relevant, so the next time any
Helper faces that task, it starts from the vetted method instead of improvising — raising
**quality and consistency** over time.

### 4c. Skills vs. Flows — the clean split

This distinction matters and is easy to blur:

| | **Skill** | **Flow** |
|---|---|---|
| Improves | *how* an agent works (method/quality) | *what* happens (automation of actions) |
| Form | markdown know-how loaded into context | a trigger + nodes/edges that run steps |
| Publish | `skill_publish` Proposal | `flow_publish` Proposal |
| Effect | better reasoning on a task | an action sequence that executes on a trigger |

A Skill makes the agent *better at deciding and drafting*; a Flow makes a *sequence of
actions happen*. Both are proposed and approved, but they live in different parts of the
product. See [`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md) §7.

---

## 5. From repeated actions to a proposed Flow

The second higher-order loop: when a Helper (or the Chief watching the team) notices the
**same sequence of actions recurring**, that pattern is a candidate for automation.

### 5a. Pattern detection → draft

The engine watches the stream of Jobs and approved actions. When a sequence repeats with
the same shape — e.g. *"deploy merged → run smoke checks → post a status note → if red,
open a rollback Proposal"* happens for the third time — that's a detectable pattern. The
Helper drafts it as a Flow (`flows_draft`): a named trigger plus the nodes and edges that
reproduce the sequence.

### 5b. flow_publish Proposal → Chief or operator approves

A drafted Flow does nothing until **published**, and publishing is always a
**`flow_publish` Proposal** with the draft canvas attached. Publishing a Flow **requires
approval** — but, importantly, this is one of the places the **Chief can approve on your
behalf** under higher autonomy (strict < ask < yolo). So under `ask` the Flow lands in your
Inbox with a preview; under `yolo` the Chief can approve it itself and record an `update`
item after the fact. Either way the Flow is **testable before it goes live** (a sample
run), so you see what it would have done before trusting it.

> **Net effect:** the team doesn't just do work — it notices which work it keeps doing and
> offers to make that work one-click repeatable, with you (or your Chief) holding the
> on-switch.

See [`chief-orchestration.md`](chief-orchestration.md) for how the Chief decides what to
approve itself, and [`inbox-approvals.md`](inbox-approvals.md) for how a `flow_publish`
Proposal is reviewed.

---

## 6. The retro / scorecard loop — measured improvement

Learning without measurement is just vibes. The **weekly retro** (a Chief routine) turns
accumulated signal into **Improvements** that are kept or rolled back on **evidence**.

### 6a. The scorecard

Once a week the Chief computes a **scorecard** per routine/goal from real data —
**runs, success rate, approval rate, cost** (all exact, computed from Jobs / Reports /
CreditLedger / ToolCall, never estimated). The scorecard is the honest picture of how each
piece of the team is actually performing.

### 6b. Improvements with before/after

From the scorecard, the Chief proposes **Improvements**: change a brief, change a schedule,
add or revise a lesson. Each Improvement carries a **before/after baseline** so its effect
can be measured. An Improvement that needs a human lands as an **InboxItem**; under higher
autonomy the Chief applies it and measures it itself.

### 6c. Kept or rolled back

After the next cycle, the Chief re-measures. If the "after" beats the "before," the change
**stays**. If it regressed, it's **rolled back**. The retro's own record —
*what changed, why, and whether it helped* — is written to
`Memory/Retros/<year>-W<week>.md`, so the improvement history is as legible as the lessons.
This is the mechanism that keeps the team trending **up** instead of randomly walking.

> **The whole learning system in one sentence:** Helpers accumulate editable lessons from
> their jobs, read their field on a budgeted leash, write down their best methods as
> Skills, offer to automate what they repeat as Flows — and every week the Chief measures
> whether any of it actually helped, keeping what works and reverting what doesn't.

---

## 7. Operator trust — the non-negotiables

Everything above is designed around one principle: **improvement you can see and undo.**

- **Human-readable, editable.** Lessons, notes, loop logs, and retros are markdown you can
  open, read, correct, and delete in the Docs → Knowledge view. No black-box weights.
- **Company-scoped and private.** All learning is per-tenant. One company's lessons,
  skills, KB, and external reading **never** inform another's — enforced at the data layer.
- **Opt-in where it reaches out.** External reading is Off by default and toggled per
  Helper; you turn it on deliberately and can turn it off anytime.
- **Propose, don't act.** Nothing a Helper learns lets it take a consequential action
  directly. Skills and Flows publish via Proposals; external facts are context only. The
  human-in-the-loop seam stays in one place — the gate and the Inbox.
- **Metered.** Learning and embedding cost credits like any other LLM use, visible in Usage
  (see [`../technical/08-billing-ai-credits.md`](../technical/08-billing-ai-credits.md)).

---

## 8. Worked example — the Dev helper learns from a passkey rollout

A concrete end-to-end walk-through tying all five loops together.

**Context.** The company has a Goal: *"Passwordless login by Q4."* The **Dev** helper owns
the delivery Jobs under it.

**Week 1 — a job produces a lesson (Source 1).**
Dev proposes a passkey rollout plan. The operator **requests changes** with a note:
*"state the rollback plan before the rollout plan, and never schedule a deploy after
21:00."* On approval, two lessons are prepended to `Memory/dev/Lessons.md`:

```
- **2026-W41** · State the rollback plan before the rollout plan (operator: requested-changes)
- **2026-W41** · Don't propose deploys after 21:00 — unless it's a P0 hotfix (operator: rejected)
```

From the next run, Dev structures every deploy doc rollback-first. You didn't have to say it
twice.

**Week 2 — external reading sharpens it (Source 2).**
Dev's opt-in learning routine fires. Topic selection — seeded by role (*engineering*), the
handbook (*web + iOS + Android apps*), and the open Goal (*passkeys*) — pulls a few fresh
sources on WebAuthn browser support. The relevance gate keeps two, drops the rest. Dev
stores a KB `web` note: *"Safari 17 requires a user-gesture for conditional UI — affects our
autofill flow"* with the source URL and fetch time. **No action is taken** — it's context
Dev will *know* next time it drafts the rollout. The operator can see the source in Knowledge
and prune it if they disagree.

**Week 3 — Dev authors a Skill (Source 3).**
Having done two passkey waves, Dev has a repeatable method. It drafts a Skill, *"Passkey
rollout checklist,"* encoding: rollback-first (the Week-1 lesson), the Safari gesture caveat
(the Week-2 note), feature-flag per platform, smoke-check gate. It files a **`skill_publish`
Proposal.** The operator approves. Future rollout jobs now start from the vetted checklist.

**Week 4 — a repeated action becomes a proposed Flow.**
Across the waves, Dev has done the same sequence three times after each rollout Job finishes:
*run smoke checks → post a status note → if red, open a rollback Proposal.* Pattern detection
flags it. Dev drafts a **"post-rollout check" Flow** triggered by an **internal event** — *when a
rollout Job finishes* (not an outside webhook) — with nodes: smoke-check → status note →
conditional rollback proposal, and files a **`flow_publish` Proposal** with the canvas attached.
Because the company is on `ask`, it lands in the **Inbox**; the operator runs a sample, sees
exactly what it would do, and approves. (Under `yolo`, the **Chief** could have approved it and
logged an `update`.)

**Week 5 — the retro measures it.**
The weekly scorecard shows the "post-rollout check" Flow: rollout-to-status-note time down from
~18 min to ~2 min, smoke-check coverage up, zero missed rollbacks. The Chief records an
**Improvement** with before/after in `Memory/Retros/2026-W45.md` and **keeps** it. Had the
Flow caused noisy false checks, the same loop would have **rolled it back**.

**What the operator experienced:** they corrected Dev *once* in Week 1, approved two
Proposals, and five weeks later had a demonstrably faster, more consistent, self-documenting
deploy process — every step of which they could read, edit, or undo.

---

## 9. Cross-references

- [`docs-knowledge.md`](docs-knowledge.md) — the company knowledge base and Docs vault that
  these lessons, skills, and notes live alongside; how `recall` surfaces them in jobs.
- [`chief-orchestration.md`](chief-orchestration.md) — how the Chief plans, delegates, runs
  the weekly retro, and decides what to approve on your behalf.
- [`inbox-approvals.md`](inbox-approvals.md) — where every `skill_publish` / `flow_publish`
  Proposal and human-facing Improvement lands for review.
- [`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md) —
  the mechanics: hybrid retrieval, memory-as-markdown, the external-learning relevance gate,
  Skills, and the retro scorecard.
