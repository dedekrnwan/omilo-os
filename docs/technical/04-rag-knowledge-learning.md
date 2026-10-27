# 04 · RAG, Knowledge & Learning

> Track: **technical**. How Helpers know things and get smarter: hybrid retrieval, editable
> memory, periodic external learning, and the retro loop. Ported from omilo-os's `kb.py`,
> `embed.py`, `memory.py`. Product-facing behavior in
> [`business/learning-skills-flows.md`](../business/learning-skills-flows.md) and
> [`business/docs-knowledge.md`](../business/docs-knowledge.md).

## 1. Stores

| Store | Table(s) | Role |
|---|---|---|
| **Knowledge base (RAG)** | `KbSource` / `KbChunk` (pgvector) | searchable memory across everything the company knows. |
| **Memory (editable)** | `MemoryDoc` (markdown) | lessons/notes/loop-logs/retros; human-editable; also KB-indexed. |
| **Docs vault** | `Doc` / `DocVersion` | wiki with `[[links]]` (d3-force graph); operator + agent authored. |
| **Skills** | `Skill` | reusable agent-authored know-how. |

Everything is **company-scoped** — RLS guarantees retrieval never crosses tenants.

## 2. Ingestion & chunking

`KbKind` sources: `doc, memory, context, job, chat, proposal, file, web, connector, skill,
note`. Ingestion paths:
- **On write** — Docs, Reports, Proposals index synchronously-ish (enqueue a KB job).
- **Marked** — Jobs/chats/proposals flagged during execution, indexed by the worker in the
  background.
- **Explicit** — files, URLs, connector data, notes added via UI (`POST /v1/knowledge/sources`)
  or the agent `kb_add`/`remember` MCP tools.

**Chunking** (markdown-aware, from `kb.py`): split at headings, target **~900 chars** with
**~120 char overlap**; merge small adjacent chunks. Each chunk stores `heading` + `text` so
retrieval returns a titled, citeable snippet.

## 3. Embeddings (pluggable)

Provider chosen in Control-Panel → Knowledge; each chunk records its model + `dim` so switching
re-embeds in the background.

| Provider | Model (default) | Dim | When |
|---|---|---|---|
| **local** (default) | `paraphrase-multilingual-MiniLM-L12-v2` (fastembed, ONNX, no GPU) | 384 | self-host, cost-sensitive, multilingual (Bahasa friendly) |
| voyage | `voyage-3.5-lite` | 1024 | higher quality cloud |
| openai | `text-embedding-3-small` | 1536 | if operator already on OpenAI |
| hash | word-hash fallback | — | tests / before a model is configured |

## 4. Hybrid retrieval

`recall(query, kinds?, memory_only?)` runs **two searches and fuses them** (reciprocal-rank
fusion), so it works even before embeddings exist:
1. **Full-text** — Postgres `tsvector` + GIN (word/BM25-ish match).
2. **Semantic** — pgvector **HNSW** nearest-neighbor on the query embedding.
3. **RRF merge** → ranked chunks, each with `{source, heading, text, kind, score}`.

Retrieval is always filtered by `company_id` and optionally by `kinds` and `helper_id`.
Results feed `TaskContext.memory` (assembled context) and the agent's `recall` tool.

```sql
-- shape of the semantic leg (per company, RLS-scoped)
SELECT c.id, c.heading, c.text, c.source_id,
       1 - (c.embedding <=> :qvec) AS score
FROM kb_chunk c
WHERE c.company_id = current_setting('app.company')
ORDER BY c.embedding <=> :qvec
LIMIT :k;
```

### 4a. Area context scope (`Channel.context_scope`)

When a Job runs **inside an Area** (`Channel`), retrieval is further bounded by that area's
**context scope** — the "Context" choice in the Create-area modal:

- **`isolated`** (recommended default) — only this area's own chats, goals, docs, and KB sources
  are retrievable. One area's work doesn't bleed into another's reasoning.
