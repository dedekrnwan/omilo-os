# P7 — Product Telemetry (PostHog, mode-aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vendor product analytics via **PostHog** to learn how omilo is used (for monetization + improvement) — **without breaking the privacy model**: `local` mode sends nothing by default (opt-in only), hybrid/cloud send **content-free usage events** keyed by the cloud `company_id`. Config-driven so it works with self-hosted PostHog *or* PostHog Cloud.

**Architecture:** A thin `Telemetry` port (mirrors the `ControlPlane`/`platform` ports): `NoopTelemetry` (local mode, or when unconfigured) + `PostHogTelemetry` (posthog-python, server-side) on the backend; `posthog-js` on the frontend, gated on a backend-provided telemetry config. Events are a fixed, reviewed taxonomy of **counts/categories only — never content, PII, keys, or RAG/message text**. Identity = the cloud `company_id` (which only exists in hybrid/cloud); `local` is anonymous + off-by-default.

**Tech Stack:** FastAPI + posthog-python, React + posthog-js, Pydantic settings. Builds on merged P0–P6 + P5e + the three-mode model (P6b design §12.10). Branch from `main`.

## Global Constraints

- Builds on merged `main`. The existing suites (backend 719, frontend 395) stay green; telemetry is additive and **off unless configured**.
- **Privacy is the hard constraint (ties to docs/technical/12 §10):**
  - `OMILO_MODE=local` → `NoopTelemetry` + frontend telemetry disabled **by default**; only an explicit user opt-in enables it. Air-gap stays intact.
  - hybrid/cloud → enabled only when `POSTHOG_API_KEY` is configured; still honor a per-user/company **opt-out** + browser Do-Not-Track.
  - **No content ever:** events carry counts, enums, durations, feature names — NEVER message text, RAG content, connector secrets, API keys, emails, or names. A reviewer rejects any event property that could carry user content/PII.
  - Identify by the cloud `company_id` + an opaque user id (the JWT `sub`); `local` opt-in uses an anonymous device id, no company.
- **Config-driven (self-host OR cloud):** `POSTHOG_API_KEY` + `POSTHOG_HOST` (default `https://us.i.posthog.com`; set to a self-hosted URL or EU host for residency). Unset key → telemetry fully disabled (Noop) in every mode — safe default.
- Telemetry must **never** block, slow, or fail a request/job — all emission is best-effort, swallowed+logged, and (server) batched/async.
- No secrets committed — the PostHog key is an env var; the frontend gets the (publishable) project key from a backend config endpoint, not hardcoded.

## Review Focus

- **Local mode sends nothing:** with `OMILO_MODE=local` and no opt-in, zero events leave the process/browser (NoopTelemetry; frontend init skipped). Test: local mode → capture is a no-op, no network. (T1, T2)
- **Unconfigured = off everywhere:** no `POSTHOG_API_KEY` → Noop in all modes; the frontend config endpoint returns `{enabled:false}` and posthog-js never inits. Test. (T1, T3)
- **No content/PII in events:** every event in the taxonomy carries only counts/enums/ids — a reviewer checks each emitted event's properties against the "no content" rule; message/RAG/secret/email/name never appears. Test: assert the captured payloads contain only allowlisted property keys. (T1, T2)
- **Best-effort, never breaks the app:** a PostHog outage / bad key does not fail or delay a chat turn, job, or page render (emission is swallowed). Test: telemetry client raising → the request/job still succeeds. (T1)
- **Opt-out respected:** a company/user opt-out (and DNT) disables capture even in hybrid/cloud. Test. (T2/T3)

---

### Task 1: Backend `Telemetry` port (Noop + PostHog) + config + core server-side events

**Files:**
- Create: `apps/api/omilo/telemetry/__init__.py` (the `Telemetry` Protocol + `capture(event, company_id=None, user_id=None, props=None)` + the event-name constants + the allowlisted-property guard), `apps/api/omilo/telemetry/posthog.py` (`PostHogTelemetry`), `apps/api/omilo/telemetry/noop.py` (`NoopTelemetry`), `apps/api/omilo/telemetry/factory.py` (`get_telemetry()` mode+config-aware)
- Modify: `apps/api/omilo/config.py` (`POSTHOG_API_KEY`, `POSTHOG_HOST`, `TELEMETRY_ENABLED` override), `apps/api/pyproject.toml` (add `posthog`), and the emit sites (loop/runner `job_completed`, approvals `proposal_decided`, billing `credit_topup`/`plan_changed`, control `install_registered`/`local_to_hybrid_upgraded`)
- Test: `apps/api/tests/test_telemetry.py`

