# Omilo Pluggable Backend & Light Tier — Design (Project A)

Date: 2026-10-19
Status: Draft for approval
Author: Dede Kurniawan (with Claude)

## Intent & why

Today Omilo's default first-run footprint is heavy: Docker running three
services — Postgres (with pgvector), Redis, and the app. For someone just
trying Omilo, or running small on a single machine, that is too much to stand
up and too much to keep running well.

We want a **light tier** that runs entirely *in-process on the one machine
Omilo already runs on* — no Docker, no sibling services, no orchestration —
while keeping today's Postgres + pgvector + Redis stack as the **full tier**
you *point Omilo at* when you outgrow light. The guiding principle: **Omilo is
an appliance that uses whatever database/queue it is pointed at; it does not
install or babysit sibling services.** This generalizes what the desktop app
already does (it bundles Postgres + Valkey into one runtime with no Docker).

The user's words: the setup is too heavy on first try; later, when you need
bigger, you should be able to switch easily to the full setup; the platform
should not cover the Docker setup for PG/Redis — those are expected to run on
the same machine the platform runs on; so when the platform itself runs in
Docker, the light tier is a single container, which is the sensible default.

## Goals

- **Light tier runs with zero external dependencies.** One process: embedded
  SQLite, the worker running in-process, an in-process event/lock bus, local
  embeddings. No Docker, no Postgres, no Redis.
- **Multitenancy in the light tier**, by design — same isolation guarantees as
  today's schema-per-company model.
- **Full tier unchanged in behavior.** Point `OMILO_DATABASE_URL` and
  `OMILO_REDIS_URL` at your own Postgres + pgvector + Redis; everything works
  exactly as it does now.
- **A one-way migration light → full**: `omilo migrate --to postgres`.
- **Tier chosen from configuration**, with a sensible default (light).
- **A single-container Docker image** for the light tier.
- **New launch command**: `omilo start` boots the light tier with no Docker.

## Non-goals

- Light-tier high availability, multi-process, or horizontal scale. That is
  exactly what the full tier is for.
- Two-way migration (full → light).
- The interactive first-run `create` wizard, polished menus, and npx/npm/bun
  distribution — that is **Project B**, a required follow-on that depends on
  `omilo start` existing.
- Rewriting the Go CLI in Node (also Project B's concern; current direction is
  to keep the Go CLI).

## Anti-goals (would make this a failure even if it "works")

- A fork that duplicates models or business logic. The light/full split must
  live **only at three seams** — `db.py` (engine/tenancy), `kb.py` (vector +
  full-text search), `bus.py` (events/locks/queue). Everything above those
  seams stays backend-agnostic.
- Silent behavioral divergence. The light tier may legitimately offer a
  *different search-quality tier* (e.g. brute-force vectors at small scale);
  any such difference must be **disclosed**, never hidden.
- Making the full tier harder to run, or changing its behavior, to accommodate
  light.

## Constraints & known-good ground

- **SQLAlchemy models already ran on SQLite before 0.4.** Evidence: the
  `_fit_strings` comment in `db.py` ("Postgres enforces column lengths; SQLite
  never did") and the existence of `import_sqlite.py`. So we are returning to
  known-good ground for the ORM layer, not exploring it.
- **`resolved_database_url()` currently *rejects* any non-Postgres URL** — this
  must be relaxed to accept `sqlite://`.
- **`engine(cid)` already abstracts per-company engines** — it is the single
  tenancy seam.
- **The worker already supports in-process mode** (`OMILO_EMBEDDED_WORKER`).
- **`bus.py` primitives already degrade gracefully** on Redis errors — the
  in-process replacement is a natural second implementation, not a rewrite of
  callers.
- **`import_sqlite.py` already moves SQLite data into Postgres schemas** — the
  `migrate --to postgres` path is a generalization of existing code.
- Default embeddings are `local` (fastembed/ONNX), which work offline — a good
  fit for the light tier.
- Data directory is `~/.omilo` (overridable via `OMILO_DATA_DIR`).

## The design (decided — items marked "my call" were settled by Claude)

### 1. Tier selection

- Tier is derived from the database URL scheme: `sqlite://…` → **light**,
  `postgresql://…` → **full**. *(My call.)* An explicit override env
  (`OMILO_TIER`) is available for edge cases.
- **Default when nothing is configured: light**, with SQLite under the data
  dir. *(My call.)*

### 2. Tenancy — file per company (light)

- Full tier keeps schema-per-company (`co_<cid>` via `search_path`).
- Light tier maps each company to **its own SQLite file**:
  `<data_dir>/companies/<cid>.db`. `engine(cid)` opens that file; no
  `search_path`. The owner's login/auth continues to live in the `main`
  company's store, exactly as today. *(My call: file-per-company mirrors
  schema-per-company isolation and keeps `engine(cid)` the only tenancy seam.)*
- Cross-company operations (overview, `companies`) already iterate companies
  and query each engine — unchanged.

### 3. Vector knowledge base — sqlite-vec + FTS5 (light)

- Full-text: an **FTS5** virtual table replaces `tsvector` + GIN. The RRF merge
  logic is unchanged; the word-search *queries* (`search`, `docs_search`, and
  the `_tsquery` prefix builder) get a SQLite branch that translates to FTS5
  `MATCH`/`bm25()` syntax. Ranking is **equivalent-quality, not byte-identical**
  — the RRF merge absorbs the score-distribution difference, and the different
  search tier is disclosed, per the anti-goal. *(My call.)*
