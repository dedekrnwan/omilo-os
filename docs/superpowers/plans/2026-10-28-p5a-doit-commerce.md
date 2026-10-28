# P5a — Doit Commerce (real payments, wallet, webhooks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Indonesian **Doit** (doit.id / PayBridge) gateway as the first real `PaymentProvider`, so a company can top up AI credits and pay subscription invoices with real money (QRIS/VA/transfer), with credits granted idempotently on webhook confirmation.

**Architecture:** Doit is redirect/invoice-based with **no card auto-debit**. So the money flow is asynchronous: an endpoint creates a Doit payment and returns its `hosted_url` in `pending` state; a signed **webhook** (`payment.paid`) is the single source of truth that grants credits / activates subscriptions — idempotently, keyed by Doit payment id. The existing P4 `PaymentProvider` port + `ManualProvider` (offline default) are preserved; `DoitProvider` is a new implementor selected by `OMILO_PAYMENT_PROVIDER=doit`. All tests run offline via a `FakeDoitClient` (no network); webhook tests POST payloads signed with a real HMAC over a test secret.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Postgres 16 + RLS, Pydantic v2, httpx (client), hmac/hashlib (signature). Builds on merged P0–P4 (`main @ 2c96bfd`).

**Spec:** docs/technical/08-billing-ai-credits.md (§4 balance/grants, §7 endpoints), docs/business/subscription-plans.md; Doit API: https://doit.id/docs/en/ (summarized in memory `omilo-payment-provider-doit` and in Global Constraints below).

## Global Constraints

- Builds on merged P0–P4; branch off fresh `main` (`2c96bfd`). Suite is **505 green** — never regress it.
- Shared-schema multitenancy: every new tenant table reuses the P0 RLS pattern EXACTLY — `omilo_app` grants + `ENABLE` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy `USING (company_id = current_setting('app.company_id', true))`. Global tables get no RLS + SELECT grant.
- **Credits are granted ONLY on `payment.paid` webhook, idempotently keyed by Doit payment id** — never synchronously in topup/change-plan. Re-delivery of the same webhook grants once.
- Reuse `omilo.billing.balance.grant_credits` for every credit grant (one positive ledger row + balance move). Reuse the existing `Invoice`/`Subscription`/`CreditLedger` models; extend, don't fork.
- `ManualProvider` stays the default from `get_payment_provider()`; `DoitProvider` only when `OMILO_PAYMENT_PROVIDER=doit` AND a key is set. **No test requires a real key or network.**
- Doit facts (verbatim): base `https://pay.doit.id/v1`; auth `Authorization: Bearer pb_test_…|pb_live_…`; one-off `POST /v1/payments` {amount int IDR, reference ≤128, rail qris|va|transfer|any, va_bank?, customer?, metadata?} + `Idempotency-Key` header → 201 {id `pay_…`, status, qr_content, va_number, hosted_url, fee_amount, total_amount, expires_at}; status `GET /v1/payments/{id}`; recurring `POST /v1/billing/plans` + `POST /v1/billing/subscriptions`; webhook sig header `PayBridge-Signature: t=<ts>,v1=<hex>`, `v1 = HMAC_SHA256(signing_secret, f"{t}.{raw_body}")`; events `payment.paid|payment.expired|invoice.created|refund.succeeded|refund.failed`.
- Money is integer rupiah (IDR has no minor unit in Doit amounts). Credits math stays the P4 rule; the IDR→credits mapping for a pack is a fixed table (defined in T4), not derived from USD here.
- ELv2 license header conventions unchanged. Offline-deterministic tests only (no `Date.now`-style nondeterminism in asserted values; sign with a fixed test secret + fixed timestamp).

## Review Focus

- **Webhook signature bypass:** a request with a missing/old/forged `PayBridge-Signature` must be rejected (401) before any credit grant — and a stale `t` (replay) rejected. Test: forged sig → 401, no ledger row; valid sig → grant. (T3)
- **Double-grant on webhook re-delivery:** Doit retries `payment.paid` up to 8× — the same payment id must grant credits exactly once. Test: POST the same signed `payment.paid` twice → one ledger row, balance moved once. (T3)
- **Cross-tenant webhook:** a webhook for company A's payment must grant to company A only; the handler resolves company from the stored payment record, never from the request body alone. Test: payment belongs to A → B's balance untouched. (T3)
- **Pending never credits:** creating a topup/subscription returns `pending` with a `hosted_url` and **does not** move the balance; only the webhook does. Test: POST topup → balance unchanged, a DoitPayment row `pending`. (T4)
- **Auto-topup cannot silently charge:** with no auto-debit, low-balance auto-topup creates a *pending* payment + an InboxItem carrying the `hosted_url` for the user to pay — it never grants credits on its own. Test: low balance + auto-topup on → pending payment + inbox alert, balance still low until a webhook arrives. (T5)

