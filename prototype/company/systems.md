# Systems map (what lives where)

All repos are siblings of `company-os/` in the `sahabat-warga` workspace.
On the server, set `WORKSPACE_DIR` to the folder that contains them (default: the parent of company-os).

| Repo | What | Notes for agents |
|---|---|---|
| `flutter-saga` | Mobile app (Flutter) | `flutter test` before any PR |
| `go-core` | Core API (Go) | `go test ./...`; migrations in `migrations/` — never run them against prod |
| `go-notification` | Notifications service (Go) | WhatsApp/push |
| `py-ai` | AI service (Sobi backend) | |
| `sobi` | Sobi assets/widget | |
| `landing` | Marketing site (Astro, Vercel) | copy in `landing/content/` |
| `ops` | Infra: Docker Swarm, Traefik, Postgres, Redpanda, Prometheus | read `ops/docs/runbook.md` first |
| `docs` | Product specs, v2 plan, gap analysis | |

## Data access for loops (read-only)
- `PROM_URL` — Prometheus (alerts + metrics), e.g. `http://127.0.0.1:9090`
- `REPLICA_DATABASE_URL` — PostgreSQL **read-only** user/replica. Never the primary.
- `GITHUB_TOKEN` — fine-grained token: issues + pull requests on the app repos, **no** admin, no direct push to main.