- **`isolated_plus_general`** — this area's scope **plus** company-wide basics from the **General**
  area (the handbook, company-level docs), so an area can read shared context without seeing other
  areas' private work.

Mechanically, KB sources carry their originating `channel_id`; retrieval for an area-scoped Job
adds a channel predicate (`channel_id = :area` — or `IN (:area, :general)` for
`isolated_plus_general`) on top of the `company_id` RLS filter. Company-global sources (handbook,
company profile) are tagged to General and always visible under `isolated_plus_general`. The
area's **`purpose`** text is injected into `get_context` so agents working there know what the
space is *for* ("Customer onboarding, retention and support"). This makes areas a real
**knowledge boundary**, not just a UI grouping — the Chief (present in every area) is the one role
that can bridge them.

## 5. Memory as editable markdown

Learned knowledge is **plain markdown docs** the operator can read and edit (Obsidian-style),
not opaque rows — so trust and correction are easy:

```
Memory/Index.md                     # links everything (keeps the graph connected)
Memory/<helper_id>/Lessons.md       # rules learned from operator decisions + retro (newest first)
Memory/<helper_id>/Notes.md         # things the helper chose to remember
Memory/Loops/<helper> · <job>.md    # run log of one routine (date, outcome, headline)
Memory/Retros/<year>-W<week>.md     # what the retro changed, why, whether it helped
```

`add_lesson(helper_id, text, source)` prepends `- **<date>** · <text> (<source>)`. Agents read
their Lessons before every run (loaded into `TaskContext.memory`). Operator edits are
first-class and re-indexed.

## 6. Periodic external learning ("getting smarter from the internet")

A scheduled **learning routine** per Helper (opt-in; Control-Panel → Knowledge toggle, default
**Off** as the UI badge shows) does relevance-filtered reading:

1. **Topic selection** — derive candidate queries from the Helper's `area`/role, the company
   context (handbook), open `Goal`s, and the operator profile.
2. **Fetch** — via the browser/web connector, pull a small, rate-limited set of fresh sources.
3. **Relevance gate** — an LLM pass scores each source against role+company+goal+operator;
   below threshold is dropped (prevents drift/noise).
4. **Distill & store** — summarize kept sources into KB `web` sources + a Memory note, with
   provenance (url, fetched_at). Never auto-acts on it — learning ≠ doing.
5. **Budget** — capped credits/run and frequency ("periodically, randomly"); jitter the
   schedule so it's not a thundering herd.

This is the mechanism behind "they learn from external sources periodically and get smarter,
but stay relevant." Safety: external content is **context only**, never executed, and is
clearly provenanced so the operator can prune it.

## 7. Skills (self-authored know-how)

When a Helper does something well or repeatedly, it can author a **Skill** (`skill_save` MCP
tool): a markdown doc of steps/checklist/rules/examples. Skills are versioned; **publishing**
a skill is a `skill_publish` Proposal (operator or Chief approves). Published skills are
loaded into context when relevant and raise quality/consistency over time. This is distinct
from Flows (which automate *actions*); Skills improve *how* an agent works. See
[`business/learning-skills-flows.md`](../business/learning-skills-flows.md).

## 8. Retro / scorecard (measured improvement)

A weekly retro (a Chief routine) computes a **scorecard** per routine/goal — runs, success
rate, approval rate, cost — and proposes **Improvements** (change a brief, a schedule, or a
lesson) with **before/after** baselines so a change can be kept or rolled back on evidence.
Mirrors omilo-os `loops.py` `scorecard()`/`review()`. Improvements that need a human land as
InboxItems; under higher autonomy the Chief applies and measures them itself.

## 9. Learning & privacy

- All learning is company-scoped; one tenant's lessons/skills/KB never inform another's.
- External-learning sources are provenanced and prunable; the operator can disable per-helper.
- Credit cost of learning/embedding is metered like any other LLM use (see [`08`](08-billing-ai-credits.md)).
