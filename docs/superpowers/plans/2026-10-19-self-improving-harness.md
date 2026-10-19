# Self-tuning helpers (Propose–Probe–Compose) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Chief of Staff a Harness²-style Propose–Probe–Compose pass that picks a better rewrite of a helper's instructions by running the same task through candidate variants and judging them, then routes the winner through the existing measured improve/rollback loop.

**Architecture:** A new `tune.py` module. `propose()` asks the AI for K candidate rewrites of a helper's `job` (system prompt). `probe()` runs one representative task brief once per candidate (plus the current job as baseline) on the engine, capturing each run's output. `compose()` is an AI judge that picks the winning variant from behavioural contrast (no ground truth). `refine()` orchestrates, gated behind an off-by-default company setting and a weekly probe budget, and hands the winner to `loops.improve(kind="job")` so baseline capture + measured keep/rollback still apply. The Chief triggers it via a new `tune_helper` MCP tool.

**Tech Stack:** Python 3.12, SQLAlchemy, FastAPI, pytest + pytest-asyncio (asyncio_mode=auto). Engine calls reuse `engines.get_engine(cfg).chat(ctx)` and `ChatContext`/`EngineResult` from `omilo_api/engines/__init__.py`. Tests use the fake engine (deterministic) and stub the AI-judge seam.

**Spec:** `docs/superpowers/specs/2026-10-19-self-improving-harness-design.md`

## Global Constraints

