# Saga OS

**The office where a founder runs a company of AI staff agents.**

Saga OS is an open-source gateway between a company owner and their AI staff agents. Every message, task, approval
and report passes through it; [Hermes](https://hermes-agent.nousresearch.com/) does the thinking and the work behind it.
Agents propose, the owner decides, and the gateway enforces that, not the prompts.

- **Inbox**: approvals, questions and alerts in one place, with Chrome push notifications and nudges.
- **Chat**: talk to the Chief of Staff or any agent; every task and proposal has its own thread.
- **Staff**: one card per agent: job, shifts, permissions, autonomy, budget, KPIs.
- **Connectors**: connect a tool once (your own systems, Gmail, Calendar, GitHub, a browser), and every agent and harness uses it through one MCP endpoint.
- **Harness pool**: Claude Code, Codex and API models; tasks switch harness without losing progress.
- **Runs anywhere**: macOS, Windows, Linux, laptop or server.

## Status

| Part | State |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | **Spec v1 (draft)**: architecture, onboarding, connectors, harness switching, agent collaboration, notifications, install, roadmap |
| [`prototype/`](prototype/) | **v0 prototype** (stdlib Python + vanilla JS): scheduled loops, approvals, a dashboard with chat, an account-pool runner. Built for Sahabat Warga, the first company on Saga OS. |
| Gateway v1 (FastAPI + Next.js) | Not started: milestone M1 in the spec |

![Architecture](docs/img/architecture.png)

## Try the prototype

Needs Python 3.7+ (and the Claude Code CLI for real runs).

```bash
cd prototype
bash bin/local demo          # fake agent and sample data, dashboard at http://127.0.0.1:8787 (token: local)
bash bin/local run content-weekly   # one real run with your own Claude Code login
```

See [`prototype/README.md`](prototype/README.md) for the server install.

## Roadmap

![Roadmap](docs/img/roadmap.png)

## License

To be decided (see the open questions in the spec).
