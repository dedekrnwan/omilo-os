# P6b — Local mode (free BYO self-host) + local→hybrid upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third install mode — `OMILO_MODE=local`: a fully-local, cloud-free, free-ELv2 self-host where identity + company + data all live on the user's machine and AI runs BYO-key / local-model only (0-credit, no metering). Plus a one-way `local → hybrid` upgrade that re-keys local data to a cloud company and starts federating identity/billing.

**Architecture:** Additive on P6. `local` reuses `LocalControlPlane` (the authoritative in-process auth/billing from cloud mode) deployed single-tenant, with a **free BYO-only billing posture** (no gate, no metering, pooled cloud inference disabled) and **no cloud dependency** (no control-plane URL, no `/control`, no register/heartbeat/JWKS). The upgrade flow registers with the cloud, re-keys the local `company_id` to the cloud `company_id` across tenant tables, and switches to `hybrid` (the former `runtime`). Cloud + hybrid modes are unchanged.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Postgres 16 + RLS, Pydantic v2. Builds on merged P0–P6 + P5e (`main @ 91b31a3`).

**Spec:** docs/technical/12-control-plane-runtime-split.md §10 (the three-mode addendum — authoritative) + §3/§4 (the port + credit rules it extends).

## Global Constraints

- Builds on merged P0–P6; branch off fresh `main` (`91b31a3`). **Cloud + hybrid modes stay behavior-identical** — the existing suite (719) passes unchanged; `local` mode is new.
- Backend gate: `pytest` (apps/api). Offline-deterministic — `local` mode needs NO cloud/network at all (that's its point); hybrid tests keep using `FakeControlPlane`.
- **Mode vocabulary:** `OMILO_MODE ∈ {local, hybrid, cloud}`. `hybrid` is the new name for the former `runtime`; keep `runtime` as a **back-compat alias** for `hybrid` so P6's config/tests don't break. `local` and `cloud` both select `LocalControlPlane`; `hybrid`/`runtime` select `RemoteControlPlane`.
- **`local` = free BYO-only, zero cloud:** no `OMILO_CONTROL_PLANE_URL`/`OMILO_INSTALL_TOKEN` required; `/control/*` not mounted; no register/heartbeat/JWKS/report_usage; the billing gate treats every job as 0-credit (no balance check, no `CreditLedger` write, no metering); pooled/cloud-metered engines (`litellm` pool) are refused/disabled so no un-billed pooled inference happens. Local auth is authoritative (normal sign-up/sign-in; the local DB owns User/Member/Company — NOT claims-only, NOT shadowed). RLS FORCE still applies (single tenant).
- **The margin invariant is preserved:** `local` can't use pooled credits (there's no cloud to meter), so there's nothing to forge; monetization stays on cloud/hybrid. A tampered local DB in `local` mode grants nothing because 0-credit BYO is all it can run.
- No secrets committed. The upgrade re-key runs inside the local DB (a `company_id` re-scope), never ships data to cloud beyond the normal hybrid federation.

## Review Focus

- **`local` needs zero cloud:** with `OMILO_MODE=local` and NO control-plane URL / install token / network, the app starts, a user signs up locally, and a BYO/local job runs end-to-end — no JWKS fetch, no register, no `/control`. Test: local mode, network-free, full auth+job path works. (T1)
- **`local` can't run pooled/metered inference:** a `litellm`-pool (credit-consuming) job in `local` mode is refused with a clear "pooled inference requires connecting to Omilo Cloud" message (or the engine is unavailable) — it NEVER runs un-metered. BYO/local jobs run free. Test both. (T1)
- **Cloud/hybrid unchanged:** the 719 suite passes; `runtime` alias still selects `RemoteControlPlane`; P4 billing + P6 runtime tests untouched. (T1)
- **Upgrade re-keys correctly + scoped:** `local→hybrid` re-keys EVERY tenant table's `company_id` from the local id to the cloud id atomically; no row is left under the old id; a second company's data (if any) is untouched; after switch, the install is hybrid (cloud JWT verifies, pooled credits available). Test: seed local data under company L, connect→cloud company C, assert all rows now under C, mode hybrid. (T2)
- **Upgrade is one-way + safe:** hybrid→local is rejected; a failed/aborted upgrade leaves the install usable as `local` (transactional — no half-migrated state). Test. (T2)

