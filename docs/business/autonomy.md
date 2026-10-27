# Autonomy — how much agents decide vs. ask

> Track: **business**. This is the **keystone** of the business track: it defines the single
> policy that decides, for every consequential action an agent wants to take, whether it
> **acts on its own, asks the Chief, asks the operator, or is refused outright**. Every other
> business doc that mentions "approval", "autonomy", "the dial", or "the gate" resolves to
> the rules here. The mechanism that executes this policy is the gate node in
> [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md); the
> propose-don't-act contract is in [`../technical/05-mcp-surfaces.md`](../technical/05-mcp-surfaces.md);
> the human side (what the operator sees and clicks) is in
> [`inbox-approvals.md`](./inbox-approvals.md); how the Chief plans and delegates is in
> [`chief-orchestration.md`](./chief-orchestration.md).

---

## 0. The mental model in one paragraph

The operator sets **Goals**. An AI **Chief of Staff** plans each Goal and delegates the work to
AI **Helpers**. Helpers never perform a consequential action by themselves — they **propose**,
and a single decision point (the **gate**) rules on every proposal. How the gate rules is
governed by one dial — **autonomy** — with three positions: **strict**, **ask**, **yolo**.
Autonomy is layered (workspace / Goal / Helper) and always resolves to the **strictest** layer
that applies. On top of autonomy sit **SafetyLimits** — hard caps (spend, messages, external
writes, deploys) the operator sets in the Control Panel. SafetyLimits **always win**: even at
`yolo`, a proposal that breaches a hard limit is **refused**. Everything is audited.

The dial answers "how much do I trust the agents to just do it?" The SafetyLimits answer
"regardless of trust, never cross these lines." Autonomy is a trust setting; SafetyLimits are
a circuit breaker.

---

## 1. What the three dial positions mean (operator's view)

The dial has a strict ordering: **`strict` < `ask` < `yolo`** (less autonomy → more autonomy).
This is the `Autonomy` enum in [`../technical/01-data-model.md`](../technical/01-data-model.md)
(`"strict" | "ask" | "yolo"`) and the `Autonomy` type in
[`../../src/app/store.ts`](../../src/app/store.ts).

### `strict` — "Show me everything before you touch the outside world."
- Helpers may **read**, **think**, **draft**, **recall** from the knowledge base, **checkpoint**,
  and **report** freely. None of that is consequential.
- **Any** side-effecting action — even a low-risk one like writing an internal doc or posting a
  routine brief — becomes a **proposal to the operator**. The Chief may *prepare* and *stage* it
  but may **not** approve it on the operator's behalf.
- Nothing leaves the workspace or changes shared state without a human click.
- Use when: onboarding a new workspace, a sensitive Goal, or an operator who wants to watch the
  agents learn before loosening the reins.

### `ask` — "Handle the routine stuff; ask me when it matters." (the default)
- **Low-risk** actions are carried out and **logged** (the Chief auto-approves on your behalf).
- **Medium- and high-risk** actions become **proposals** — routed first to the **Chief**, who
  may approve the medium ones on your behalf within policy; **high-risk** always reaches **you**.
- This is the shipped workspace default (`Company.autonomy_default = "ask"`, and the store's
  initial `autonomy: 'ask'`).
- Use when: a trusted, steady-state workspace. Most companies live here.

### `yolo` — "Run the business; only stop for the hard limits."
- The Chief **auto-approves low- and medium-risk** actions on your behalf and logs them.
- **High-risk** actions are auto-approved **too** — *unless* a SafetyLimit or a `deploy`/`spend`
  hard cap intervenes, in which case they are **refused** (never silently executed). The
  operator's control over dangerous actions at `yolo` is the SafetyLimits they set in advance,
  not per-action approval. See §4 for the exact high-risk rule.
- Helpers behave like empowered employees: they send, publish, spend, and write within the
  guardrails without waiting on a human.
- Use when: a mature workspace with well-tuned SafetyLimits and a Chief the operator trusts.
  **`yolo` is only safe because SafetyLimits are the backstop** (see §6).

> Plain-language summary: **strict** = "ask me about *everything* external." **ask** = "ask me
> about the *important* things." **yolo** = "only the *hard limits* can stop you."

---

## 2. The layering rule — strictest wins

Autonomy is not a single global switch. Three layers can each set a position; the effective
autonomy for any given action is the **strictest** of whichever layers are set:

```
effective_autonomy = min(workspace_default, goal_override, helper_cap)
```

where `min` is taken over the ordering **`strict`(0) < `ask`(1) < `yolo`(2)**, so `min` =
"the most restrictive." The three inputs:

