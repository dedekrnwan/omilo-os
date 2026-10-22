# Contributing to Omilo

Thanks for helping build Omilo. This guide covers how to get the project running, the
day-to-day dev loop, how tests and CI work, and the few rules that keep Omilo safe.

New here? Skim the [README](README.md) for what Omilo is, and
[`docs/SPEC.md`](docs/SPEC.md) for how each area behaves.

---

## The one rule that matters

Omilo's promise is that **helpers can't send, spend, post, merge, or deploy on their
own** — the gateway enforces that in code, not in prompts. When you touch anything a
helper can do:

- Route every outward side-effect through the policy gate (`request_action` /
  `gated_execute` / the delegation gate) with a typed `action_type`. Don't add a new
  path that reaches the outside world without one.
- **Never log secrets** (API keys, OAuth tokens, `OMILO_SECRET_KEY`). They're stored
  encrypted and passed only to the process that needs them.
- A change that relaxes a safety floor (what still asks even in Auto, what shell
  commands stay blocked) should say so clearly in the PR.

If you're unsure whether something counts as "outward," it does — gate it.

---

## Prerequisites

- **Python 3.11+** (macOS ships 3.9 — `brew install python@3.12`)
- **Node 20+** (CI uses 22)
- **Docker** (for Postgres + pgvector and Redis), or your own Postgres 16 with the
  `vector` extension and Redis 7
- **Go 1.24+** (only if you work on the `cli`)

## First run

```bash
make dev    # Postgres + Redis in Docker, builds the web app, installs the API, serves http://localhost:7700
```

Then open http://localhost:7700, create the owner account, and finish onboarding. Pick
the **Demo engine** to exercise every flow with no AI key — it uses the real MCP
endpoint and executes approvals deterministically.

Already running Postgres/Redis yourself? Skip Docker and set `OMILO_DATABASE_URL`
(Postgres 16 + `vector`) and `OMILO_REDIS_URL`.

---

## The dev loop

`make dev` builds the web app as a static bundle — good for a quick look, slow for
iterating. For active development, run the two servers separately with hot reload:

```bash
make db                       # Postgres + Redis (once); make db-stop to stop them

# terminal 1 — API + worker on :7700
make api                      # = cd apps/api && .venv/bin/omilo-api

# terminal 2 — web with hot reload on :3000
cd apps/web && npm install && npm run dev
```

Open **http://localhost:3000**. The web app proxies `/api/*` to the API on `:7700`
(see `apps/web/next.config.mjs`), so both must be running.

- **API / worker / MCP / engines** live in `apps/api/omilo_api`. `make api` runs the
  gateway and an embedded worker.
- **Web** is Next.js in `apps/web` (static export). `npm run dev` for iteration.
- **CLI** is a stdlib-only Go binary in `cli`. `make cli` → `./cli/omilo`.

### Where things are

| Path | What |
| --- | --- |
| `apps/api` | FastAPI gateway, worker, MCP server, engines (`claude_code`, `claude`, `litellm`, `fake`), connector pieces, loops, memory, tests |
| `apps/web` | Next.js web app |
| `cli` | Go CLI `omilo` |
| `deploy` | Server compose (Postgres + API + worker + Traefik) |
| `docs` | Spec, diagrams, and design/implementation notes |

More detail: README → [Architecture](README.md#architecture) and
[Configuration](README.md#configuration) (all settings are `OMILO_`-prefixed env vars,
see `apps/api/omilo_api/config.py`).

---

## Tests, lint, and CI

Run the whole thing the way CI does:

```bash
make test
```

That runs, in order:

1. **API** — `ruff check omilo_api tests` then `pytest -q`
2. **Web** — `npm run lint` (which is `tsc --noEmit`)
3. **CLI** — `go vet ./...` and `go build ./...`

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) mirrors this on every push
and PR, and also runs `npm run build` and `gofmt -l` (keep Go `gofmt`-clean). It spins
up Postgres (pgvector) and Redis as services, so your PR is tested against the real DB.

Run just one surface while iterating:

```bash
cd apps/api && .venv/bin/pytest -q tests/test_autonomy.py   # one file
cd apps/api && .venv/bin/ruff check omilo_api tests
cd apps/web && npm run lint
cd cli && go vet ./... && go build ./...
```

**About the test database:** the API suite uses the `omilo_test` database and Redis
db 15, and creates a fresh Postgres schema per test. If you run large chunks
repeatedly you can exhaust Postgres locks (`out of shared memory` /
`max_locks_per_transaction` on teardown) — restart the DB container
(`docker restart omilo-dev-postgres-1`) and re-run. See
[`docs/test-suite-isolation.md`](docs/test-suite-isolation.md) for how isolation works.

Add a test with the change it covers. For a behavior change, update the tests that
encoded the old behavior and say so in the PR.

---

## Branches, commits, and PRs

- Branch off `main` (e.g. `fix/inbox-409`, `feat/calendar-tool`).
- Commits follow **Conventional Commits**: `type(scope): subject`, lower-case, present
  tense. Types in use: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`. Scopes are
  the surface: `api`, `web`, `mcp`, `engine`, `cli`. Examples from history:
  - `fix(web): gracefully handle 409 already-decided on approve click`
  - `feat(api): native calendar tool`
- Run `make test` before opening the PR.
- In the PR description, say what changed and why, and call out anything touching the
  approval policy, secrets, or a safety floor.
- Keep PRs focused — one concern per PR is easier to review and revert.

---

## Contributing a connector

Adding an app to the marketplace needs **no Omilo release and no code here** — it's data
in a separate repo. Open a PR to
[`omilo-pieces`](https://github.com/dedekrnwan/omilo-pieces) with:

- `pieces/<slug>/piece.yaml` — metadata, OAuth config, and HTTP actions
- `pieces/<slug>/logo.svg`

A piece is declarative data the runtime interprets, never a program Omilo runs, and
every action's request host is restricted to the provider's own domains. To test
against a local catalog, point Omilo at your checkout with
`PIECES_SOURCE=/path/to/omilo-pieces`.

---

## Design notes

Larger features start as a written design, then a plan, under `docs/`:

- `docs/superpowers/specs/` — design documents (the *what* and *why*)
- `docs/superpowers/plans/` — implementation plans (the *how*)
- `docs/SPEC.md` — the living behavior spec

If your change alters how a documented area behaves, update `docs/SPEC.md` in the same
PR.

---

## License

By contributing, you agree your contributions are licensed under the project's
[MIT License](LICENSE).