- Vectors: **sqlite-vec** (a `vec0` virtual table) provides cosine KNN,
  replacing pgvector's HNSW. The embedding is stored **both** as a blob/text
  column on `kb_chunk` (so the non-KNN consumers keep working) **and** mirrored
  into a `vec0` table for KNN, kept in sync on every write/delete/reindex
  (`put`, `remove`, `embed_pending`, `reindex`). *(My call.)*
- **All four embedding consumers get a SQLite branch**, not just search:
  `search` (KNN), `related` (centroid — rewrite the `AVG(embedding::vector)`),
  `projection` (the SVD read of `embedding::text` → read the blob column), and
  `_ensure_dim_index` (one `vec0` table per embedding dim, mirroring today's
  per-dim HNSW scheme). *(My call — the builder check flagged `related` and
  `projection` as consumers the first draft missed.)*
- **Multiple embedding dimensions per company** are supported as today: a
  `vec0` table per dim is created on demand. Switching embedding provider
  re-embeds everything (existing `embed.py` behavior), so mixed dims are only
  transient.
- Fallback if sqlite-vec cannot load on a platform: **brute-force cosine in
  Python** over the `kb_chunk` blob column (acceptable at light-tier scale),
  with full-text still working. *(My call: ship sqlite-vec, keep brute-force as
  a disclosed fallback.)*

### 4. Queue / event bus — in-process LocalBus (light)

- `bus.py` keeps its current function API and gains a second implementation
  behind it, selected by tier:
  - `RedisBus` — today's behavior (full tier).
  - `LocalBus` — in-process (light tier): `publish` → in-process async pub/sub
    to the WebSocket layer; `lock`/`claim`/`throttle` → threading primitives +
    a timestamp dict (a single process makes these trivially correct);
    `get_json`/`set_json` → an in-memory TTL map; the KB embed/index queue →
    an in-process queue plus the existing "dirty" marks.
- **The light tier is single-process by definition.** The worker always runs
  embedded; running the standalone `omilo-worker` against a SQLite backend is
  **unsupported** (it is a full-tier capability). This is what makes an
  in-memory LocalBus correct — there is no second process to coordinate with.
  *(My call, consistent with the "no light-tier multi-process" non-goal.)*

### 4b. SQLite concurrency model (light)

- The API request handlers and the embedded worker both write to the same
  per-company `<cid>.db`. To keep that safe under SQLite's single-writer rule:
  **WAL journal mode + a `busy_timeout`**, `check_same_thread=False`, and the
  existing `bus.lock(...)` coordination (now in-process threading locks) around
  dispatch/embed. Writes are serialized; a thin retry-on-`SQLITE_BUSY` wrapper
  guards `session_scope`. *(My call — note that pre-0.4 SQLite did not run an
  embedded worker, so this concurrency path is genuinely new and must be tested
  under load, not assumed from history.)*

### 5. CLI — launch & migrate (Go CLI, extended)

- `omilo start [--data-dir] [--port]` — launches the light tier **in-process,
  no Docker**. *(Exact mechanics of locating/launching the app vs a bundled
  runtime are coordinated with Project B's packaging.)*
- `omilo up` stays as-is = full tier via Docker.
- `omilo migrate --to postgres --database-url … [--redis-url …]` — copies every
  company's SQLite data into Postgres schemas, (re-)embeds the KB, then flips
  the configuration to the full tier. **One-way.** Built as a generalization of
  `import_sqlite.py`.
- **Atomicity: all-or-nothing.** Stage every company into Postgres first; flip
  the config to full tier **only after all companies succeed**. A failure
  mid-way leaves the install still pointed at the light tier (import is
  idempotent via the existing `on_conflict_do_nothing` + marker, so a retry is
  safe). *(My call.)*
- **Derived/bus state is not carried over.** Embeddings are re-generated on the
  full tier; ephemeral LocalBus values (Claude Code pool leases, connector
  health, rate limits) start cold. Persistent settings stored in the DB (e.g.
  the per-company `kb_embedder` choice) migrate with the data. *(My call —
  "re-embed the KB" already implied cold derived state.)*

### 6. Docker packaging

- The light-tier image is a **single container**: app + embedded SQLite, worker
  in-process, nothing else. This becomes the default image.
- Today's three-service `docker-compose.dev.yml` becomes the **full-tier
  reference**, not the default path.

## Positioning (decided by the human)

- **Light tier is a trial / tiny-use tier, meant to graduate.** It is how you
  *try* Omilo and run small; anyone doing real work is expected to move to the
  full tier. Consequences for scope:
  - SQLite-on-disk durability is sufficient as-is. **No backup/export tooling
    in Project A** — if a user wants durability guarantees, they graduate.
  - The product should **nudge toward `migrate` early** (e.g. a visible note in
    the UI / `doctor` once the KB or task volume crosses a soft threshold).
  - Light-tier concurrency (§4b) is still built correctly — a trial that
    corrupts data is still a failure — but we do not invest in scale/HA.

## What's left to the builder

- sqlite-vec packaging and cross-OS extension loading; the exact brute-force
  fallback threshold.
- Which `get_json`/`set_json` values must survive a restart (e.g. Claude Code
  pool leases, connector health) → in-memory vs a small on-disk kv table.
- Test strategy: parametrize the existing suite to run against both backends.
- Any model columns that need a backend-neutral type review (vector column
  stored as blob/text in SQLite; JSON already portable).
- Precise `omilo start` process model, in coordination with Project B.
