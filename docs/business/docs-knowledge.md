# Docs & Knowledge — what the team knows

> Track: **business**. This is the "what your team knows and where it lives" story told as
> behavior. It covers the **company knowledge base** (the handbook every Helper reads before
> it works), the **Docs vault** (your wiki with `[[links]]`, shown as a d3-force graph),
> how retrieval (`recall`) surfaces the right knowledge during a job, how you add knowledge,
> the Knowledge toggle, and the privacy guarantees. For the retrieval mechanics — hybrid
> search, chunking, embeddings — see
> [`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md).
>
> Related: [`learning-skills-flows.md`](learning-skills-flows.md) (how agents *add* to this
> knowledge by learning), [`chief-orchestration.md`](chief-orchestration.md) (how the Chief
> uses knowledge to plan), and [`inbox-approvals.md`](inbox-approvals.md) (where agent doc
> edits are accepted).

---

## 1. Two kinds of knowledge, one clean split

omilo keeps a deliberate separation that shows up all over the UI (*"Agent memory is
separate," "Ask Chief · searches docs only"*):

| | **Knowledge base (the handbook + what agents learned)** | **Docs vault (the wiki)** |
|---|---|---|
| What | company facts + agent-learned lessons/notes | authored documents with `[[links]]` |
| Shape | the 7-note handbook + Memory markdown, RAG-indexed | `Doc` / `DocVersion`, a d3-force graph |
| Who writes | operator seeds it; agents learn into it | operator + agents (agent writes are Proposals) |
| How read | `get_context` (handbook) + `recall` (search) | `docs_search` / `docs_read`; opened in Notes/Graph |
| Toggle | the **Knowledge** search layer is **opt-in, default Off** | Docs are always on |

The short version: the **handbook** is the *seed context* every Helper reads before it
starts. The **Docs vault** is the *living reference library* operator and agents build
together. The **Knowledge search layer** (memory + semantic recall) is the *opt-in* ability
to find any of it by meaning.

---

## 2. The company handbook — seed context every Helper reads

Before a Helper does anything, it needs to know *who you are, who you serve, what you sell,
and what it must never do.* That's the handbook — captured during onboarding and read on
every job via the `get_context` tool.

### 2a. The seven notes

The onboarding wizard captures the company as seven short notes (`KNOWLEDGE_NOTES`), framed
as *"what your team will know"*:

| Note | What it holds |
|---|---|
| **Company** | who you are and what you do |
| **Customers** | who you serve |
| **Goals** | what you want this quarter |
| **Offer** | what you sell, for how much |
| **Rules** | what Helpers must **never** do |
| **Systems** | your tools and where things live |
| **Voice** | how you sound |

These are stored as the **company handbook** (`GET/PATCH /v1/company/handbook`) and are the
knowledge *seed*. "Rules" is load-bearing: it's where "never issue a refund over Rp 2jt
without Dede" lives, and the Chief's planning and the gate both lean on it.

### 2b. get_context — read before every job

Every Helper calls `get_context` at the start of a turn and gets the handbook back —
profile, goals, voice, rules, systems, KPIs. This is why a brand-new Helper already sounds
like your company and already knows your hard limits: it's reading the seed you wrote in
onboarding, every single time, before it touches the work.

> The handbook is the one piece of knowledge that is **always** in context, regardless of
> the Knowledge toggle. Rules and voice are too important to be a search hit that might miss.

---

## 3. The Docs vault — your wiki with a living graph

The Docs vault is the team's shared reference library: a wiki of markdown documents linked
with `[[wikilinks]]`, visible both as a file list (**Notes**) and as a **d3-force graph**
(the `Graph` view in `OfficeDocsRoute`). Goals, docs, and memories appear as connected nodes
so you can *see* how the company's knowledge hangs together.

### 3a. Notes, links, and the graph

- **Notes.** A left-sidebar list of docs grouped by area, each with status, last-edited,
  and a `By you / By agents` filter — because *who wrote it* matters.
- **`[[links]]`.** Inline wikilinks render as clickable references. A deploy doc links
  `[[Rollback runbook]]`; the graph draws the edge. The doc viewer shows **Links from
  here**, **Linked here** (e.g. a Goal that references the doc), an outline, and **history**.
- **Graph.** The d3-force graph renders every doc and its links as a physical web — the
  product's signature "your knowledge is connected" view. `Memory/Index.md` keeps the graph
  connected so nothing floats orphaned.

### 3b. Operator-authored and agent-authored

Docs are written by **both** operator and agents — but with different gates:

- **Operator** writes and edits freely (`POST /v1/docs`, direct edits).
- **An agent** doesn't silently overwrite your docs. An agent's write is a
  **`doc_write` Proposal / a version-0 *suggestion*** (`POST /v1/docs/{id}/suggest`): the
  Helper proposes content with a summary, and the operator **accepts** a version
  (`POST /v1/docs/{id}/accept`) to make it real. This is exactly the handbook UI's *"Suggest
  a change"* button — it emits *"Suggestion sent — Chief will review and propose an edit,"*
  not an instant overwrite.

> **The rule:** operators edit; agents **suggest**. Agent doc writes are version-0 proposals
> you accept, so the vault never changes under you. See
> [`inbox-approvals.md`](inbox-approvals.md).

### 3c. Ask Chief about your docs

The **Ask Chief** view answers questions *from your docs*, with **citations** — it reads the
relevant docs, answers, and shows the exact sources and lines it used (*"read 4 docs,"* a
Sources bar, a numbered citation list). You can **narrow** it (`@engineering`, `@by:dev`).
Crucially, when the Knowledge toggle is **off**, Ask Chief is honest about its blind spot:
it shows *"Agent memory wasn't searched — Knowledge is off for this company,"* so you always
know whether an answer saw the full picture or only the docs.

---

## 4. recall — surfacing knowledge during a job

Reading the handbook gives a Helper the *seed*. **`recall`** gives it everything else, on
demand, by meaning.

### 4a. What recall does

During a job, a Helper calls `recall(query)` and gets back the most relevant chunks from
**everything the company knows** — docs, memory lessons, past jobs, chats, proposals, added
files/URLs, and provenanced external reading. Each result comes back as a **titled, citeable
snippet** (`{source, heading, text, kind, score}`), so the Helper can both *use* the
knowledge and *show its work*. This is what powers the cited answers in Ask Chief and the
sources that stream into a job thread.

### 4b. Why it's reliable

`recall` is **hybrid** — it fuses keyword search with semantic (meaning-based) search, so it
finds the right doc whether you remember the exact word or just the gist, and it works even
before embeddings are fully built. Retrieval is always **company-scoped** and can be filtered
by kind (e.g. *memory only*) or by helper. The mechanics live in
[`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md) §4.

