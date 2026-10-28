# P6 — Control Plane / Runtime Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the backend run as either a cloud **control plane** (authoritative identity + billing) or a local **runtime** (private workspace + execution) via one `ControlPlane` port — so a self-host user installs locally, registers against the cloud, keeps their data private, and pooled-credit jobs stay cloud-metered (un-forgeable), while BYO/local jobs run free and offline.

**Architecture:** Additive, one-codebase-two-modes (`OMILO_MODE=cloud|runtime`). A `ControlPlane` port abstracts verify/entitlements/balance/usage/register; `LocalControlPlane` (cloud) wraps today's in-process auth+billing (no behavior change), `RemoteControlPlane` (runtime) federates over HTTP with local JWKS verification (offline-capable) + cached entitlements/balance + a usage outbox. Credits move only in the cloud ledger.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Postgres 16 + RLS, Pydantic v2, PyJWT (JWKS), httpx. Builds on merged P0–P5c (`main @ cbe6ea2`).

**Spec:** docs/technical/12-control-plane-runtime-split.md (the authoritative design — read it; every task implements part of it), plus 08-billing-ai-credits.md (credit rules) and 07/multitenancy-auth for the existing auth/billing this wraps.

## Global Constraints

- Builds on merged P0–P5c; branch off fresh `main` (`cbe6ea2`). **Cloud mode must be behavior-identical to today** — the existing suite (619) stays green; runtime mode is new.
- Backend tasks gate on `pytest` (apps/api); keep offline-deterministic: a **`FakeControlPlane`** (or the in-process `LocalControlPlane`) backs every runtime-mode test — NO test calls a real cloud or network. JWKS verification is tested with a locally-generated keypair.
- **Credits are cloud-authoritative, never written by the runtime.** BYO/local engines (`_POOL_ENGINE_TYPES` minus cloud) = 0-credit, always run (even "offline" in tests); pooled/cloud engines (`_CLOUD_ENGINE_TYPES`) require `check_balance` and `report_usage` through the ControlPlane. Reuse the existing `billing.meter` pool/BYO classification — do not reinvent it.
- Usage reports are **idempotent per `(company_id, job_id)`** (the cloud debit must dedupe retries/outbox flushes). The install token is **company-scoped + revocable**.
- RLS is unchanged: both modes `SET LOCAL ROLE omilo_app` + set `app.company_id`. In runtime mode the authoritative auth/billing tables are not owned locally — keep a minimal local **Company shadow** (id + display fields) so RLS scoping + the UI still work; do NOT create local `CreditLedger`/`User` authority.
- No secrets committed; JWKS public keys are fetched/cached, private signing stays cloud-side; the install token is stored via config/keychain (desktop per P5c), never hardcoded.

## Review Focus

- **Cloud mode unchanged:** with `OMILO_MODE=cloud` (default), auth + billing + metering behave exactly as P0–P5b — the 619-test suite passes untouched, the gate/ledger/meter paths resolve in-process via `LocalControlPlane`. (T1)
- **Credits un-forgeable from the runtime:** in runtime mode a credit-consuming job's balance check + debit happen through the ControlPlane (cloud), never against a local ledger; a tampered/empty local DB cannot grant credits. Test: pooled job with cloud-reported balance 0 → blocked; BYO job → runs, 0 credits, no report. (T4)
- **Offline pooled → paused, not run uncounted:** when the ControlPlane is unreachable, a pooled job is paused (`status="paused_offline"` + an InboxItem), never executed; a BYO/local job runs normally offline. Test both. (T4)
- **Idempotent usage debit:** `report_usage` for the same `(company_id, job_id)` twice debits once (outbox flush/retry safe). Test on the cloud `/control/usage` endpoint. (T2)
- **JWKS verify is offline + rejects forgeries:** a runtime verifies a cloud-signed JWT locally against the cached JWKS with no network; a token signed by the wrong key / expired → rejected. Test with a generated keypair. (T3)
- **Install token scope + revocation:** a `/control/*` call with a revoked or foreign-company install token → 401/403; cannot read/report for another company. (T2)

---

### Task 1: `ControlPlane` port + `LocalControlPlane` + wire cloud mode through it

**Files:**
- Create: `apps/api/omilo/control/__init__.py` (the `ControlPlane` Protocol + types: `Identity`, `Entitlements`, `BalanceState`, `UsageEvent`, `UsageResult`, `InstallToken`), `apps/api/omilo/control/local.py` (`LocalControlPlane`), `apps/api/omilo/control/factory.py` (`get_control_plane()` by `OMILO_MODE`)
- Modify: the auth context dep + the billing gate/meter call sites to go through `get_control_plane()` (behavior-preserving in cloud mode)
- Test: `apps/api/tests/test_control_local.py`

