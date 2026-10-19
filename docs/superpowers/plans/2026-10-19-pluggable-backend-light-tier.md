# Pluggable Backend & Light Tier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Omilo run as a single in-process "light tier" on embedded SQLite (no Docker, no Postgres, no Redis), while keeping the Postgres+pgvector+Redis "full tier" unchanged, with a one-way `migrate --to postgres` graduation path.

**Architecture:** The light/full split lives at exactly three seams — `db.py` (engine + tenancy), `bus.py` (events/locks/queue), `kb.py` (vector + full-text search) — plus the `KbChunk` model's column types. Tier is derived from the database URL scheme (`sqlite://` → light, `postgresql://` → full). Light tier is one process: embedded worker, in-process `LocalBus`, file-per-company SQLite. Everything above the three seams stays backend-agnostic.

**Tech Stack:** Python 3.11+, SQLAlchemy, SQLite (WAL) + [sqlite-vec](https://github.com/asg017/sqlite-vec) + FTS5, pgvector (full tier), Go CLI, Docker.

**Spec:** `docs/superpowers/specs/2026-10-19-pluggable-backend-light-tier-design.md`

## Global Constraints

- Python floor: **3.11+** (matches existing `Makefile` `PYTHON` probe).
- Light tier is **single-process**: the standalone `omilo-worker` against SQLite is unsupported. In-process coordination only.
- The split touches **only** `config.py`, `models.py` (KbChunk column types), `db.py`, `bus.py`, `kb.py`, `worker.py` (queue access), the Go CLI, and Docker files. No business-logic module above these seams changes behavior.
- Full tier behavior must be **byte-for-byte unchanged** when `OMILO_DATABASE_URL` is a `postgresql://` URL.
- Light tier SQLite search ranking is **equivalent-quality, disclosed**, not identical to Postgres `ts_rank_cd`.
- Company id → filename: company ids already match `^[a-z0-9][a-z0-9-]{0,47}$` (`company.py` `_ID`), so they are filesystem-safe; no extra sanitization needed, but the `main` company maps to `<data_dir>/omilo.db` (not a `companies/` subdir), mirroring `dir_for`.
- Data dir default: `~/.omilo` (`OMILO_DATA_DIR` overrides).

## Review Focus

- **Existing full-tier users** who set `OMILO_DATABASE_URL=postgresql://…` must see zero change when the default flips to SQLite — covered by Task 1's test asserting a postgres URL still resolves to full tier.
- **Empty / whitespace / punctuation-only search query** on SQLite FTS5 (FTS5 `MATCH` throws on empty/syntax-bad queries where Postgres returned nothing) — covered by Task 6's `test_search_empty_query_sqlite`.
- **Hash embedder (no model) search on SQLite** — the offline/test path must return results via full-text even before vectors exist — covered by Task 6's `test_search_words_only_before_vectors_sqlite`.
- **Concurrent write (request handler + embedded worker) → `SQLITE_BUSY`** must retry, not 500 — covered by Task 3's `test_concurrent_writes_retry`.
- **Migration partial failure** (company 3 of N fails) must leave config still pointed at light tier, no half-flip — covered by Task 8's `test_migrate_aborts_before_flip_on_failure`.

---

### Task 1: Tier detection & SQLite URL in Settings

**Files:**
- Modify: `apps/api/omilo_api/config.py` (`resolved_database_url`, add `tier`, change `database_url` default)
- Test: `apps/api/tests/test_config_tier.py`

**Interfaces:**
- Produces: `Settings.resolved_database_url() -> str` (now also returns `sqlite://…` unchanged); `Settings.tier` property → `"light" | "full"`; new default `database_url` = `f"sqlite:///{data_dir}/omilo.db"` when unset. `OMILO_TIER` env forces a tier if set.

- [ ] **Step 1: Write failing tests**

```python
def test_sqlite_url_resolves_and_is_light(tmp_path, monkeypatch):
    monkeypatch.setenv("OMILO_DATABASE_URL", f"sqlite:///{tmp_path}/omilo.db")
    s = Settings()
    assert s.resolved_database_url().startswith("sqlite:///")
    assert s.tier == "light"

def test_postgres_url_still_full(monkeypatch):
    monkeypatch.setenv("OMILO_DATABASE_URL", "postgresql://omilo:omilo@127.0.0.1:5432/omilo")
    s = Settings()
    assert s.resolved_database_url().startswith("postgresql+psycopg://")
    assert s.tier == "full"

def test_default_is_light_sqlite(monkeypatch, tmp_path):
    monkeypatch.delenv("OMILO_DATABASE_URL", raising=False)
    monkeypatch.setenv("OMILO_DATA_DIR", str(tmp_path))
    assert Settings().tier == "light"
```

- [ ] **Step 2: Run tests, verify they fail** — Run: `cd apps/api && .venv/bin/pytest tests/test_config_tier.py -v` — Expected: FAIL (`resolved_database_url` raises on sqlite; no `tier`).

- [ ] **Step 3: Implement** — In `resolved_database_url`, return the url unchanged when it starts with `sqlite://`; keep the postgres normalization/rejection for everything that is neither sqlite nor postgres. Add `tier` property: `"light"` if `OMILO_TIER=="light"` or the resolved url starts with `sqlite`, else `"full"` (honor explicit `OMILO_TIER`). Change the `database_url` field default to compute the sqlite path from `data_dir` (use a `default_factory`/validator so `OMILO_DATA_DIR` is honored).

- [ ] **Step 4: Run tests, verify pass** — Run: `cd apps/api && .venv/bin/pytest tests/test_config_tier.py -v` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): tier detection + sqlite database URL in Settings"`