---

### Task 1: Commerce models + migration (DoitPayment, WalletSettings, Subscription/Invoice extensions)

**Files:**
- Create: `apps/api/omilo/models/commerce.py`
- Modify: `apps/api/omilo/models/billing.py` (extend Invoice/Subscription with provider linkage fields if absent)
- Create: `apps/api/migrations/versions/0011_p5a_commerce.py`
- Test: `apps/api/tests/test_commerce_models.py`

**Interfaces:**
- Consumes: P4 `Company`, `Invoice`, `Subscription`, `CreditLedger`, the RLS helpers in migration 0001/0007.
- Produces:
  - `class DoitPayment(Base)` — tenant/RLS. Columns: `id` (ULID PK), `company_id` (FK, indexed), `provider` (default "doit"), `provider_payment_id` (Doit `pay_…`, unique per company, nullable until created), `reference` (our invoice/txn ref, ≤128), `kind` ("topup"|"subscription"), `amount_idr` (int), `credits` (int — credits to grant on paid, 0 for subscription which grants plan.included_credits), `rail` (nullable), `hosted_url` (Text nullable), `status` ("pending"|"paid"|"expired"|"failed"|"refunded", default "pending"), `plan_id` (nullable, for subscription kind), `granted` (bool default false — the idempotency guard for credit grant), `raw` (JSONB nullable — last provider snapshot), `created_at`, `updated_at`.
  - `class WalletSettings(Base)` — tenant/RLS, one row per company. Columns: `company_id` (PK/unique), `auto_topup_enabled` (bool default false), `auto_topup_threshold_credits` (int default 0), `auto_topup_pack` (str nullable, e.g. "medium"), `updated_at`.
  - Invoice/Subscription: ensure a `provider` + `provider_ref` (Doit subscription/plan id) column exists; add if missing (additive).
- `0011` upgrade: create both tables, `GRANT SELECT,INSERT,UPDATE,DELETE … TO omilo_app`, `ENABLE`+`FORCE RLS`, `tenant_isolation` policy; additive columns on invoice/subscription. Downgrade drops them.

- [ ] **Step 1: Write the failing test** — `test_commerce_models.py`: in a company-scoped tenant session, create a `DoitPayment(kind="topup", amount_idr=50000, credits=5000, status="pending")` and a `WalletSettings(auto_topup_enabled=True, auto_topup_threshold_credits=1000, auto_topup_pack="medium")`; assert they persist and read back; assert a second company's tenant session sees neither (RLS). Assert `provider_payment_id` uniqueness within a company.
- [ ] **Step 2: Run it, verify it fails** (`pytest tests/test_commerce_models.py -v`) — tables/columns missing.
- [ ] **Step 3: Implement** the two models + billing extensions; write migration `0011` following `0007`'s exact RLS/grant structure (read 0007 for the pattern). `down_revision = "0010_harness_account_tag"`.
- [ ] **Step 4: Apply migration to the live DB** (`alembic upgrade head` from `apps/api`) and run the test → PASS.
- [ ] **Step 5: Commit.**

### Task 2: Doit client + FakeDoitClient + DoitProvider (implements the P4 port)

**Files:**
- Create: `apps/api/omilo/billing/doit_client.py` (real httpx client + `FakeDoitClient`)
- Create: `apps/api/omilo/billing/doit_provider.py` (`DoitProvider` implementing `PaymentProvider`)
- Modify: `apps/api/omilo/billing/provider.py` (`get_payment_provider()` returns `DoitProvider` when `OMILO_PAYMENT_PROVIDER=doit` + key present; else `ManualProvider`)
- Modify: `apps/api/omilo/config.py` (settings `OMILO_PAYMENT_PROVIDER`, `DOIT_API_KEY`, `DOIT_SIGNING_SECRET`, `DOIT_BASE_URL` default `https://pay.doit.id/v1`)
- Test: `apps/api/tests/test_doit_provider.py`

