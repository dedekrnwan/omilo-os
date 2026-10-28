# 13 — Product Telemetry (PostHog, mode-aware)

**Status:** Implemented (P7). Off by default; configured via env vars.

---

## Overview

Omilo collects **content-free product analytics** to understand feature usage and support monetisation decisions. The telemetry stack is PostHog (server-side Python SDK on the backend; posthog-js on the frontend), but the design is config-driven — any PostHog-compatible endpoint works, including self-hosted instances.

**Privacy is the hard constraint:** no content, no PII, no free-text ever leaves the process. Identity is the cloud `company_id`; `local` mode is off by default.

---

## What Is Collected

### Backend events (server-side, posthog-python)

| Event | Properties | Notes |
|---|---|---|
| `job_completed` | `type`, `engine_type`, `status`, `duration_bucket`, `token_bucket` | Coarse buckets only — no raw duration/token counts, no brief/content |
| `proposal_decided` | `decision`, `risk` | Outcome only — no proposal title, body, or user note |
| `credit_topup` | `pack` | Pack name (e.g. "small") — no amount, no payment reference |
| `plan_changed` | `plan_id` | Plan tier identifier — no price, no email |
| `install_registered` | _(none)_ | Signal only — a new install was registered |
| `local_to_hybrid_upgraded` | _(none)_ | Signal only — a local install upgraded to hybrid |

### Frontend events (posthog-js, when enabled)

| Event | Properties |
|---|---|
| `onboarding_step` | `step` |
| `onboarding_completed` | _(none)_ |
| `area_created` | _(none)_ |
| `message_sent` | _(none)_ |
| `connector_installed` | `piece` |
| `mcp_token_minted` | _(none)_ |
| `plan_changed` | `plan` |
| `connect_to_cloud_clicked` | _(none)_ |

### No-content/no-PII guarantee

Every event payload is filtered through a **per-event property allowlist** before emission. Any property key not in the allowlist is **silently dropped** — content, PII, free-text, API keys, RAG results, message text, email addresses, and user names can never reach PostHog, regardless of call-site mistakes.

Identity: `distinct_id = company_id` (cloud/hybrid) or an anonymous device id (local opt-in). No user email, no user name, no content id.

---

## Mode Behaviour

| `OMILO_MODE` | Default telemetry state | Notes |
|---|---|---|
| `cloud` | **On** when `POSTHOG_API_KEY` is configured | Normal SaaS path |
| `hybrid` | **On** when `POSTHOG_API_KEY` is configured | Self-hosted runtime, cloud control plane |
| `local` | **Off by default** | Air-gap / fully local. No events leave the process unless `TELEMETRY_ENABLED=true` is explicitly set |

`POSTHOG_API_KEY` unset → **NoopTelemetry in all modes** (safe default; nothing leaves the process).

`TELEMETRY_ENABLED=false` → forced Noop regardless of mode or key.

---

## Opt-Out

Companies can opt out at any time. Opt-out is:

- **Per company** — stored as `Company.telemetry_opted_out` (boolean, default `false`).
- **Enforced on both backend and frontend** — the backend stops capturing; the frontend config endpoint returns `{enabled: false, key: null}` so posthog-js is never initialised.
- **Reversible** — posting `{opted_out: false}` re-enables.

### API

```
GET  /v1/telemetry-config
→ { enabled: bool, key: str|null, host: str|null, mode: str, opted_out: bool }

POST /v1/telemetry-config
Body: { opted_out: bool }
→ updated config (same shape as GET)
```

`key` is returned **only** when `enabled=true`. The publishable PostHog project key is never exposed to the frontend when telemetry is disabled, local mode, or opted out.

### Browser Do-Not-Track

The frontend respects the browser `navigator.doNotTrack` signal — if DNT is set, posthog-js is not initialised even when the backend returns `enabled: true`.

---

## Self-Hosted vs PostHog Cloud

Set two environment variables:

| Variable | Default | Notes |
|---|---|---|
| `POSTHOG_API_KEY` | _(empty — telemetry off)_ | Your PostHog project API key (publishable). Leave unset to disable telemetry entirely. |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | Override for EU residency (`https://eu.i.posthog.com`) or a self-hosted URL (e.g. `https://posthog.example.com`). |

The code is entirely agnostic between PostHog Cloud and a self-hosted instance — the key and host are the only differences.

Example `.env` for PostHog Cloud (US):
```
POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxx
# POSTHOG_HOST defaults to https://us.i.posthog.com
```

Example for EU data residency:
```
POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxx
POSTHOG_HOST=https://eu.i.posthog.com
```

Example for self-hosted:
```
POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxx
POSTHOG_HOST=https://posthog.your-domain.com
```

Example to enable in local mode (explicit opt-in, e.g. for internal analytics):
```
POSTHOG_API_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxx
TELEMETRY_ENABLED=true
```

---

## Architecture

```
Backend                         Frontend
───────────────────────         ──────────────────────────────
get_telemetry() factory         GET /v1/telemetry-config
  ├─ NoopTelemetry               → {enabled, key, host, mode, opted_out}
  │   (local mode / no key /     initTelemetry(config)
  │    forced off)                 ├─ if !enabled → skip init (no network)
  └─ PostHogTelemetry             └─ if enabled → posthog.init(key, host)
      (posthog-python, batched)
      capture(event, props)    capture(event, props)
        → allowlist filter       → allowlist filter
        → best-effort emit       → posthog.capture()
        (never raises,
         never blocks request)
```

**Best-effort:** A PostHog outage, network error, or invalid key never fails or delays a request or job. All emission errors are caught, swallowed, and logged at DEBUG level.

**Singleton:** `get_telemetry()` is cached via `functools.lru_cache`. Tests call `get_telemetry.cache_clear()` to reset between test cases.

---

## Privacy Summary

| Guarantee | Mechanism |
|---|---|
| local mode sends nothing by default | `get_telemetry()` returns `NoopTelemetry`; frontend skips init |
| unconfigured = off everywhere | No `POSTHOG_API_KEY` → `NoopTelemetry`; frontend `enabled: false` |
| no content/PII in events | Per-event property allowlist; allowlist guard strips any non-allowlisted key before emission |
| opt-out respected | `Company.telemetry_opted_out`; `enabled: false` + `key: null` returned to frontend |
| best-effort, never breaks | All capture errors caught+swallowed; async/batched emit |
| key not leaked when disabled | `/v1/telemetry-config` returns `key: null` unless `enabled: true` |
