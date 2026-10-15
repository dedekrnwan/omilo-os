# Saga OS

**The office where a founder runs a company of AI staff agents.**

Saga OS is an open-source gateway between a company owner and their AI staff agents. Every task, proposal, approval,
question and report passes through it. [Hermes](https://hermes-agent.nousresearch.com/) profiles do the thinking and the
work behind it. Agents propose, the owner decides, and the gateway enforces that in code, not in prompts.

## What works today (milestones M1 + M2)

- **Onboarding**: company name and 7 knowledge files (company, goals, customers, offer, voice, systems, rules), then a recommended team (solo / small / growing) sized by how many agents may work at once.
- **Staff**: one card per agent: job, shifts (cron with timezone), engine, permission overrides, MCP token rotation.
- **Work**: shifts become tasks, the worker dispatches them (concurrency limit, one task per agent, timeout), agents write checkpoints and a report.
- **Inbox**: proposals, questions and alerts. Approve → an execution task runs exactly the approved text. Request changes → a revision task; every revision is kept. Reject needs a note.
- **Policy**: per action type `off / ask / do_and_tell / auto`; strict mode (default) caps every external action at *ask*. Agents cannot send, spend, merge, deploy or publish on their own.
- **Chat**: master thread (Chief of Staff) and per-agent / per-task / per-proposal threads, markdown replies.
- **Agent MCP server** at `/mcp` (Streamable HTTP, per-agent bearer token): `get_context`, `get_task`, `checkpoint`, `report`, `propose`, `revise_proposal`, `get_approved`, `mark_executed`, `request_action`, `ask_founder`, `post_message`, `update_kpi`, `create_task` (Chief only), `log_usage`. Every call is logged.
- **Company**: KPIs and the knowledge editor. **Settings**: pause all, strict mode, concurrency, engine health, audit log.
- **CLI** `saga-os`: `up`, `down`, `logs`, `login`, `doctor`, `status`, `inbox`, `show`, `approve`, `reject`, `changes`, `answer`, `staff`, `tasks`, `run`, `chat`, `pause`, `resume`, `import`.
- **Import** of the v0 prototype (`legacy/prototype`): knowledge, loops → staff + shifts, runs, approvals.

Not built yet (see the roadmap in [`docs/SPEC.md`](docs/SPEC.md)): Chrome push notifications and nudges (M3), connectors hub with
OAuth (M4), harness pool and switching between Claude Code / Codex (M5), Telegram, passkeys, package-manager installers.

## Layout

| Path | What |
| --- | --- |
| `apps/api` | FastAPI gateway, worker, MCP server, engines (`hermes`, `fake`), tests |
| `apps/web` | Next.js (static export) web app, Finity design tokens |
| `cli` | Go CLI `saga-os` (stdlib only) |
| `deploy` | Server compose: Postgres + API + worker + Traefik labels |
| `docs` | Spec v1 and diagrams |
| `legacy/prototype` | v0 shell/Python prototype (kept for reference and import) |

## Quick start (development)

Requirements: Python 3.11+, Node 20+, Go 1.24+ (for the CLI).

```bash
make dev        # builds the web app, installs the API in apps/api/.venv, starts http://localhost:7700
make test       # ruff + pytest, web lint, go vet
make cli        # builds cli/saga-os
```

Open the web app, create the owner account, finish onboarding. Pick **Demo engine** to try every flow without any AI:
it uses the real MCP endpoint, files proposals and executes approvals deterministically.

## Run with Docker

Laptop (one container, SQLite in `~/.saga-os/data`):

```bash
make cli && ./cli/saga-os up     # then ./cli/saga-os login
```

Server (Postgres, separate worker, Traefik):

```bash
cd deploy && cp .env.example .env    # set SAGA_SECRET_KEY, POSTGRES_PASSWORD, SAGA_PUBLIC_URL, SAGA_HOST
docker compose up -d
```

Under a path prefix (e.g. `/os`), set `SAGA_BASE_PATH=/os` and build the web app with `NEXT_PUBLIC_BASE_PATH=/os`.

## Connect Hermes

1. Run each agent as a Hermes profile with its API server on (OpenAI-compatible, default `http://127.0.0.1:8642/v1`, key in `API_SERVER_KEY`).
2. In Saga OS: Staff → agent → engine type `hermes`, base URL, model. Put the key in the gateway environment as `HERMES_API_KEY` (or name another env var in the engine's `api_key_env`).
3. Staff → agent → **Rotate MCP token**. Paste the returned `hermes_config` (or `claude_code_config`) into that profile so the agent can call back into Saga OS.
4. Settings → Engine health should show the agent as reachable.

Saga OS sends `X-Hermes-Session-Id: task-<id>` / `thread-<id>`, so a task or chat keeps its context across calls.

## Configuration

All settings are environment variables with the `SAGA_` prefix (see `apps/api/saga_api/config.py`): `DATA_DIR`,
`DATABASE_URL`, `SECRET_KEY`, `PUBLIC_URL`, `INTERNAL_URL`, `BASE_PATH`, `TIMEZONE`, `EMBEDDED_WORKER`,
`MAX_CONCURRENT_TASKS`, `TASK_TIMEOUT_S`, `STRICT_MODE`, `COOKIE_SECURE`.

## Status of testing

- 16 API tests pass on SQLite and Postgres 16 (policy, auth, CSRF, propose → approve → execute, changes loop, MCP auth and tools, cross-agent isolation, delegation, questions, chat, official MCP client, prototype import, a mock Hermes server).
- Web build passes; the full UI flow was checked with Playwright on desktop and mobile.
- CLI checked against a live server.
- The Docker image and server compose have **not** been built in CI yet.

## License

MIT