---

### Task 2: Dialect-neutral KbChunk model

**Files:**
- Modify: `apps/api/omilo_api/models.py` (KbChunk `embedding`, `tsv`; imports)
- Test: `apps/api/tests/test_kbchunk_sqlite_schema.py`

**Interfaces:**
- Produces: `KbChunk` whose `embedding` column renders as pgvector `Vector()` on PostgreSQL and `LargeBinary` on SQLite (via a SQLAlchemy `TypeDecorator`/`type_variant`); the `Computed` `tsv` column exists only on PostgreSQL. On SQLite the FTS index is an external table built in Task 5 — `KbChunk` carries no `tsv` column there.

- [ ] **Step 1: Write failing test**

```python
def test_kbchunk_create_all_on_sqlite(tmp_path):
    from sqlalchemy import create_engine
    from omilo_api.db import Base
    from omilo_api import models  # noqa: F401
    eng = create_engine(f"sqlite:///{tmp_path}/t.db")
    Base.metadata.create_all(eng)          # must not raise
    insp = inspect(eng)
    cols = {c["name"] for c in insp.get_columns("kb_chunk")}
    assert "embedding" in cols and "tsv" not in cols
```

- [ ] **Step 2: Run test, verify it fails** — Expected: FAIL (`Vector`/`TSVECTOR`/`Computed` DDL errors on SQLite).

- [ ] **Step 3: Implement** — Replace the `embedding` column with a type that is `Vector()` under the `postgresql` dialect and `LargeBinary` under `sqlite` (SQLAlchemy `TypeEngine.with_variant` or a `TypeDecorator` whose `load_dialect_impl` branches). Gate the `tsv` `Computed` column so it is only added on PostgreSQL (e.g. a `Column(..., info={"pg_only": True})` filtered in `db._after_create`, or define `tsv` conditionally). Keep the serialized blob format = little-endian float32 (compatible with sqlite-vec) — document the format in a comment; Task 5 reads it.

- [ ] **Step 4: Run test, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): dialect-neutral KbChunk (vector blob + no tsv on sqlite)"`

---

### Task 3: db.py SQLite engine (file-per-company, WAL, busy-retry)

**Files:**
- Modify: `apps/api/omilo_api/db.py` (`engine`, `_url`, add `_sqlite_path`, add `is_sqlite`, retry in `session_scope`)
- Test: `apps/api/tests/test_db_sqlite_engine.py`

**Interfaces:**
- Consumes: `Settings.tier`, `Settings.resolved_database_url` (Task 1).
- Produces: `engine(cid)` returns a per-company SQLite engine on light tier — `main` → `<data_dir>/omilo.db`, others → `<data_dir>/companies/<cid>.db`; `is_sqlite(bind) -> bool`; `session_scope`/`get_db` retry once on `OperationalError` matching `database is locked`.