| Layer | Field | Set where | Nullable? |
|---|---|---|---|
| Workspace default | `Company.autonomy_default` | Control Panel (store `autonomy`) | no — always set |
| Per-Goal override | `Goal.autonomy_override` | Goal editor | yes — null = inherit workspace |
| Per-Helper cap | `Helper.autonomy_cap` | Helper editor | yes (treated as the tightest the Helper may *ever* act at) |

Unset (null) layers **drop out** of the `min` — they neither raise nor lower the result. Only
layers that are actually set participate.

### Why a *cap* and not just another override
`Helper.autonomy_cap` is the **tightest a given Helper is allowed to act at**, regardless of how
permissive the workspace or Goal is. It can only ever *lower* effective autonomy, never raise
it. A junior or newly-hired Helper can be capped at `strict` so that even inside a `yolo`
workspace it still proposes everything. A Goal override, by contrast, can be set either looser
or tighter than the workspace — but because the result is a `min`, setting a Goal to `yolo`
inside an `ask` workspace **does not** make it `yolo`; the workspace still clamps it to `ask`.

### Worked resolutions

| workspace_default | goal_override | helper_cap | effective | why |
|---|---|---|---|---|
| `ask` | `yolo` | *(unset)* | **`ask`** | Goal can't exceed workspace; `min(ask, yolo) = ask` |
| `yolo` | *(unset)* | `strict` | **`strict`** | Helper cap clamps hardest; `min(yolo, strict) = strict` |
| `yolo` | `ask` | *(unset)* | **`ask`** | Goal tightens a loose workspace |
| `strict` | `yolo` | `yolo` | **`strict`** | Workspace is the floor; nothing loosens it |
| `ask` | `strict` | `yolo` | **`strict`** | Goal tightens; Helper cap irrelevant here |
| `yolo` | `yolo` | `yolo` | **`yolo`** | all three agree at the top |
| `ask` | *(unset)* | *(unset)* | **`ask`** | only workspace set → it wins by default |
| `yolo` | `ask` | `strict` | **`strict`** | strictest of the three |

**Rule of thumb:** autonomy only ever *ratchets down* as you add layers. No layer can make an
action more autonomous than the workspace default allows. **The strictest set layer wins,
always.** When in doubt, the system is biased toward asking, never toward acting.

---

## 3. The decision matrix (canonical)

This is **the** table. Other docs reference it by name as *the autonomy decision matrix*.

Given a pending action, the gate computes `effective_autonomy` (§2), reads the action's
**risk** (`low | medium | high`) and **proposal type** (§3.1), and returns exactly one of five
outcomes:

- **act-silently** — execute immediately, no Inbox noise (still written to `ToolCall`/`AuditEvent`).
- **act-and-log** — execute immediately **and** drop an `update` InboxItem so the operator can see it after the fact.
- **propose-to-chief** — create a `Proposal`; the **Chief** may approve on the operator's behalf (per §4).
- **propose-to-operator** — create a `Proposal` + a `decision` InboxItem that **blocks** until a human decides. The Chief may prepare but **not** approve.
- **refuse** — hard `SafetyLimit` breach; never executed; surfaced as a `failure`/`alert` InboxItem.

In gate terms (from [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md)),
`decide(...) → allowed` covers *act-silently* and *act-and-log*; `→ needs_owner` covers
*propose-to-chief* and *propose-to-operator*; `→ refused` covers *refuse*.

### 3.1 Proposal-type → risk-band grouping

Every action maps to a `ProposalType`. Types are grouped into risk bands as the **default** risk
the gate assumes when the Helper doesn't estimate otherwise. An individual action can be rated
higher by the worker (e.g. a `message` to a VIP, a large `spend`); the matrix is read at the
**actual** risk of the action, using the type only to pick a sensible default band.

| ProposalType | Default band | Notes |
|---|---|---|
| `message` (internal note, team chat) | low | post into Job/Session thread, peer chat |
| `doc_write` | low | Docs vault write; internal only |
| `message` (external — WhatsApp/email/Slack to outsiders) | medium | counts against `messages_day` |
| `spend` (small, under daily cap) | medium | any credit/currency outflow |
| `external_write` | medium | writing to a connected system (CRM, repo issue, sheet) |
| `flow_publish` | medium | publishing an automation that will act repeatedly |
| `connector_access` (filed via the `request_access` tool) | medium | granting a Helper a new connector/folder/skill |
| `settings_change` | high | changing workspace configuration, autonomy, limits |
| `skill_publish` | high | a self-authored skill that other Helpers will run |
| `deploy` | high | shipping code / infra changes |
| `spend` (large, near/over a cap) | high | re-rated up by amount; gated by `spend_*` limits |
| `other` | medium | unknown → treated as medium (bias to asking) |