> **Behavioral payoff:** a Helper mid-job doesn't need you to paste the runbook. It asks its
> own knowledge base by meaning and pulls the right snippet, cited. The handbook is the
> always-on seed; `recall` is the search over the whole vault and memory.

---

## 5. Adding knowledge — files, URLs, notes

Beyond the onboarding handbook and the Docs vault, you top up the knowledge base directly in
**Control-Panel → Knowledge**.

- **Files.** Upload a PDF, policy doc, spec — it's chunked and indexed for `recall`.
- **URLs.** Point at a page; its content is fetched and indexed (`kind: web`).
- **Notes.** Type a fact directly ("Our fiscal year starts in April").

All of these go through `POST /v1/knowledge/sources` and become `KbSource`/`KbChunk` rows,
immediately searchable. Agents can *suggest* additions too (the `kb_add` / `remember` tools),
but **external** additions route through the gate as a Proposal — the same propose-don't-act
discipline as everywhere else. You can remove any source
(`DELETE /v1/knowledge/sources/{id}`), which is what keeps the base prunable and trustworthy.

---

## 6. The Knowledge toggle — opt-in, default Off

The **Knowledge** search layer — storing agent memories and searching docs + memory by
meaning — is **off by default**, shown as a `Knowledge · off` badge in the Docs topbar. When
off, the `Knowledge` tab shows a clear explainer and a **"Turn on Knowledge"** action; Ask
Chief still answers from docs but tells you memory wasn't searched.

### 6a. Why Off by default

Turning Knowledge on means (a) the workspace starts **storing agent memories** and (b)
retrieval starts searching **memory as well as docs**. That's a meaningful data decision, so
it's a deliberate, admin-only choice — not an on-by-default surprise. The in-product copy is
explicit about the tradeoff and the setup:

- **The pitch when on:** *"agents stop repeating mistakes you already corrected," "Ask Chief
  can search docs and memory by meaning," "you review every lesson before agents use it."*
- **The setup check:** it runs on **pgvector** in your own workspace database; turning it on
  installs the extension and uses your company AI account to embed (*~$0.02 per 1k
  memories*).
- **The retention promise:** admin-only to enable; **turn it off anytime** — memories are
  kept 30 days, then deleted.

