# 12 — Control Plane / Runtime Split (self-host with cloud identity & billing)

> **Status:** Design (2026-10-28). Implements the "install locally → register to our cloud → use locally" model with the user's data staying on their machine while identity + billing stay cloud-authoritative. Supersedes the "fully self-contained local backend" framing in earlier packaging notes.

## 1. Why

omilo is open-source (ELv2) monetized by **subscription + margin on AI credits**. For that margin to exist, **credits cannot be forgeable** — a self-hosted user who owns their database must not be able to set their own balance. So **identity, the account/company registry, entitlements, and the credit ledger are always cloud-authoritative**, even when the app runs on the user's machine. Everything else — the agent loop and the user's data (messages, RAG, connectors, keys) — can run **locally and stay private**.

## 2. The split

| Concern | **Cloud control plane** (authoritative) | **Local runtime** (on the user's machine) |
|---|---|---|
| Identity: `User`, `Member`, sign-up/sign-in, **JWT issuance** | ✅ owns | verifies cloud JWTs (resource server) |
| `Company`/account registry, `Plan`, `Subscription`, entitlements | ✅ owns | keeps a read-only **shadow** (id + display fields) synced from cloud |
| Billing: `CreditLedger`, `DoitPayment`, `WalletSettings`, Doit webhooks | ✅ owns | never — reports usage, cloud debits |
| Agent loop, Jobs, RunEvents, Proposals | — | ✅ runs locally |
| Channels/Areas, Goals, Routines, Flows, Chat, Inbox | — | ✅ local data |
| RAG (KbSource/KbChunk), Memory, Skills | — | ✅ local data |
| Connectors, HarnessAccount/ProviderKey (BYO keys), MCP | — | ✅ local data |

**Data residency:** in runtime mode the user's workspace Postgres is on their machine; messages/RAG/connectors/keys never leave. Only JWT verification material, entitlements, and **usage events** cross to the cloud.

## 3. One codebase, two run-modes

The same backend image runs as either mode via `OMILO_MODE`:

- `OMILO_MODE=cloud` — the control plane. Owns auth + billing in-process (authoritative). Exposes the `/control/*` federation API + the existing Doit billing + `/auth/*`.
- `OMILO_MODE=runtime` — the local runtime. Does **not** own auth/billing; delegates through a `ControlPlane` port to a remote cloud via `OMILO_CONTROL_PLANE_URL`.

### 3.1 The `ControlPlane` port (`omilo/control/`)

```
class ControlPlane(Protocol):
    def verify_token(jwt: str) -> Identity            # {user_id, company_id, role}  (offline-capable via JWKS)
    def get_entitlements(company_id) -> Entitlements   # {edition, plan, included_credits, limits, features}
    def check_balance(company_id) -> BalanceState      # {balance, overage_policy}    (cloud-authoritative)
    def report_usage(usage: UsageEvent) -> UsageResult # cloud debits the ledger; returns {accepted, new_balance}
    def register_install(jwt) -> InstallToken          # company-scoped, revocable
    def heartbeat(install_token) -> Liveness
```

- **`LocalControlPlane`** (cloud mode): wraps the existing in-process `auth.tokens.decode_token`, `billing.balance`, `billing.meter`, entitlements from `Plan`/`Company`. Authoritative.
- **`RemoteControlPlane`** (runtime mode): HTTP client to the cloud. **`verify_token` runs LOCALLY** against the cloud's published JWKS public key (no round-trip, works offline). `get_entitlements`/`check_balance`/`report_usage` are HTTP calls, **cached with a TTL**; `register_install`/`heartbeat` manage the install.

### 3.2 Cloud `/control/*` endpoints (mounted only in cloud mode)

Secured by a per-install token (company-scoped, revocable):
- `GET  /control/jwks` — the public keys to verify user JWTs (also usable unauthenticated).
- `POST /control/register` `{user_jwt}` → `{install_token, company_id}` — a runtime registers itself to a company.
- `GET  /control/entitlements` → the company's plan/limits/features.
- `GET  /control/balance` → `{balance, overage_policy}`.
- `POST /control/usage` `{job_id, engine_type, model, tokens_in, tokens_out, credits}` → debits the authoritative ledger idempotently (per `(company_id, job_id)`), returns `{accepted, new_balance}`.
- `POST /control/heartbeat` → liveness + revocation check.

## 4. Credit rules (the offline decision)

**BYO-key and local-model jobs are 0-credit and ALWAYS run — even fully offline.** A self-host user on their own LLM keys or local models (Ollama / Claude Code / LM Studio) pays only the subscription; those jobs are never metered and never need the cloud. This reuses the existing pool/BYO = 0-credits rule (`_POOL_ENGINE_TYPES` / `_CLOUD_ENGINE_TYPES` in `billing.meter`).

**Pooled / cloud-inference jobs (which cost credits) require the control plane reachable:**
- **Billing gate** (`check_can_start_job`): for a credit-consuming job, the runtime calls `ControlPlane.check_balance` (cached, short TTL). If the balance is sufficient → run. If the control plane is **unreachable**, the job is **paused** (`status="paused_offline"`, an InboxItem explains it) and retried on reconnect — never run uncounted.
- **Metering** (`meter_job`): after a pooled job, the runtime calls `ControlPlane.report_usage`; the **cloud** debits the ledger authoritatively (idempotent per `job_id`). The runtime holds a small outbox of unreported usage events and flushes them on reconnect; the cloud is the single source of truth for the balance.
- In **cloud mode**, `check_balance`/`report_usage` resolve in-process against the real ledger (today's behavior) — zero behavior change.

This makes the margin un-forgeable (credits only ever move in the cloud ledger) while giving self-host users a strong offline story on their own compute.

## 5. Auth flow (runtime)

1. User opens the local runtime UI (or desktop app) → signs in against the **cloud** (`/auth/sign-in`) → receives a cloud-issued JWT (`sub`, `cmp`, `role`).
2. On first run the runtime `register_install(jwt)` → gets a company-scoped **install token** (stored in the OS keychain on desktop, per P5c; in an env/secret on a server self-host).
3. Every request to the local runtime carries the user JWT; the runtime **verifies it locally against the cloud JWKS** (offline-capable) and sets `app.company_id` for RLS exactly as today.
4. The runtime keeps a minimal local **Company shadow** (id + profile display fields, synced from `get_entitlements`) so RLS scoping + the UI work without the authoritative tables being local.

## 6. Security

- The runtime never sees passwords; it only verifies cloud-signed JWTs (JWKS). Compromising a runtime cannot mint identities.
- Credits move **only** in the cloud ledger; a tampered local DB cannot grant credits (pooled jobs are gated + metered cloud-side; BYO jobs are 0-credit by definition).
- The install token is company-scoped + **revocable** (heartbeat checks revocation) — a stolen/abused install is cut off.
- Usage reports are idempotent per `(company_id, job_id)` so retries/duplicate flushes never double-debit.
- RLS still FORCE-applies locally (the runtime's own Postgres), so multi-user local installs stay tenant-isolated.
- The `/control/*` surface is the only new externally-reachable API; it is install-token-authenticated and rate-limited.

## 7. Deployment shapes

- **Cloud control plane:** one deployment, `OMILO_MODE=cloud`, multi-tenant, owns auth + billing + `/control/*` + the Doit webhook. This is the existing backend — no data model fork.
- **Local runtime:** the self-host stack (Docker, or the desktop app's companion), `OMILO_MODE=runtime` + `OMILO_CONTROL_PLANE_URL=https://api.omilo.app`. Its Postgres holds only workspace/runtime data.
- **Desktop (P5c):** the thin Tauri client points at a local runtime (localhost) that itself federates to the cloud — or, in the simplest install, the desktop app bundles/launches the local runtime.

## 8. Migration / build phasing (P6)

Additive — today's single backend is already "cloud mode" with an in-process control plane:
1. Extract the `ControlPlane` port + `LocalControlPlane` (wrap current auth/billing) — no behavior change in cloud mode.
2. Add the `/control/*` endpoints (cloud mode) + install-token model (cloud-authoritative, revocable).
3. Add `RemoteControlPlane` (runtime mode) — JWKS verify (offline), cached entitlements/balance, usage outbox.
4. Wire runtime mode: auth via ControlPlane, billing gate via `check_balance` (pooled→online, BYO→free), metering via `report_usage`; the `paused_offline` job path; the local Company shadow.
5. Mode config + install registration + keychain storage (desktop).
6. Packaging (revised P5e): two deployables — cloud control plane image + local runtime stack pointing at it.

**Deferred:** a hosted control plane at a real domain + JWKS rotation ops; billing reconciliation dashboards; multi-region.

## 9. Non-goals

- The runtime is not a billing authority and never writes the credit ledger.
- No peer-to-peer or runtime→runtime trust; all trust flows through the cloud control plane.
- Offline pooled inference is intentionally **not** supported (credits must be authoritative); BYO/local covers the offline use case.
