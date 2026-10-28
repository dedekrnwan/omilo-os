# P12 — Cloud Subscription Plan (per-company, monthly/yearly, 14-day trial) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Checkbox steps.

**Goal:** Ship the single Cloud (website) subscription: **Rp 299k/mo (~$19) per company · Rp 2.99jt/yr (2 months free) · 14-day full-feature trial**, no free tier. Reduce the plan step to a monthly/yearly toggle. Local/desktop stay fully free (no subscription, unchanged).

**Architecture:** Extends the built P4 billing (Plan catalog / Subscription / CreditLedger / DoitPayment / change-plan+settle). Adds yearly pricing + billing_interval + a trial + a real plan catalog (none exists in prod today — plans are only created in tests). Cloud-mode only; local = `self_hosted` free plan, untouched.

**Spec:** memory `omilo-monetization-packaging` + `docs/technical/12` modes. Doit (IDR) is the gateway (`omilo-payment-provider-doit`).

## Global Constraints
- Branch off fresh `main`. Backend gates on `cd apps/api && pytest` (baseline 807). Frontend on `npx vitest run` (544) + `npx tsc -b --force` (0). Trust tsc over editor squiggles.
- **Money-sensitive:** credits granted ONLY via the existing idempotent paths (change_plan/settle); trial grants once; never double-grant. No secrets.
- **Mode-aware:** trial + subscription apply in cloud/hybrid only. In `local` the plan is fixed `self_hosted` (free, 0 credits) — no trial, no picker (already the behavior; do not regress it).
- Reuse existing: `change_plan` (Manual instant + Doit hosted_url→settle webhook), `get_payment_provider`, `_subscription_dict`, `make_access_token`. Frontend reuses Commands/queries + the existing ChoosePlanPage monthly/yearly toggle UI.

## Review Focus
- **Local unchanged:** a local-mode company must NOT get a trial/subscription/credits; `self_hosted` stays free, 0-credit, pooled refused. (T2 test.)
- **No double credit grant:** converting trial→paid, or a replayed Doit webhook, grants credits at most once (idempotency). (T2 test.)
- **Trial expiry:** after 14 days with no payment, pooled inference is blocked (BYO still works); status reflects expired. (T2 test.)
- **Yearly math:** yearly uses the yearly price + period_end = +1 year (not +1 month). (T1/T2 test.)
- **Idempotent catalog seed:** running the plan-catalog bootstrap twice doesn't duplicate plans. (T1 test.)

---

### Task 1: Billing model + migration + plan catalog — FOUNDATION
**Files:** `apps/api/omilo/models/billing.py` (Plan + Subscription fields); new `apps/api/omilo/billing/catalog.py` (canonical plans + idempotent `seed_plans(db)`); wire `seed_plans` into `apps/api/omilo/seed/run.py` AND a cloud-startup bootstrap (so cloud deployments have the catalog); new Alembic migration under `apps/api/omilo/migrations/versions/`; tests `apps/api/tests/test_plan_catalog.py`.
**Produces:**
- `Plan`: add `yearly_price_usd: Decimal` + `yearly_price_idr: int` (nullable/default 0).
- `Subscription`: add `billing_interval: str` (server_default `"monthly"`).
- `catalog.py`: `PLAN_CATALOG` = two canonical rows — `self_hosted` (tier="self_hosted", monthly/yearly=0, included_credits=0, seats unlimited-sentinel e.g. 9999) and `cloud` (tier="cloud", monthly_price_idr=299000, yearly_price_idr=2990000, monthly_price_usd≈19, yearly_price_usd≈190, included_credits=2000, seats=5). `seed_plans(db)` upserts them by a stable id/tier (idempotent).
- Alembic migration: add the 3 columns + run `seed_plans` (or document seed runs separately). Head must chain from the current head (find it: `cd apps/api && alembic heads`).
- [ ] Step 1: failing test — `seed_plans` twice → exactly 2 plans (no dup); the `cloud` plan has monthly 299000 + yearly 2990000 IDR + included_credits 2000 + seats 5; a Subscription row defaults billing_interval="monthly".
- [ ] Step 2: run → fail.
- [ ] Step 3: implement model fields + catalog + migration; `alembic upgrade head` clean.
- [ ] Step 4: targeted + FULL `pytest` green (807 baseline; new tests add). Commit `feat/p12-billing-model`.

