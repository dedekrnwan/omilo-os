# Subscription Plans & AI Credits

> Track: **business**. How omilo makes money, what a credit is in plain language, what each plan
> tier includes, how cloud differs from self-host, and what happens when a company runs out of
> credits mid-month. This is the *behavior* doc; the formulas, the pluggable `PaymentProvider`
> port, ledger, and build phases live in
> [`../technical/08-billing-ai-credits.md`](../technical/08-billing-ai-credits.md)
> and [`../technical/01-data-model.md`](../technical/01-data-model.md). Who's allowed to touch
> billing is in [`teams-members-roles.md`](teams-members-roles.md).
>
> **Note on payments:** the plan + credit model here is **fully designed and provider-independent**.
> The actual **payment processor is undecided and optional** — omilo can run on **manual/offline
> billing** (admin-provisioned plans, out-of-band invoices) and plug in a provider (Stripe /
> Xendit / Midtrans / Paddle) later behind the `PaymentProvider` port, with no change to anything
> below. Treat every mention of charging/invoicing as "via the provider *if wired*, else offline."

---

## 1. Two revenue streams

omilo is open-source (ELv2) and monetized two ways — **and only the cloud path has both**:

1. **Subscription fee.** A monthly `Plan` the Company pays for: **seats** (human Members) +
   **included monthly credits** + **features**. This is the predictable, recurring number.
2. **AI-credit margin.** On the **cloud** path, Helpers consume **credits** as they work. omilo
   buys provider tokens (via litellm) at cost and sells credits at a markup. The **difference is
   the margin** — tracked on every ledger row, not a separate invoice line.

The split is deliberate:

| Path | Who pays the AI provider | Credits charged? | Revenue to omilo |
|---|---|---|---|
| **Cloud / litellm** | omilo (we carry provider cost) | **Yes** — metered with margin | Subscription **+** credit margin |
| **Claude Code pool** (subscription accounts) | the operator's own subscription | **No** (`credits_charged = 0`) | Subscription fee only |
| **BYO API keys** | the operator, directly to Anthropic/OpenAI | **No** (`credits_charged = 0`) | Subscription fee only (self-host: license only) |

> **The rule:** we only add a margin when *we* are paying for the tokens. If the operator brings
> their own capacity (a signed-in Claude Code account, a pooled subscription, or their own API
> key), there's **no credit margin** — just the subscription/license fee. Pool/BYO usage is
> still *metered* for the operator's own analytics (`provider_cost_usd` is recorded,
> informational), but it costs them 0 credits (`08` §9).

---

## 2. What a credit is (plain language)

A **credit** is omilo's own unit of AI work — deliberately **decoupled from any provider's
token price** so the operator sees a stable, predictable number even as model prices move
underneath. Think of it as "one small unit of helper effort." The onboarding copy frames it as
**"1 credit ≈ 1 helper step"** (`onboarding/data.ts`, cloud mode).

**How real usage becomes credits** (plain-language version of the formula in `08` §2):

> Every AI call reports its token usage. We turn that into a **real dollar cost** at the
> provider's price, multiply by a **margin** (our markup), and scale it into whole credits. The
> ledger stores **both** the true cost and the credits charged, so the operator sees credits and
> we can see margin exactly.

The exact formula (reference, `08` §2):

```
credits_charged = ceil( provider_cost_usd × MARGIN × CREDITS_PER_USD )
```

- `provider_cost_usd` — the real metered cost (litellm usage × provider price table).
- `MARGIN` — our markup multiplier, e.g. `1.4` ⇒ 40% gross margin *(illustrative, to be set by
  the business)*.
- `CREDITS_PER_USD` — a fixed display scale, e.g. `100 credits = $1 of included value`
  *(illustrative, to be set by the business)*.

Each charge appends one `CreditLedger` row (`reason: "job"`) carrying `delta` (negative),
`balance_after`, `provider_cost_usd`, `credits_charged`, and `{provider, model, tier}`.
Charging is **idempotent per job** — a Job is billed once even if it retries or resumes.

> **Illustrative numbers everywhere.** Every concrete credit amount, price, and margin below is a
> *placeholder, to be set by the business.* They exist to make the behavior legible.

---

## 3. Plan tiers (free → enterprise)

The canonical enum is `PlanTier = free | starter | growth | scale | enterprise` (`01` §1). Each
`Plan` row carries `monthly_price_usd`, `included_credits`, `credit_overage_usd`, `seats`, and a
`features` jsonb. **What varies across tiers:** seats, included credits, and which features
unlock. *(The onboarding UI currently labels tiers "Starter / Team / Business"; treat those
labels as illustrative — the stored tiers are the enum above.)*