### 3.2 The matrix

Rows are **(risk × representative proposal types)**; columns are the three dial positions.
Read the row by the action's **actual risk**; the type examples show what typically lands there.

| Risk | Representative types | `strict` | `ask` | `yolo` |
|---|---|---|---|---|
| **low** | internal `message`, `doc_write`, `checkpoint`, routine brief post | **propose-to-operator** | **act-and-log** | **act-silently** |
| **medium** | external `message`, small `spend`, `external_write`, `flow_publish`, `connector_access` | **propose-to-operator** | **propose-to-chief** | **act-and-log** |
| **high** | `deploy`, `settings_change`, `skill_publish`, large `spend` | **propose-to-operator** | **propose-to-operator** | **act-and-log**¹ |
| **any** | any type that breaches a hard `SafetyLimit` | **refuse** | **refuse** | **refuse** |

¹ **High-risk under `yolo` is auto-approved by the Chief and logged** — `yolo` means "run the
business; only the hard limits stop you." The backstop is the **`SafetyLimit`** row below it: any
high-risk action that touches a governed kind (`deploy`, `external_write`, `spend_*`,
`messages_day`) is evaluated against the hard cap **first** and **refused** on breach, never
silently executed. So the operator controls genuinely dangerous actions under `yolo` by setting
SafetyLimits (e.g. `spend_day`, a zero-cap on `deploy`), **not** by per-action approval. See §4
for the precise statement. The implication: **`yolo` is only as safe as your SafetyLimits** — set
them deliberately before turning the dial up.

**Reading the matrix down a column:**
- **`strict` column:** every consequential action is *propose-to-operator*; nothing is
  auto-approved, by anyone, for any reason — except the always-row, which refuses.
- **`ask` column:** low-risk is handled and logged; medium-risk goes to the Chief; high-risk
  reaches the operator. This is the "ask me when it matters" shape.
- **`yolo` column:** everything the Chief is permitted to do is handled (low silent, medium and
  high logged); the **only** thing that can pause or stop an action is a hard `SafetyLimit`
  breach. There is no per-action human gate under `yolo` — the guardrail is entirely the
  SafetyLimit envelope.

**Reading the matrix across a row:** as the dial loosens left→right, each cell moves *up* the
escalation ladder (operator → chief → log → silent), never down. No cell ever becomes *stricter*
as autonomy increases. The `refuse` row is invariant across all columns — autonomy cannot buy
past a hard limit.

---

## 4. "Approve on behalf" — how the Chief fits

The Chief of Staff is the operator's **representative** inside the loop (`Helper.is_chief = true`,
exactly one per company). "Chief auto-approves on the operator's behalf" is what makes the
`allowed` and *propose-to-chief* outcomes move without a human click. The exact rule:

1. **Under `strict`:** the Chief **never** approves on the operator's behalf. It may draft,
   stage, and annotate a proposal, but the decision edge belongs to the human. Every
   consequential action is *propose-to-operator*.

2. **Under `ask`:** the Chief approves **low-risk** silently-logged work implicitly (it was never
   a proposal) and approves **medium-risk** proposals on the operator's behalf
   (*propose-to-chief* → the Chief decides). **High-risk** always escalates to the operator —
   the Chief cannot self-authorize a deploy, a settings change, a skill publish, or a large spend.

3. **Under `yolo`:** the Chief approves the **full range** — low, medium, **and high-risk** —
   on the operator's behalf, without asking. The exact rule:

   > **High-risk under `yolo` is auto-approved by the Chief and logged** (an `update` InboxItem
   > records it after the fact). The sole backstop is the **SafetyLimit**: the gate evaluates any
   > hard cap (`spend_day`, `spend_month`, `messages_day`, `external_write`, `deploy`) **before**
   > honoring the Chief's approval, and **refuses** the action on breach. The Chief's mandate never
   > overrides a SafetyLimit.

   In other words, `yolo` is genuinely hands-off — "set a goal, touch nothing." The operator does
   not gate individual high-risk actions; instead they constrain them **up front** by setting
   SafetyLimits (e.g. a daily spend cap, a zero-cap on `deploy`, a `messages_day` ceiling).
   Within that envelope the Chief acts as a fully empowered representative; outside it, nothing
   executes. **This is why SafetyLimits must be set deliberately before a workspace moves to
   `yolo`.**

