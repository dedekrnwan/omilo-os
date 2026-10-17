# Vendor-Agnostic Provider & Harness Layer — Design

**Date:** 2026-10-17
**Status:** Approved for planning (pending final owner sign-off)
**Area:** `apps/api/omilo_api/engines/`, `apps/api/omilo_api/routers/api.py`, web settings UI

## Intent & Why

Omilo's AI layer is currently Anthropic-only. The owner picks one of three
options (`claude`, `claude-direct`, `claude-code`) that conflate two
separate concerns, and every provider-specific detail (prompt caching,
web tools, model-name matching) is hardwired to Anthropic.

The platform is being positioned as **vendor-agnostic**. Two concrete
asks drive this:

1. **Provider choice** — the model API should be selectable across vendors,
   presented in the UI as a selection with brand icons.
2. **Harness choice** — the agent runtime (today only Claude Code CLI)
   should support additional agent harnesses; build the framework plus the
   first few now, add the rest later without a rewrite.

The outcome: an owner can run a staff member on, say, OpenAI for the model
and Claude Code for the agent loop — or Gemini direct — chosen from clean
pickers, with cost tracking and budgets working identically across vendors.

## Key Decisions (made with the owner)

- **Provider integration = LiteLLM, in-process SDK.** One new engine calls
  `litellm.completion()` inside the existing agent loop; the model string
  carries the vendor prefix (`anthropic/…`, `openai/…`, `gemini/…`). No new
  service to operate; keys stay in-app. The `Engine` facade is preserved so
  a future switch to a LiteLLM **proxy** is a `base_url` config change, not
  a rewrite.
  - *Why LiteLLM, not native SDKs:* it is a translation/routing layer, not
    an inference layer — requests hit each vendor's real endpoint with real
    weights, so there is **no output-quality downgrade**. The
    Anthropic-style `cache_control: {"type": "ephemeral"}` format and
    `cache_read_input_tokens` / `cache_creation_input_tokens` usage fields
    pass through verbatim (same format for Gemini/Vertex; ignored by
    providers that don't support it). `completion_cost()` gives per-token $
    for every vendor — an upgrade over today's web-search-only cost math.
- **Harness scope = framework + 2–3 now.** Extract a `HarnessAdapter`
  interface; Claude Code becomes the first adapter; add **Codex CLI,
  Gemini CLI, Aider** now. Remaining harnesses (OpenHands, Goose, opencode,
  Cline, Cursor CLI, Qwen Code) are drop-in adapters later.
- **Harnesses are vendor-locked; the two axes are NOT freely independent.**
  Agent CLIs are tied to their own vendor's auth/models: Claude Code →
  Anthropic (subscription pool or key), Codex CLI → OpenAI, Gemini CLI →
  Google. Only **Aider** is provider-agnostic (it routes through LiteLLM
  itself). Therefore: the free 8-vendor picker applies **only to the
  direct-API (LiteLLM) engine**; choosing a harness implies its vendor
  (except Aider, which takes any vendor). This is honest to how the tools
  actually work and avoids offering impossible combos.
- **Selection is company-wide.** One provider + one harness choice applies
  to all staff (matches today's `_apply_ai` behavior). Simpler UI and
  migration; per-staff mixing is explicitly out of scope for this phase.
  (`Staff.engine` stays per-row in the DB — the company choice writes the
  same engine dict to every staff member, as today.)
- **Provider picker vendors (8):** Anthropic, OpenAI, Google Gemini,
  xAI (Grok), DeepSeek, Mistral, AWS Bedrock, Groq.
- **Capabilities become per-engine flags** (`supports_cache`,
  `supports_web`, `tier_map`, …) rather than global assumptions, so a
  provider lacking a feature skips that branch instead of erroring.
- **Builds on the existing seam.** `engines/__init__.py` already splits
  direct-API engine (`claude.py`) from CLI-harness engine
  (`claude_code.py`). This extends that split; it does not invent a new one.

## Goals

- Owner selects a **provider** (8 vendors, icons) for the direct-API engine.
- Owner selects a **harness** (Claude Code + Codex CLI + Gemini CLI + Aider
  usable now). Harness choice carries its own vendor (except Aider); the
  free provider picker governs the direct-API engine.
- Prompt caching, model tiering (fast/balanced/deep), token+cost accounting,
  budgets, and retries all work across every provider that supports them.
- Adding a new provider = add a model/vendor entry. Adding a new harness =
  add one adapter file implementing the interface. No core rewrites.

## Non-Goals

- LiteLLM **proxy** service (centralized gateway, per-tenant budgets at the
  gateway, shared base URL for harness CLIs). Explicitly deferred; the
  design keeps it a config-flip away.
- Editor-embedded harnesses (Cline, Cursor CLI) — need a headless story;
  out of this phase.
- Replacing the Claude Code account-pool model (`harness.py`); it stays and
  is shared by adapters where applicable.
- Changing the MCP tool layer, permissions, worker queue, or budgets logic
  beyond making them provider-neutral.

## Anti-Goals (would make this a failure even if it "works")

- Any measurable output-quality regression versus calling Anthropic directly.
- A picker that silently offers a provider/harness combo that can't actually
  run (e.g. a provider with no key, a harness not installed).
- Hardcoding one vendor's assumptions (model-name substrings, cache format,
  web-tool schema) into the shared loop such that other vendors break.
- Leaking API keys into logs, manifests, or the DB in plaintext (existing
  safety rule; must hold across all new providers).

## Current State (what exists today)

- `engines/__init__.py` — `Engine` interface + `get_engine(config)` factory.
- `engines/claude.py` — direct Anthropic engine; `_loop()` runs the agent
  loop via raw `httpx` POST to `/v1/messages`. **Already has** (this session):
  prompt caching via `cache_control`, cache-token accounting, and model
  tiering (`TIER_HINT`, `resolve_model`, `_models_for` cache).
- `engines/claude_code.py` + `harness.py` — Claude Code CLI subprocess with
  an LRU account pool, rate-limit detection, account switching.
- `routers/api.py` — `AI_PROVIDERS`, `_engine_for`, `_assign_engine`,
  `/api/ai`, `/api/ai/check` endpoints; conflates provider+harness.
- Keys stored encrypted via `services.ai_api_key` / `security.encrypt`.

## Proposed Shape

### Axis 1 — Provider (direct-API engine via LiteLLM)

- New `engines/litellm_engine.py`: reuse the `claude.py` `_loop` structure
  but swap the `httpx` call for `litellm.completion()`. Keep the same
  MCP-tool loop, `cache_control` injection, tiering, and
  `EngineResult(text, tokens, cost_usd)` contract.
- Model string = `"{vendor}/{model}"`. Vendor comes from the picker; model
  from per-staff config or a per-vendor default.
- Per-provider capability table (cache, web, reasoning/tier mapping).
  LiteLLM normalizes `reasoning_effort`; the fast/balanced/deep tier maps
  to each vendor's equivalent (or is a no-op).
- Cost via `litellm.completion_cost()`; fold into existing token/$ tracking.
- Keys: one encrypted key per vendor, same storage path as today.

### Axis 2 — Harness (agent-runtime engine)

- New `engines/harness/base.py`: `HarnessAdapter` interface capturing what
  differs per CLI — binary discovery, arg construction, env/auth, streaming
  output parser (→ RunEvent kinds), MCP config wiring, limit/err detection.
- Refactor `claude_code.py` into `engines/harness/claude_code.py` as the
  first adapter; keep `harness.py` account-pool shared.
- Add `codex_cli.py`, `gemini_cli.py`, `aider.py` adapters.
- `get_engine()` routes `{"type": "harness", "harness": "<name>", ...}` to
  the right adapter.

### UI

- Settings → AI splits into **Provider** (8-vendor selection with brand
  icons) and **Harness** (adapter selection). Each shows only usable
  options (key present / binary installed) and surfaces a clear "needs
  setup" state otherwise.

## Constraints

- Python 3.12, FastAPI, existing async worker model.
- Keys encrypted at rest; never logged (safety.md).
- PostgreSQL stays read-only via MCP where that rule applies.
- Must not regress the existing Claude path or its tests.
- Pre-existing flaky tests (`test_workflows.py::test_helper_job_step_and_failure`,
  `::test_patterns_and_build`) fail under full-suite load regardless of these
  changes — not a regression signal.

## Resolved Calls (design author's decisions, not owner-specified)

These were raised in builder review and settled here to keep the plan moving;
the owner can override any of them.

- **MCP is required for every harness adapter.** Policy, the tool log, and
  permissions all flow through the omilo MCP server, so an adapter that
  can't speak MCP can't enforce safety rules. Claude Code / Codex CLI /
  Gemini CLI support MCP. **Aider has no native MCP client** — so Aider is
  marked *at-risk* for this phase: it ships only if an MCP bridge is
  feasible, otherwise it drops to the "later" list and a 3rd MCP-capable
  harness takes its slot. The builder validates this early.
- **Tier → model mapping lives in a static per-vendor table in code**
  (fast/balanced/deep → a model id per vendor), plus an explicit per-config
  model override that always wins, plus live `/v1/models` matching for
  vendors that expose it (Anthropic already does). No universal live-list
  is assumed. The table is the single source of truth and has an obvious
  maintenance home next to the provider list.
- **Picker gating is cheap/binary, not live paid calls.** A provider is
  "usable" if its key is present; a harness if its binary is on PATH
  (`find_cli`-style discovery per adapter). Live validation stays behind an
  explicit on-demand "Check" button (extends today's `/api/ai/check`) — no
  automatic paid calls on page load (safety rule).
- **Cost source:** the LiteLLM engine uses `litellm.completion_cost()` for
  token→$. The existing `claude.py` Anthropic-direct path keeps its current
  cost math to avoid regression. `completion_cost` staleness is accepted as
  a minor risk (pricing tables update with LiteLLM releases).
- **Back-compat / regression:** `claude.py` (Anthropic-direct) stays as-is
  for now to satisfy "must not regress the existing Claude path"; the new
  `litellm_engine.py` handles the other 7 vendors, sharing the agent-loop
  helper. Consolidating Anthropic onto `anthropic/…` via LiteLLM is a
  follow-up, not part of this phase. Existing engine configs
  (`claude`/`claude-direct`/`claude-code`) map forward via a migration shim.

## Left to the Builder

- Exact `HarnessAdapter` method signatures and how much of
  `claude_code.py` becomes shared base vs per-adapter.
- Internal shape of the per-provider capability table.
- Whether `litellm_engine.py` subclasses/【shares code with】`claude.py` or
  replaces it (with `claude.py` kept as a thin alias for back-compat).
- Icon asset sourcing/format for the 8 vendors in the web UI.
- Migration of existing staff `engine` dicts to the new provider/harness
  split (back-compat mapping for `claude` / `claude-direct` / `claude-code`).
- Test strategy: mock LiteLLM per provider; adapter tests with fake CLIs
  (pattern already exists at `tests/bin/fake_claude.py`).

## Verification

- `litellm.completion()` path returns correct text/tokens/cost for at least
  Anthropic + one non-Anthropic vendor (mocked), with cache tokens counted.
- Tier mapping produces the expected model per provider; explicit model wins.
- Each new harness adapter runs a trivial task end-to-end against a fake CLI
  and emits the expected RunEvent sequence.
- Existing `tests/test_claude_engine.py` suite still passes.
- UI: pickers render all 8 providers + the available harnesses; unusable
  options are clearly gated.
- `.venv/bin/python -m pytest tests/test_claude_engine.py` green; full suite
  shows no *new* failures beyond the two known-flaky workflow tests.
