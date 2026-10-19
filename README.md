<div align="center">

<img src="apps/web/public/omilo.svg" alt="Omilo" width="96" height="96" />

# Omilo

**Run your company with a team of AI staff you actually manage.**

Omilo is an open-source office for a founder and their AI staff. Helpers do the work, you approve what leaves the company, and the gateway enforces that in code, not in prompts.

[Website](https://omilo.saga.co.id) · [Spec & roadmap](docs/SPEC.md) · [Connector catalog](https://github.com/dedekrnwan/omilo-pieces)

[![License: MIT](https://img.shields.io/badge/License-MIT-6366f1.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-0.4.0-6366f1.svg)
![Stack](https://img.shields.io/badge/stack-FastAPI%20·%20Next.js%20·%20Postgres-1c1917.svg)

</div>

---

## What Omilo is

A business owner describes their company once, in plain language. Omilo turns that into a team of AI helpers (Marketing, Sales, Support, Finance, and more), each with a job, a schedule, and permissions. Helpers research, draft, and plan on their own; anything that sends, spends, posts, merges, or deploys waits for the owner's approval in an Inbox. Every recurring job is a loop that learns from the owner's decisions and gets better over time.

The thinking runs on Claude Code (with your own Claude API key or a pool of subscriptions) or a multi-vendor engine. The owner never sees a prompt, a token, or the word "MCP": they see helpers, jobs, and approvals.

<div align="center">
<img src="docs/img/onboarding.png" alt="Guided onboarding: plain questions build the team" width="80%" />
</div>

## Who it is for

- **Non-technical founders** who want help running the day to day without hiring, and without learning AI tooling.
- **Developers** who want a self-hosted, auditable agent platform where policy is enforced in code and every action is logged.

## Features

- **Guided onboarding.** A plain-language wizard (business, customers, offer, goals, voice, tools, rules) writes the knowledge files every helper reads and suggests a team from the goals. Business-type templates cover common Indonesian businesses (warung, kuliner, laundry, bengkel, online shop, and more), each seeding sensible goals, tools, and tone.
- **Staff and work.** One card per helper: job, shifts (cron in the owner's timezone), engine, permissions. Shifts become tasks; a worker dispatches them with a concurrency limit; helpers write checkpoints and a report.
- **Approvals Inbox.** Proposals, questions, and alerts. Approve and an execution task runs exactly the approved text; request changes and every revision is kept; reject needs a note (which becomes a lesson).
- **Policy in code.** Per action type `off / ask / do_and_tell / auto`, with a strict mode (default) that caps every outward action at *ask*. Helpers cannot send, spend, merge, deploy, or publish on their own.
- **Connector marketplace.** Browse a catalog of apps and connect them (see [Connectors](#connectors)).
- **Workflows.** Turn repeated work into a trigger and steps that run on their own. Most steps need no AI (connectors, web requests, reshaping data, decisions), so they cost nothing; AI runs only in the steps that think.
- **Knowledge base.** Everything helpers can know (docs, memory, finished jobs, chats, files, web pages) is indexed in Postgres with hybrid search (pgvector meaning + full text). Embeddings run locally by default, or via Voyage/OpenAI.
- **Docs.** An Obsidian-style shared notebook for the owner and helpers: Markdown notes, wiki links, backlinks, version history, and a graph view. The vault is a plain folder you can open in Obsidian.
- **Monitor, Simple and Office.** A dashboard of usage, jobs, helpers, and the Claude Code pool; plus a top-down virtual office (Phaser 3) where each helper sits at a desk and only verified events animate.
- **Notifications and nudges.** Anything waiting on you gets louder until you decide, snooze, or hand it to the Chief of Staff: a push at once, again after 2 hours, a call-out from the Chief of Staff after 6, then the top of the 07:30 brief (faster for blocking items; Critical repeats every 15 minutes until seen). Quiet hours and a focus switch hold everything but Critical, at most 6 pushes an hour (the rest merge into one), snooze until tomorrow or Monday, and one-tap Approve on low-risk proposals.
- **Calendar.** Month, week and day views of when each helper works: runs of regular jobs from their schedules, one-off jobs, and scheduled workflows, on the company's clock. Run a job now, skip one run, or pause a job from the calendar; a "Coming up" list on the side shows what's next and loads more as you scroll.
- **Multi-company.** Run several companies from one Omilo, each fully separate (its own helpers, data, connectors), with only the login shared. Each company is its own Postgres schema.

For the full behavior of each area, read [`docs/SPEC.md`](docs/SPEC.md).

## Connectors

Owners connect the apps their business already uses from a **marketplace**: a grid of apps (Gmail, Google Calendar, Google Sheets, WhatsApp, Instagram, Facebook, with more added over time) that they connect in a few taps. No URLs, keys, or server config.

The catalog is **data, not code**. Omilo fetches a GitHub repo of connector "pieces" ([`dedekrnwan/omilo-pieces`](https://github.com/dedekrnwan/omilo-pieces)), validates each manifest, and builds a local index. Adding a connector is a pull request with one `piece.yaml` (metadata, OAuth config, and HTTP actions) plus a logo. A piece is declarative data the runtime interprets, never a program Omilo runs; every action's request host is restricted to the provider's own domains.

How a piece reaches a helper: **fetch** the repo (local checkout, `git clone`, or tarball) → **index** each `pieces/*/piece.yaml` into `~/.omilo/pieces/index.json` → **read** it in the marketplace and expose each app's actions to helpers as tools. The catalog refreshes on startup and from a Refresh button.

- Point Omilo at a catalog with `PIECES_REPO=owner/name`, or `PIECES_SOURCE=/path/to/checkout` for local development.
- Outward actions keep the usual approval: helpers read and draft freely, and posting, sending, or spending waits for the owner's OK.
- **Advanced:** add any raw MCP server by address or local command (kept behind an Advanced section for developers).

A hosted sign-in service that holds each provider's OAuth app (so "Connect Gmail" is one tap on any self-hosted instance) is in progress; event triggers ("when a DM arrives, draft a reply") are planned for a later version.

<div align="center">
<img src="docs/img/connector-hub.png" alt="Connecting apps" width="80%" />
</div>

## Light tier (default) vs Full tier

The default Docker image runs everything in one container with no sibling services:

```bash
docker run -p 7700:7700 -v omilo-data:/data ghcr.io/super-saga/saga-os
```

SQLite is the database (`/data/omilo.db`), the worker runs in-process, and Redis is not required. This is the **light tier**: good for a single user, a laptop, or a low-traffic self-hosted instance.

To use **Postgres + pgvector + Redis** (the full tier), pass the URLs as environment variables:

```bash
docker run -p 7700:7700 -v omilo-data:/data \
  -e OMILO_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/omilo \
  -e OMILO_REDIS_URL=redis://host:6379/0 \
  ghcr.io/super-saga/saga-os
```

Or drop a `/data/.env` file with those variables and restart — the same image reads it on startup.

The three-service `docker-compose.dev.yml` is the full-tier reference for local development (Postgres + Redis running alongside the API). The laptop `cli/compose.yml` (used by `omilo up`) also wires up the full tier with sibling containers.

## Quick start (development)

Requirements: Python 3.11+, Node 20+, Docker (for Postgres and Redis), Go 1.24+ (for the CLI).

```bash
make dev    # Postgres (pgvector) + Redis in Docker, builds the web app, installs the API, serves http://localhost:7700
make db     # just Postgres + Redis; make db-stop stops them (data stays in Docker volumes)
make test   # ruff + pytest (database omilo_test, Redis db 15), web lint, go vet
make cli    # builds cli/omilo
```

Already running Postgres or Redis yourself? Skip Docker and set `OMILO_DATABASE_URL` (Postgres 16 with the `vector` extension) and `OMILO_REDIS_URL`.

Open the web app, create the owner account, and finish onboarding. Pick **Demo engine** to try every flow without any AI: it uses the real MCP endpoint and executes approvals deterministically.

## Omilo for Mac

One app with everything inside (database included), no Docker: download the `.dmg` from Releases, drag it to
Applications, open it. Build it yourself with `make desktop` on a Mac. See [docs/desktop.md](docs/desktop.md).

## Run with Docker

Laptop (Omilo, Postgres, and Redis containers; data in `~/.omilo`):

```bash
make cli && ./cli/omilo up     # then ./cli/omilo login
```

Server (Postgres with pgvector, Redis, a separate worker, Traefik):

```bash
cd deploy && cp .env.example .env    # set OMILO_SECRET_KEY, POSTGRES_PASSWORD, OMILO_PUBLIC_URL, OMILO_HOST
docker compose up -d
```

To serve under a path prefix (e.g. `/os`), set `OMILO_BASE_PATH=/os` and build the web app with `NEXT_PUBLIC_BASE_PATH=/os`.

## Connect the AI

- **Your Claude API key (easiest).** In onboarding or Settings, choose "Use my Claude API key", paste a key from console.anthropic.com, and pick a model. Omilo installs Claude Code and runs every helper in it with your key. The key is stored encrypted and passed only to the Claude Code process; usage is billed to your key and shown as real spend.
- **Your Claude subscriptions.** Add them on the Harness page and put helpers on the pool. Each job leases the least recently used free account; on a usage limit the job continues on another account with `--resume`, so no work is lost.
- **Built-in / multi-vendor.** A lighter path calls the model API from Omilo itself (web search and the Omilo tools, no files or browser). The engine layer is vendor-agnostic (via LiteLLM) with prompt caching and model tiering, so cheaper work can run on smaller models.

## Project layout

| Path | What |
| --- | --- |
| `apps/api` | FastAPI gateway, worker, MCP server, engines (`claude_code`, `claude`, `litellm`, `fake`), connector pieces, loops and memory, tests |
| `apps/web` | Next.js (static export) web app |
| `cli` | Go CLI `omilo` (stdlib only) |
| `deploy` | Server compose: Postgres + API + worker + Traefik labels |
| `docs` | Spec, diagrams, design and implementation plans |
| `legacy/prototype` | v0 prototype, kept for reference and import |

## Architecture

Postgres holds everything (one schema per company), pgvector holds the knowledge base, and Redis carries what several processes share (live office events, worker locks, the Claude Code pool's leases, connector health). Helpers reach Omilo through a per-agent MCP server at `/mcp`; every tool call is checked against that helper's permissions and logged.

<div align="center">
<img src="docs/img/architecture.png" alt="Omilo architecture" width="80%" />
</div>

## Configuration

Settings are environment variables with the `OMILO_` prefix (see `apps/api/omilo_api/config.py`): `DATA_DIR`, `DATABASE_URL`, `REDIS_URL`, `EMBED_PROVIDER` (local | voyage | openai), `SECRET_KEY`, `PUBLIC_URL`, `BASE_PATH`, `TIMEZONE`, `STRICT_MODE`, `MAX_CONCURRENT_TASKS`, and others. Connector catalog: `PIECES_REPO` or `PIECES_SOURCE`.

## Testing

```bash
make test
```

The API suite runs on Postgres 16 + pgvector and Redis 7 (knowledge base, policy, auth and CSRF, the propose → approve → execute path, the changes loop, MCP auth and tools, cross-company isolation, the connector marketplace and runtime, workflows, the retro's measured changes and rollback). The web build and the full UI flow are checked with Playwright on desktop and mobile. The Docker image and server compose are not yet built in CI.

## Contributing

- **Connectors:** open a pull request to [`omilo-pieces`](https://github.com/dedekrnwan/omilo-pieces) with a new `pieces/<slug>/piece.yaml` and `logo.svg`. No Omilo release is needed to add an app.
- **Code:** run `make test` before opening a pull request. Keep outward-facing behavior behind the approval policy, and never log secrets.
- Design and implementation notes live under `docs/`.

## License

[MIT](LICENSE)
