# Self-improving helpers: a Harness²-style loop on Omilo

**Status:** design note (not yet planned/built)
**Date:** 2026-10-19
**Prompted by:** google-research/harness2 (https://github.com/google-research/harness2)

## What this is about

Harness² is a method for making an AI agent better at tasks by **rewriting its own
scaffolding** (prompt, skills, tools, subagents) from evidence of what worked, with
**model weights fixed**. It does not make the model smarter; it makes *our agents* smarter.

Omilo already has most of the machinery. This note maps Harness² onto what exists, names
the gaps, and proposes the smallest additions that get us a self-improving loop. It is a
direction, not a commitment; nothing here is built.

Note on the word "harness": in Omilo, **Harness** = the Claude Code subscription pool
(`harness.py`, where runs execute). In Harness², "harness" = the **editable config layer**
around a fixed model. Same word, different thing. Below, "config" = Harness²'s harness.

## The two loops, and where Omilo already stands

Harness² has two nested recursions:

| Harness² | What it does | Omilo today |
|---|---|---|
| **Harnessing-level** (experience reflection) | After each task, distil lessons + winning config into a persistent *improvement harness* for the next task | **`loops.py` retro** already does this: `improve()` applies a change, `_baseline()` records the before-score, `evaluate()` measures after `MEASURE_DAYS` and keeps or rolls back. Per-helper lessons live in `memory.py` (`lessons_path`, `set_lessons`). This is a working harnessing loop. |
| **Task-level** (Propose → Probe → Compose) | On a *single task*, propose config edits, run each variant, compose the winner from behavioural contrast — no ground-truth labels | **Missing.** Omilo's retro changes one variant on *live traffic* and waits 7 days to judge it by outcome rate. There is no same-task A/B of config variants. |

So the gap is the **task-level loop**, plus widening **what the retro is allowed to edit**.

## The eight editable components → Omilo surfaces

Harness² edits eight components. Omilo already *has* all eight as runtime inputs
(`capabilities.Resources` + the engine `plan()` in `engines/claude_code.py`), but the retro
(`loops.KINDS`) can currently only touch three.

| Harness² component | Omilo surface | Retro can edit today? |
|---|---|---|
| System prompt | `Staff.job` | ✅ `kind="job"` |
| Memory | `memory.py` lessons/notes | ✅ `kind="lessons"` |
| (job cadence) | `Shift.brief` / `Shift.cron` | ✅ `shift_brief`, `shift_schedule` |
| Skills | `capabilities.skills` (`<data>/skills/<slug>/SKILL.md`) | ❌ not yet |
| Guardrails | system-prompt constitution + `SHELL_DENY` + access rules | ❌ (and some must stay owner-only) |
| Tool guidance | `with_resources()` text, tool allowlist | ❌ not yet |
| Scripts | folder commands / Bash allowlist | ❌ not yet |
| Subagents | `create_task` handoffs, per-helper team | ❌ not yet |
| Plugins | connectors/pieces (`capabilities.connectors`) | ❌ not yet |

**Safety boundary (unchanged):** `loops.py` already forbids the retro from touching
permissions, budgets, engine, approvals, or the hard rules (no sending/spending/merging/
deploying without the owner). Any new editable component inherits that boundary. Skills and
tool-guidance are safe to auto-edit (they are instructions); guardrails and plugin *access*
are not — those stay owner-only.

## Proposed additions (smallest viable)

### 1. Task-level Propose–Probe–Compose (the real new thing)

Add an opt-in refinement pass that runs on **one representative task**, offline, before a
config change goes live:

```
propose(k):   ask the Chief (or a dedicated "tuner" helper) for k candidate edits to ONE
              component (e.g. k variants of a helper's system prompt or a skill body)
probe(k):     run the SAME task brief k times on the pool, one per candidate, in parallel
              (we already have the pool + concurrency; each run is a normal engine call)
compose:      compare the k run transcripts (tools used, steps, report quality, cost) and
              pick/merge the best — WITHOUT ground truth, from behavioural contrast
```

- Reuses the pool (`harness.lease`) for cheap parallel probes — this is exactly what the
  subscription seats are for, and overflow falls back to the API key (`auth:"auto"`).
- Judging "which variant behaved better" with no labels is an LLM-judge step (same pattern
  as `interview.py`'s JSON-only calls). Cost is bounded by `k` (default 2, like Harness²).
- The winner enters the existing `improve()` path, so baseline capture + measured
  keep/rollback still apply. Propose–Probe–Compose chooses the change; the harnessing loop
  still verifies it on real traffic.

### 2. Let the retro edit skills + tool guidance

Add `KINDS += ("skill", "tool_guidance")`:
- `skill`: edit a `SKILL.md` body the helper uses (bounded by `MAX_SKILL_CHARS`), with
  before/after captured for rollback exactly like `job`.
- `tool_guidance`: a per-helper note injected via `with_resources()` telling the agent how
  to use its tools better.
Both are instructions, so they sit inside the existing safety boundary.

### 3. Improvement harness = cross-helper lessons store

Today lessons are per-helper files. Add a small shared "what worked" store the tuner reads
before proposing, so a win for one helper can seed another's candidates (Harness²'s
"improvement harness … to guide future refinement"). This can be one Markdown doc under
`memory.py` (e.g. `retro_path`-style) listing adopted edits + evidence, linked from the
memory Index. No schema change required.

## What we deliberately keep

- **Owner control of the hard levers** (permissions/budget/engine/approvals): untouched.
- **Measured keep/rollback** (`evaluate()` with `WORSE_SUCCESS`/`WORSE_APPROVAL`): still the
  final gate. Propose–Probe–Compose only improves *which* change we try, not whether it
  survives real traffic.
- **Everything stays file-backed and visible** (`memory.py` writes Markdown the owner can
  read/edit), so the owner can always see and undo what the loop learned.

## Open questions (for the owner)

1. Who runs the tuner — the Chief of Staff on a schedule, or a dedicated hidden "tuner"
   helper so it does not spend the Chief's context?
2. Probe budget: default `k=2` and cap probes/week (like the existing `MAX_PER_WEEK=3`)?
3. Do we gate the whole feature behind a company setting (off by default), given it spends
   pool/API tokens on probing?

## Relationship to other designs

This composes with `2026-10-19-dynamic-langgraph-staff-design.md`: the LangGraph "learning +
initiative" is the *runtime*; this note is the *offline tuning* of the config that runtime
loads. The multi-engine `auth:"auto"` work (merged) is what makes parallel probing cheap.