4. **SafetyLimits are the backstop in every case above.** The Chief's "approve on behalf" power
   is strictly *inside* the SafetyLimit envelope. The gate always evaluates the hard limit before
   honoring any approval — human or Chief. A proposal the Chief would happily approve is still
   *refused* if it would push the day over `spend_day`, the message count over `messages_day`, or
   if `external_write`/`deploy` is capped at zero.

The Chief's decisions are recorded with `decided_by = "chief"` on the `Proposal`; the operator's
with `decided_by = "operator:usr_…"`. Both are auditable and reversible-by-policy; nothing the
Chief approves is hidden from the Activity log.

---

## 5. Where each dial is set, and who can change it

| Dial | Field | UI location | Who may change it |
|---|---|---|---|
| Workspace default | `Company.autonomy_default` | Control Panel → **Autonomy** (store `setAutonomy`) | **owner / admin** |
| Per-Goal override | `Goal.autonomy_override` | Goal editor → Autonomy field | **owner / admin** (member may propose) |
| Per-Helper cap | `Helper.autonomy_cap` | Helper editor → "Acts at most at…" | **owner / admin** |
| SafetyLimits (hard caps) | `SafetyLimit` rows | Control Panel → **Safety & limits** | **owner** only |

Under `yolo` the Chief approves high-risk actions too, so **SafetyLimits are the operator's only
control over dangerous actions** at that dial — which is why they are owner-only and why the UI
should prompt the operator to review them when switching a workspace to `yolo`.

Roles are the `MemberRole` enum (`owner | admin | member`) from the data model. Members can
**view** the dials and **propose** changes (a `settings_change` proposal, which is high-risk and
therefore routes to an admin/owner), but cannot flip them directly. The workspace autonomy value
is the one persisted in the UI store (`store.ts`, `autonomy`), surfaced in the Control Panel; the
Goal and Helper fields live on their respective records per the data model.

> A `settings_change` that would *loosen* autonomy or *raise* a SafetyLimit is itself high-risk
> and must be decided by a human owner/admin — the agents can never autonomously widen their own
> mandate. This closes the obvious loophole: no Helper, and not the Chief, can propose-and-approve
> its way to more power.

---

## 6. Hard limits and the backstop

`SafetyLimit` (Control Panel → **Safety & limits**) is a set of **hard caps** that the gate
enforces **regardless of autonomy**. Kinds (from the data model): `spend_day`, `spend_month`,
`messages_day`, `external_write`, `deploy`; each has a `value`, a `scope`
(`workspace | channel | helper`), and a `block_or_warn` mode.

- **Refuse regardless of autonomy.** Even at `yolo`, an action that would breach a `block`-mode
  SafetyLimit returns `refused` from the gate. There is no dial position, and no Chief approval,
  that executes a refused action. This is the invariant last row of the decision matrix (§3.2).
- **`warn` mode** does not block: the action proceeds but a `warn`-level `alert` InboxItem is
  raised and the breach is flagged in Activity. Use `warn` for soft ceilings you want visibility
  on; use `block` for lines that must never be crossed.
- **Budgets pause helpers.** Beyond the named SafetyLimits, a Helper's monthly credit budget
  (`Helper.budget_credits_month`) and the per-company concurrency ceiling are enforced by the
  gate/runner: when a Helper exceeds its budget it is **paused** (no new consequential work)
  until the operator tops up or the window resets. This is a resource guard, complementary to the
  risk/autonomy policy.
- **Everything is audited.** Every gate decision writes a `ToolCall`
  (`decision ∈ {allowed, proposal, refused, error}`) and, for consequential outcomes, an
  `AuditEvent`. Approvals (human or Chief) are stamped on the `Proposal`. The operator can
  reconstruct, after the fact, exactly what was done, by whom, under which autonomy, and why it
  was or wasn't gated. Autonomy decides *how much gets asked*; the audit trail guarantees
  *nothing is invisible*.

The design intent: **autonomy is a convenience dial; SafetyLimits are the safety floor.** You can
turn the convenience all the way up (`yolo`) and still sleep, because the floor doesn't move.

---

## 7. Worked scenarios

### (a) A `yolo` Goal sending WhatsApp messages, hitting `messages_day`
- Workspace `yolo`, Goal override unset, Helper "Support" cap unset → **effective = `yolo`**.
- A support Helper drafts outbound WhatsApp replies. Each is an **external `message`, medium
  risk**. Per the matrix, medium @ `yolo` = **act-and-log** → the Chief auto-approves, messages
  send, each drops an `update` InboxItem and increments the `messages_day` counter.