**Interfaces:**
- `ControlPlane` Protocol (see design §3.1): `verify_token`, `get_entitlements`, `check_balance`, `report_usage`, `register_install`, `heartbeat`.
- `LocalControlPlane`: `verify_token`→`auth.tokens.decode_token`; `get_entitlements`→from `Company.plan_id`/`Plan`; `check_balance`→`billing.balance.balance` + `Company.overage_policy`; `report_usage`→`billing.meter` debit against the real ledger (idempotent per job_id); `register_install`→issue a local install token row; `heartbeat`→ok.
- `get_control_plane()`→`LocalControlPlane()` when `OMILO_MODE!="runtime"`, else `RemoteControlPlane(...)` (T3). Default mode = cloud.

- [ ] **Step 1: Write failing test** — `test_control_local.py`: `LocalControlPlane.verify_token(valid_jwt)`→Identity; `check_balance(company)` matches `balance.balance`; `report_usage` twice for the same job_id debits once (idempotent); `get_entitlements` returns the plan's included_credits. In cloud mode `get_control_plane()` is a `LocalControlPlane`.
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** the port + LocalControlPlane + factory; route the auth/gate/meter call sites through it WITHOUT changing cloud behavior.
- [ ] **Step 4: Full suite green (619) — cloud mode untouched.**
- [ ] **Step 5: Commit.**

### Task 2: Cloud `/control/*` federation endpoints + InstallToken model (cloud mode)

**Files:**
- Create: `apps/api/omilo/api/control.py` (the router, mounted only in cloud mode), `apps/api/omilo/models/install.py` (`InstallToken`), `apps/api/migrations/versions/0016_install_token.py`
- Modify: `main.py` (mount `/control` when `OMILO_MODE=cloud`), `omilo/auth/tokens.py` (expose JWKS / a public-key endpoint)
- Test: `apps/api/tests/test_control_api.py`

**Interfaces (design §3.2):** `InstallToken` (id, company_id, token_hash, label, created_at, last_seen_at, revoked_at; `is_active`). Endpoints: `GET /control/jwks`; `POST /control/register {user_jwt}`→`{install_token, company_id}` (verify the user JWT, create a company-scoped install token, raw once); `GET /control/entitlements`, `GET /control/balance`, `POST /control/usage {job_id, engine_type, model, tokens_in, tokens_out, credits}` (idempotent cloud debit via `LocalControlPlane.report_usage`), `POST /control/heartbeat` — all authenticated by the install token (company resolved from it, revocation checked).

