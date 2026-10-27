# 08 · Billing & AI Credits

> Track: **technical**. The money model: subscription plans + **metered AI credits with
> margin**. **Fully designed here; built in phases (meter → wallet → pay).** Product-facing
> plan behavior in [`business/subscription-plans.md`](../business/subscription-plans.md).
>
> **Payment-provider is deliberately decoupled and OPTIONAL.** The billing *domain* (plans,
> credits, ledger, metering, overage, subscriptions-as-state) is fully provider-independent and
> works with **no payment integration at all** — subscriptions can be provisioned manually and
> overage invoiced out-of-band. Collecting money is a pluggable `PaymentProvider` behind a port
> (§6); the concrete choice (Stripe / Xendit / Midtrans / Paddle / manual) is **not yet decided
> and not a dependency**. Everything below holds regardless of which provider (if any) is wired.

## 1. Revenue model

Two streams, matching the stated model:
1. **Subscription fee** — monthly `Plan` (seats + included monthly credits + features).
2. **AI-credit margin** — agents consume **credits**; we buy provider tokens at cost and sell
   credits at a markup. The margin is the difference, tracked per ledger row.

Credits only apply to the **cloud/litellm** path (we carry provider cost). The **Claude Code
pool** and **BYO keys** are the operator's own capacity → no credit charge, just the
subscription fee.

## 2. The credit

- **Definition:** a stable internal unit decoupled from any provider's token price, so pricing
  is predictable for the operator and we absorb provider price drift.
- **Conversion:** `credits_charged = ceil( provider_cost_usd × MARGIN × CREDITS_PER_USD )`.
  - `provider_cost_usd` = real metered cost (litellm usage × provider price table).
  - `MARGIN` = configurable multiplier (e.g. 1.4 ⇒ 40% gross margin).
  - `CREDITS_PER_USD` = fixed display scale (e.g. 100 credits = $1 of included value).
- Both the **true cost** and the **credits charged** are stored on every `CreditLedger` row, so
  gross margin is reportable exactly.

## 3. Metering (Phase P4 — first)

Every LLM call (and embedding call) returns usage. The runner, on Job completion:
1. Sums `tokens_in/out` → `provider_cost_usd` via the provider price table.
2. Computes `credits_charged` (formula above).
3. Appends an append-only **`CreditLedger`** row:
   `{company_id, delta:-credits_charged, balance_after, reason:"job", job_id, helper_id,
     provider_cost_usd, credits_charged, meta:{provider,model,tier}}`.
4. Updates the company credit **balance** (materialized from the ledger; the ledger is the
   source of truth).

Metering is **idempotent** per `job_id` (a Job is charged once even on retry/resume). This
phase makes Usage/Analytics exact and is a prerequisite for everything below.

## 4. Balance, grants, overage

- **Balance** = `SUM(delta)` over the ledger (cached; reconciled). Exposed at `GET /v1/usage`.
- **Grants**: subscription renewal grants `plan.included_credits`
  (`reason:"subscription_grant"`); promos/support use `reason:"grant"`.
- **Overage**: when balance hits 0, behavior by plan:
  - *soft* (default): keep running, accrue overage credits at `plan.credit_overage_usd`; the
    accrued amount is **recorded on the ledger and reconciled at period end**. *How* it is then
    collected (metered charge via a `PaymentProvider`, or a manual/out-of-band invoice) is the
    optional payment layer (§6) — the accrual itself needs no provider.
  - *hard*: block new consequential Jobs (`402 insufficient credits`), queue non-urgent work,
    and raise an `alert` InboxItem. Routines/flows pause; chat read stays free.
  - The operator sets soft/hard and a top-up threshold in Control-Panel → Usage/Safety.
- **Budgets** ≠ billing: per-Helper `budget_credits_month` and `SafetyLimit` spend caps are
  *controls* the gate enforces; exceeding a budget pauses the helper, it does not change what's
  owed.

## 5. Wallet & top-up (Phase P5a — provider-independent core)

- **Credit packs & grants** are a pure ledger operation — adding credits (`reason:"topup"` or
  `"grant"`) needs no payment provider. An admin can grant a pack manually today.
- **Manual top-up**: `POST /v1/billing/topup {pack}` — in the no-provider configuration this
  records the grant and marks it `payment_status: "offline"` (collected out-of-band); with a
  provider wired it first takes payment, then grants on success (§6).
- **Auto top-up** (requires a provider): when balance < threshold, request a charge for a credit
  pack via the `PaymentProvider`; on success record `reason:"topup"`.
- Credits are **non-expiring within a period** unless policy says otherwise (decide per plan);
  refunds (`reason:"refund"`) and manual `adjustment`s are supported and audited.

## 6. Subscriptions & the `PaymentProvider` port (payment layer — OPTIONAL / deferred)

The subscription **domain** is internal and provider-agnostic; **payment collection** sits
behind a port that can be left unimplemented.

### 6.1 Subscription as internal state (always present, no provider needed)
- A `Subscription` row is omilo's own record: `{company_id, plan_id, status, current_period_end,
  seats, provider, external_ref?}`. `status ∈ active | trialing | past_due | canceled`.
- Transitions are driven by omilo logic (renewal grants `plan.included_credits`, downgrades on
  non-payment, etc.), **not** by a vendor. A provider, when present, only *feeds* these
  transitions via webhooks.
- **Manual provisioning** (the default until a provider is chosen): an owner/admin — or omilo
  staff via an internal tool — sets a company's plan directly (`POST /v1/billing/subscription`
  admin path). This covers early customers, design partners, invoice-me deals, and self-host
  licenses. Billing, credits, metering, and overage all work fully in this mode; money is
  simply collected out-of-band.

### 6.2 The `PaymentProvider` abstraction (pluggable, choose later)
A narrow port so the concrete processor is a swappable implementation detail:

```python
class PaymentProvider(Protocol):
    def ensure_customer(self, company) -> str: ...                     # external customer id
    def start_subscription(self, company, plan, seats) -> CheckoutRef: ...  # hosted checkout / redirect
    def change_subscription(self, sub, plan, seats) -> None: ...        # proration handled by impl
    def cancel_subscription(self, sub) -> None: ...
    def charge_one_off(self, company, amount, memo) -> ChargeRef: ...   # credit-pack top-up
    def report_usage(self, sub, credits) -> None: ...                   # metered overage (if supported)
    def parse_webhook(self, headers, body) -> list[BillingEvent]: ...   # verify sig → normalized events
