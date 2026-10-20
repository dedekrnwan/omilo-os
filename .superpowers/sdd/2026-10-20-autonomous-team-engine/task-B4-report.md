# Task B4 Report: CoS Manager Tool-Policy (Delegate, Don't Do)

## Summary

Implemented a context-sensitive execution-tool exclusion for Chief of Staff (CoS) goal-delivery runs. A CoS on a goal-delivery task now has `Bash`, `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` stripped from its `--allowedTools`, forcing it to delegate work via MCP tools rather than execute directly. All other runs — CoS admin runs, non-CoS staff — are unaffected.

## What Was Built

### 1. Pure testable helper: `manager_tool_filter`
**File:** `apps/api/omilo_api/engines/claude_code.py`

```python
_EXEC_TOOLS = frozenset(["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"])

def manager_tool_filter(tools: list[str], *, is_chief: bool, goal_delivery: bool) -> list[str]:
    if not (is_chief and goal_delivery):
        return tools
    return [t for t in tools if t not in _EXEC_TOOLS]
```

Applied at one point in `_run()`, immediately after `plan(cfg, resources)` resolves the tool list. This ensures resource-granted Bash (e.g. from a folder with `commands=True`) is also suppressed for a CoS goal-delivery run.

### 2. `goal_delivery` field on `TaskContext`
**File:** `apps/api/omilo_api/engines/__init__.py`

Added `goal_delivery: bool = False` to the `TaskContext` dataclass. Defaults to `False` — safe for all existing callers (non-CoS staff, chat engine, graph engine).

### 3. `goal_delivery` computation in `_task_context`
**File:** `apps/api/omilo_api/worker.py`

```python
goal_delivery = False
if st.is_chief:
    if t.origin in ("plan", "review"):
        goal_delivery = True
    else:
        goal_delivery = db.get(TaskGoal, t.id) is not None
```

Logic:
- `is_chief` AND (`origin == "plan"` OR `origin == "review"`) → goal-delivery (planner and reviewer CoS runs are always goal-delivery, even without a TaskGoal row)
- `is_chief` AND TaskGoal row exists → goal-delivery (any CoS task explicitly linked to a goal)
- Everything else → admin run (chat, retro, manual task with no goal link) → normal tool set

Also added `TaskGoal` to the top-level import in `worker.py`.

### 4. Filter applied in `_run`
**File:** `apps/api/omilo_api/engines/claude_code.py`

The `_is_chief` and `_goal_delivery` flags are threaded via `cfg` dict from `run_task` into `_run`. After `plan()` resolves tools, `manager_tool_filter` is called:

```python
tools = manager_tool_filter(tools, is_chief=bool(cfg.get("_is_chief")), goal_delivery=bool(cfg.get("_goal_delivery")))
```

This is additive and does not change `_run`'s signature or any other call site.

## Tests

**File:** `apps/api/tests/test_orchestration.py`

9 new tests added (14-22 in the module docstring):

**Unit tests on `manager_tool_filter` (pure, no DB):**
- `test_b4_filter_strips_exec_tools_for_cos_goal_delivery` — Bash/Write/Edit/MultiEdit absent
- `test_b4_filter_keeps_bash_for_cos_non_goal_delivery` — Bash present for CoS admin run
- `test_b4_filter_non_cos_is_unaffected` — both goal_delivery values; Bash always present
- `test_b4_filter_cos_plan_origin_is_goal_delivery` — origin="plan" → no Bash
- `test_b4_filter_cos_review_origin_is_goal_delivery` — origin="review" → no Bash
- `test_b4_filter_keeps_read_only_tools_for_cos_goal_delivery` — Read/Glob/Grep/WebSearch/TodoWrite kept
- `test_b4_filter_keeps_mcp_tools_for_cos_goal_delivery` — mcp__omilo tools kept

**Integration tests (DB, via `Worker._task_context`):**
- `test_b4_task_context_goal_delivery_true_for_goal_linked_cos_task` — TaskGoal-linked CoS task → `ctx.goal_delivery is True`
- `test_b4_task_context_goal_delivery_false_for_cos_admin_task` — origin="chat", no goal link → `ctx.goal_delivery is False`

All 27 tests in `test_orchestration.py` pass (9 new B4 + 18 existing B1-B3).

## Constraints Verified

- Context-sensitive per run — NOT a permanent `Staff.permissions` strip, NOT prompt-only.
- Does NOT break non-CoS runs or CoS admin runs.
- Additive/surgical — no changes to `_run`'s signature, no changes to `plan()`, no changes to other engine paths (Claude, LiteLLM, GraphEngine).
- MCP delegation tools (`mcp__omilo__*`) and read-only tools preserved.
- `goal_delivery` defaults to `False` — safe for all existing `TaskContext` constructors outside `_task_context` (e.g. graph engine node construction).