### Task 2: Trial + interval subscribe logic + plans/subscription endpoints
**Files:** `apps/api/omilo/api/billing.py` (change_plan interval; GET /v1/billing/plans; trial fields on GET subscription); new `apps/api/omilo/billing/trial.py` (`start_trial(db, company)`); hook trial start where a cloud company is first provisioned (in the billing layer, cloud-mode only — e.g. lazily on first GET subscription, or at signup via a cloud-only call); tests `test_billing_trial.py`, extend `test_billing_api.py`.
**Consumes:** T1 catalog + fields. **Produces:**
- `POST /v1/billing/change-plan {plan_id, interval?: "monthly"|"yearly"}` — interval defaults "monthly"; when "yearly" use `yearly_price_idr` + period_end = now+1yr; set `Subscription.billing_interval`. (Both Manual + Doit paths — Doit amount uses the interval's price.)
- `GET /v1/billing/plans` → the catalog for the current mode: cloud mode → `[cloud]` (id, tier, monthlyPriceIdr, yearlyPriceIdr, includedCredits, seats, trialDays=14); local → `[self_hosted]` / empty. (camelCase out, or snake per the billing endpoints' existing convention — MATCH `_subscription_dict`/`_plan_dict` style exactly.)
- `GET /v1/billing/subscription` → add `interval`, `isTrial`/`trialEndsAt`/`trialDaysLeft` derived from status=="trialing" + current_period_end.
- `start_trial(db, company)`: cloud-mode only; if the company has no subscription, create one — plan=cloud, status="trialing", current_period_end=now+14d, billing_interval="monthly"; grant `included_credits` ONCE (reason="trial_grant", idempotent — guard on existing trial/grant). In `local` mode: no-op (company stays self_hosted free).
- Trial expiry: the pooled gate already blocks on 0 balance; ensure an expired trialing sub (period_end < now, not converted) does NOT get a monthly reset and its status can be read as expired. Minimal: don't reset credits for trialing/expired; only active (paid) subs reset. Document any deeper enforcement as deferred.
- [ ] Step 1: failing tests — local company: start_trial is a no-op (no subscription, self_hosted, 0 credits). cloud company: start_trial → trialing sub, +14d, 2000 credits granted ONCE (second call doesn't double-grant). change-plan interval="yearly" → yearly price + period +1yr + billing_interval="yearly". GET plans (cloud) returns the cloud plan with trialDays=14. GET subscription exposes isTrial/trialDaysLeft. Replayed settle/webhook doesn't double-grant.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement.
- [ ] Step 4: targeted + FULL `pytest` green. Commit `feat/p12-billing-trial`.

### Task 3: Frontend — single Cloud plan + monthly/yearly + trial
**Files:** `src/features/auth/ChoosePlanPage.tsx` (single plan + real prices + wired CTA); a billing/usage section (`src/features/control-panel/sections/SectionUsage.tsx` or SectionBilling) for trial countdown + manage; `src/app/queries.ts` + `src/adapters/http/commands.ts` (usePlans / subscribe interval); tests `src/features/auth/choosePlan.test.tsx`.
**Consumes:** T2 `GET /v1/billing/plans`, `POST /v1/billing/change-plan {plan_id, interval}`, `GET /v1/billing/subscription` (trial fields). **Produces:**
- ChoosePlanPage: drop the static 3-plan `PLANS`; render the SINGLE cloud plan from `GET /v1/billing/plans`, using the EXISTING monthly/yearly toggle (line ~89) to switch displayed price (monthly vs yearly≈2-months-free) and the chosen `interval`. Primary CTA "Start 14-day trial" (or "Subscribe") → `changePlan(planId, interval)` → on Doit `hosted_url` redirect there; on Manual, proceed. Hidden/again: this page only shows in cloud mode (local/desktop never route here).
- Billing section: show current plan, `interval`, and if trial: "N days left in trial" + a Subscribe CTA; reuse `GET /v1/billing/subscription`.
- All API paths `/v1`-prefixed; map snake↔camel at the boundary to match the billing endpoints.
- [ ] Step 1: failing tests — ChoosePlanPage renders the single cloud plan from a stubbed /plans, toggling monthly↔yearly changes the shown price + the interval sent; CTA calls changePlan with the selected interval. Trial countdown renders from a stubbed subscription with isTrial+trialDaysLeft. Grep-prove the static PLANS fixture is gone from the live path.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement.
- [ ] Step 4: `npx vitest run` + `npx tsc -b --force` green. Commit `feat/p12-billing-frontend`.

---
## Self-Review notes
- **Coverage:** price/interval (T1 model + T2 logic + T3 UI), trial (T2 + T3), catalog (T1). Local-free untouched (guarded in T2 + Review Focus #1).
- **Parallel:** T1 foundation merges first (model+migration+catalog). T2 (backend) + T3 (frontend) then parallel against documented contracts, isolated worktrees. T3's API paths /v1-prefixed + camel mapping (the recurring cross-boundary hazard).
- **Money safety:** credits only via existing idempotent grant paths; trial grants once; yearly uses yearly price; replay-safe. The sharpest tests are local-no-op, no-double-grant, yearly-math, trial-expiry.
- **Deferred:** dunning/past_due automation, proration on interval switch, multiple cloud tiers, desktop add-ons (parked).