| Tier | Seats | Included credits / mo | Headline features | Overage default |
|---|---|---|---|---|
| **free** | 1 | small starter grant (e.g. ~1,000) | Chief + 1 Helper, docs & chat, limited runs | hard (protect us from free abuse) |
| **starter** | ~5 | moderate (e.g. $20-of-value worth) | All Helpers & flows, Knowledge (pgvector), email support | soft |
| **growth** | ~25 | larger | Everything in starter, Google domain sign-in, longer activity log, priority support | soft |
| **scale** | more | large | Higher caps, more concurrency, advanced analytics | soft |
| **enterprise** | custom | custom | SSO/SLA, custom contracts, optional per-tenant isolation/keys | negotiated |

*(All seat counts, credit amounts, and feature placements above are illustrative, to be set by
the business.)* Grounding from the product:

- Onboarding free offer: **"Start with 1,000 free credits · about 2 weeks for a small team · no
  card needed"** (`onboarding/data.ts`).
- Onboarding monthly chips: **"Starter · 5k credits / Team · 20k credits / Scale · 60k
  credits."**
- Plan cards (`ChoosePlanPage`): free = "1 seat, Chief + 1 agent, 100 runs a month"; Team = "5
  seats, all agents & flows, Knowledge, $20 AI credit every month"; Business = "25 seats, Google
  domain sign-in, 1-year activity log."

On **subscription renewal**, omilo grants `plan.included_credits` as a ledger row
(`reason: "subscription_grant"`) — triggered by the payment provider's payment-success event
*when one is wired*, or by omilo's own internal renewal when billing offline/manually. Changing
plans (`POST /v1/billing/change-plan`) adjusts seats + the included-credit grant immediately, and
(if a provider is configured) prorates the charge through it (`08` §6). **No payment processor is
required for any of this** — the plan + credit model is provider-independent.

---

## 4. Cloud vs self-host

The onboarding "Your AI" step forks the whole money model via `Company.edition`:

- **Cloud** (`edition = cloud`): omilo runs the Helpers 24/7, carries provider cost, and bills
  **subscription + credit margin**. Collection is handled by the configured payment provider
  **if one is wired** — otherwise the company is billed **offline/manually** (early customers,
  invoice-me deals) while every other part of the model (plans, credits, metering, overage)
  works unchanged. This is where everything in this doc applies. Copy: *"Helpers keep working
  24/7, even when your computer is off… every job uses omilo credits; you'll see the balance in
  Billing."*
- **Self-host** (`edition = self_host`): the open-source binary runs on the operator's own
  machine/infra with **their own AI** (signed-in Claude Code, a pooled subscription, or BYO
  keys). Behavior (`07` §6, `08` §9):
  - **No credit margin** — the operator pays their provider directly; `credits_charged = 0`.
  - **No payment provider** — billing is a no-op; the subscription/license fee is handled
    **out-of-band** (license). The plan cards even say *"Self-hosting? The open-source version
    needs no plan."*
  - **Metering still runs** for the operator's *own* analytics (true cost is recorded, nothing
    is charged).
  - Same binary, same code path (RLS stays on with one satisfied tenant) — the ELv2 edition
    split is **config + packaging, not a fork** (`07` §6, see
    [`../integrations/README.md`](../integrations/README.md) §editions).

> So: **cloud = metered credits with margin (collected via a payment provider when wired, else
> offline); self-host = subscription/license only, no credit margin.** The payment processor
> itself is undecided and optional — see the `PaymentProvider` port in `08` §6.

---

## 5. Overage: soft vs hard

When a Company's credit **balance hits 0**, what happens next depends on a policy the **owner**
sets (Control-Panel → *Usage & billing* / Safety), per `08` §4:

- **Soft overage (default on paid tiers): keep running, reconcile at period end.** Helpers keep
  working past 0; each over-balance credit **accrues** at `plan.credit_overage_usd` on the
  ledger and is settled on the next invoice — collected through the payment provider's metered
  usage item if one is wired, otherwise billed offline. Nothing stops; the operator just owes
  more. Best for teams who never want work to stall.
- **Hard overage: block new consequential work.** New *consequential* Jobs are refused
  (`402 insufficient credits`); non-urgent work is queued; Routines and Flows **pause**; an
  `alert` InboxItem is raised. **Reading chat stays free** and **in-flight Jobs finish** (the
  gate checks balance only for *new* consequential Jobs — `08` §9, "negative balance race"). Best
  for free tier and cost-sensitive operators who'd rather hit a wall than a bill.

