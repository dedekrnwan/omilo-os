# 06 · LLM Routing & Account Pool

> Track: **technical**. How a Job's turn actually reaches a model — three engines, model
> tiering, and the shared subscription **account pool** that backs the AI-accounts screen.
> Ported from omilo-os `engines/`, `providers.py`, `claude_code.py`. Cost capture feeds
> [`08-billing-ai-credits.md`](08-billing-ai-credits.md).

## 1. Three engines, one factory

```python
def get_engine(cfg: dict) -> Engine:
    t = cfg.get("type", "fake")
    return {
        "litellm":     LiteLLMEngine,     # cloud, metered credits (default on cloud)
        "claude_code": ClaudeCodeEngine,  # subscription pool (BYO Claude/Codex/… accounts)
        "anthropic":   AnthropicEngine,   # direct BYO API key
        "graph":       GraphEngine,       # wraps another engine + the LangGraph loop
        "fake":        FakeEngine,        # deterministic demo/tests
    }[t]()
```

A `Helper.engine` is `{type, auth, model, tier}`. Resolution order when a Helper doesn't pin
one: Helper → Channel/area default (Control-Panel → AI engine) → company default (onboarding
AI mode). The onboarding "self-host vs cloud" choice sets the company default:
- **cloud** → `litellm` on omilo credits (we carry the provider cost, charge credits).
- **self-host** → `claude_code` pool and/or direct `anthropic` key (operator's own capacity;
  no credit margin, just subscription fee).

## 2. litellm — vendor-agnostic routing with tiers

One interface over Anthropic/OpenAI/Gemini/xAI/DeepSeek/Mistral. Each provider defines
**fast / balanced / deep** tiers so cheap work runs on small models and reasoning runs deep:

```python
PROVIDERS = {
  "anthropic": {"default":"claude-sonnet-4-5",
                "tiers":{"fast":"claude-haiku-4-5","balanced":"claude-sonnet-4-5","deep":"claude-opus-4-5"},
                "supports_cache":True, "supports_web":True},
  "openai":    {"default":"gpt-4o",
                "tiers":{"fast":"gpt-4o-mini","balanced":"gpt-4o","deep":"o3"}},
  "gemini":    {...}, "xai":{...}, "deepseek":{...}, "mistral":{...},
}
```

**Tier selection** per turn: supervisor/review/relevance-gate → `fast`; worker execution →
`balanced`; hard reasoning/planning → `deep`. Prompt caching used where supported to cut cost.
litellm returns token usage → converted to credits (see `08`).

## 3. Claude Code pool — the AI-accounts screen

Runs headless `claude` (and Codex/Copilot/Gemini/Cursor CLIs) across a **shared, cross-harness
pool** of subscription accounts. This is exactly the `/control-panel/ai-accounts` **Account
pool**: every agent shares all accounts; when one hits its rate-limit window, the next ready
account takes over.

### `HarnessAccount` lifecycle
```
new ─setup-token─► ready ─picked─► working ─warn threshold─► near_limit ─hard limit─► cooling ─window reset─► ready
                       ▲                        │  (still usable, de-prioritized)        │
                       └────────────────────────┴──── drops back to ready on reset ──────┘
                                   └── error (bad token) ──► error
```

**Two kinds of switch — proactive (threshold) and reactive (hit).**

- **Proactive threshold switch (the primary mechanism).** Every account's `HarnessQuota` tracks
  **utilization** for each window (`five_hour`, `seven_day`). When utilization crosses a
  configurable **warn threshold** (default ~85%), `HarnessQuota.status = allowed_warning` and the
  account is marked `near_limit`: the scheduler **stops routing new work to it** and shifts to the
  next account with headroom — *before* it ever hits the wall. This keeps a reserve, avoids the
  thundering-into-the-limit pattern, and means most switches happen with **zero failed calls**.
- **Selection:** among accounts for the requested harness, pick the **least-recently-used `ready`
  account whose utilization is below the warn threshold** (most headroom first). `near_limit`
  accounts are skipped for new work; `cooling`/`error` are never picked. `near_limit` accounts are
  used only as a **last resort** when nothing else has headroom (better a warned account than a
  stalled Job).
- **Reactive switch (safety net).** If a hard limit *is* hit anyway (bursty traffic, provider
  changing the window), parse the CLI output/headers → set `status=cooling`, `cooldown_until`,
  record a `HarnessLimitHit`, update `HarnessQuota` (`status=rejected`, `resets_at`). The in-flight
  Job returns `EngineResult.defer=True` → re-queue with backoff onto another ready account,
  idempotent via checkpoint `(job_id, step)`, so **no duplicated work**.
