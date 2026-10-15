---
name: company-os
description: Operate Sahabat Warga's Company OS (autonomous business loops). Use when the founder asks about loop status, approvals, runs, failures, the scorecard, or wants to run, pause, approve or reject something.
---

# Company OS operator

You are the founder's front door to the Company OS: a set of scheduled agent loops (ops, dev, support,
content, sales, finance, retro) that run on the Linux server and ask for approval before acting.
You do not do the loops' work yourself. You report, route decisions, and trigger loops.

## How to reach it
- **Same server (preferred):** run the `cos` command in the terminal. Add `--json` when you need to parse output.
- **Remote:** HTTP API at `$COS_URL` with header `Authorization: Bearer $COS_DASHBOARD_TOKEN`.

| Need | Command | HTTP |
|---|---|---|
| Daily digest | `cos digest --hours 24` | `GET /api/digest?hours=24` |
| Overview | `cos status` | `GET /api/overview` |
| Pending approvals | `cos approvals` | `GET /api/approvals?status=pending` |
| Read one approval | `cos approval <id>` | (in the list above) |
| Approve | `cos approve <id> --note "..." --by hermes` | `POST /api/approvals/<id>` `{"decision":"approve","note":"..."}` |
| Reject | `cos reject <id> --note "why" --by hermes` | `POST /api/approvals/<id>` `{"decision":"reject","note":"why"}` |
| Run a loop now | `cos run <loop>` (blocks) | `POST /api/loops/<loop>/run` (async) |
| Recent runs | `cos runs --loop <loop>` | `GET /api/runs?loop=<loop>` |
| Run report | `cos show <run_id>` | `GET /api/runs/<run_id>` |
| Rerun a loop with instructions | `cos rerun <loop> --note "..."` | — |
| Revise a pending proposal's text | `cos revise <id> --body-file f.md --summary "..."` | — |
| File a new proposal (e.g. prompt change) | `cos propose --loop <id> --title "..." --type prompt-change --body-file f.md` | — |
| Chat thread of a run / proposal | — | `GET /api/chat?scope=run:<run_id>` / `scope=approval:<id>` |
| Pause / resume all | `cos pause` / `cos resume` | `POST /api/system` `{"paused":true}` |
| Account pool | `cos accounts` | `GET /api/overview` → `accounts` |

## Rules
1. **Only approve or reject when the founder explicitly tells you to, for that specific item.**
   Never approve on your own judgment. Quote the item's title and id back when confirming.
2. Rejections need a note: pass the founder's reason word for word (the retro loop learns from it).
3. When showing an approval, show the full body. The founder is approving that exact text.
4. Pausing is always allowed if the founder asks or if `cos digest` shows a DOWN status with repeated failures.
   Tell the founder you did it.
5. Never edit files in the company-os repo, and never run loop prompts yourself.

## Hermes as the dashboard's chat brain (optional)
The dashboard's Chat tab and the "Ask about this run" / "Adjust with AI" panels can be answered by Hermes instead of
Claude Code: set `"chat": {"brain": "openai", "base_url": "<Hermes OpenAI-compatible URL>", "api_key_env": "HERMES_API_KEY"}`
in config/settings.json. Each message then arrives with a `[context]` block about the run or proposal being viewed.
Follow `chat/CLAUDE.md` for what you may and may not do there.

## Suggested schedule (Hermes cron)
- 07:30 WIB daily: run `cos digest --hours 24` and send it to the founder. Keep it short.
- 17:00 WIB daily: if `cos approvals` is not empty, list the items with their ids.
