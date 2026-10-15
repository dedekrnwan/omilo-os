# Company OS — Sahabat Warga

Autonomous business loops for a one-person company, plus a dashboard to watch and steer them.

```
            you (phone)                      you (browser)
                │ chat                            │
        ┌───────▼────────┐  cos CLI / HTTP  ┌─────▼──────────────┐
        │ Hermes (API key)├────────────────►│ Dashboard :8787    │
        │ front door      │                 │ status · approvals │
        └─────────────────┘                 └─────▲──────────────┘
                                                  │ reads state/
  systemd timers ──► bin/cos run <loop> ──► runner ──► harness (claude-code │ claude-api │ codex │ …)
                                              │            └─ account pool: accounts/claude-code/acc-01..25
                                              ├─ writes state/runs/<run>/ (run.json, report.md, prompt.md, logs)
                                              └─ proposals ──► state/approvals/ ──► you approve ──► next run executes
```

## Chat: the master entrypoint
The dashboard has a **Chat** tab: one conversation that can see every loop, run, approval and KPI. Each run
("Ask about this run") and each proposal ("Adjust with AI") also has its own thread with that item as context.

What chat can do (rules in `chat/CLAUDE.md`):
- answer questions from the real runs, reports, approvals and KPIs (`cos` read commands)
- **rerun a loop with your instructions**: `cos rerun <loop> --note "..."` (the note goes into that run's prompt)
- **revise a pending proposal**: rewrites the text, keeps the old versions (shown as "Revised N×")
- **file a new proposal**, e.g. a change to a loop prompt, which then waits in Approvals
- it can never approve or reject: that stays your button

The brain is configurable in `config/settings.json` → `chat`: `claude-code` (default, uses the same account pool and
keeps one session per thread) or `openai` pointed at Hermes' OpenAI-compatible endpoint. On WhatsApp/Telegram,
Hermes uses the same `cos` commands through `integrations/hermes/SKILL.md`.

## The loop contract
Every run: **trigger → context (CLAUDE.md + company/ + loop prompt + last runs + approved items) → act →
report.md + proposals → you approve/reject (with a note) → next run executes approved items → weekly retro
improves the prompts from your notes.**

| Loop | When (WIB) | Function | Output you see |
|---|---|---|---|
| `ops-health` | hourly :05 | operations | OK/DEGRADED/DOWN + fix proposals |
| `dev-builder` | 01:00, 13:00 | development | one PR per run from `agent-ready` issues |
| `support-digest` | 06:30 daily | support | FAQ drafts, bug issue proposals |
| `finance-scorecard` | Mon 07:00 | business | KPIs, scorecard row, 3 actions |
| `content-weekly` | Mon 08:00 | marketing | week plan + post/script drafts |
| `sales-prospecting` | Tue, Thu 09:00 | sales | pipeline updates + outreach drafts |
| `retro-weekly` | Fri 16:00 | meta | prompt-change proposals |

Agents never send to customers, spend money, merge, deploy, or write to the production DB (see `CLAUDE.md`).

## Layout
```
CLAUDE.md               constitution for every loop (rules + output contract)
company/                goals, scorecard, pricing, brand voice, systems map  (shared memory)
loops/<id>/loop.json    schedule, harness, tools, limits      loops/<id>/prompt.md  the job
config/settings.json    harnesses, account pools, caps
bin/cos                 CLI (you, systemd, Hermes)
lib/                    runner, harness adapters, core
dashboard/              stdlib web app (no dependencies)
deploy/                 install.sh, env example, systemd units, add-account.sh
integrations/hermes/    SKILL.md for Hermes
state/                  runs, approvals, accounts, kpis.json, goals.json   (runtime, mostly gitignored)
tests/                  mock agent + smoke test
```

## Try it on your Mac first
Needs only `python3` (comes with Xcode Command Line Tools) and, for real runs, the Claude Code CLI.
```bash
cd ~/Documents/works/sahabat-warga/company-os
bin/local demo                    # fake agent, fake data, dashboard opens (token: local). Uses no Claude quota.
bin/local run content-weekly      # one REAL run with your own Claude Code login (drafts only, nothing is sent)
bin/local dashboard               # look at the real run, approve/reject its proposals
```
On a laptop there are no timers: loops run only when you start them. `ops-health` and `finance-scorecard`
will report that Prometheus / the DB replica are unreachable, which is expected locally.

## Install on the server
Requirements: Linux with systemd, Python 3.10+, git, `gh`, Claude Code CLI (`npm i -g @anthropic-ai/claude-code`),
plus the toolchains the dev loop needs (Go, Flutter, Node).

```bash
# 1. put the workspace on the server (company-os next to the app repos)
sudo mkdir -p /srv/sahabat-warga && cd /srv/sahabat-warga
git clone <your company-os repo> company-os     # and clone flutter-saga, go-core, ops, ... next to it

# 2. install (creates user 'agent', /etc/company-os.env, systemd units, dashboard)
cd company-os && sudo ./deploy/install.sh
sudo nano /etc/company-os.env                    # tokens, read-only DB URL, dashboard token

# 3. log in the Claude Code accounts (one folder per account)
sudo -u agent ./deploy/add-account.sh acc-01     # repeat acc-02 ... acc-25

# 4. test one loop by hand, look at it in the dashboard
sudo -u agent cos run ops-health

# 5. turn the schedules on (start with 2 loops, add the rest one by one)
sudo systemctl enable --now cos-loop-ops-health.timer cos-loop-finance-scorecard.timer
```

Dashboard: it listens on 127.0.0.1:8787. Reach it with `ssh -L 8787:127.0.0.1:8787 <server>`, Tailscale,
or a Traefik route with TLS (then set `COS_COOKIE_SECURE=1`). Never expose it without the token.

Read-only database user (run once on the primary):
```sql
CREATE ROLE cos_readonly LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE sahabat_warga TO cos_readonly;
GRANT USAGE ON SCHEMA public TO cos_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cos_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO cos_readonly;
```

## Harnesses (swap the engine per loop)
Set `"harness"` in `loops/<id>/loop.json`:
- `claude-code` — Claude Code on the subscription account pool in `accounts/claude-code/`. The runner picks the
  least recently used free account, and on a usage limit puts that account on cooldown and retries on the next one.
- `claude-api` — same CLI billed to `ANTHROPIC_API_KEY`, guarded by `daily_api_cost_cap_usd`.
- `codex` / any CLI — `type: "command"` adapter with an argv template. Add Gemini CLI, OpenCode, an Agent SDK
  script, etc. the same way. Make sure each tool's terms allow automated use the way you run it.

## Hermes
Install Hermes on the same server with its own API key, copy `integrations/hermes/SKILL.md` into its skills
folder, and give it terminal access to `cos`. Hermes is then the chat front door: "what's waiting for me?",
"approve 261015-a1b2c3, post it Tuesday", "pause everything". Optional: set `COS_NOTIFY_WEBHOOK` so failures,
DOWN alerts and new proposals are pushed instead of polled.

## Daily use
- **Dashboard → Approvals**: read, approve, or reject with a note. Approved items run on the loop's next run.
- **Dashboard → Overview**: goal KPIs, loop health, which loops are failing, account pool, cost.
- `cos pause` is the kill switch for all schedules.
- Weekly: read the retro proposals. That's how the system gets better.

## Adding a loop
1. `mkdir loops/<id>` with `loop.json` (copy one) and `prompt.md` (goal, steps, what to propose, how to execute approvals).
2. `sudo cos install-timers && sudo systemctl daemon-reload && sudo systemctl enable --now cos-loop-<id>.timer`.

## Test without any account
`tests/smoke.sh` runs every loop against a fake agent and prints how to open the dashboard on that test data.