Who sets it: **owner only** (billing surface). The owner also sets a **top-up threshold** here.
Admins can manage Helpers and limits but cannot change overage policy or the plan — see
[`teams-members-roles.md`](teams-members-roles.md).

---

## 6. Top-ups & auto-top-up

Separate from the monthly subscription grant, operators can add credits any time (`08` §5):

- **Manual top-up**: `POST /v1/billing/topup {pack}` — buy a credit pack on demand. Onboarding:
  *"Buy a credit pack · top up anytime · credits never expire."*
- **Auto-top-up**: when `balance < threshold`, omilo charges the saved payment method for a pack
  automatically and records a `reason: "topup"` ledger row. This is how a soft-overage team
  avoids ever actually dipping negative — the wallet refills before the floor.
- Top-ups are ordinary positive ledger grants; **refunds** (`reason: "refund"`) and manual
  **adjustments** (`reason: "adjustment"`) are supported and audited. Credits are **non-expiring
  within a period** unless a plan says otherwise.

---

## 7. The onboarding plan + payment flow (cloud)

As behavior (screens under `src/features/auth/`, routes `/auth/onboarding/*`):

1. **Choose plan** (`ChoosePlanPage`, `/auth/onboarding/plan`): tier cards with a monthly/yearly
   toggle (*"Yearly · save 20%"*), each showing seats + included AI credit + features. Paid
   tiers start a **14-day free trial**.
2. **Payment — OPTIONAL** (`PaymentPage`, `/auth/onboarding/payment`): shown **only when a
   payment provider is configured and the chosen plan requires payment**. It collects payment via
   the configured provider's hosted checkout/fields (*"We never see your full card number"*),
   showing the yearly math, the **included AI credit per month** line item, **"Due today: $0"**
   during trial, and the first charge date (`08` §6). **When no provider is wired, this step is
   skipped**: the company is activated on the chosen plan in `trialing`/`active` with offline
   billing, and payment is arranged out-of-band.
3. **All set** (`/auth/onboarding/all-set`): subscription is live; the first `included_credits`
   grant lands; Helpers can start billing credits — whether billing is provider-collected or
   offline.