- [ ] **Step 1: Write failing tests**

```python
def test_light_engine_is_file_per_company(tmp_path, monkeypatch):
    _use_light(monkeypatch, tmp_path)
    db.engine("main"); db.engine("acme")
    assert (tmp_path / "omilo.db").exists()
    assert (tmp_path / "companies" / "acme.db").exists()

def test_company_isolation(tmp_path, monkeypatch):
    _use_light(monkeypatch, tmp_path)
    with db.session_scope("main") as s: s.add(Setting(key="company_name", value="A"))
    with db.session_scope("acme") as s: assert s.get(Setting, "company_name") is None

def test_concurrent_writes_retry(tmp_path, monkeypatch):
    # hold a write lock in one connection; a second write must retry past busy_timeout, not raise
    ...
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement** — In `engine(cid)`, branch on `get_settings().tier`: for light, skip the `CREATE EXTENSION`/`CREATE SCHEMA`/`search_path` boot block; build `create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30}, poolclass=...)`; on `connect`, `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=30000; PRAGMA foreign_keys=ON` (via a `connect` event listener). Still run `Base.metadata.create_all`, `_after_create`, `_migrate`. Add `_sqlite_path(cid)` using `company.dir_for`-style mapping. Add `is_sqlite(bind)`. Wrap the body of `session_scope` / the `get_db` yield with a single retry when `OperationalError` message contains `database is locked`.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): sqlite file-per-company engine with WAL + busy retry"`

---

### Task 4: bus.py LocalBus (in-process events/locks/queue)

**Files:**
- Modify: `apps/api/omilo_api/bus.py` (add in-process backend, select by tier; make `redis` import lazy)
- Test: `apps/api/tests/test_bus_local.py`

**Interfaces:**
- Consumes: `Settings.tier`.
- Produces: the **existing** `bus` function surface works in light tier with no Redis: `publish`, `lock`, `claim`, `release`, `get_json`, `set_json`, `throttle`. Plus new set helpers that hide the raw `r().sadd/spop` used by `kb.py`/`worker.py`: `mark_pending(cid)`, `pop_pending(n) -> list[str]`, `add_marks(cid, items)`, `pop_marks(n, cid) -> list[str]`, `drop(name, cid)`. On full tier these delegate to Redis sets exactly as today.

- [ ] **Step 1: Write failing tests**

```python
def test_local_lock_is_exclusive(light):
    with bus.lock("x") as a:
        assert a is True
    # claim/release round-trip
    assert bus.claim("c", 10) is True and bus.claim("c", 10) is False

def test_local_set_json_ttl(light):
    bus.set_json("k", {"v": 1}, ttl_s=0.01); time.sleep(0.02)
    assert bus.get_json("k") is None

def test_local_pending_queue(light):
    bus.mark_pending("acme"); assert "acme" in bus.pop_pending(10)

def test_no_redis_import_in_light(light):
    bus.check()   # must not raise, must not connect to redis
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement** — Introduce two backends behind the module functions: keep today's Redis code as the full-tier path; add a `_LocalBus` using `threading.RLock`-guarded dicts: `{key: (value_json, expiry)}` for get/set_json/throttle/claim, a `{name: token}` map for `lock`, `set`s for pending/marks, and an in-process async fan-out for `publish` (a list of registered `asyncio.Queue`s the WebSocket layer subscribes to — expose `subscribe()/unsubscribe()` used by the WS endpoint). Each public function checks `get_settings().tier` once (cache per call) and dispatches. Make `import redis` lazy so light tier never requires the package at runtime. Route `kb.py`/`worker.py` raw set ops through the new helpers (changed in Tasks 5–6).

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(backend): in-process LocalBus for light tier"`

---

### Task 5: kb.py SQLite search backend (FTS5 + sqlite-vec, dual-write)