**Interfaces:**
- Consumes: T1 `DoitPayment`; P4 `PaymentProvider` Protocol (7 methods), `ProviderNotConfigured`.
- Produces:
  - `class DoitClient` — `create_payment(amount_idr, reference, rail="any", customer=None, metadata=None, idempotency_key=...) -> dict`; `get_payment(payment_id) -> dict`; `create_plan(name, amount_idr, interval) -> dict`; `create_subscription(plan_ref, customer) -> dict`; `refund(payment_id, amount=None) -> dict`. Uses httpx with the Bearer key + `Idempotency-Key` header. **Never called in tests.**
  - `class FakeDoitClient` — same methods, deterministic in-memory: `create_payment` returns `{id: f"pay_fake_{idempotency_key or reference}", status:"pending", hosted_url: f"https://pay.doit.id/p/{id}", amount, fee_amount:0, total_amount:amount, expires_at: <fixed>}`; `get_payment` returns stored; lets tests flip a payment to paid. No network, no clock nondeterminism (accept an injected timestamp or use a fixed constant).
  - `class DoitProvider(PaymentProvider)` — takes a client (real or fake). `ensure_customer`→no-op dict; `charge_one_off(company, amount_idr, reference, …)` → `client.create_payment(...)` returning `{provider_payment_id, hosted_url, status:"pending"}`; `start_subscription`/`change_subscription` → `create_plan`+`create_subscription` returning refs; `cancel_subscription`; `report_usage`→no-op; `parse_webhook(headers, raw_body) -> list[BillingEvent]` → verify signature then map Doit event → `BillingEvent` (reuse the P4 `BillingEvent` type).
  - `verify_doit_signature(signing_secret, header_value, raw_body, *, tolerance_s=300, now=...) -> bool` (module-level in `doit_provider.py` or a `doit_sig.py`) — parse `t=…,v1=…`, recompute `HMAC_SHA256(secret, f"{t}.{raw_body}")`, constant-time compare, reject if `|now - t| > tolerance`.

- [ ] **Step 1: Write the failing test** — `test_doit_provider.py`:
  - `get_payment_provider()` returns `ManualProvider` by default; with `OMILO_PAYMENT_PROVIDER=doit` + a key in settings → `DoitProvider`.
  - `DoitProvider(FakeDoitClient()).charge_one_off(company, 50000, "INV/1")` → returns `provider_payment_id` starting `pay_fake_`, `status=="pending"`, a `hosted_url`.
  - `verify_doit_signature(secret, good_header, body)` → True; tampered body → False; `v1` wrong → False; stale `t` (now-3600) → False. (Compute `good_header` in the test with the same HMAC.)
  - `parse_webhook` on a signed `payment.paid` body → one `BillingEvent` with type `payment.paid` and the payment id; on a bad signature → raises/returns per the chosen contract (document it; T3 relies on it).
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** client/fake/provider/signature. Keep all Doit HTTP inside `DoitClient`; `FakeDoitClient` is the only one tests touch.
- [ ] **Step 4: Run tests → PASS.**
- [ ] **Step 5: Commit.**

### Task 3: Webhook endpoint — signature, idempotent grant, subscription activation

**Files:**
- Create: `apps/api/omilo/api/webhooks.py` (`POST /v1/webhooks/doit`)
- Modify: `apps/api/omilo/main.py` (wire router)
- Test: `apps/api/tests/test_doit_webhook.py`

**Interfaces:**
- Consumes: T2 `verify_doit_signature`/`DoitProvider.parse_webhook`, T1 `DoitPayment`, `omilo.billing.balance.grant_credits`, `Subscription`/`Invoice`.
- Produces: `POST /v1/webhooks/doit` — reads the **raw** body (not parsed-then-reserialized), verifies `PayBridge-Signature`; on fail → 401. On `payment.paid`: look up the `DoitPayment` by `provider_payment_id`; if `granted` already true → 200 no-op (idempotent); else in one tenant-scoped transaction (resolve company from the payment row, `SET LOCAL app.company_id` to it via the privileged→tenant path used elsewhere) set `status="paid"`, and for `kind="topup"` `grant_credits(company, credits, reason="topup")`, for `kind="subscription"` activate the `Subscription` + `grant_credits(company, plan.included_credits, reason="subscription_grant")`, then set `granted=true`. On `invoice.created`: upsert an `Invoice`/`DoitPayment` row `pending` with `hosted_url`. On `payment.expired`/`refund.*`: update status (refund → negative ledger row only if previously granted). Always 200 on a verified event the handler understands (so Doit stops retrying).

