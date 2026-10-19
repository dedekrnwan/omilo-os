# Claude Code auth — local login + subscription-pool hardening (Design)

Date: 2026-10-20
Status: Draft for approval
Author: Dede Kurniawan (with Claude)

## Intent & why

Using a Claude **subscription** with Omilo today requires `claude setup-token` (which needs the
Claude Code CLI) and pastes a long-lived `sk-ant-oat…` token into Omilo's server-side Harness pool.
That's friction for users, and — more importantly — pooling consumer subscription tokens in a
third-party server for automation is the pattern Anthropic prohibits and has enforced against. So
the current path is both high-friction and exposed.

This project does two things:
1. **A zero-friction, compliant path for a single user on their own machine** — reuse the Claude
   Code login they already have (the "Orca posture": Omilo just drives the user's own
   locally-authenticated `claude`; the credential never leaves the machine, is never pooled, is
   never handled by Omilo).
2. **Make the existing subscription pool safe to keep** — opt-in, clearly disclosed, and
   *non-load-bearing*: if Anthropic cuts it off (or an account is revoked/limited), Omilo
   automatically falls back so no work is lost.

The subscription pool is kept (the owner's explicit choice), not removed — just hardened.

## Goals

- **New Claude Code engine auth mode `"local"`:** run the user's locally-installed,
  locally-authenticated `claude` with **no credential injected by Omilo**. Available on the
  light/desktop tier (same machine as the user's login).
- **Detection + surfacing:** detect whether `claude` is installed and logged in; show the status in
  onboarding (the "Connect Claude" step) and in `omilo doctor`.
- **Fallback ladder (makes the pool non-load-bearing):**
  - `auth == "local"`: local login → (if absent/not-logged-in) the user's API key → clear error.
  - pool / `auth == "auto"` exhausted: **spill to the API key even in pool mode**, and if there's
    no key, **re-queue the task and wait (backoff) instead of failing** — "fallback then wait".
- **Subscription pool hardening:** opt-in and off by default; an explicit one-time **disclosure**
  (your own accounts; pooling subscriptions for automation may violate Anthropic's terms and can be
  suspended; you accept responsibility); own-accounts-only (already true); and the auto-fallback
  above so losing the pool is a shrug, not an outage.
- **Honest active-auth signal:** the run status always shows which auth actually ran (the engine
  already emits `status` events with the account/mode) — never a silent switch.

## Non-goals

- **No in-app OAuth for subscriptions.** Anthropic publishes no third-party OAuth for subscription
  credentials, and replicating `claude setup-token`'s flow is both undocumented and against ToS.
  Out of scope, permanently.
- **Not the compliant cost levers** (prompt-caching defaults, model tiering, batch API) — a
  separate follow-up project.
- **Not removing the Harness pool** — keep it, harden + disclose it.
- **No change to `OMILO_HARNESS_PARALLEL`** (stays default 2; one subscription may still serve up to
  2 agents).
- **No new server-side token lifting/pooling**, and `"local"` is never offered on the hosted/full
  tier or inside the container.

## Anti-goals (failure even if it "works")

- A `"local"` mode that **silently** falls back so the user can't tell whether their subscription,
  their API key, or the pool ran. The active auth must be visible.
- Disclosure copy that soft-pedals or hides the ToS risk.
- Making the pool **load-bearing** — if the pool dies, work must continue via API/local, not stop.
- A "wait when pool empty" that **spins/polls hot** — it must re-queue with bounded backoff.
- Breaking the existing `"api"` and pool/`"auto"` paths (full-tier behavior unchanged).

## Constraints & current structure

- Engine: `apps/api/omilo_api/engines/claude_code.py`.
  - `_once(cli, token, args, cwd, config, emit, timeout, token_env="CLAUDE_CODE_OAUTH_TOKEN")`
    sets `env[token_env] = token` and spawns `claude -p … --output-format stream-json …`.
  - `STRIP_ENV` already scrubs `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
    `CLAUDE_CODE_OAUTH_TOKEN` from the child env (so a stray env var can't override a chosen one —
    and, usefully, can't override the stored local login either).
  - `run_task`/`chat` branch on `cfg.get("auth")`: `"api"` → `_run_api` (token_env=ANTHROPIC_API_KEY);
    otherwise the `H.lease()` loop (token_env=CLAUDE_CODE_OAUTH_TOKEN), with API overflow when
    `auth == "auto"` and `api_key()` is set; on empty pool it currently returns the error
    *"No Claude Code account is free right now…"*.
- `harness.py`: `find_cli()` locates `claude`; `lease()` picks least-busy→LRU among enabled,
  not-cooling, not-error, under-`MAX_PARALLEL_PER_ACCOUNT` accounts; `release()` records usage,
  cooldowns, limit-hits, auth errors.
- The worker dispatcher (`worker.py`) is where a task lives before/after running — the right place
  for "re-queue + backoff when the pool is empty and no API key".
- Local login uses Claude Code's **own** credential store (`~/.claude` / OS keychain). Omilo must
  not inject a token and must preserve `HOME` so the store resolves. `STRIP_ENV` removing the auth
  vars is correct here.

## The how (decided in conversation — items marked "my call" settled by Claude)

### 1. `auth: "local"` engine mode
- Teach `_once` that `token_env=None` means **inject no auth var** (only set a token when one is
  given). *(My call.)* Under the current `STRIP_ENV`, Claude Code then authenticates via the user's
  stored login.
- Add `_run_local(...)` (sibling of `_run_api`) that calls `_once(cli, token="", …, token_env=None)`
  — no `H.lease()`, no pool, no token.
- **`_run_local` must NOT set `CLAUDE_CONFIG_DIR`** (builder-check #4). `_once` today always points
  `CLAUDE_CONFIG_DIR` at Omilo's per-company `harness/config` dir — but the user's login lives in
  their default `~/.claude`. Local runs must let that default resolve (don't override the config
  dir), while still passing the MCP server via `--mcp-config` (that's independent of the credential
  store). *(My call.)*
- `run_task`/`chat` gain the `"local"` branch with the fallback ladder (local → api_key → error).
- **`"local"` is a first-class provider** in the auth registry (builder-check #2): add it to
  `AI_PROVIDERS` / `_engine_for` / `_provider_of` / `_engine_from_onboarding` / `_engine_label` /
  `health`, with the special property that it **requires no key** (unlike every existing provider,
  so `_apply_ai`'s key-requirement check must exempt it). *(My call — first-class keeps the
  provider round-trip consistent; a hidden sub-mode would leave values `_provider_of` can't map.)*
- **Do NOT overload `"auto"`** (builder-check #5). `"auto"` keeps its current meaning (pool → API
  key); it is *not* re-pointed at local on the light tier (that would silently re-route existing
  `"auto"` installs that have a pool). Local is only ever reached by explicitly choosing the
  `"local"` provider. *(My call — reverses an earlier idea the check flagged as risky.)*

### 2. Detection — `H.local_login_status(cli) -> {"installed": bool, "logged_in": bool}`
- `installed`: reuse `find_cli()`.
- `logged_in`: pragmatic check — presence of Claude Code's credential store
  (e.g. `~/.claude/.credentials.json`) and/or a cheap probe. **This is the one soft spot** (Claude
  Code exposes no stable documented "logged-in" flag); design so a *false negative just falls back*
  to API/error, never hard-fails. Exact mechanism is left to the builder to pin against the
  installed CLI version.

### 3. Fallback-then-wait when the pool is exhausted
- In the engine's empty-pool branch: if `api_key()` → `_run_api` (spill over) **regardless of
  `auth` being "auto" or pure pool** — pure-pool today errors; make it spill too when a key exists.
  *(My call.)*
- If no API key and no free account: **do not fail the task.** This needs a **distinct
  non-terminal state** (builder-check #3) — the existing retry path (`_finish` → `loops.transient`,
  `attempts < 3`, 30s/60s, then permanent fail) would burn an attempt and hard-fail in ~90s, the
  opposite of "wait for a slot." So: when the pool is exhausted and there's no key, the task goes to
  a **waiting-for-capacity** state (modeled on the existing `"waiting"` graph-approval state),
  **releases its concurrency slot, is NOT counted as a failed attempt**, and is re-dispatched when
  an account frees or a cooldown resets. *(My call for the mechanism.)* **How long it waits before
  giving up and surfacing to the owner is an owner decision — see Open Questions.**

### 4. Pool hardening — disclosure + opt-in
- Subscription pool is **off by default**; enabling it shows a one-time disclosure the user must
  accept (stored as a setting). Copy conveys: your own accounts; pooling subscriptions for
  automation may violate Anthropic's terms and can be suspended; auto-falls-back if it stops.
- **Gate the disclosure at enable / add-first-account time, NOT in `lease()`** (builder-check #6) —
  keep the hot path clean; don't add a consent check to every lease.
- Own-accounts-only (already true). No change to lease concurrency.
- **Upgrade behavior for existing installs that already have pool accounts is an owner decision —
  see Open Questions.**

### 5. Gating — purely on detection, not tier (builder-check #1)
- The light Docker image *is* a container where `tier == "light"`, so gating on tier contradicts
  itself. Instead, **gate purely on `local_login_status`**: `"local"` runs only when `claude` is
  found **and** logged in. This is naturally false in the container and on a hosted server (neither
  has the user's `~/.claude` login), so no separate container-detection primitive is needed. *(My
  call.)* The UI surfaces "local" as available only when detected; if a run is configured for
  `"local"` and detection later fails, it falls back per the ladder (never a silent hard-fail).

## Decisions (owner) — resolved from the builder check

1. **Pool-exhausted wait cap → short cap, then surface.** A task in the waiting-for-capacity state
   waits up to a short bound (~30–60 min; default a config constant, e.g. 45 min) for an account to
   free or a cooldown to reset. If still nothing, it **surfaces to the owner as an inbox item**
   rather than hanging for hours or failing. No multi-hour silent waits.
2. **Disclosure on upgrade → grandfather.** Existing installs with pool accounts **keep working**;
   the disclosure is shown **once as an informational notice**. New consent is only required to
   enable the pool / add the first account on a fresh install. No disruption to current users.

## What's left to the builder

- The exact "logged-in" detection for the installed Claude Code (credentials-file vs probe), with
  false-negative-safe fallback.
- Backoff/re-queue specifics in the worker (max wait, re-attempt cadence) — must not hot-spin.
- Disclosure copy wording and the settings flag + where the consent lives in the onboarding/Harness
  UI (`apps/web`).
- Test strategy: a fake-`claude` fixture to assert `_run_local` injects **no** token and the
  fallback ladder order; dispatcher re-queue/backoff test; detection-status test. (A real
  interactive login can't be unit-tested — test the construction and the ladder, not the login.)