**Interfaces:**
- `Telemetry` Protocol: `capture(event: str, *, company_id: str|None, user_id: str|None, props: dict|None) -> None` (best-effort, never raises). `NoopTelemetry.capture` = no-op. `PostHogTelemetry` wraps posthog-python (`distinct_id = company_id or user_id or "anon"`, `groups={"company": company_id}` when present), batched/async, swallow+log on error.
- `get_telemetry()`: `NoopTelemetry` when `OMILO_MODE=local` (unless an explicit opt-in flag) OR when `POSTHOG_API_KEY` is unset; else `PostHogTelemetry`. Cached singleton.
- Event constants + an **allowlist of property keys per event** (the guard strips/omits any non-allowlisted key so content can't leak). Initial server events: `job_completed {type, engine_type, status, duration_bucket, token_bucket}`, `proposal_decided {decision, risk}`, `credit_topup {pack}`, `plan_changed {plan_id}`, `install_registered {}`, `local_to_hybrid_upgraded {}`. NO free-text, NO ids of user content.

- [ ] **Step 1: Write failing test** — `test_telemetry.py`: `get_telemetry()` is `NoopTelemetry` when `OMILO_MODE=local` and when `POSTHOG_API_KEY` unset; is `PostHogTelemetry` when configured + hybrid/cloud. A `PostHogTelemetry` with an injected fake client captures `job_completed` with ONLY allowlisted props (assert a content-ish prop like `brief`/`message` is omitted). A capture whose underlying client RAISES does not propagate (best-effort). Emitting from a job path does not change the job result.
- [ ] **Step 2: Run it → fail.**
- [ ] **Step 3: Implement** the port, Noop/PostHog impls, factory, config, the property allowlist guard, and wire the ~6 server events best-effort.
- [ ] **Step 4: Full suite green (719) + new; telemetry off by default (no key) so nothing changes.**
- [ ] **Step 5: Commit.**

### Task 2: Frontend posthog-js (gated) + funnel events + opt-out

**Files:**
- Create: `src/telemetry/index.ts` (`initTelemetry(config)`, `capture(event, props)`, `optOut()/optIn()`, an allowlist guard), `src/telemetry/posthog.ts`
- Modify: `package.json` (add `posthog-js`), the app bootstrap (init after fetching the telemetry config), and the key funnel call sites (onboarding steps, area create, message send, connector install, token mint, plan change, upgrade) + a settings opt-out toggle
- Test: `src/telemetry/telemetry.test.ts`

**Interfaces:**
- `initTelemetry({enabled, key, host, mode})`: if `!enabled` or `mode==='local'` (without opt-in) or DNT → do NOT init posthog-js (no network). Else init with the key/host. `capture(event, props)` strips to an allowlist (no content). `optOut()` persists + calls posthog opt-out. Content-free funnel events: `onboarding_step {step}`, `onboarding_completed`, `area_created`, `message_sent`, `connector_installed {piece}`, `mcp_token_minted`, `plan_changed {plan}`, `connect_to_cloud_clicked`. NEVER capture message text / field values.
- The app fetches the telemetry config from the backend (T3) before init.

- [ ] **Step 1: Write failing tests** — `telemetry.test.ts`: `initTelemetry({enabled:false})` / `{mode:'local'}` / DNT → posthog-js init NOT called (stub the module). `enabled:true` hybrid → init called with the key/host. `capture('message_sent', {text:'secret'})` → the sent props omit `text` (allowlist). `optOut()` → subsequent capture is a no-op. Build gate: `npx vitest run` + `npx tsc -b`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the telemetry module + gated init + funnel captures + the settings opt-out; add posthog-js.
- [ ] **Step 4: `npx vitest run` green + `npx tsc -b` 0; app unchanged when telemetry disabled (default).**
- [ ] **Step 5: Commit.**

### Task 3: Telemetry config endpoint + privacy copy + docs

**Files:**
- Create: `apps/api/omilo/api/telemetry_config.py` (`GET /v1/telemetry-config` → `{enabled, key, host, mode, opted_out}`; the key is the PUBLISHABLE project key, only returned when enabled) — or fold into `/me`
- Modify: a settings section (frontend) for the opt-out toggle; `README.md` + `docs/technical/13-telemetry.md` (what's collected, the no-content guarantee, mode behavior, opt-out, self-host vs cloud PostHog config)
- Test: `apps/api/tests/test_telemetry_config.py`

**Interfaces:** `GET /v1/telemetry-config` → `{enabled: bool, key: str|null, host: str|null, mode, opted_out}`; `enabled=false` + `key=null` when local(no opt-in) / unconfigured / opted-out. `POST /v1/telemetry-config {opted_out}` persists the company/user opt-out. Docs state exactly which events are collected (the taxonomy), that no content/PII is sent, that local is off by default, and how to point at self-hosted PostHog.

- [ ] **Step 1: Write failing test** — `test_telemetry_config.py`: unconfigured → `{enabled:false, key:null}`; configured + hybrid → `{enabled:true, key:<publishable>, host}`; local mode → `enabled:false` unless opted-in; opt-out persists → `enabled:false`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the endpoint + opt-out persistence + the settings toggle + docs/privacy copy.
- [ ] **Step 4: Full suite green (backend) + frontend vitest+tsc.**
- [ ] **Step 5: Commit.**

---

## Self-Review notes (author)

- **Coverage:** backend port + server events (T1), frontend posthog + funnels + opt-out (T2), config surface + privacy docs (T3). Monetization dashboards (Metabase on the billing DB) + error tracking (Sentry) are intentionally OUT of scope ("PostHog for now").
- **Privacy is the spine:** local-off-by-default, unconfigured-off-everywhere, content-free allowlist, opt-out + DNT, best-effort-never-breaks — these are the five Review-Focus tests. The allowlist guard (both backend + frontend) is the mechanism that makes "no content leaks" enforceable, not just intended.
- **Config-driven keeps the ops/cost call yours:** self-hosted vs PostHog Cloud (US/EU) is purely `POSTHOG_HOST` + the key; the code is agnostic. Unset key = fully off.
- **Consistent with the architecture:** the `Telemetry` port mirrors `ControlPlane`/`platform`; mode-awareness reuses `OMILO_MODE`. Depends on nothing from P6b except the `local` mode value (telemetry treats any non-configured/local as Noop, so it's safe to build before or after P6b).
- **Proportion:** 3 tasks; the sharpest tests are the no-content allowlist + local-sends-nothing + best-effort-never-breaks.
