# Claude Auth — Local Login + Subscription-Pool Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compliant `"local"` Claude Code auth mode that drives the user's own locally-logged-in `claude` (no token handled by Omilo), and harden the subscription pool so it is opt-in, disclosed, and non-load-bearing (spill to API key, else wait briefly then surface).

**Architecture:** `"local"` becomes a first-class, no-key provider in the existing engine-auth registry; a new `_run_local` spawns `claude` with no injected credential and no `CLAUDE_CONFIG_DIR` override so the user's `~/.claude` login resolves. Pool exhaustion gains a fallback-then-wait path using a non-terminal defer (reusing the worker's `retry_at`), capped then surfaced. Disclosure gates enabling the pool, grandfathering existing installs.

**Tech Stack:** Python 3.11+ (FastAPI, SQLAlchemy), the Go CLI is untouched, Next.js web app (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-10-20-claude-auth-local-login-and-pool-hardening-design.md`

## Global Constraints

- Full-tier and existing `"api"` / pool `"auto"` behavior must be unchanged except where this plan adds a branch.
- `"local"` requires **no API key** (unlike every other provider); it is reached only by explicitly choosing the `"local"` provider — **do not change `"auto"`'s meaning**.
- `_run_local` must **not** set `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` and must **not** override `CLAUDE_CONFIG_DIR` (let the user's default `~/.claude` resolve); MCP is still passed via `--mcp-config`.
- Gate `"local"` purely on `local_login_status` (installed + logged_in) — not on tier/container.
- Pool wait cap: a deferred task waits up to **`POOL_WAIT_CAP_S` (default 2700 = 45 min)**, then surfaces to the owner as an inbox item; it must **not** be counted as a failed attempt and must **release its slot** while waiting.
- Disclosure gates **enabling the pool / adding the first account**, never `lease()`. Existing installs with accounts are **grandfathered** (treated as consented; notice shown once).
- `OMILO_HARNESS_PARALLEL` unchanged.
- A run's active auth (local / pool account / api key) must be visible via the existing `emit("status", ...)` events — never a silent switch.

## Review Focus

- **`"local"` chosen but `claude` not logged in** → must fall back (api key, else clear error), never hard-fail or hang — covered by Task 2 `test_local_falls_back_to_api_when_not_logged_in`.
- **`_run_local` leaking Omilo's `CLAUDE_CONFIG_DIR`** (would miss the user's login) → covered by Task 2 `test_local_does_not_override_config_dir_or_inject_token`.
- **Deferred pool task counted as a failed attempt / fails in ~90s** instead of waiting → covered by Task 4 `test_pool_defer_does_not_consume_attempt`.
- **Existing install's pool stops working on upgrade** (consent regression) → covered by Task 5 `test_existing_accounts_are_grandfathered`.
- **`_provider_of` can't round-trip `"local"`** (orphaned engine config) → covered by Task 1 `test_local_provider_round_trips`.

---

### Task 1: `"local"` first-class provider in the auth registry

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (`AI_PROVIDERS`, `_engine_for`, `_provider_of`, `_apply_ai`, `_engine_label`, `_engine_from_onboarding`)
- Test: `apps/api/tests/test_local_auth.py`

**Interfaces:**
- Produces: provider string `"local"` ⇄ engine `{"type": "claude-code", "auth": "local"}`; `_apply_ai` accepts `provider="local"` with **no key**; `_engine_label`/`health` recognize `auth == "local"`.

- [ ] **Step 1: Write failing tests**

```python
def test_local_provider_round_trips():
    e = _engine_for("local", None)
    assert e == {"type": "claude-code", "auth": "local"}
    assert _provider_of(e) == "local"

def test_apply_ai_local_needs_no_key(db, owner_user):
    msgs = _apply_ai(db, owner_user, AiIn(provider="local"))   # no key field
    assert "key" not in " ".join(msgs).lower()   # not rejected for a missing key
```

- [ ] **Step 2: Run tests, verify fail** — Run: `.venv/bin/pytest tests/test_local_auth.py -k "round_trips or needs_no_key" -v` — Expected: FAIL (`"local"` not in `AI_PROVIDERS`; `_engine_for` returns fake).

- [ ] **Step 3: Implement** — add `"local"` to `AI_PROVIDERS`; in `_engine_for`, `provider == "local"` → `{"type": "claude-code", "auth": "local"}`; in `_provider_of`, `claude-code` engine with `auth == "local"` → `"local"` (keep `"api"`→`"claude"`, else→`"claude-code"`); in `_apply_ai`, exempt `"local"` from the key-required check; add `"local"` to `_engine_label` and the `_engine_from_onboarding` type→provider map.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(auth): register 'local' Claude Code provider (no key)"`

---

### Task 2: `_run_local` engine path + `_once` no-token / no-config-dir

**Files:**
- Modify: `apps/api/omilo_api/engines/claude_code.py` (`_once`, add `_run_local`, `run_task`, `chat`)
- Test: `apps/api/tests/test_local_auth.py`

**Interfaces:**
- Consumes: Task 1's `auth == "local"`; `api_key()`.
- Produces: `_run_local(cli, cfg, system, prompt, session, emit, timeout, remember, tools, extra, mcp_file, cwd) -> EngineResult`; `_once(..., token_env=None)` injects no auth var and (when `config is None`) does not set `CLAUDE_CONFIG_DIR`.

- [ ] **Step 1: Write failing tests** (patch `asyncio.create_subprocess_exec` to capture `env`/args; stub the CLI):

```python
def test_local_does_not_override_config_dir_or_inject_token(captured_env):
    # run a claude-code engine with auth="local"
    assert "CLAUDE_CODE_OAUTH_TOKEN" not in captured_env and "ANTHROPIC_API_KEY" not in captured_env
    assert "CLAUDE_CONFIG_DIR" not in captured_env            # user's ~/.claude resolves
    assert "--mcp-config" in captured_args                    # MCP still wired

def test_local_falls_back_to_api_when_not_logged_in(monkeypatch):
    # local_login_status -> logged_in False, api_key present -> runs via _run_api (ANTHROPIC_API_KEY set)
    ...
def test_local_errors_when_no_login_and_no_key(monkeypatch):
    # logged_in False, no api key -> EngineResult(error mentions sign in / add a key), no crash
    ...
```

- [ ] **Step 2: Run tests, verify fail.**

- [ ] **Step 3: Implement** — `_once`: only `env[token_env] = token` when `token_env` is truthy; only set `CLAUDE_CONFIG_DIR` when `config` is not None. Add `_run_local` mirroring `_run_api` but `token=""`, `token_env=None`, `config=None`. In `run_task`/`chat`, branch `auth == "local"`: if `H.local_login_status(cli)["logged_in"]` → `_run_local`; elif `api_key()` → `_run_api`; else `EngineResult(error="Sign in to Claude Code (run `claude`), or add a Claude API key in Settings → AI.")`. Emit `status` with the active auth. (`local_login_status` is defined in Task 3 and returns `{"installed", "logged_in"}`; Task 2 can land a thin stub returning `{"installed": bool(find_cli()), "logged_in": False}` and Task 3 fills in the real probe.)

- [ ] **Step 4: Run tests, verify pass**, plus `.venv/bin/pytest tests/test_claude_engine.py -q` (existing engine paths unchanged).

- [ ] **Step 5: Commit** — `git commit -m "feat(engine): _run_local — drive the user's own claude login, no token/config-dir"`

---

### Task 3: `local_login_status` detection + health/ai_state surfacing

**Files:**
- Modify: `apps/api/omilo_api/harness.py` (add `local_login_status`), `engines/claude_code.py` (`health`), `routers/api.py` (`ai_state` exposes detection)
- Test: `apps/api/tests/test_local_auth.py`

**Interfaces:**
- Produces: `harness.local_login_status(cli: str | None = None) -> dict` → `{"installed": bool, "logged_in": bool}`; `ai_state` payload gains `local_login` with that shape; `health({"auth":"local"})` reflects it.

- [ ] **Step 1: Write failing tests**

```python
def test_local_login_status_detects_credentials(tmp_path, monkeypatch):
    # with a fake claude on PATH and a credentials file present -> logged_in True
    assert H.local_login_status(fake_cli)["logged_in"] is True
def test_local_login_status_absent(monkeypatch):
    # no claude -> {"installed": False, "logged_in": False}
    assert H.local_login_status(None) == {"installed": False, "logged_in": False}
```

- [ ] **Step 2: Run tests, verify fail.**

- [ ] **Step 3: Implement** — `local_login_status`: `installed = bool(find_cli())`; `logged_in` = installed AND a login is present in the user's default Claude Code config (check `~/.claude/.credentials.json` or `$CLAUDE_CONFIG_DIR`/`$HOME` equivalent). *A false negative must only cause fallback, never a hard error — keep the probe cheap and exception-safe.* Wire `local_login` into the `ai_state` response and make `health` for `auth=="local"` report installed/logged_in.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(harness): local_login_status detection + surface in ai_state/health"`

---

### Task 4: Pool fallback-then-wait (spill to API, else defer + cap + surface)

**Files:**
- Modify: `apps/api/omilo_api/engines/claude_code.py` (empty-pool branch), `apps/api/omilo_api/worker.py` (`_finish`/dispatch defer handling), `apps/api/omilo_api/harness.py` (add `POOL_WAIT_CAP_S`)
- Test: `apps/api/tests/test_harness.py`, `apps/api/tests/test_pool_wait.py`

**Interfaces:**
- Consumes: `EngineResult`, worker `self.retry_at` (task_id→monotonic), the `"waiting"`/inbox mechanisms.
- Produces: engine returns `EngineResult(error=..., defer=True)` (new field, default `False`) when the pool is exhausted and no API key; `_finish` honors `defer` by re-queuing without counting an attempt, capped at `POOL_WAIT_CAP_S`, then surfacing.

- [ ] **Step 1: Write failing tests**

```python
def test_auto_and_pool_spill_to_api_when_pool_empty_and_key_present(...):
    # pool empty, api_key set -> runs via _run_api even in pure pool mode (not just auto)
def test_pool_defer_does_not_consume_attempt(...):
    # pool empty, no key -> EngineResult(defer=True); _finish sets status back to "queued",
    # attempts NOT incremented past the pre-run value, slot released, retry_at set in the future
def test_pool_defer_surfaces_after_cap(monkeypatch):
    # with deferred_since older than POOL_WAIT_CAP_S -> an InboxItem is created and task fails/surfaced
```

- [ ] **Step 2: Run tests, verify fail.**

- [ ] **Step 3: Implement** — in the engine empty-pool branch: if `api_key()` → `_run_api` (regardless of `auth` being `"auto"` or pool); else return `EngineResult(error="No Claude Code account is free; waiting for capacity.", defer=True)`. Add `defer: bool = False` to `EngineResult`. In `_finish`: if `res.defer`, set task `status="queued"`, do **not** increment attempts (restore the pre-run count), set `self.retry_at[task_id] = monotonic + 30` and record `self._deferred_since.setdefault(task_id, now())`; if `now() - deferred_since >= POOL_WAIT_CAP_S`, create an inbox item ("a job is waiting on Claude Code capacity") and mark the task failed/surfaced. `dispatch_tasks` already skips tasks whose `retry_at` is in the future — confirm and reuse.

- [ ] **Step 4: Run tests, verify pass**, plus `.venv/bin/pytest tests/test_harness.py -q`.

- [ ] **Step 5: Commit** — `git commit -m "feat(pool): fallback-then-wait — spill to API, else defer/cap/surface"`

---

### Task 5: Pool disclosure + opt-in (grandfather existing)

**Files:**
- Modify: `apps/api/omilo_api/harness.py` (`add_account` / an `enable_pool` gate), `routers/api.py` (`/harness/accounts` POST, a consent endpoint/field, `ai_state`)
- Test: `apps/api/tests/test_harness.py`

**Interfaces:**
- Produces: a `Setting` `pool_consent` (bool/timestamp); `add_account` (or enabling the pool) requires consent on a fresh install; `ai_state`/harness payload exposes `pool_consent` + whether a one-time notice is pending.

- [ ] **Step 1: Write failing tests**

```python
def test_fresh_install_requires_consent_to_enable_pool(db):
    # no accounts, no consent -> adding the first account / enabling is rejected until consent recorded
def test_existing_accounts_are_grandfathered(db):
    # accounts already exist (pre-upgrade) -> treated as consented; pool works; notice flagged once
```

- [ ] **Step 2: Run tests, verify fail.**

- [ ] **Step 3: Implement** — a consent gate checked at pool-enable / first `add_account` (NOT in `lease()`). On first run where `HarnessAccount` rows already exist and `pool_consent` is unset → set `pool_consent` true (grandfather) and flag a one-time informational notice. Expose both in the API for the UI.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(pool): opt-in consent gate; grandfather existing installs"`

---

### Task 6: Web — "Connect Claude" local option + pool disclosure UI

**Files:**
- Modify: `apps/web` AI/Harness settings + onboarding "Connect Claude" components (consume `ai_state.local_login`, `pool_consent`)
- Test: `cd apps/web && npm run lint && npm run build`

**Interfaces:**
- Consumes: `ai_state.local_login` (Task 3), `pool_consent`/notice (Task 5), the `"local"` provider (Task 1).

- [ ] **Step 1: Implement** — in the AI/Connect-Claude settings: when `local_login.logged_in`, offer **"Use my Claude Code sign-in (this machine)"** → sets provider `"local"`; if installed-but-not-logged-in, show a "run `claude` to sign in" hint; if absent, only show API-key + pool. Gate the subscription pool behind the disclosure text + an accept action (skipped/notice-only when grandfathered).
- [ ] **Step 2: Verify** — `cd apps/web && npm run lint && npm run build` pass; the `"local"` option renders only when detected.
- [ ] **Step 3: Commit** — `git commit -m "feat(web): Connect Claude local-login option + pool disclosure"`

---

## Notes for the executor

- Tasks 1→2→3 are sequential (provider → engine path → detection used by the engine's fallback). Task 4 depends on 2. Task 5 is independent of 1–4 (pool consent). Task 6 depends on 1/3/5 (consumes their API fields).
- A real interactive `claude` login can't be unit-tested — tests assert env/arg construction and the fallback ladder with a stubbed CLI, not an actual login.