**Files:**
- Modify: `apps/api/omilo_api/kb.py` (`ensure_indexes`, `_ensure_dim_index`, `put`, `remove`, `embed_pending`, `reindex`, `search`, `docs_search`, `_tsquery`, `related`, `projection`)
- Add: `apps/api/omilo_api/kb_sqlite.py` (the SQLite-dialect SQL, kept out of `kb.py`'s Postgres path)
- Test: `apps/api/tests/test_kb_sqlite.py`

**Interfaces:**
- Consumes: `db.is_sqlite` (Task 3), `KbChunk.embedding` blob format (Task 2), `bus` helpers (Task 4).
- Produces: all public `kb` functions behave the same on SQLite as on Postgres (same return shapes). `kb_sqlite` exposes `ensure_fts_and_vec(eng)`, `ensure_vec_table(db, dim)`, `upsert_vec(db, chunk_id, dim, vec)`, `delete_vec(db, chunk_id)`, `knn(db, dim, qv, k, where, params) -> list[(id, sim)]`, `fts_match(db, tq, ...) -> list[(id, rank)]`, `fts_query(terms, prefix, op) -> str`.

- [ ] **Step 1: Write failing tests** — with an in-memory/`tmp_path` SQLite company and the `hash` embedder:

```python
def test_fts_search_returns_source(sqlite_kb):
    kb.put(db, "doc", "a.md", "Pricing", "Our pricing plans and tiers")
    hits = kb.search(db, "pricing")
    assert any(h["ref"] == "a.md" for h in hits)

def test_vector_knn_after_embedding(sqlite_kb):
    kb.put(db, "doc", "b.md", "Cats", "felines and kittens")
    kb.embed_pending(db)                      # writes blob + vec0 row
    assert kb.search(db, "kitten")            # KNN path returns something

def test_related_and_projection_sqlite(sqlite_kb):
    ...  # related() returns neighbors; projection() returns {points: [...]}
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement** — In each listed `kb` function, branch `if db.is_sqlite(db.bind):` to the `kb_sqlite` equivalent, leaving the Postgres SQL untouched:
  - `ensure_indexes` → also call `kb_sqlite.ensure_fts_and_vec`: create FTS5 external-content table `kb_chunk_fts(heading, text, content='kb_chunk', content_rowid='id')` + sync triggers (insert/update/delete), and load the sqlite-vec extension (`import sqlite_vec; sqlite_vec.load(conn)` in the `connect` listener from Task 3; if the import/load fails, set a module flag `VEC_OK=False`).
  - `_ensure_dim_index` → `ensure_vec_table(db, dim)`: `CREATE VIRTUAL TABLE IF NOT EXISTS kb_vec_{dim} USING vec0(embedding float[{dim}])` (skip when `VEC_OK` is false).
  - `put`/`embed_pending`/`reindex`/`remove` → after writing the `embedding` blob, `upsert_vec`/`delete_vec` into `kb_vec_{dim}` (skip when `VEC_OK` is false).
  - `search` → vector half = `knn` (or brute-force cosine over the blob column when `VEC_OK` is false, disclosing `mode`); word half = `fts_match`. Keep the existing RRF merge.
  - `docs_search` → FTS5 `MATCH` with the title boost expressed via `bm25()` weighting; `_tsquery`/`fts_query` translate terms to FTS5 syntax (prefix `term*`, `OR`/`AND`).
  - `related` → compute the centroid in Python from the blob rows, then `knn`.
  - `projection` → read the `embedding` blob column instead of `embedding::text`.

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(kb): sqlite-vec + FTS5 search backend with dual-write"`

---

### Task 6: Worker & WS queue through the bus abstraction (light)

**Files:**
- Modify: `apps/api/omilo_api/worker.py` (replace raw `bus.r().sadd/spop`, `bus.ar().pubsub()` with bus helpers / subscribe), `apps/api/omilo_api/kb.py` (`_wake`, `mark`, `process_marks` use bus helpers), the WS endpoint module that consumes `publish`
- Test: `apps/api/tests/test_worker_light_queue.py`, plus the Review-Focus search tests

**Interfaces:**
- Consumes: `bus.mark_pending/pop_pending/add_marks/pop_marks/subscribe` (Task 4).
- Produces: the KB indexing loop and cancel/live-event path work with no Redis in light tier; full tier unchanged.

- [ ] **Step 1: Write failing tests**

```python
def test_light_embed_loop_drains_in_process(light_company):
    kb.put(db, "doc", "c.md", "T", "body"); # marks pending in-process
    assert "main" in bus.pop_pending(10)

def test_search_empty_query_sqlite(sqlite_kb):
    assert kb.search(db, "   ") == []        # no FTS5 syntax error
def test_search_words_only_before_vectors_sqlite(sqlite_kb):
    kb.put(db, "doc", "d.md", "Invoices", "monthly invoice totals")
    assert kb.search(db, "invoice")          # found via FTS before any embedding
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement** — Swap the raw `bus.r().spop(gkey("kb:pending"))` / `sadd` in `worker.py` for `bus.pop_pending`/`bus.mark_pending`; swap `kb._wake`/`mark`/`process_marks` set ops for `bus.mark_pending`/`add_marks`/`pop_marks`. Replace the worker's `bus.ar().pubsub()` cancel channel with the in-process `subscribe()` on light tier (keep Redis pubsub on full). In `kb_sqlite.fts_query`, return `""`/sentinel for empty/punctuation-only input and have `search`/`docs_search` short-circuit to `[]`/word-less path so FTS5 `MATCH` never receives a bad query.

- [ ] **Step 4: Run tests, verify pass** — also run the full suite on SQLite: `cd apps/api && OMILO_DATABASE_URL=sqlite:///$(mktemp -d)/t.db .venv/bin/pytest -q`.

- [ ] **Step 5: Commit** — `git commit -m "feat(worker): in-process KB queue + events for light tier"`

---

### Task 7: CLI `omilo start` (no-Docker launch)

**Files:**
- Modify: `cli/main.go` (add `start` command + usage), `Makefile` (mention `omilo start`)
- Test: `cli/main_test.go` (`TestStartBuildsLightEnv`)

**Interfaces:**
- Consumes: the installed `omilo-api` entrypoint.
- Produces: `omilo start [--data-dir DIR] [--port 7700] [--no-open]` runs the API+embedded worker in-process with `OMILO_DATABASE_URL=sqlite:///<data-dir>/omilo.db`, `OMILO_EMBEDDED_WORKER=true`, no Docker; waits for `/healthz`, saves config URL, opens browser.

- [ ] **Step 1: Write failing test** — a Go test asserting the env/argv `start` would exec: light sqlite URL, embedded worker true, port passthrough, and that it does **not** call `compose`.

- [ ] **Step 2: Run test, verify it fails** — Run: `cd cli && go test ./...` — Expected: FAIL (no `start`).

- [ ] **Step 3: Implement `cmdStart(args []string)`** — Mirror `cmdUp` but instead of `compose(...)`, locate the `omilo-api` binary (PATH, then a bundled location next to the CLI — document the lookup order; the fully bundled runtime is Project B), set the light-tier env, `exec.Command` it with stdout/stderr inherited, `waitHealthy`, `saveConfig`, `openBrowser`. Add to `usage` and the `switch` in `main`.

- [ ] **Step 4: Run test, verify pass**, and `cd cli && go build ./...`.

- [ ] **Step 5: Commit** — `git commit -m "feat(cli): omilo start (in-process light tier, no Docker)"`

---

### Task 8: `migrate --to postgres` (one-way graduation)

**Files:**
- Create: `apps/api/omilo_api/migrate.py` (orchestrates light→full; reuses `import_sqlite.import_company`)
- Modify: `cli/main.go` (add `migrate` command shelling to `python -m omilo_api.migrate`), `import_sqlite.py` if a reusable copy helper must be factored out
- Test: `apps/api/tests/test_migrate.py`

**Interfaces:**
- Consumes: `import_sqlite.import_company(cid, force)`, `company.ids`, `kb.reindex`.
- Produces: `migrate.run(database_url: str, redis_url: str | None, *, dry_run=False) -> dict` — for every company: open its SQLite file, copy rows into the target Postgres schema, re-embed (`kb.reindex`); only after **all** companies succeed, write `OMILO_DATABASE_URL`/`OMILO_REDIS_URL` to the data dir's `.env`. On any failure: raise, write nothing to `.env`.

- [ ] **Step 1: Write failing tests**

```python
def test_migrate_copies_all_companies(light_with_data, pg_url):
    out = migrate.run(pg_url, None)
    assert out["companies"]["main"]["rows"] > 0  # present in Postgres
def test_migrate_aborts_before_flip_on_failure(light_with_data, monkeypatch):
    monkeypatch.setattr(import_sqlite, "import_company", _raise_on_second)
    with pytest.raises(Exception):
        migrate.run("postgresql://bad", None)
    assert ".env" not configured with the postgres url  # no half-flip
```

- [ ] **Step 2: Run tests, verify they fail.**

- [ ] **Step 3: Implement `migrate.run`** — Stage: for `cid in company.ids(include_archived=True)`, set the target env for that company, call `import_company(cid, force=True)` (already idempotent via `on_conflict_do_nothing` + `imported_from_sqlite` marker) and `kb.reindex`. Collect per-company counts. Only after the loop completes with no exception, atomically write the two URLs to `<data_dir>/.env` (temp-file + replace, like `company._save`). Add a `--to postgres --database-url … [--redis-url …] [--dry-run]` parser in `main()`; the Go CLI `migrate` subcommand shells to it.

- [ ] **Step 4: Run tests, verify pass.** (Postgres-dependent tests use the same `omilo_test` database the `Makefile` provisions; mark them to skip when no PG is reachable.)

- [ ] **Step 5: Commit** — `git commit -m "feat(migrate): one-way light->full migration, all-or-nothing flip"`

---

### Task 9: Single-container light Docker image

**Files:**
- Modify: `Dockerfile` (default command runs light tier, no PG/Redis deps), `cli/compose.yml` note, `README.md` (light vs full)
- Test: manual build + healthz (scripted check)

**Interfaces:**
- Produces: `docker run ghcr.io/super-saga/saga-os` starts the light tier in one container (SQLite under a mounted `/data` volume, embedded worker), no sibling services; full tier remains the three-service compose.

- [ ] **Step 1: Write the check** — a shell step: build the image, `docker run -d -e OMILO_DATA_DIR=/data -p 7700:7700 …`, poll `/healthz` for 200.

- [ ] **Step 2: Run it against current image, verify it fails** (current default expects Postgres/Redis).

- [ ] **Step 3: Implement** — Set the image default env to the light tier (`OMILO_DATABASE_URL=sqlite:////data/omilo.db`, `OMILO_EMBEDDED_WORKER=true`), ensure sqlite-vec is installed in the image, and make the entrypoint run API+embedded worker. Keep `docker-compose.dev.yml` as the full-tier reference.

- [ ] **Step 4: Run the check, verify 200 from `/healthz`.**

- [ ] **Step 5: Commit** — `git commit -m "feat(docker): single-container light-tier image as default"`

---

### Task 10: Graduation nudge (light tier → migrate)

**Files:**
- Modify: `apps/api/omilo_api/` the `/healthz` or an overview/health endpoint that the CLI `doctor`/`status` already reads; `cli/main.go` (`cmdDoctor` prints the hint)
- Test: `apps/api/tests/test_graduation_nudge.py`

**Interfaces:**
- Consumes: `Settings.tier`, a KB chunk count per company.
- Produces: when `tier == "light"` and total `kb_chunk` rows across companies exceed **5000** (concrete soft threshold; a sensible builder may tune), a `graduate` hint string is exposed in the health/overview payload; `omilo doctor` prints it. Full tier never shows it.

- [ ] **Step 1: Write failing test**

```python
def test_light_tier_nudges_after_threshold(light_company, monkeypatch):
    monkeypatch.setattr(health, "_kb_chunk_total", lambda: 6000)
    assert "postgres" in health.graduate_hint().lower()
def test_full_tier_no_nudge(full_company):
    assert health.graduate_hint() is None
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Implement** — add `graduate_hint() -> str | None` returning a one-line "you're outgrowing the light tier — run `omilo migrate --to postgres`" message when light + over threshold; wire it into the health/overview payload and print it in `cmdDoctor`.

- [ ] **Step 4: Run test, verify pass.**

- [ ] **Step 5: Commit** — `git commit -m "feat(light): nudge toward graduation past soft threshold"`

---

## Notes for the executor

- Build sqlite-vec loading into the Task 3 `connect` listener once; Tasks 5–6 assume it. If it cannot load on the host, `VEC_OK=False` turns on the brute-force cosine fallback (disclosed via the query `mode`), and the suite must still pass in that mode.
- Run the whole existing test suite against **both** backends before the branch review: default (SQLite) and `OMILO_DATABASE_URL=postgresql://…` (full), per the full-tier "unchanged" constraint.
