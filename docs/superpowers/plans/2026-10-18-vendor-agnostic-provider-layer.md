# Vendor-Agnostic Provider Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a LiteLLM-backed direct-API engine so Omilo can run any of 8 model vendors behind a single picker, with prompt caching, tiering, and per-vendor cost tracking.

**Architecture:** A new `LiteLLMEngine` reuses the existing `claude.py` agent-loop shape (MCP tool loop → model call → tool_result, until stop) but calls `litellm.completion()` instead of raw `httpx`, with the vendor carried as a model prefix (`openai/…`). A small frozen `providers.py` registry holds the 8 vendors with per-vendor capability flags (cache/web) and fast/balanced/deep tier→model tables. The existing `Engine` facade and per-provider encrypted key storage are reused unchanged; the Anthropic-direct `claude.py` path stays as-is for back-compat.

**Tech Stack:** Python 3.11+, FastAPI, LiteLLM (new dep), existing async worker, pytest.

**Spec:** `docs/superpowers/specs/2026-10-17-vendor-agnostic-engines-design.md`

## Global Constraints

- Python `requires-python = ">=3.11"`; project `omilo-api` v0.4.0.
- API keys encrypted at rest (`services.set_ai_key`/`ai_api_key`, per-provider); **never logged or returned in plaintext** — only the last-4 hint.
- No automatic paid API calls on page load; live validation only behind an explicit "Check" action.
- Must not regress the existing Anthropic path: `claude.py` and `tests/test_claude_engine.py` stay green.
- The 8 provider ids are exactly: `anthropic`, `openai`, `gemini`, `xai`, `deepseek`, `mistral`, `bedrock`, `groq`.
- Selection is company-wide (one provider written to every `Staff.engine`, as today's `_apply_ai` already does).
- `EngineResult(text, tokens, cost_usd, error)` contract is unchanged.

## Review Focus

- **Provider selected but no key present** → `run_task`/`chat` return a clear `EngineResult(error=…)`, never crash. (Task 3)
- **Unknown provider id** in config or `/api/ai` body → `400`/handled error, not a `KeyError`. (Tasks 1, 4)
- **Provider lacking prompt caching** (e.g. `groq`, `deepseek`) → no `cache_control` sent; call succeeds, cost still tracked. (Task 2)
- **Model response has no/malformed `tool_calls`** → loop terminates cleanly and returns accumulated text, no infinite loop. (Task 2)
- **`litellm.completion_cost()` returns `None`** (unknown/untabled model) → `cost_usd` defaults to `0.0`, no exception. (Task 2)

---

### Task 1: Provider registry (`providers.py`)

**Files:**
- Create: `apps/api/omilo_api/engines/providers.py`
- Modify: `apps/api/pyproject.toml:7-27` (add `litellm` to `dependencies`)
- Test: `apps/api/tests/test_providers.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `@dataclass(frozen=True) class Provider` with fields: `id: str`, `label: str`, `prefix: str` (LiteLLM vendor prefix), `icon: str` (UI asset key), `default_model: str`, `tiers: dict[str, str]` (keys `"fast"|"balanced"|"deep"` → model id), `supports_cache: bool`, `supports_web: bool`.
  - `PROVIDERS: dict[str, Provider]` — the 8 entries.
  - `get_provider(pid: str) -> Provider | None`.
  - `provider_ids() -> list[str]` (the 8 ids, stable order).
  - `litellm_model(prov: Provider, model: str | None, tier: str | None) -> str` → returns `f"{prov.prefix}/{model or prov.tiers.get(tier or '') or prov.default_model}"`.

- [ ] **Step 1: Write the failing tests**

```python
# test_providers.py
from omilo_api.engines import providers as P

def test_all_eight_vendors_present():
    assert set(P.provider_ids()) == {"anthropic","openai","gemini","xai","deepseek","mistral","bedrock","groq"}

def test_each_provider_has_three_tiers_and_default():
    for pid in P.provider_ids():
        pr = P.get_provider(pid)
        assert set(pr.tiers) == {"fast","balanced","deep"} and pr.default_model

def test_litellm_model_prefixes_and_precedence():
    pr = P.get_provider("openai")
    assert P.litellm_model(pr, "gpt-x", None) == "openai/gpt-x"          # explicit model wins
    assert P.litellm_model(pr, None, "fast") == f"openai/{pr.tiers['fast']}"  # tier
    assert P.litellm_model(pr, None, None) == f"openai/{pr.default_model}"    # default

def test_unknown_provider_is_none():
    assert P.get_provider("nope") is None

def test_cache_capability_flags_match_spec():
    assert P.get_provider("anthropic").supports_cache is True
    assert P.get_provider("gemini").supports_cache is True
    assert P.get_provider("groq").supports_cache is False
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_providers.py -v`
Expected: FAIL (module/attrs not defined).

- [ ] **Step 3: Implement `providers.py` and add the dependency**

Populate `PROVIDERS` with the 8 entries. Use LiteLLM's documented prefixes (`anthropic`, `openai`, `gemini`, `xai`, `deepseek`, `mistral`, `bedrock`, `groq`). Set `supports_cache=True` only for `anthropic` and `gemini`; `supports_web` per each vendor's LiteLLM web-search support (conservative: `anthropic`, `openai`, `gemini`, `xai` True; others False). Pick current, real model ids for each tier from LiteLLM's model list — if unsure of an exact id, use the vendor's documented current small/mid/large model. Add `"litellm>=1.81"` to `pyproject.toml` dependencies and install into `.venv`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_providers.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/engines/providers.py apps/api/tests/test_providers.py apps/api/pyproject.toml
git commit -m "feat(engines): add 8-vendor provider registry + litellm dep"
```

---

### Task 2: LiteLLM engine loop (`litellm_engine.py`)

**Files:**
- Create: `apps/api/omilo_api/engines/litellm_engine.py`
- Test: `apps/api/tests/test_litellm_engine.py`

**Interfaces:**
- Consumes: `providers.get_provider`, `providers.litellm_model` (Task 1); `engines.EngineResult`; `engines.fake.MCPClient`; `engines.prompts` helpers.
- Produces:
  - `class LiteLLMEngine(Engine)` with `type = "litellm"`.
  - `async def _loop(self, cfg: dict, system: str, messages: list[dict], mcp: MCPClient | None, allowed: set[str] | None, max_turns: int, timeout: float, emit=None) -> EngineResult`.
  - Module helpers: `def mcp_tools_to_openai(tools: list[dict]) -> list[dict]` (MCP `{name,description,inputSchema}` → OpenAI `{"type":"function","function":{...}}`); `def resolve_key(cfg: dict, pid: str) -> str`.
  - `cfg` keys read: `provider` (id), `model`, `tier`, `api_key`, `max_tokens`, `web`.

- [ ] **Step 1: Write the failing tests** (monkeypatch `litellm.completion` with a fake that returns canned `ModelResponse`-shaped objects)

```python
# test_litellm_engine.py — assertions, names only
def test_openai_tool_loop_runs_until_no_tool_calls(...):   # 1 tool_call turn then plain text → returns text, tokens summed
def test_cache_control_sent_only_for_cache_providers(...): # provider=anthropic → system block has cache_control; provider=groq → plain string system
def test_token_and_cost_accounting(...):                    # usage prompt+completion+cache_* summed; completion_cost() folded into cost_usd
def test_completion_cost_none_defaults_zero(...):           # completion_cost -> None => cost_usd == 0.0, no raise
def test_malformed_response_without_tool_calls_terminates(...): # choices[0].message.tool_calls is None/[] → loop ends, returns text
def test_missing_key_returns_error_result(...):             # no key anywhere → EngineResult(error=...), no network call
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_litellm_engine.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `_loop`**

Mirror `claude.py:_loop` control flow. Differences to implement: resolve `pid = cfg["provider"]`, `prov = get_provider(pid)` (error result if `None`); `model = litellm_model(prov, cfg.get("model"), cfg.get("tier"))`; `key = resolve_key(cfg, pid)` (→ `cfg["api_key"]` else `services.ai_api_key(db, pid)` else env). Build `system` as a cache-control content-block list **only when `prov.supports_cache`**, else plain string. Convert MCP tools via `mcp_tools_to_openai`; call `await litellm.acompletion(model=model, messages=[{"role":"system",...}] + messages, tools=..., max_tokens=int(cfg.get("max_tokens") or 8192), api_key=key, timeout=timeout)`. Read `resp.choices[0].message`; append assistant message; for each `tool_calls` entry call `mcp.call_raw(name, json.loads(arguments))` and append `{"role":"tool","tool_call_id":...,"content":out}`. Sum tokens from `resp.usage` (`prompt_tokens`+`completion_tokens`+`cache_read_input_tokens`+`cache_creation_input_tokens`, each guarded). `cost += litellm.completion_cost(completion_response=resp) or 0.0` inside `try/except`. Terminate when no `tool_calls`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && .venv/bin/python -m pytest tests/test_litellm_engine.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/engines/litellm_engine.py apps/api/tests/test_litellm_engine.py
git commit -m "feat(engines): LiteLLM multi-vendor agent loop"
```

---

### Task 3: Engine wrappers + factory wiring

**Files:**
- Modify: `apps/api/omilo_api/engines/litellm_engine.py` (add `run_task`, `chat`, `health`)
- Modify: `apps/api/omilo_api/engines/__init__.py:65-83` (`get_engine`)
- Test: `apps/api/tests/test_litellm_engine.py` (extend)

**Interfaces:**
- Consumes: `TaskContext`, `ChatContext` (`engines/__init__.py`); `prompts.CONSTITUTION`, `CHAT_SYSTEM`, `task_message`, `with_resources`; `claude.MAX_TURNS_TASK`, `MAX_TURNS_CHAT`, `CHAT_TOOLS` (import constants) or redefine locally.
- Produces:
  - `async def run_task(self, ctx: TaskContext) -> EngineResult` — defaults `tier="balanced"`.
  - `async def chat(self, ctx: ChatContext) -> EngineResult` — defaults `tier="fast"`.
  - `async def health(self, cfg: dict) -> dict`.
  - `get_engine({"type":"litellm", ...})` → `LiteLLMEngine()`.

- [ ] **Step 1: Write failing tests**

```python
def test_get_engine_routes_litellm():   # get_engine({"type":"litellm","provider":"openai"}) -> LiteLLMEngine
def test_run_task_defaults_balanced_tier(...)   # cfg without tier → balanced model used
def test_chat_defaults_fast_tier(...)           # cfg without tier → fast model used
def test_run_task_requires_mcp_token(...)       # no mcp_token → EngineResult(error=...)
```

- [ ] **Step 2: Run to verify fail** — `pytest tests/test_litellm_engine.py -v` → FAIL.

- [ ] **Step 3: Implement** `run_task`/`chat`/`health` mirroring `claude.py:144-177` (same system-prompt construction, MCPClient usage, `{"tier": "...", **ctx.engine_config}` default merge so explicit config wins). Add the `litellm` branch to `get_engine`.

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_litellm_engine.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/engines/litellm_engine.py apps/api/omilo_api/engines/__init__.py apps/api/tests/test_litellm_engine.py
git commit -m "feat(engines): litellm run_task/chat/health + factory routing"
```

---

### Task 4: Router & API integration

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py:610-713` (`AI_PROVIDERS`, `_engine_for`, `_provider_of`, `ai_state`, `ai_check`, `_apply_ai`; add `/api/ai/providers`)
- Test: `apps/api/tests/test_settings.py` (extend) or new `tests/test_ai_providers_api.py`

**Interfaces:**
- Consumes: `providers.provider_ids`, `get_provider` (Task 1); `litellm_engine` health (Task 3); `services.set_ai_key`/`ai_api_key`/`ai_key_hint` (per-provider, existing).
- Produces:
  - `AI_PROVIDERS` extended to include the 8 vendor ids (direct-API) alongside existing `fake`/`claude`/`claude-code`.
  - `_engine_for(provider, model, base_url)` returns `{"type":"litellm","provider":<pid>, ...}` for the 8 vendor ids; existing claude/claude-code branches unchanged.
  - `_provider_of(engine)` maps `{"type":"litellm","provider":pid}` → `pid`.
  - `GET /api/ai/providers` → `[{"id","label","icon","has_key": bool}]` for the picker (key presence from `ai_key_hint`; **no live calls**).
  - `_apply_ai` stores the key under the chosen `provider` id (not hardcoded `"claude"`), and the key-required guard applies to the vendor ids.

- [ ] **Step 1: Write failing tests**

```python
def test_providers_endpoint_lists_eight_with_key_flags(owner):  # GET /api/ai/providers → 8 items, has_key reflects stored keys
def test_set_provider_openai_writes_litellm_engine(owner):      # POST /api/ai {provider:"openai",api_key:...} → staff engine type == "litellm", provider=="openai"
def test_key_stored_per_provider_not_as_claude(owner, db):      # key saved under "openai", ai_key_hint(db,"openai") set, "claude" untouched
def test_unknown_provider_rejected(owner):                      # POST /api/ai {provider:"bogus"} → 400
```

- [ ] **Step 2: Run to verify fail** — `pytest tests/test_ai_providers_api.py -v` → FAIL.

- [ ] **Step 3: Implement** the router changes. Keep `claude`/`claude-direct`/`claude-code` working (back-compat). In `_apply_ai`, branch key storage on provider id; in `_engine_for`, return the litellm engine dict for vendor ids. Add the `/api/ai/providers` route.

- [ ] **Step 4: Run to verify pass** — `pytest tests/test_ai_providers_api.py tests/test_settings.py -v` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/routers/api.py apps/api/tests/test_ai_providers_api.py
git commit -m "feat(api): 8-vendor provider selection + /api/ai/providers"
```

---

### Task 5: Web provider picker with icons

**Files:**
- Modify: the existing Settings → AI component under `apps/web/` (locate the component that calls `GET /api/ai` / `POST /api/ai`)
- Add: 8 vendor brand icon assets (SVG) under the web app's asset dir
- Test: follow the web app's existing test convention for that component (if none exists for settings, a manual verification step is acceptable — note it)

**Interfaces:**
- Consumes: `GET /api/ai/providers` (Task 4) for `{id,label,icon,has_key}`; existing `POST /api/ai`.
- Produces: a provider selection control (icon + label per vendor) that posts the chosen provider; options with `has_key=false` show a "needs key" affordance.

- [ ] **Step 1:** Locate the Settings→AI component and its current provider control; follow its existing framework/patterns (do not restructure).
- [ ] **Step 2:** Render the 8 providers from `/api/ai/providers` as an icon selection; wire selection + key entry to `POST /api/ai`.
- [ ] **Step 3:** Gate unusable options (no key) with a clear "needs setup" state; keep the harness (Claude Code) control as-is.
- [ ] **Step 4:** Verify in the running app that all 8 render with icons and selecting one persists (reload shows it). Run any existing web test suite.
- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): 8-vendor provider picker with brand icons"
```

---

## Notes for the executor

- Axis 2 (harness adapter framework for Codex CLI / Gemini CLI / Aider) is a **separate plan** — not in scope here. This plan ships the vendor-agnostic model layer end-to-end on its own.
- Pre-existing flaky tests `test_workflows.py::test_helper_job_step_and_failure` and `::test_patterns_and_build` fail under full-suite load regardless of these changes; not a regression signal.
- After Task 4, run `.venv/bin/python -m pytest tests/test_claude_engine.py tests/test_litellm_engine.py tests/test_providers.py -v` to confirm the Anthropic path is un-regressed alongside the new engine.