- Message #50 would cross the `messages_day = 50` hard cap (`block` mode). The gate evaluates the
  SafetyLimit **before** honoring the autonomy decision and returns **refused** for #50 and
  onward. A `failure`/`alert` InboxItem is raised: *"Daily message limit reached — 12 replies
  held."* The held drafts wait; the operator can raise the cap (an owner-only `settings_change`)
  or let them resume at the next daily reset.
- **Takeaway:** `yolo` did not buy past the hard cap. The dial governed the first 49; the
  SafetyLimit governed the 50th.

### (b) A `strict` Goal where even a low-risk doc write is proposed
- Workspace `ask`, but this Goal has `autonomy_override = "strict"` → `min(ask, strict) =`
  **effective = `strict`**.
- A Helper finishes research and wants to write an **internal `doc_write`, low risk** — the most
  benign consequential action there is. Per the matrix, low @ `strict` = **propose-to-operator**.
- The Chief may *prepare* the doc (staged as a `DocVersion` with `version = 0`, a *suggestion*)
  but may **not** publish it. A `decision` InboxItem blocks: *"Dev wants to save 'Q3 Research
  Notes' to Docs — approve?"* The graph `interrupt()`s and waits.
- The operator approves; an `execution` Job carries out the write; `decided_by = operator:usr_…`.
- **Takeaway:** under `strict`, *nothing* external happens without a human click — not even an
  internal doc. The Goal override tightened a looser workspace, exactly as the `min` dictates.

### (c) An `ask` Goal where a routine brief posts silently but a `$` disbursement escalates
- Workspace `ask`, Goal override unset, Finance Helper cap unset → **effective = `ask`**.
- Morning routine fires: the Helper composes the daily ops brief and posts it to the team chat —
  an **internal `message`, low risk**. Per the matrix, low @ `ask` = **act-and-log** → it posts
  immediately and appears as an `update` in the Inbox. No human was needed.
- Later the same Helper proposes a **`spend`** — a supplier disbursement of a non-trivial amount.
  The worker rates it **high** (large spend near a cap). Per the matrix, high @ `ask` =
  **propose-to-operator**. Even though the brief flowed freely, the money **stops** for a human:
  a blocking `decision` InboxItem, *"Finance wants to disburse to Supplier X — approve?"* The
  Chief cannot self-authorize it at `ask`.
- **Takeaway:** the same dial position treats a brief and a disbursement completely differently —
  because the matrix reads **risk**, not just the dial. `ask` means *ask me when it matters*, and
  money matters.

---

## 8. Invariants (quick reference for other docs)

1. **Ordering:** `strict < ask < yolo`. Autonomy is a total order; `min` = strictest.
2. **Layering:** `effective = min(workspace_default, goal_override, helper_cap)` over set layers;
   unset layers drop out; the result only ever *ratchets down*.
3. **Helper cap is a ceiling, never a floor** — it can only lower effective autonomy.
4. **The decision matrix (§3.2) is canonical.** Read it at the action's *actual* risk.
5. **Chief approves on behalf only within policy:** never under `strict`; medium under `ask`
   (high escalates to the operator); low+medium+**high** under `yolo`, bounded only by
   SafetyLimits.
6. **SafetyLimits always win** — `block`-mode breach = `refused` at any autonomy, overriding any
   approval. Budgets pause helpers.
7. **Agents can't widen their own mandate:** loosening autonomy or raising a limit is a high-risk
   `settings_change` decided only by a human owner/admin.
8. **Everything is audited** — `ToolCall`, `AuditEvent`, and the `Proposal.decided_by` stamp.

---

### See also
- [`inbox-approvals.md`](./inbox-approvals.md) — what the operator sees and clicks when a proposal reaches them.
- [`chief-orchestration.md`](./chief-orchestration.md) — how the Chief plans Goals and delegates to Helpers (the layer that *generates* the actions this policy gates).
- [`../technical/03-agent-loop-engine.md`](../technical/03-agent-loop-engine.md) — the gate node that executes `decide(effective_autonomy, risk, type, safety)`.
- [`../technical/05-mcp-surfaces.md`](../technical/05-mcp-surfaces.md) — propose-don't-act: `request_action` / `propose` and the one-time execution token.
- [`../technical/01-data-model.md`](../technical/01-data-model.md) — `SafetyLimit`, `Proposal`, `Helper.autonomy_cap`, `Goal.autonomy_override`, `Company.autonomy_default`.