- **UI:** utilization drives the "Usage window" meter (`pct`); the `status` badge reads
  **Working** (`working`), **Ready** (`ready`, has headroom), or **Resting** (`near_limit` reserved
  / `cooling`). So the operator *sees* an account ease off before it rests, not just after.
- **Pool exhausted (all cooling / no headroom):** the Job defers and waits for the nearest
  `resets_at` rather than failing; operator sees "Resting" counts rise.

Thresholds (warn %, per-window) and cooldown are configurable (Control-Panel → AI accounts /
AI engine). Cross-harness: the pool spans Claude Code/Codex/Copilot/Gemini/Cursor, so a Job can
also fall across harnesses if its engine config allows.

### UI contract
`GET /v1/ai-accounts` → rows matching `PoolAccount` (`harness, name, tag, status, pct,
tokens, last_used`) + ids. `POST /v1/ai-accounts/{id}/test` runs a one-shot probe;
`POST /v1/ai-accounts/check` runs the "Run connection check". Tokens stored `token_enc`,
shown only as `token_hint` (`…pwAA`).

## 4. Direct provider keys (BYO)

`ProviderKey` for Anthropic/OpenAI/local (Ollama/LM Studio). Matches `DIRECT_PROVIDERS` on the
screen: Anthropic (connected, "used by Chief"), OpenAI (optional fallback), Local model. A
Helper can be pinned to a direct key per the UI copy ("pick per agent which one it runs on").
No credit margin on BYO keys — the operator pays the provider directly.

## 5. Cost & token capture (always)

Every engine returns `cost_credits`, `tokens_in`, `tokens_out`. The runner writes them onto the
`Job`, appends a `CreditLedger` row (cloud/litellm path) with the **true `provider_cost_usd`**
and the **`credits_charged`** (margin applied), and updates `HarnessUsage` (pool path). This
makes analytics exact and billing auditable. See [`08`](08-billing-ai-credits.md).

## 6. Failure & fallback

| Failure | Behavior |
|---|---|
| Provider 429 / overload (litellm) | retry with backoff; optionally fall to next provider tier if configured |
| Pool account rate-limited | cool account, switch to next ready; else defer+wait |
| Bad token | `status=error`, alert InboxItem, skip in selection |
| All capacity exhausted | Job stays `queued` (defer), operator notified; nothing lost |
| Model refusal/error mid-turn | `attempts++`, retry; after N, `Job.failed` + `failure` InboxItem |

## 7. Composer controls — model selection & think level

The chat composer ([`02` §4a](02-api-contracts.md)) lets the operator override **which model** and
**how hard it thinks** per chat (or per message), on top of the automatic routing above.

### Model resolution order (loosest binds last)
```
message.model  →  session.model_override  →  Helper.engine.model  →  Channel/area default  →  company default
```
`GET /v1/models` returns the installable set for the active engine — litellm provider models, the
Claude Code pool's harness models, or BYO-key models — each with its **context window** (feeds the
usage meter, §/`02`). A per-message pick doesn't change the Helper's standing engine; it's a
one-turn override.

### Think level → tier + reasoning budget
`ThinkLevel` from the composer maps onto the engine:

| `think_level` | litellm tier | Thinking / reasoning budget |
|---|---|---|
| `auto` (default) | engine picks by task (supervisor/review→fast, worker→balanced, hard→deep) | provider default |
| `standard` | balanced | none / minimal |
| `high` | deep | moderate extended-thinking / `reasoning_effort: medium` |
| `max` | deep | large thinking budget / `reasoning_effort: high` |

For Anthropic models this sets the **extended-thinking** budget; for OpenAI reasoning models it
sets `reasoning_effort`; for others it falls back to tier only. Higher levels cost more and are
slower — the composer shows the trade-off. `think_level` is recorded per turn (`MessageContext`)
so cost/latency are attributable.

## 8. Why this split (reuse)

- **litellm** gives provider independence and tiered cost control without per-vendor code.
- **Claude Code pool** turns cheap flat-rate subscriptions into real agent capacity — the
  product's cost edge — with rate-limit resilience already solved in omilo-os.
- Keeping both behind one `Engine` interface lets a Helper move between credits, pool, and BYO
  keys with a config change, and lets tests/demo run on `fake`.