**Self-host skips steps 1–2 entirely** — there's no plan to choose and no card to enter
(`08` §6). When a provider *is* configured, a reminder is sent 3 days before any trial ends
(dunning/trial-end events arrive via that provider's webhooks and raise InboxItems); without a
provider, trial-end reminders are driven by omilo's own internal scheduler.

---

## 8. Usage & Analytics — where the operator sees the money

`GET /v1/usage` backs Control-Panel → *Usage & billing* and the Analytics "Spend / Tokens /
budget" cards (`08` §7), straight from the ledger + Jobs:

- **Balance** — current credits left (`SUM(delta)` over the ledger).
- **Included** — this period's grant from the plan.
- **Used this period** — credits burned so far.
- **By-helper spend** (`by_helper[]`) — which Helper cost what. The onboarding Inbox previews
  this per job: *"~40 credits/day" (Chief brief), "~120 credits/run" (Builder tests), "~300
  credits/week" (Grower review), "~10 credits/reply" (Support)* (`onboarding/data.ts`).
- **By-day** (`by_day[]`) — the burn-rate sparkline.
- `GET /v1/billing/ledger` is the full audit (every charge, grant, top-up, refund);
  `GET /v1/billing/invoices` lists omilo invoices (provider-collected or `offline`-marked).

Because each ledger row carries both `provider_cost_usd` and `credits_charged`, the same data
powers the operator's ROI view (cost per Helper / routine / goal) and omilo's internal
gross-margin reporting (ops-only, never a tenant endpoint — `08` §8).

---

## 9. Budgets ≠ billing

A critical distinction (`08` §4): **budgets are controls, not charges.**

- A per-Helper **`budget_credits_month`** or a **`SafetyLimit`** spend cap is a **guardrail the
  gate enforces**. When a Helper hits its monthly budget, that **Helper pauses** — but the
  Company's bill and credit balance are **unchanged**. A budget caps *behavior*, not *what's
  owed*.
- **Overage** (§5) is the opposite: it's about the *Company's* balance and what gets **billed**.
- So an admin can safely cap the Builder at, say, 5,000 credits/month to stop a runaway loop
  without affecting the invoice; only the **owner's** plan + overage settings move money.

| | Budget / SafetyLimit | Overage policy |
|---|---|---|
| Set by | admin (or owner) | **owner only** |
| Scope | one Helper / channel / workspace | the whole Company balance |
| Effect when hit | pauses that Helper (a control) | soft: bill at period end · hard: block new work |
| Changes what's owed? | **No** | **Yes** (soft) / no (hard) |

---

## 10. Worked example — Growth-tier company hits soft overage mid-month

*(All numbers illustrative, to be set by the business.)*

**Setup.** "Sahabat Warga" is on **Growth**, cloud edition. Plan grants **20,000 included
credits/month**, `credit_overage_usd = $0.012`/credit, overage policy **soft** (the default the
owner, Dede, left on). Margin and scale are the platform defaults from §2.

**The month unfolds:**

1. **Day 1 — grant.** Renewal fires (a provider payment-success event if one is wired, else
   omilo's internal renewal) → ledger row `+20,000` (`reason: subscription_grant`), balance
   **20,000**.
2. **Days 1–18 — normal burn.** Helpers work: Chief's morning brief (~40/day), Builder's test
   runs (~120/run), Grower's weekly review (~300), Support's WhatsApp drafts (~10/reply). Each
   Job appends a `job` ledger row with real cost + credits. By **day 18**, balance ≈ **3,500**.
   Usage screen shows *Included 20,000 · Used 16,500 · Balance 3,500*, with Builder as the top
   by-helper spender.
3. **Day 22 — budget guardrail (not a bill).** Builder enters a retry loop on a flaky test suite
   and approaches its admin-set `budget_credits_month = 6,000`. Builder **pauses itself**; an
   InboxItem explains it. The **balance and the invoice are untouched** — this is a control
   (§9). Rina (admin) raises the Builder budget; Builder resumes.
4. **Day 26 — balance hits 0.** A busy growth push drains the last credits. Balance reaches
   **0**. Because policy is **soft**:
   - **Nothing stops.** Chief, Grower, and Support keep running; Routines and Flows keep firing.
   - Each further credit is now **overage**, accrued on the ledger at $0.012/credit (metered to
     the payment provider's usage item if one is wired, else reconciled on an offline invoice).
   - An InboxItem notifies the owner: *"You've used your included credits; further work bills as
     overage."* (If auto-top-up were configured with a threshold above 0, the wallet would have
     refilled first via a `topup` grant — §6. Dede hasn't set one.)
5. **Days 26–31 — overage accrues.** The team burns **2,500** more credits. The ledger keeps
   recording them; the Usage screen now reads *Included 20,000 · Used 22,500 · Balance 0 ·
   Overage 2,500*.
6. **Period end — one invoice.** The overage settles: `2,500 × $0.012 = $30`, added to the next
   invoice alongside the seat subscription (collected via the payment provider if wired, else an
   offline invoice). A new **+20,000** grant resets the balance for the next month.

**What Dede could have done differently:**

- Flip overage to **hard** → at 0 credits, new consequential Jobs would be **blocked** (402),
  Routines/Flows would **pause**, and he'd get an alert — no surprise $30, but stalled work.
- Set **auto-top-up** at, say, a 1,000-credit threshold → the wallet refills in packs before
  hitting 0, smoothing the month with predictable top-up charges instead of an end-of-period
  overage line.
- **Upgrade to Scale** (more included credits) if this burn rate is the new normal — cheaper per
  credit than steady overage.

The point of the example: **soft overage trades a hard stop for a bigger bill**; budgets caught
the *runaway Helper* without touching the bill; and the choice between soft/hard, top-ups, and
upgrade is the **owner's** billing decision (admins can't make it) — see
[`teams-members-roles.md`](teams-members-roles.md).

---

## See also

- [`teams-members-roles.md`](teams-members-roles.md) — seats, who may change the plan/overage
  (owner only), who sets budgets (admin).
- [`../technical/08-billing-ai-credits.md`](../technical/08-billing-ai-credits.md) — the credit
  formula, metering, wallet, the optional `PaymentProvider` port, overage, and build phases
  (P4 meter → P5 wallet + manual subscriptions → P6 optional payment provider).
- [`../technical/07-multitenancy-auth.md`](../technical/07-multitenancy-auth.md) — cloud vs
  self-host edition, authz for the billing surface.
- [`../technical/01-data-model.md`](../technical/01-data-model.md) — `Plan`, `Subscription`,
  `Invoice`, `CreditLedger`, `Company.edition`.
- [`../integrations/README.md`](../integrations/README.md) — the ELv2 cloud/self-host edition
  split and connectors.

> **Illustrative values.** Every price, credit amount, seat count, margin, and tier label in
> this doc is an *illustrative placeholder, to be set by the business.*