- [ ] **Step 1: Write failing test** — `test_control_api.py`: register with a user JWT → an install token (raw once); `/control/balance` + `/control/entitlements` with it → the company's values; `/control/usage` debits the ledger once, re-post same job_id → no double debit; a revoked or foreign-company install token → 401/403; company-scoped (install token for A can't read B).
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** the model + migration 0016 (RLS-tenant or install-token-scoped as appropriate; follow 0013's pattern) + endpoints + JWKS. Mount `/control` only in cloud mode.
- [ ] **Step 4: Apply migration live; full suite green (≥619 + new); single head 0016.**
- [ ] **Step 5: Commit.**

### Task 3: `RemoteControlPlane` (runtime mode) — JWKS verify + cached entitlements/balance + usage outbox

**Files:**
- Create: `apps/api/omilo/control/remote.py` (`RemoteControlPlane`), `apps/api/omilo/control/outbox.py` (unreported-usage queue), `apps/api/omilo/control/jwks.py` (local JWKS verify + cache)
- Test: `apps/api/tests/test_control_remote.py`

**Interfaces:** `RemoteControlPlane(control_plane_url, install_token, http=None)`: `verify_token`→**local JWKS** verify (fetch/cache the cloud public key; verify signature+exp OFFLINE, no per-call round-trip); `get_entitlements`/`check_balance`→HTTP GET, cached with a short TTL; `report_usage`→HTTP POST, on failure enqueue to the outbox; `register_install`/`heartbeat`→HTTP. A `ControlPlaneUnreachable` exception when a required online call fails. A `flush_outbox()` that re-posts queued usage idempotently. Tests inject a fake httpx transport (no network) + a locally-generated RSA/EdDSA keypair for JWKS.

- [ ] **Step 1: Write failing test** — `test_control_remote.py` (fake transport + generated keypair): `verify_token` accepts a token signed by the test key (offline, no HTTP), rejects wrong-key/expired; `check_balance` returns the fake cloud value + caches it; `report_usage` posts and, when the transport errors, enqueues to the outbox; `flush_outbox` re-posts; a required call against a dead transport → `ControlPlaneUnreachable`.
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** remote + jwks + outbox.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit.**

### Task 4: Runtime-mode wiring — auth, billing gate, metering, `paused_offline`, Company shadow

**Files:**
- Modify: the auth context dep (verify via ControlPlane), `omilo/billing/balance.py` `check_can_start_job` (pooled→`check_balance`, BYO/local→free, unreachable+pooled→pause), `omilo/billing/meter.py` / runner metering (runtime→`report_usage`, cloud→local ledger), `omilo/loop/runner.py` (the `paused_offline` job path), a local `Company` shadow sync
- Test: `apps/api/tests/test_runtime_mode.py`

**Interfaces:** In runtime mode (`get_control_plane()` → a Remote/Fake): `get_context` verifies the user JWT via ControlPlane. `check_can_start_job`: if the job's engine is BYO/local (0-credit per `billing.meter` classification) → allow (even offline); if pooled → `check_balance` (cloud); on `ControlPlaneUnreachable` → do NOT run, record the job `status="paused_offline"` + an InboxItem, return it. Metering: pooled job → `report_usage` (cloud debits); BYO/local → no-op. Company shadow: on entitlements fetch, upsert a minimal local Company row (id + display) so RLS/UI work. Cloud mode behavior is unchanged (LocalControlPlane makes all this resolve in-process).

- [ ] **Step 1: Write failing test** — `test_runtime_mode.py` (force runtime mode with a `FakeControlPlane`): a BYO/local-engine job runs offline (control plane unreachable) → done, 0 credits, no usage reported; a pooled job with fake-cloud balance>0 → runs + `report_usage` called; a pooled job with the control plane unreachable → `status="paused_offline"` + InboxItem, engine NOT run; a pooled job with fake-cloud balance 0 → blocked. Cloud mode (LocalControlPlane) → the existing P4 gate/meter tests still pass.
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** the runtime wiring + `paused_offline` + shadow.
- [ ] **Step 4: Full suite green; the P4 billing tests unchanged in cloud mode.**
- [ ] **Step 5: Commit.**

### Task 5: Mode config + install registration flow + startup wiring + docs

**Files:**
- Modify: `omilo/config.py` (`OMILO_MODE`, `OMILO_CONTROL_PLANE_URL`, `OMILO_INSTALL_TOKEN`/registration), `main.py` (mode-aware mounting + startup), a small `omilo/control/register.py` (CLI/endpoint to register an install using a user JWT)
- Modify: `docs/technical/12-control-plane-runtime-split.md` (mark implemented bits), add a runtime quickstart
- Test: `apps/api/tests/test_mode_config.py`

**Interfaces:** `OMILO_MODE` default "cloud"; runtime requires `OMILO_CONTROL_PLANE_URL`. The factory selects Local vs Remote. A registration path (CLI `omilo-register` or an endpoint) exchanges a user JWT for an install token (stored per config / keychain on desktop). `main.py` mounts `/control` only in cloud mode and skips the local auth/billing routers' authority in runtime mode (they proxy to the control plane).

- [ ] **Step 1: Write failing test** — `test_mode_config.py`: default mode cloud → `get_control_plane()` is Local + `/control` mounted; `OMILO_MODE=runtime` + a URL → Remote + `/control` NOT mounted; a registration call exchanges a user JWT for an install token (against a fake control plane).
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** config + registration + startup wiring + docs.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit.**

---

## Self-Review notes (author)

- **Coverage (design §12):** the port + Local (T1), cloud `/control/*` + install token (T2), Remote + JWKS/cache/outbox (T3), runtime wiring + offline credit rules + paused_offline + shadow (T4), mode config + registration (T5). Deferred (design §8): a hosted control plane at a real domain, JWKS rotation ops, reconciliation dashboards — plus the revised **P5e packaging** (two deployables) which follows this.
- **Un-forgeable credits is the spine:** credits only ever move in the cloud ledger (LocalControlPlane in cloud mode; `/control/usage` from the runtime). The runtime never writes `CreditLedger`. Review Focus pins this + the offline-pooled-pause + idempotent debit + JWKS-forgery-reject + install-token-revocation.
- **Additive + safe:** cloud mode routes through `LocalControlPlane`, so the 619-suite is behavior-identical; runtime mode is entirely new and fake-backed in tests. No network in the suite (fake transport + generated keypair).
- **Type consistency:** the `ControlPlane` Protocol types (Identity/Entitlements/BalanceState/UsageEvent) are defined once (T1) and used by Local (T1), the cloud endpoints (T2), Remote (T3), and the runtime wiring (T4). The pool/BYO engine classification is reused from `billing.meter`, not re-derived.
- **Proportion:** 5 tasks tracing the design's build phasing; the security-critical ones (T2 idempotent debit + revocation, T4 un-forgeable + offline-pause) carry the sharpest Review-Focus tests.