---

### Task 1: `local` mode — config + factory + free BYO-only billing posture + local auth

**Files:**
- Modify: `apps/api/omilo/config.py` (`OMILO_MODE` enum local|hybrid|cloud + runtime alias), `apps/api/omilo/control/factory.py` (mode→impl), `apps/api/omilo/billing/balance.py` + `meter.py` (local-mode free posture), `apps/api/omilo/engine/__init__.py` or the engine factory (refuse pooled/`litellm` in local mode), `apps/api/omilo/main.py` (don't require/mount `/control` in local), `apps/api/omilo/auth/deps.py` (local = authoritative local auth, NOT claims-only)
- Test: `apps/api/tests/test_local_mode.py`

**Interfaces:**
- `OMILO_MODE`: `local` (default for a privacy-first self-host) | `hybrid` | `cloud`; `runtime` accepted as an alias of `hybrid`. `get_control_plane()`: `local`/`cloud` → `LocalControlPlane`; `hybrid`/`runtime` → `RemoteControlPlane`.
- A helper `is_local_mode()` / `is_cloud_authoritative()` so the billing + auth forks are readable. In `local` mode: the gate (`check_can_start_job`) returns allowed with 0-credit for EVERY job and never reads a balance; `meter_job` is a no-op (no `CreditLedger`); the engine factory refuses a `litellm`-pool/credit-consuming engine with a clear error (BYO engines — anthropic/claude_code/local/graph/fake — run normally). Auth in `local` mode uses the normal local `User`/`Member` path (authoritative), NOT the hybrid claims-only/shadow path.

- [ ] **Step 1: Write failing test** — `test_local_mode.py`: `OMILO_MODE=local` → `get_control_plane()` is `LocalControlPlane`, no `OMILO_CONTROL_PLANE_URL` needed; a local sign-up + authed request works with no network; a BYO/local-engine job runs to completion (0 credits, no `CreditLedger` row); a `litellm`-pool job is refused with a clear message (never runs un-metered); `/control` is not mounted in local mode. `runtime` alias → `RemoteControlPlane`. Cloud mode unchanged.
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** the mode enum+alias, factory, local billing posture, pooled-engine refusal, local-authoritative auth, `/control` gating.
- [ ] **Step 4: Full suite green (719) + new; cloud/hybrid unchanged (P4 + P6 runtime tests pass; `runtime` alias works).**
- [ ] **Step 5: Commit.**

### Task 2: `local → hybrid` upgrade — re-key migration + `omilo connect`

**Files:**
- Create: `apps/api/omilo/control/upgrade.py` (`connect_to_cloud(db, user_jwt, control_plane_url) -> UpgradeResult`), `apps/api/omilo/control/rekey.py` (`rekey_company(db, old_company_id, new_company_id)`), an `omilo-connect` console script in `apps/api/pyproject.toml`
- Modify: config/startup to allow the post-upgrade mode switch (write the new mode + control-plane URL + install token to the runtime config/env store)
- Test: `apps/api/tests/test_upgrade_local_to_hybrid.py`

**Interfaces:**
- `rekey_company(db, old_company_id, new_company_id)`: in ONE transaction, UPDATE `company_id` from old→new across EVERY tenant table (enumerate them from the model registry / the RLS table list — Channel, Goal, Routine, Flow, ChatSession, Message, Inbox, Helper, Job, Report, RunEvent, Proposal, KbSource, KbChunk, MemoryDoc, Skill, Connector, HarnessAccount, ProviderKey, ToolCall, McpAccessToken, DoitPayment?, WalletSettings?, etc.) + the local `Company` row. Must cover ALL of them (a missed table orphans data) — derive the list programmatically from the tenant-table registry, do not hardcode-and-forget. Runs under a privileged session (re-tenanting crosses the RLS boundary intentionally). Atomic: all-or-nothing.
- `connect_to_cloud(db, user_jwt, control_plane_url)`: (1) via a `RemoteControlPlane(control_plane_url)` register the install with the cloud `user_jwt` → cloud `company_id` + install token; (2) `rekey_company(db, local_company_id, cloud_company_id)`; (3) persist the new config (`OMILO_MODE=hybrid`, `OMILO_CONTROL_PLANE_URL`, `OMILO_INSTALL_TOKEN`) so the next start is hybrid; (4) retire the local `User`/`Member` authority (identity is now cloud). Return an `UpgradeResult`. One-way: a guard rejects running it when already hybrid/cloud.
- `omilo-connect` console script: wraps `connect_to_cloud` (prompt/accept a user JWT + the cloud URL).

- [ ] **Step 1: Write failing test** — `test_upgrade_local_to_hybrid.py` (FakeControlPlane for the cloud side): seed a `local` install with a Company L + data across several tenant tables (channels/goals/jobs/kb/etc). Run `connect_to_cloud(..., fake cloud → company C)` → assert EVERY seeded row is now under company C (none left under L), the local Company is re-keyed/retired, the persisted mode is `hybrid`, and an authed request with a cloud JWT (verified via the fake JWKS) now works + pooled credits are available. A second call (already hybrid) → rejected. A simulated failure mid-rekey → rolled back (data still intact under L, still usable as local).
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** `rekey_company` (programmatic tenant-table enumeration), `connect_to_cloud`, the config persistence, the one-way guard, the console script.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit.**

### Task 3: Packaging + onboarding mode selector (default local; `omilo connect` to upgrade)

**Files:**
- Modify: `deploy/docker-compose.runtime.yml` → rename/retarget as the self-host stack with `OMILO_MODE` configurable (default `local`); `deploy/.env.runtime.example` (document local vs hybrid); `packaging/npm/bin/omilo.js` (`omilo up` defaults local; add `omilo connect` → runs `omilo-connect` in the api container); root `Makefile` (`up` local default, `connect` target); `README.md` (the three modes + the choice)
- Modify (frontend, minimal): the onboarding/first-run copy to state the mode (if a mode indicator is easy) — OPTIONAL; keep it light, gate on vitest+tsc.
- Test: launcher `--help`/parse checks; compose `config`; README accuracy. (Ops-style gates like P5e.)

**Interfaces:** self-host defaults to `OMILO_MODE=local` (no cloud env needed — privacy-first out of the box); `omilo connect` (launcher) → runs `omilo-connect` to upgrade to hybrid (sign in to cloud, re-key, switch). `.env.runtime.example` documents both. README explains: local (free, BYO, no cloud) vs hybrid (cloud identity + pooled credits) vs the vendor cloud. The cloud compose is unchanged.

- [ ] **Step 1: Write/adjust** the compose default, launcher `up`(local)+`connect`, Makefile, env example, README.
- [ ] **Step 2: Validate** — `docker compose -f deploy/docker-compose.runtime.yml config` exits 0 (local default needs no required secret); `node packaging/npm/bin/omilo.js --help` shows `up`/`connect` + exit 0; `make -n up`/`-n connect` sane; README accurate; (if frontend touched) vitest+tsc green.
- [ ] **Step 3: Commit.**

---

## Self-Review notes (author)

- **Coverage (§10):** `local` mode (T1), the local→hybrid upgrade + re-key (T2), packaging/onboarding default-local + connect (T3). `cloud`/`hybrid` unchanged.
- **The free-BYO invariant:** `local` can't run pooled/metered inference (engine refused) and never writes a ledger, so there's nothing to forge — the margin model stays intact (monetization = cloud/hybrid only). This is the spine of T1's Review Focus.
- **The re-key is the risk:** T2 must re-tenant EVERY tenant table programmatically (a missed table orphans the user's data under the old company) and be atomic (a failed upgrade leaves a working `local` install). The Review Focus pins "every row moved / none orphaned / rollback-safe / one-way."
- **Additive + safe:** `local`/`cloud` both map to `LocalControlPlane`; `hybrid`/`runtime` to `RemoteControlPlane`. The 719 suite is untouched; `runtime` stays a working alias so P6 doesn't regress.
- **Proportion:** 3 tasks — the mode+billing posture (T1), the upgrade/re-key (T2, the hard one), and packaging/onboarding (T3). T2 carries the sharpest test.
