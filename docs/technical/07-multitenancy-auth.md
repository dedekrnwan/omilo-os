# 07 · Multi-tenancy & Auth

> Track: **technical**. How one deployment safely serves many companies, and how users sign
> in. **Decision: shared schema + `company_id` + Postgres RLS.** Self-host collapses to a
> single company (RLS still on, trivially satisfied).

## 1. Tenancy model

- **One Postgres schema.** Every tenant table carries `company_id` (see [`01`](01-data-model.md)).
  Global tables (`User`, `Plan`) have no `company_id`.
- **Row-Level Security** is the isolation boundary — a database guarantee, not app discipline:

```sql
ALTER TABLE helper ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON helper
  USING (company_id = current_setting('app.company_id', true));
-- identical policy on every tenant table (generated in migrations)
```

- **Session variable.** Every request/worker task opens a DB session and runs
  `SET LOCAL app.company_id = :cmp` **before any query**, inside the transaction. A FastAPI
  dependency (`get_db`) and the worker's job wrapper both do this; there is no code path that
  touches tenant tables without it.
- **Defense in depth.** The ORM base query for tenant models also filters `company_id`
  (belt-and-braces), and writes stamp `company_id` from the context, never the request body.

### Why shared-schema + RLS (vs schema/db-per-company)
Many small tenants, cheap ops, **one migration** to run, simple connection pooling, and RLS
gives strong isolation without per-tenant DDL. Schema-per-company (omilo-os's choice) and
db-per-company remain *possible* escape hatches for a future enterprise tier, but are not the
default. Self-host is just "one row in `company`," so the same code runs unmodified.

## 2. Tenant resolution

1. Auth yields a `User`.
2. A user may belong to many companies (`Member` rows). The **active company** is:
   - from the session (set at sign-in or `POST /v1/companies/{id}/switch`), or
   - overridden per-request by `X-Company-Id` **iff** the user has a `Member` row there.
3. `get_current_context()` → `{user, member, company}`; `member.role` drives authorization;
   `company.id` sets the RLS var.

## 3. AuthN

- **Password**: argon2id hashes. Sign-up/in/forgot/reset per [`02` §3](02-api-contracts.md).
- **Google SSO**: verify `id_token`; link/create `User`. (The UI has a
  `google-not-allowed` screen → domain allowlist per company.)
- **Two-step**: TOTP/code verification screen supported.
- **Sessions**: short-lived **access JWT** (~15 min) + rotating opaque **refresh token**
  (httpOnly, secure cookie on web; OS-keychain-backed on desktop — see [`10`](10-tauri-desktop.md)).
  JWT claims: `sub=user_id`, `cmp=company_id`, `role`, `exp`. Refresh rotates and detects reuse.
- **Agent/MCP tokens**: separate per-Helper bearer tokens (hashed on `Helper`), never a user
  session — see [`05`](05-mcp-surfaces.md).
- **Connector tokens**: per-connector OAuth tokens / API keys (encrypted), used *outbound* to
  call the connected system and to poll it on a schedule. omilo exposes **no public inbound
  webhook ingress** for flow triggers (billing-provider callbacks in [`08`](08-billing-ai-credits.md)
  are the only inbound hooks, and only when a payment provider is wired).

## 4. AuthZ (roles)

`MemberRole = owner | admin | member` (Control-Panel → Members).

| Capability | member | admin | owner |
|---|---|---|---|
| Use chat, set goals, approve items in own channels | ✓ | ✓ | ✓ |
| Manage helpers, routines, flows, connectors | – | ✓ | ✓ |
| Members & roles, safety & limits, AI engine/accounts | – | ✓ | ✓ |
| Billing, plan, delete company, data export/delete | – | – | ✓ |

`channel_scope` on `Member` can further restrict a member to specific channels (the UI shows
"Engineering, General" style scoping). Authorization = role check **and** channel scope **and**
RLS. Enforced in a FastAPI dependency per route.

## 5. Secrets & encryption

- Provider keys, connector secrets, pool account tokens: **encrypted at rest** with
  `cryptography` (Fernet/AES-GCM) using a KMS-managed key (env `OMILO_SECRET_KEY`; cloud uses a
  real KMS). Only `*_hint` is ever returned to clients.
- Encryption keys are **not** per-tenant by default (shared schema), but rotation is supported;
  an enterprise tier may add per-tenant keys.
- All secret access is audited (`AuditEvent`).

## 6. Self-host edition

- Same binary; `COMPANY_EDITION=self_host` seeds exactly one `Company`, disables sign-up of new
  companies, and makes billing a no-op (subscription fee handled out-of-band / license).
- RLS stays enabled (single satisfied tenant) so there's **no divergent code path** between
  cloud and self-host — the ELv2 edition split is config + packaging, not a fork. See
  [`integrations/README.md` §editions](../integrations/README.md).

## 7. Threat-model guardrails

- No endpoint trusts a `company_id` from the body; it comes from the authenticated context.
- RAG retrieval, KB writes, MCP tool calls, and realtime subscriptions are **all** RLS-scoped.
- Realtime channels are namespaced per company; a socket is bound to the authenticated
  `company_id` at connect (see [`09`](09-realtime.md)).
- Rate limits and `SafetyLimit`s are per-company; one tenant cannot exhaust another's capacity
  (per-company concurrency + credit budgets).
