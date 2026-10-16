# Saga OS

**The office where a founder runs a company of AI staff agents.**

Saga OS is an open-source gateway between a company owner and their AI staff agents. Every task, proposal, approval,
question and report passes through it. [Hermes](https://hermes-agent.nousresearch.com/) profiles do the thinking and the
work behind it. Agents propose, the owner decides, and the gateway enforces that in code, not in prompts.

## What works today (milestones M1 + M2)

- **Onboarding for non-engineers**: a guided 9-step wizard with plain questions, examples and tap-to-choose answers (business, customers, offer, goals, voice, tools and rules). Saga OS writes the knowledge files from the answers, suggests a team from the goals (no app-building helpers for businesses without their own app), uses the owner's time zone, starts in practice mode, and runs a first practice job so the owner sees an approval in the Inbox right away. Answers are saved as you go.
- **Staff**: one card per agent: job, shifts (cron with timezone), engine, permission overrides, MCP token rotation.
- **Work**: shifts become tasks, the worker dispatches them (concurrency limit, one task per agent, timeout), agents write checkpoints and a report.
- **Inbox**: proposals, questions and alerts. Approve → an execution task runs exactly the approved text. Request changes → a revision task; every revision is kept. Reject needs a note.
- **Policy**: per action type `off / ask / do_and_tell / auto`; strict mode (default) caps every external action at *ask*. Agents cannot send, spend, merge, deploy or publish on their own.
- **Chat**: master thread (Chief of Staff) and per-agent / per-task / per-proposal threads, markdown replies.
- **Agent MCP server** at `/mcp` (Streamable HTTP, per-agent bearer token): `get_context`, `get_task`, `checkpoint`, `report`, `propose`, `revise_proposal`, `get_approved`, `mark_executed`, `request_action`, `ask_founder`, `post_message`, `update_kpi`, `create_task` (Chief only), `log_usage`. Every call is logged.
- **Company**: KPIs and the knowledge editor. **Settings**: pause all, strict mode, concurrency, engine health, audit log.
- **CLI** `saga-os`: `up`, `down`, `logs`, `login`, `doctor`, `status`, `inbox`, `show`, `approve`, `reject`, `changes`, `answer`, `staff`, `tasks`, `run`, `chat`, `pause`, `resume`, `import`.
- **Import** of the v0 prototype (`legacy/prototype`): knowledge, loops → staff + shifts, runs, approvals.

Not built yet (see the roadmap in [`docs/SPEC.md`](docs/SPEC.md)): nudges and quiet hours (M3), connector
OAuth (M4), Codex in the harness (M5), Telegram, passkeys, package-manager installers.

## Workspace: chat and work, live

The Workspace puts chat and work on one page (toggle top right) with a side panel for **Progress**, **Output** and the
**Browser** trail. Agent turns render as they happen: a live "Working" card with reasoning, each tool call (expand for input and
output), sources, account switches and a usage meter (tokens, cost, time). Helpers can offer clickable choices (`offer_choices`).
Engines report through `/api/events` (`RunEvent`): Hermes streams its draft, Claude Code streams every step, and every saga-os tool
call is recorded by the MCP server.

## Harness: a pool of Claude Code subscriptions

Settings live under **Harness**. Add each subscription with a token from `claude setup-token` (stored encrypted), install
Claude Code with one click (npm), then put helpers on the pool. Each job leases the least recently used free account
(`SAGA_HARNESS_PARALLEL` jobs per account, default 2). On a usage limit the account rests until its reset time and the job
continues on another account with `--resume`, so no work is lost; sign-in problems mark the account and move on.
The Workspace header shows the pool at a glance: one short bar per account, side by side, filled by how much of its 5-hour
limit it has used (green, amber from 70%, red from 90%, striped red while resting, outlined red when it needs signing in again;
hover for details and reset times). The numbers come from Claude Code's `rate_limit_event` when it reports them; otherwise Saga OS
estimates from tokens used against what the account handled before its last limit. The Harness page shows the same per account.
Runs use `claude -p --output-format stream-json`, the saga-os MCP server, `--permission-mode dontAsk` and an allowlist
(web, read, write in the helper's own workspace; `Bash` only when a helper has `allow_shell`).

## Capabilities: files, folders, connectors and skills

The **+** button in the Workspace chat box works like Claude's: attach files or photos, and switch folders, connectors and
skills on or off for that chat. They are managed under **Capabilities** in the sidebar.

- **Computer**: share folders on the machine running Saga OS (pick them with the built-in folder browser). Per folder: read, or read
  and edit, and "run commands" for development work (install, build, test, git). On the Claude Code pool this is enforced by
  Claude Code itself: each folder is passed with `--add-dir`, read-only folders get Edit/Write denied, `Bash` is only allowed when a
  folder permits commands, and even then `rm`, `sudo`, `git push`, publishing, deploying and `ssh` stay denied (helpers ask in the
  Inbox instead). Hermes helpers are told which folders to use, but Hermes has its own terminal, so use the pool for strict limits.
  In Docker only mounted folders can be shared.
- **Connectors**: any MCP server, by web address (with secret headers) or as a program on this computer (command, arguments, secret
  environment). "Ask me first" connectors stay locked until you approve a `connector.<id>` request; "Use directly" ones are open.
  Secrets are stored encrypted. Default-on connectors are also written into each managed Hermes profile.
- **Skills**: `SKILL.md` files in `<data dir>/skills/<id>/`. Write your own, or turn an Agency specialist's playbook into a skill.
  "Standard" skills apply everywhere; others are switched on per chat.
- **Files**: uploaded into `<data dir>/files/` (25 MB each). Helpers get their paths (read-only on the pool), and give files back with the
  `share_file` tool: they appear as cards you can preview (images, PDF, video, CSV as a table, Markdown, code) and download. Files in a
  shared folder or helper workspace are served by `/api/fs/file`; HTML and SVG are served as text, so nothing runs at the app's origin.

The chat box stays quiet: switched-on folders, connectors and skills show as small count badges next to **+**. The connector badge has a
health dot (green: all reachable, amber: a few are not, red: half or more are not), from a check every five minutes and the Test button.

Replies render like Claude's: highlighted code with Copy (long blocks fold), JSON pretty-printed even without a fence, tables, images and
file links (`file:///path`, or an absolute path in backticks) that open the preview.

## Docs: the shared notebook

**Docs** (under Work) is an Obsidian-style notebook for you and every helper: folders of Markdown notes, `[[wiki links]]`
(type `[[` for suggestions), backlinks, an outline, full version history with who changed what (you, a helper, or "outside" when
the file was edited in Obsidian or on disk), restore, rename that keeps links working, and a **graph view** of how notes connect.
It saves as you type; if a helper changed the note meanwhile you choose "keep mine" or "use theirs".

- The vault is a plain folder, `<data dir>/vault`: open it in Obsidian as well. Company knowledge is its `Company/` folder.
- Helpers use `docs_search`, `docs_read` and `docs_write` (with `base_version`, so nobody overwrites anyone). Shared notes:
  helpers edit directly and you get a notice (`docs.write`, do and tell). Company knowledge: a helper's change is a suggestion
  you approve in the Inbox (`knowledge.write`, ask). Change either per helper under Permissions.
- Deleted notes go to the vault's `.trash` folder.

## Monitor

**Monitor** (under Work) shows how the company of helpers is doing over the last 24 hours, 7 days or 30 days, refreshed every
30 seconds and at once when a job ends or something lands in the Inbox:

- tiles: tokens and spend (with the change against the previous period), jobs finished and the success rate, what waits on you
  (oldest item, your average time to decide), who is working now, and the Claude Code pool
- tokens by helper over time (stacked bars, hover for the split, or switch to a table), and jobs done vs failed
- every helper: state (working, awake, sleeping, paused), the job it is on, jobs, tokens, spend, last activity
- the pool per account, the Saga tools helpers called (with failures and blocked calls), and the latest notices

Below that: **why jobs failed** (grouped by cause: usage limit, sign-in, took too long, Hermes, connection, interrupted,
budget, with what to do and links to the jobs), **run time** per engine and per helper (median, slowest 10%, slowest job),
**value per helper** (proposals, approval rate, cost per approved item), the **pool over the last 24 hours** (tokens per account
per hour, red marks where a limit hit), and the **weekly digest**: every Monday at 08:00 the Chief of Staff posts last week's
numbers in the main chat (switch it off or send it now from the page).

**Budgets.** Each helper can have a monthly spend limit (USD, at API prices) and a token limit (Team → helper → Budget). At 80%
you get an Inbox alert, at 100% the helper pauses until you raise the budget or resume it; each level fires once a month.

**Jobs and chats open in a drawer, from anywhere.** Click a job in the Inbox, Monitor, a notification or any link, and it
opens on the right: **Progress** (the brief, live run cards, checkpoint, report, what went wrong, handoffs), **Needs you**
(approve, answer or dismiss right there) and **Chat** (talk to the helper about this job). "Discuss" on a proposal opens the
chat the same way. **Full view** still opens it in the Workspace.

**Inbox board.** The Inbox is a board: Needs you, Running and Done (last 48 hours). Cards show how long it has been going, the
sources read and tool calls; click one for the recent steps and Open. Approvals open in a drawer. List shows the classic view
with history filters.

It reads what Saga OS already records (`/api/monitor?range=`): run usage events from every engine, tasks, proposals, inbox
items, MCP tool calls, pool usage and notices. Charts use Recharts, loaded only on this page.

## Chat box: slash commands and the pool meter

Type `/` in the chat box for a menu that filters as you type (arrows to choose, Enter to use, Esc to close): quick prompts
(`/brief`, `/status`, `/plan`, `/research`, `/delegate`, `/draft`, `/review`), `/job <brief>` to start a job for the Chief of
Staff, `/attach`, `/folder`, `/connector`, every skill by name (switches it on for the chat), `/<helper>` to talk to a helper, and
shortcuts (`/inbox`, `/hire`, `/pool`, `/settings`, `/pause`). Under the chat box, the Claude Code pool meter shows one bar per account.

## Helper mascots

Every helper has its own little character, drawn in SVG by the web app: colour and shape come from its id, and a prop hints at the
job (crown for the Chief, headset for Support, glasses for Dev, megaphone for Marketing, tie for Sales, coin for Finance, gear for
Ops…). Sleeping helpers close their eyes; a helper that is starting work glows. Change colour, shape and prop, or upload a picture,
on the helper's page (Team → helper → Look).

## Notifications

Saga OS tells you right away when a helper needs you: inbox items (approvals, questions, alerts), chat replies, and failed (or, if
you want, finished) jobs. Notices are written automatically (`Notice` table) and reach you three ways:

- **In the app**: a live stream (`/api/stream`, server-sent events) shows a small pop-up and refreshes the Inbox and counts at once.
- **Tab in the background**: a system notification, and the tab title shows the count.
- **No tab open**: Web Push through the service worker (`pywebpush`, VAPID key created in the data dir). Push pauses while a tab is
  open, so you never get two.

The browser asks for permission only after you press **Turn on** (banner, or Settings → Notifications), where you also pick what to hear
about and send a test. Browsers allow notifications only on https or `localhost`; on iPhone, add Saga OS to the Home Screen first.

## Speed

Pages poll only as fast as needed: every 1.5 s while a helper is working, every 12–30 s when idle, never while the tab is hidden, and at
once when a live notice arrives. Unchanged chats answer with `304 Not Modified` (ETag). Responses are gzip-compressed, hashed build files
are cached for a year, SQLite runs with WAL and `synchronous=NORMAL`, and the code highlighter and file preview load only when used.

## Hire specialists from The Agency

Team → **Hire a specialist** opens a library of about 280 specialists from
[The Agency](https://github.com/msitarzewski/agency-agents) (MIT): marketing, sales, design, engineering, finance, support and more,
each with its own personality, process and deliverables. Saga OS downloads the roster from GitHub (`git clone`, or the tarball;
`SAGA_TALENT_SOURCE=<local checkout>` to use your own copy), indexes it, and hires a specialist in one click: their playbook becomes
the helper's job, with division-based permissions and the usual approvals on top.

Helpers run by Saga OS sleep until they have work: only the Chief of Staff (and helpers marked `always_on`) keep a Hermes running;
everyone else is started when a job or chat arrives and stopped after 10 idle minutes.

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

## Connect the AI

**Easiest: your Claude API key, through Hermes run by Saga OS.** In onboarding (or Settings → AI) choose "Use my Claude
API key", paste a key from console.anthropic.com, check it and pick a model (Sonnet is recommended). Saga OS then:

1. installs Hermes into a private environment (`<data dir>/hermes-venv`, `pip install hermes-agent[...]`, needs Python 3.11–3.13),
   plus the browser helper `agent-browser` (needs Node.js) using the Chrome already on the computer, or a downloaded Chromium;
2. writes one Hermes home per helper in `<data dir>/hermes/<helper>`: Claude as the model provider, the saga-os MCP server with
   that helper's token, and the API server on its own local port (8650+) with a random 64-character key;
3. runs and supervises one `hermes gateway run` per helper (restarted when it exits or its settings change).

Helpers get every Hermes tool (browser, terminal, web, skills, memory) and still go through Saga OS approvals. The Claude key is
stored encrypted in Saga OS and written only to each helper's Hermes `.env` (mode 600). Logs: Settings → AI → "<helper> log".
Without Hermes there is a fallback, "Claude directly" (web search and fetch, no browser).

**Advanced: your own Hermes server.** Point a helper at it under Staff:

### Connect Hermes

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

- 43 API tests pass on SQLite (16 core ones also on Postgres 16) (policy, auth, CSRF, propose → approve → execute, changes loop, MCP auth and tools, cross-agent isolation, delegation, questions, chat, official MCP client, prototype import, a mock Hermes server).
- Web build passes; the full UI flow was checked with Playwright on desktop and mobile.
- CLI checked against a live server.
- The Docker image and server compose have **not** been built in CI yet.

## License

MIT