- Editable component in this slice is **only `job`** (the helper's system prompt). Skills, tool guidance, guardrails, subagents, plugins are out of scope (follow-up).
- The feature is **off by default**: a company setting `self_tuning` (bool, default `False`). When off, `refine()` is a no-op returning `None`.
- Never bypass the owner-only safety boundary in `loops.py`: tuning may only change `kind="job"` via `loops.improve()`; it must not touch permissions, budgets, engine, approvals, or hard rules.
- Weekly probe budget: `TUNE_MAX_PER_WEEK = 2`; default candidate count `DEFAULT_K = 2`.
- All measured keep/rollback stays in `loops.evaluate()` unchanged; `refine()` only chooses which single change to apply.
- `refine()`, `propose()`, `probe()`, `compose()` are `async`. The AI seam is one function `_ask_json()` so tests can stub it without a live model.
- Probes must be side-effect-free: no `Task` rows, no persisted `RunEvent`s (use a noop emitter), `shared=True` so no engine session is saved.

## Review Focus

- **Feature off (default):** `refine()` on a company with no `self_tuning` setting returns `None` and spends nothing. (Task 5)
- **Weekly budget exhausted:** a third `refine()` in 6 days returns `None` without probing. (Task 5)
- **No improvement found:** when the judge picks the current/baseline job, `refine()` makes no `Improvement` and returns `None`. (Task 5)
- **A probe run errors:** one candidate's engine run failing does not abort the pass; it scores lowest and the others still compose. (Task 4)
- **Non-chief caller:** the `tune_helper` MCP tool rejects a non-chief helper with 403, like `improve`. (Task 6)

---

### Task 1: `self_tuning` company setting (off by default)

**Files:**
- Modify: `apps/api/omilo_api/services.py` (add `is_self_tuning` near `is_paused`, services.py:63)
- Modify: `apps/api/omilo_api/routers/api.py` (GET `/system` body ~line 60-66; `SystemIn` ~line 85; `update_system` already persists unknown keys via its else branch)
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Produces: `services.is_self_tuning(db: Session) -> bool` (reads Setting `"self_tuning"`, default `False`).
- Produces: GET `/api/system` includes `"self_tuning": bool`; POST `/api/system` accepts `self_tuning: bool | None`.

- [ ] **Step 1: Write the failing test**

```python
def test_self_tuning_setting_defaults_off_and_toggles(owner):
    assert owner.get("/api/system").json()["self_tuning"] is False
    owner.post("/api/system", json={"self_tuning": True})
    assert owner.get("/api/system").json()["self_tuning"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && source .venv/bin/activate && python -m pytest tests/test_tune.py::test_self_tuning_setting_defaults_off_and_toggles -q -p no:cacheprovider`
Expected: FAIL (KeyError `self_tuning` / field not accepted)

- [ ] **Step 3: Implement the setting**

Add `is_self_tuning(db)` in services.py mirroring `is_paused` (services.py:63). Add `self_tuning: bool | None = None` to `SystemIn`. Add `"self_tuning": S.is_self_tuning(db)` to the GET `/system` dict. `update_system`'s existing else branch (`S.set_setting(db, k, v, ...)`) already persists it.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tune.py::test_self_tuning_setting_defaults_off_and_toggles -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/services.py apps/api/omilo_api/routers/api.py apps/api/tests/test_tune.py
git commit -m "feat(tune): self_tuning company setting, off by default"
```

---

### Task 2: `propose()` — K candidate rewrites of a helper's job

**Files:**
- Create: `apps/api/omilo_api/tune.py`
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Consumes: `services.get_setting`; `engines.get_engine`, `ChatContext`, `EngineResult`; `config.get_settings().mcp_url()`; `security.decrypt`.
- Produces: `DEFAULT_K = 2`, `TUNE_MAX_PER_WEEK = 2`.
- Produces: `async def _ask_json(db: Session, staff: Staff, system: str, user: str) -> dict` — runs one `get_engine(cfg).chat(ctx)` with a synthetic `ChatContext` (job=`system`, history=`[{"role":"owner","text":user}]`, `shared=True`, noop emit) and returns the first `{...}` JSON object parsed from `EngineResult.text` (`{}` on parse failure). This is the stub seam for tests.
- Produces: `async def propose(db: Session, staff: Staff, k: int = DEFAULT_K) -> list[str]` — returns up to `k` candidate full-rewrite strings of `staff.job` (never includes the current job).

- [ ] **Step 1: Write the failing test** (stub the AI seam)

```python
import omilo_api.tune as T

async def test_propose_returns_k_candidates(owner, monkeypatch):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff
    async def fake_ask(db, staff, system, user):
        return {"candidates": ["JOB A", "JOB B", "JOB C"]}
    monkeypatch.setattr(T, "_ask_json", fake_ask)
    with session_scope() as db:
        st = db.get(Staff, "sales")
        out = await T.propose(db, st, k=2)
    assert out == ["JOB A", "JOB B"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tune.py::test_propose_returns_k_candidates -q -p no:cacheprovider`
Expected: FAIL (module `tune` has no `propose`)

- [ ] **Step 3: Implement `_ask_json` and `propose`**

`_ask_json` builds the `ChatContext` from the staff's `engine` config and decrypted `mcp_token`, calls the engine, and extracts JSON with `re.search(r"\{.*\}", text, re.S)`. `propose` calls `_ask_json` with a system prompt instructing "return JSON `{\"candidates\": [full rewrites]}`" and slices the returned `candidates` list to `k` strings (dropping empties).

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tune.py::test_propose_returns_k_candidates -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/tune.py apps/api/tests/test_tune.py
git commit -m "feat(tune): propose K candidate job rewrites via the AI seam"
```

---

### Task 3: `probe()` — run one brief per candidate on the engine

**Files:**
- Modify: `apps/api/omilo_api/tune.py`
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Consumes: `engines.get_engine(cfg).chat(ctx)`, `EngineResult`; `teamchat`/worker patterns for building a `ChatContext` (see `worker._answer_as` for the field set).
- Produces: `@dataclass class ProbeResult: job: str; text: str; tokens: int; cost_usd: float; error: str`.
- Produces: `async def probe(db: Session, staff: Staff, brief: str, jobs: list[str]) -> list[ProbeResult]` — one `ProbeResult` per input job, same order; runs each via `get_engine(cfg).chat(ctx)` with `job` overridden, `history=[{"role":"owner","text":brief}]`, `context_note=""`, `shared=True`, noop emit; a run that raises or returns `EngineResult.error` yields a `ProbeResult` with that `error` and empty `text` (never aborts the batch).

- [ ] **Step 1: Write the failing test** (uses the fake engine via the `owner`+`base_url` fixtures)

```python
async def test_probe_runs_once_per_job(owner, base_url):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff
    import omilo_api.tune as T
    with session_scope() as db:
        st = db.get(Staff, "sales")
        st.mcp_token_enc = __import__("omilo_api.security", fromlist=["encrypt"]).encrypt(owner.mcp_tokens["sales"])
        res = await T.probe(db, st, "Find 3 catering leads", ["JOB ONE", "JOB TWO"])
    assert len(res) == 2 and all(r.text and not r.error for r in res)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tune.py::test_probe_runs_once_per_job -q -p no:cacheprovider`
Expected: FAIL (`probe` not defined)

- [ ] **Step 3: Implement `ProbeResult` and `probe`**

Build the `ChatContext` exactly as `worker._answer_as` does (staff_id, staff_name, job=<candidate>, is_chief, thread_id=`"tune"`, scope=`"staff"`, history, context_note, mcp_url, mcp_token=decrypt(...), engine_config, emit=noop, resources=`None`, shared=True). Run each with `await asyncio.wait_for(engine.chat(ctx), timeout=600)` inside a try/except that captures errors into the `ProbeResult`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tune.py::test_probe_runs_once_per_job -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/tune.py apps/api/tests/test_tune.py
git commit -m "feat(tune): probe runs a brief once per candidate, errors don't abort"
```

---

### Task 4: `compose()` — AI judge picks the winning variant

**Files:**
- Modify: `apps/api/omilo_api/tune.py`
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Consumes: `_ask_json` (Task 2); `ProbeResult` (Task 3).
- Produces: `async def compose(db: Session, staff: Staff, brief: str, probes: list[ProbeResult]) -> int` — returns the index into `probes` of the best run, judged on `brief` vs each `ProbeResult.text` (no ground truth). An errored probe can never win. Falls back to index `0` on a malformed judge reply or an out-of-range index.

- [ ] **Step 1: Write the failing test** (stub the AI seam; index 0 is the baseline)

```python
async def test_compose_picks_judge_winner_clamps_and_skips_errored(owner, monkeypatch):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff
    import omilo_api.tune as T
    probes = [T.ProbeResult(job="cur", text="weak", tokens=1, cost_usd=0, error=""),
              T.ProbeResult(job="A", text="strong", tokens=1, cost_usd=0, error=""),
              T.ProbeResult(job="B", text="", tokens=0, cost_usd=0, error="timed out")]
    async def fake_ask(db, staff, system, user): return {"winner": 1, "why": "clearer"}
    monkeypatch.setattr(T, "_ask_json", fake_ask)
    with session_scope() as db:
        assert await T.compose(db, db.get(Staff, "sales"), "brief", probes) == 1
    async def out_of_range(db, staff, system, user): return {"winner": 9}
    monkeypatch.setattr(T, "_ask_json", out_of_range)
    with session_scope() as db:
        assert await T.compose(db, db.get(Staff, "sales"), "brief", probes) == 0
    async def names_errored(db, staff, system, user): return {"winner": 2}  # the timed-out probe
    monkeypatch.setattr(T, "_ask_json", names_errored)
    with session_scope() as db:
        assert await T.compose(db, db.get(Staff, "sales"), "brief", probes) == 0  # an errored probe can never win
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tune.py::test_compose_picks_judge_winner_clamps_and_skips_errored -q -p no:cacheprovider`
Expected: FAIL (`compose` not defined)

- [ ] **Step 3: Implement `compose`**

Build a numbered list of each probe's output text, ask `_ask_json` for `{"winner": <index>, "why": <str>}`, coerce `winner` to int, return it when `0 <= winner < len(probes)` and that probe has no `error`, else `0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tune.py::test_compose_picks_judge_winner_clamps_and_skips_errored -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/tune.py apps/api/tests/test_tune.py
git commit -m "feat(tune): compose AI-judges the winning probe, clamps bad replies"
```

---

### Task 5: `refine()` — orchestrate, gate, budget, route the winner to `improve()`

**Files:**
- Modify: `apps/api/omilo_api/tune.py`
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Consumes: `services.is_self_tuning` (Task 1); `propose` (Task 2); `probe` (Task 3); `compose` (Task 4); `loops.improve` (loops.py:133, `kind="job"`); `Improvement`, `Task` models.
- Produces: `def _tunes_this_week(db: Session) -> int` — count of `Improvement` rows in the last 6 days whose `reason` starts with the sentinel `"Self-tuned:"`.
- Produces: `async def refine(db: Session, staff_id: str, brief: str | None = None, k: int = DEFAULT_K) -> Improvement | None` — returns the created `Improvement`, or `None` when the feature is off, the budget is spent, there is no brief to probe, or the judge keeps the current job.

- [ ] **Step 1: Write the failing tests** (off-by-default, budget, and the happy path with stubs)

```python
async def test_refine_noop_when_off(owner):
    from omilo_api.db import session_scope
    import omilo_api.tune as T
    with session_scope() as db:
        assert await T.refine(db, "sales", brief="do x") is None  # self_tuning defaults off

async def test_refine_applies_winner_when_on(owner, base_url, monkeypatch):
    from omilo_api.db import session_scope
    from omilo_api.models import Staff, Improvement
    from omilo_api import services as S, security
    import omilo_api.tune as T
    async def fake_propose(db, staff, k=2): return ["NEW JOB TEXT"]
    async def fake_compose(db, staff, brief, probes): return len(probes) - 1  # the candidate wins
    monkeypatch.setattr(T, "propose", fake_propose)
    monkeypatch.setattr(T, "compose", fake_compose)
    with session_scope() as db:
        S.set_setting(db, "self_tuning", True)
        db.get(Staff, "sales").mcp_token_enc = security.encrypt(owner.mcp_tokens["sales"])
    with session_scope() as db:
        imp = await T.refine(db, "sales", brief="Find 3 catering leads")
    assert imp is not None and imp.kind == "job"
    with session_scope() as db:
        assert db.get(Staff, "sales").job == "NEW JOB TEXT"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_tune.py -k refine -q -p no:cacheprovider`
Expected: FAIL (`refine` not defined)

- [ ] **Step 3: Implement `refine`**

Order: return `None` if `not is_self_tuning(db)`; return `None` if `_tunes_this_week(db) >= TUNE_MAX_PER_WEEK`; resolve `brief` (arg, else the most recent `Task.brief` for this staff, else `None` → return `None`); `cands = await propose(...)` (return `None` if empty); `probes = await probe(db, staff, brief, [staff.job, *cands])` (index 0 = current baseline); `win = await compose(...)`; if `win == 0` return `None`; else `return loops.improve(db, chief, staff_id, "job", probes[win].job, reason="Self-tuned: "+<judge note or default>, task_id=None)` where `chief = services.chief(db)`. Catch `loops.LoopError` (e.g. weekly `improve` cap) and return `None`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_tune.py -k refine -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/tune.py apps/api/tests/test_tune.py
git commit -m "feat(tune): refine orchestrates propose-probe-compose, gated + budgeted, routes to improve()"
```

---

### Task 6: `tune_helper` MCP tool for the Chief of Staff

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (tool list near review_week/improve ~line 149-158; dispatch near ~line 341)
- Test: `apps/api/tests/test_tune.py`

**Interfaces:**
- Consumes: `tune.refine` (Task 5).
- Produces: MCP tool `tune_helper` with inputSchema `{staff_id: string (required), brief: string (optional)}`; returns `{"improvement_id": <id>}` on a change, else `{"message": "no change"}`; rejects a non-chief caller with `S.DomainError(..., 403)` exactly like `improve`.

- [ ] **Step 1: Write the failing test** (call the live MCP endpoint as the chief, feature on, stubbing the AI seams)

```python
def test_tune_helper_tool_chief_only(owner, base_url, monkeypatch):
    import httpx, omilo_api.tune as T
    from omilo_api.db import session_scope
    from omilo_api import services as S
    async def fake_propose(db, staff, k=2): return ["NEW JOB"]
    async def fake_compose(db, staff, brief, probes): return len(probes) - 1
    monkeypatch.setattr(T, "propose", fake_propose); monkeypatch.setattr(T, "compose", fake_compose)
    with session_scope() as db: S.set_setting(db, "self_tuning", True)
    def call(tok):
        return httpx.post(f"{base_url}/mcp", headers={"Authorization": f"Bearer {tok}"}, json={
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "tune_helper", "arguments": {"staff_id": "sales", "brief": "Find 3 leads"}}}).json()
    assert call(owner.mcp_tokens["sales"])["result"]["isError"]        # non-chief rejected
    r = call(owner.mcp_tokens["chief-of-staff"])
    assert not r["result"]["isError"] and r["result"]["structuredContent"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tune.py::test_tune_helper_tool_chief_only -q -p no:cacheprovider`
Expected: FAIL (unknown tool `tune_helper`)

- [ ] **Step 3: Implement the tool**

Add the `tune_helper` entry to the tool list (description: "Chief of Staff: tune a helper's instructions by trying variants on one task and keeping the best; off unless the owner enabled self-tuning."). In dispatch, guard `st.is_chief` (else `S.DomainError("only the Chief of Staff tunes helpers", 403)`), `await tune.refine(db, args["staff_id"], brief=args.get("brief"))`, and return `("allowed", {"improvement_id": imp.id})` or `("allowed", {"message": "no change"})`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_tune.py::test_tune_helper_tool_chief_only -q -p no:cacheprovider`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/omilo_api/mcp_server.py apps/api/tests/test_tune.py
git commit -m "feat(tune): tune_helper MCP tool (Chief-only) for Propose-Probe-Compose"
```

---

## Notes for the executor

- Run tests one pytest process at a time against the shared `omilo_test` Postgres DB; never run two concurrently (see `project-omilo-test-db`). Verify each task with its own `pytest … -q -p no:cacheprovider` line; run the whole changed file (`tests/test_tune.py`) plus `tests/test_loops.py` before finishing.
- `tune.py` imports `loops` lazily inside `refine()` to avoid an import cycle (`loops` imports `memory`, not `tune`).
- The `owner` fixture builds the small team on the fake engine and exposes `owner.mcp_tokens[...]`; `base_url` runs the live API so engine/MCP calls work. Probe/refine/tool tests need both.