```

- **Normalized `BillingEvent`s** map any provider's callbacks to omilo-internal transitions:
  `payment_succeeded`, `payment_failed`, `subscription_updated`, `subscription_canceled`,
  `refund`. The rest of the system only ever sees these, never vendor-specific shapes.
- **Candidate implementations (undecided):** `StripeProvider`, `XenditProvider` /
  `MidtransProvider` (Indonesia-relevant, given IDR pricing and local methods),
  `PaddleProvider` (merchant-of-record / handles tax), and `ManualProvider` (the no-op default:
  everything is offline/admin-driven). The choice can be deferred without touching the billing
  core; most impls are a few hundred lines behind the port.
- **Onboarding** payment step (`/auth/onboarding/payment`) is **skippable**: if no provider is
  configured (or self-host), onboarding completes on a plan in `trialing`/`active` with offline
  billing; the step only appears when a provider is wired and the plan requires payment.
- **Proration & plan change**: `POST /v1/billing/change-plan {plan_id}` adjusts the internal
  subscription + `included_credits` grant immediately; if a provider is present it also calls
  `change_subscription` for money. Without a provider, the plan change just takes effect and any
  delta is reconciled offline.

> **Why a port, not Stripe directly:** you're not yet sure Stripe is the processor (local
> methods/IDR may favor Xendit/Midtrans, or a merchant-of-record like Paddle for tax). Designing
> to the port lets us ship plans + credits + metering now and plug payment in later — or run
> indefinitely on manual/offline billing for early customers — with no rework.

## 7. API surface

```
# Provider-independent (always available)
GET  /v1/usage                         → {balance, included, used_this_period, by_helper[], by_day[]}
GET  /v1/billing/ledger  ?cursor=      → CreditLedger[]           (audit of every charge/grant)
GET  /v1/billing/subscription          → {plan, status, period_end, seats, provider, payment_method?}
POST /v1/billing/change-plan {plan_id}  # internal effect immediately; provider charge if wired
POST /v1/billing/topup {pack}           # grant now (offline) or take-payment-then-grant (if wired)
GET  /v1/billing/invoices              → Invoice[]               (internal; may be offline-marked)
POST /v1/billing/subscription          → set/activate a plan     (admin/owner — manual provisioning)

# Payment layer (only active when a PaymentProvider is configured)
POST /v1/billing/webhook/{provider}     (provider → server; signature verified per impl)
POST /v1/billing/checkout {plan_id}     → CheckoutRef             (hosted redirect, if provider)
```

`GET /v1/usage` backs the Analytics "Spend / Tokens / budget" cards and the Control-Panel →
Usage screen; numbers come straight from the ledger + Jobs — and work **with or without** a
payment provider. The webhook/checkout routes simply don't exist (or 501) when no provider is
configured.

## 8. Cost attribution & reporting (margin visibility)

Because each ledger row carries both `provider_cost_usd` and `credits_charged`:
- **Per company**: revenue (credits sold × price) − provider cost = gross margin.
- **Per helper / per routine / per goal**: cost rollups for the operator's own ROI view.
- **Platform-wide**: an internal dashboard query sums margin across tenants (ops-only, not a
  tenant endpoint).

## 9. Edge cases & integrity

| Case | Handling |
|---|---|
| Retry/resume double-charge | idempotent per `job_id`; ledger uniqueness on `(job_id, reason)` for job charges. |
| Provider price change | price table versioned; historical rows keep the price used. |
| Refund after execution | `reason:"refund"` positive delta; audited; does not un-send the action. |
| No payment provider wired | subscriptions provisioned manually; overage/top-ups recorded as `offline`; everything else (plans, credits, metering, overage accrual) works unchanged. |
| Self-host | metering runs for the operator's own analytics; no provider, no margin (license/sub handled out-of-band). |
| Pool/BYO usage | metered for analytics (`provider_cost_usd` informational) but `credits_charged = 0`. |
| Negative balance race | balance checked at gate for *new* consequential Jobs; in-flight Jobs finish. |

## 10. Build order (phased)

1. **P4 — Meter.** Price table, `CreditLedger`, balance, `GET /v1/usage`, idempotent charging.
2. **P5a — Wallet + manual subscriptions.** Grants, overage policy (soft/hard), budget
   enforcement at the gate, **internal `Subscription` state + manual/admin provisioning**,
   offline top-ups/invoices. *At this point the full plan + credit model is live and sellable —
   money is collected out-of-band.*
3. **P6 — Pay (optional, when a provider is chosen).** Implement one `PaymentProvider`
   (Stripe / Xendit / Midtrans / Paddle), wire webhooks + hosted checkout + metered overage +
   onboarding payment. Choosing/adding/replacing a provider touches only the port impl, not the
   billing core.

Nothing in P0–P3 depends on billing; the engine runs on pool/BYO or ungated credits in dev. The
**payment integration (P6) is explicitly optional** and can be deferred indefinitely — omilo is
fully operable and monetizable on manual/offline billing until you're ready to pick a processor.