**Note on tenant scoping from a webhook:** the webhook is unauthenticated (Doit calls it) — resolve the company from the stored `DoitPayment.company_id` and open a tenant session for *that* company via the same privileged-bootstrap→`set_config('app.company_id', …)` mechanism the system uses for identity-bootstrap writes. The grant MUST run under that company's RLS scope. Document this path.

- [ ] **Step 1: Write the failing test** — `test_doit_webhook.py` (seed a `pending` topup `DoitPayment` for company A, credits=5000):
  - valid `payment.paid` signed with the test secret → 200; A's balance += 5000; one `CreditLedger` topup row; `DoitPayment.granted==True`, `status=="paid"`.
  - **re-deliver the same event** → 200; balance unchanged (still +5000 once); still one ledger row. (Double-grant guard.)
  - **forged signature** → 401; balance unchanged; no ledger row.
  - **stale timestamp** → 401.
  - subscription `payment.paid` (seed a subscription DoitPayment + plan) → subscription active + included credits granted once.
  - cross-tenant: the payment belongs to A → company B's balance untouched.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the endpoint + handlers; reuse `grant_credits`; idempotency via `DoitPayment.granted`.
- [ ] **Step 4: Run tests → PASS. Run the full suite → still green.**
- [ ] **Step 5: Commit.**

### Task 4: Real topup / change-plan wired to Doit (pending + hosted_url) + status

**Files:**
- Modify: `apps/api/omilo/api/billing.py` (topup/change-plan now go through `get_payment_provider()`; when provider is Doit, create a `DoitPayment` + return `hosted_url`/`pending`; when Manual, keep the P4 instant-offline grant)
- Create: `apps/api/omilo/api/wallet.py` (`GET /v1/wallet` settings, `PUT /v1/wallet` update auto-topup, `GET /v1/wallet/payments` list DoitPayments, `GET /v1/wallet/payments/{id}` status)
- Modify: `apps/api/omilo/main.py` (wire wallet router)
- Test: `apps/api/tests/test_billing_doit_endpoints.py`

**Interfaces:**
- Consumes: T1 `DoitPayment`/`WalletSettings`, T2 `get_payment_provider`/`DoitProvider`, the `PACKS` map from P4 billing (IDR amount per pack — ADD an `amount_idr` to each pack here; define `PACKS = {"small":{credits:1000, amount_idr:15000}, "medium":{credits:5000, amount_idr:70000}, "large":{credits:20000, amount_idr:250000}}` or read spec if it pins values — note the choice).
- Produces: `POST /v1/billing/topup {pack}` under Doit → creates a `DoitPayment(kind="topup", credits, amount_idr, status="pending")` via the provider, returns `{payment_id, hosted_url, status:"pending", credits, amount_idr}` **without** touching the balance. `POST /v1/billing/change-plan {plan_id}` under Doit → creates subscription DoitPayment pending + returns `hosted_url`; the actual activation happens on the webhook (T3). Under Manual, both keep P4 behavior (instant grant) so existing P4 tests still pass. Wallet CRUD + payment list/status, all company-scoped.