### 6b. What the toggle does and doesn't gate

- **Always on:** the handbook (via `get_context`) and the Docs vault. Rules, voice, and your
  wiki are never gated behind Knowledge.
- **Gated by the toggle:** the *memory* store and *semantic recall over memory*. With
  Knowledge off, agents still read the handbook and docs; they just don't accumulate or
  search a personal memory.

This pairs directly with the learning story: external reading and lesson-accumulation
(in [`learning-skills-flows.md`](learning-skills-flows.md)) are the *producers* of agent
memory; the Knowledge toggle is the *master switch* that decides whether that memory is kept
and searched at all.

---

## 7. Privacy & tenancy

- **Company-scoped, always.** Every doc, handbook note, memory, and KB source belongs to one
  company. Retrieval is filtered by `company_id` at the data layer (RLS), so one tenant's
  knowledge **cannot** surface in another's — not by accident, not by a crafted query.
- **Yours to prune.** Files, URLs, notes, docs, and memories are all deletable by you.
  Provenance is kept (especially for external/web sources) so you can trace any fact and
  remove it.
- **Self-hostable.** The Knowledge store is pgvector in *your* workspace database; in the
  self-host posture, your docs and memories never leave your machine.
- **Readable.** Knowledge is markdown and structured rows you can inspect — not an opaque
  model. You can always answer "why does my agent think this?"

---

## 8. Worked example — seed the handbook, then accept a Helper's doc edit

A concrete walk-through from onboarding to a day-to-day doc improvement.

**Onboarding — the operator seeds the handbook.**
Dede sets up *Sahabat Warga*. In the wizard, he fills the seven notes: **Company** (a
neighborhood dues-and-services org), **Customers** (residents), **Offer** (Rp 25rb/month
iuran), **Rules** (*"late fee waived for residents 65+," "refunds over Rp 2jt go to Dede"*),
**Systems**, **Voice**. These become the handbook. From this moment, every Helper that runs a
job calls `get_context` and already knows the dues amount, the senior-citizen rule, and the
company's tone — without Dede repeating any of it.

**Day 1 — the handbook also seeds the Docs vault.**
Dede (or the Chief, on his approval) turns the **Rules** note into a `POLICIES.md` doc in the
vault, linked from the goals that reference it. It shows in **Notes** under the Company
handbook and as a node in the **Graph**.

**Week 3 — a Helper suggests a doc edit.**
A resident asks Support about late fees for an elderly parent. The **Support** helper,
reading `POLICIES.md`, notices the senior-citizen waiver is stated loosely. It drafts a
tightened line — *"Late fee waived for residents aged 65 and over"* — and, rather than
overwriting the doc, files it as a **`doc_write` suggestion** (`POST /v1/docs/{id}/suggest`,
a version-0). In the handbook UI this is the *"Suggest a change"* flow; Dede sees
*"Suggestion sent — Chief will review and propose an edit."*

**Week 3 — the operator accepts.**
The suggestion arrives for review (see [`inbox-approvals.md`](inbox-approvals.md)). Dede
opens `POLICIES.md`, sees the proposed line highlighted as **New**, and **accepts** the
version (`POST /v1/docs/{id}/accept`). The doc's **history** now shows *"Support · today ·
clarified senior-citizen waiver,"* and the new line is live. The vault changed — but only
because Dede said so.

**Thereafter — the knowledge compounds.**
The clarified `POLICIES.md` is re-indexed. Next time any Helper calls `recall("late fee
seniors")`, it gets the precise, operator-accepted line, cited — and Ask Chief answers the
next resident question straight from that doc, showing the exact line it used. The operator
seeded the handbook once; the team keeps the reference library sharp, and every edit is one
the operator chose to accept.

---

## 9. Cross-references

- [`learning-skills-flows.md`](learning-skills-flows.md) — how agents *produce* knowledge:
  learning from jobs, periodic external reading, authoring Skills, proposing Flows, the retro
  loop.
- [`chief-orchestration.md`](chief-orchestration.md) — how the Chief reads the handbook and
  the vault to plan and delegate, and how it reviews doc suggestions.
- [`inbox-approvals.md`](inbox-approvals.md) — where `doc_write` suggestions and external
  `kb_add` proposals are reviewed and accepted.
- [`../technical/04-rag-knowledge-learning.md`](../technical/04-rag-knowledge-learning.md) —
  the mechanics: stores, chunking, embeddings, hybrid retrieval, memory-as-markdown.