- [ ] **Step 1: Write the failing test** — `test_billing_doit_endpoints.py` (force Doit provider with `FakeDoitClient` via dependency override / settings):
  - `POST /v1/billing/topup {pack:"medium"}` → 200/201 with `hosted_url` + `status:"pending"`; **balance unchanged**; a `DoitPayment` pending row exists with credits=5000.
  - simulate the webhook (call the T3 path or POST a signed event) → balance now +5000.
  - `POST /v1/billing/change-plan {plan_id}` → pending subscription DoitPayment + hosted_url; plan NOT yet active until webhook.
  - `GET /v1/wallet/payments` lists the company's payments; `GET …/{id}` returns status; company-scoped.
  - With `ManualProvider` (default), the existing P4 topup/change-plan still grant instantly (don't break P4 tests).
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** the provider-branching in billing.py + wallet.py.
- [ ] **Step 4: Run tests → PASS. Full suite green.**
- [ ] **Step 5: Commit.**

### Task 5: Wallet auto-topup (pending payment + inbox alert, never silent charge)

**Files:**
- Create: `apps/api/omilo/billing/autotopup.py` (`maybe_auto_topup(db, company) -> DoitPayment | None`)
- Modify: `apps/api/omilo/billing/meter.py` or `omilo/loop/runner.py` (call `maybe_auto_topup` best-effort after a job meters credits and balance drops)
- Test: `apps/api/tests/test_auto_topup.py`

**Interfaces:**
- Consumes: T1 `WalletSettings`/`DoitPayment`, T4 provider topup path, `InboxItem`.
- Produces: `maybe_auto_topup(db, company)` — if `WalletSettings.auto_topup_enabled` and `balance(db, company) < threshold` and there's no already-`pending` auto-topup payment, create a `pending` topup `DoitPayment` for the configured pack via the provider AND an `InboxItem(kind="alert", "Balance low — tap to top up", actions=[{hosted_url}])`; return it. It **never** grants credits (only the webhook does). Under `ManualProvider` (no real redirect) it may grant directly (offline convenience) — gate that on provider type and document it. Idempotent: one pending auto-topup at a time.

- [ ] **Step 1: Write the failing test** — `test_auto_topup.py` (Doit provider via fake): company with `auto_topup_enabled`, threshold 1000, balance 500 → `maybe_auto_topup` creates a pending DoitPayment + an InboxItem with the hosted_url; **balance still 500** (no grant). Calling it again while one is pending → returns None / no duplicate. Disabled → None. After a webhook pays it, balance rises and a new low-balance can trigger again.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** `maybe_auto_topup`; wire a best-effort call after metering (swallow+log on error, never block a job — mirror the P4 gate best-effort pattern).
- [ ] **Step 4: Run tests → PASS. Full suite green.**
- [ ] **Step 5: Commit.**

### Task 6: Reconciliation + usage surfacing (pending vs paid) + docs

**Files:**
- Modify: `apps/api/omilo/api/billing.py` (`GET /v1/usage` adds `pending_topups` + `last_payment` summary)
- Create: `apps/api/omilo/billing/reconcile.py` (`reconcile_pending(db, company, provider) -> int` — for each `pending` DoitPayment older than N minutes, `provider.get_payment` and apply the same paid/expired transition as the webhook, idempotently — the safety net for a missed webhook)
- Test: `apps/api/tests/test_reconcile.py`
- Modify: `docs/technical/08-billing-ai-credits.md` (append a "Doit provider" subsection documenting the async webhook-grant model)

**Interfaces:**
- Consumes: T2 provider `get_payment`, T3 grant logic (factor the paid-transition into a shared helper both the webhook and reconcile call — e.g. `apply_payment_paid(db, payment)` in a `billing/settle.py`, so T3 and T6 share ONE idempotent settle path; if time, refactor T3 to use it).
- Produces: reconcile function + usage fields. `reconcile_pending` must use the SAME idempotent settle (so a webhook that already granted makes reconcile a no-op, and vice-versa).

- [ ] **Step 1: Write the failing test** — `test_reconcile.py`: seed a `pending` topup DoitPayment; make `FakeDoitClient.get_payment` report it `paid`; `reconcile_pending` → grants credits once, marks `granted`; running it again → no double grant; a webhook arriving afterward for the same payment → also no double grant (shared settle guard).
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** `apply_payment_paid` shared settle (refactor T3 to call it), `reconcile_pending`, usage fields, docs subsection.
- [ ] **Step 4: Run tests → PASS. Full suite green.**
- [ ] **Step 5: Commit.**

---

## Self-Review notes (author)

- **Spec coverage:** topup (T4), subscription/change-plan (T3+T4), balance/grants (T3 via grant_credits), usage endpoint (T6), provider port (T2) — all covered. The one spec item deliberately deferred: refund UX beyond a ledger reversal (T3 handles the ledger side; a refund-initiation endpoint is out of P5a scope — note in docs).
- **Idempotency is the backbone:** `DoitPayment.granted` + a shared `apply_payment_paid` settle (T6) guarantee webhook re-delivery, reconcile, and a race between them all converge to one grant. If T6's shared-settle refactor slips, T3's `granted` guard still holds per-path — but the cross-path (webhook vs reconcile) guarantee needs the shared helper, so T6 is not optional for correctness.
- **Auto-topup honesty:** no card-on-file → auto-topup is "prepare + notify", never silent charge (Review Focus #5, T5). The ManualProvider offline-grant branch is a dev convenience only.
- **Type consistency:** `BillingEvent` reused from P4 (T2 `parse_webhook`). `grant_credits` reused everywhere. `PACKS` gains `amount_idr` (T4) — the P4 PACKS (credits only) is extended, not forked; update P4's callers if they index PACKS by the old shape.
- **Proportion:** 6 tasks, each an independently reviewable deliverable with real-number/RLS/idempotency assertions; code bodies are left to the implementer except where a signature or the HMAC formula is pinned.
