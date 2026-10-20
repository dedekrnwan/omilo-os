# Omilo v2 — Backend & Integration Gap-Closure — Design

**Date:** 2026-10-21
**Status:** Draft for approval
**Owner:** Dede Kurniawan
**Builds on:** the v2 UI refresh (shell + 14 screens, all merged to `main`).

---

## Intent & why

The v2 UI refresh is complete and merged. During it, screens were built faithfully to the
pen.dev design — and a few of those designs assume backend capabilities that don't exist yet,
plus some deferred surfaces (the ⌘K "Ask Chief of Staff" answer, the "You" account pages)
need backend before they can be real. This project **closes the backend + integration gaps**
so the already-shipped and near-shipped UI actually works end-to-end.

**Key finding from the gap analysis:** the backend is remarkably complete (~230 endpoints).
**All 14 refreshed screens already have full backend support** — every `api()` call they make
maps to a real endpoint. The gaps are narrow and concentrated. This is a focused gap-closure,
not a backend build-out.

## Goals

- **Finish the ⌘K command palette** so "Ask Chief of Staff" returns a real inline answer with
  sources, the AI-status line reflects real health, and RECENT / @helper / #chat modes work.
- **Build the "You" account pages** (reached from a new profile-menu dropdown), wiring the ones
  the backend already supports and adding the one missing backend (Email/SMTP).
- Keep everything behavior-preserving and consistent with the existing API + service patterns.

## Non-goals / explicitly deferred (stay "Coming soon" in the UI)

- **Personas** (marketplace / persona page / try-interview / hired) — **Coming soon**. The
  sidebar PERSONAS group already renders disabled; the profile-menu "Your Persona / Create your
  Persona" and "Persona Studio" entries must also render **"Coming soon"** (disabled, no route).
- **Persona Studio** (creator side) — Coming soon.
- **Chat message-bubble restyle** (shared `ChatThread`) — tracked separately; not backend.
- No new multi-tenant, auth, or billing surfaces beyond what's listed.

## Anti-goals

- Don't rebuild what exists: notification prefs, devices, audit log, sessions, KB search are
  all already there — wire to them, don't duplicate.
- Don't make ⌘K `/ask` a heavyweight agent run; it's a fast, bounded retrieval+answer.
- Don't fork the "You" pages away from Settings in a way that creates two sources of truth for
  the same setting (see open question on Settings-vs-You overlap).

## The gap analysis (what's missing, precisely)

**Confirmed present (no work needed):** every existing screen's calls; notification prefs
(`GET/PUT /notify`, `/notify/prefs`), push devices (`/notify/subscribe|unsubscribe|test`),
audit log + CSV (`/audit`), sessions (`/auth/sessions`), account name edit (`PATCH /auth/me`),
password (`/auth/password`), KB hybrid search (`GET /kb/search`), threads/staff for palette modes.

**Tier A — ⌘K command palette gaps** (UI already shipped; see `components/CommandPalette.tsx`
GAP comments at lines 13, 14, 129, 276):
- **A1 — no synchronous answer endpoint.** "Ask Chief of Staff" needs an answer + cited sources
  + token/cost, returned in one request. Today the palette falls back to opening a chat thread.
  `GET /kb/search` (ranked chunks) + the engine layer exist to build it on.
- **A2 — no AI-health field.** The palette fakes "AI on · Claude Code pool" from `overview.paused`.
  No `ai_status`/`pool_down` on `GET /overview`.
- **A3 — RECENT / @helper / #chat modes stubbed.** Data exists (`/threads`, `/staff`) but isn't
  wired; these are frontend-only integration (no backend gap).

**Tier B — "You" settings sections + profile menu** (CORRECTED after reading the pen frames —
the Section 07 "You" pages are NOT new routes; **Account, Notifications, and Email(SMTP) are
sections of the already-built `/settings` page**, reached via the Settings Nav. The pen's
Settings Nav is: COMPANY [General, Safety & limits, **Email (SMTP)**], AI [AI engine, Connection
check], YOU [Account, Devices & tokens, Notifications], DATA [Activity log, Data & storage] —
which matches the shipped Settings v2 **plus one new section: Email (SMTP)**):
- **B1 — Profile menu** (the one genuinely new shell element — a dropdown on the sidebar user
  avatar): Me, Your Persona (**Coming soon**), Persona Studio (**Coming soon**), Account,
  Notifications, Switch company (reuse `CompanySwitcher`), Help & guides, Log out. The Account /
  Notifications items **navigate into the existing `/settings` sections**; Help routes to the
  Help page; Persona entries are disabled "Coming soon".
- **B2 — Account section polish:** the shipped Settings "Account" section → match the pen
  (Profile / Sign-in & security / **Your Persona [Coming soon]** / Danger zone with Delete).
  Wire `GET/PATCH /auth/me`, `/auth/password`, `/auth/sessions`, `/auth/tokens` (all exist;
  name-only edit today). Account **Delete** (danger zone) has no backend today (open question).
- **B3 — Notifications section:** already shipped + wire the existing `/notify*`. The pen adds an
  **"Email delivery · Set up SMTP"** tile that links to the new Email section. No backend gap
  beyond SMTP itself.
- **B4 — Email (SMTP) section + backend (the real net-new work):** a new settings section under
  COMPANY. Pen tagline: *"Omilo writes the emails; your own mail server sends them."* So SMTP is
  **company-level outbound email delivery** whose consumer is **email notifications + the weekly
  digest** (the Notifications "Email delivery" tile confirms this). New backend: SMTP config
  stored as a `Setting` (host/port/security/username/password-encrypted/from), endpoints to
  get/set/test, and an **`email` notification channel** so notices/digest can be delivered by
  email (see open question on delivery scope).
- **B5 — Help & guides + Guide article:** a genuinely new page (the profile menu's "Help &
  guides"), rendering static/markdown guide content (frontend; reuse the markdown renderer). Not
  a settings section.

**Minor (optional):** `/staff` "Suggested specialists" is a hardcoded list of 3 — could become a
backend-driven recommendation feed. Deferred unless wanted.

## Decided approach (the "how" we're committing to)

### Tier A — ⌘K
1. **`POST /api/ask`** (new) — synchronous. Body `{ q, scope? }`. Pipeline: **cross-surface
   retrieval** — gather candidate context from KB (`kb.search`, already returns
   `{title,ref,url,text,score}`) **plus Inbox, Plan, and Docs/vault** (a new lightweight
   retrieval layer that queries those surfaces and normalizes hits into the same source shape),
   rank/merge, then compose a short grounded answer via the engine layer (bounded tokens/timeout)
   and return `{ answer, sources:[{title,ref,url?,surface}], tokens, cost_usd, ms }`. Engine seam:
   add a small threadless "compose grounded answer from these chunks" primitive (or synthesize a
   bounded `ChatContext`) — builder's call, but it must NOT spin up a full agent run. Falls back
   gracefully (no AI available → 503 with a reason the palette renders as the "AI unavailable"
   state). Wire the palette's ask mode to render the inline answer (pen `JxYA6`) instead of
   bouncing to chat; keep "⌘↵ continue in chat" as the escalation. Log the ask (like `kb.search`
   logs `KbQuery`) and audit it.
2. **`ai_status` on `GET /overview`** — add a field (e.g. `{ ok, label, detail }`) derived from
   the harness pool / provider health (`harness.py` already computes pool state). Palette + any
   status UI read it instead of faking from `paused`.
3. **Palette RECENT/@/# wiring** (frontend) — RECENT from `GET /threads` (most-recent), `@` filters
   `GET /staff`, `#` filters `GET /threads` group/chat scope. No backend change.

### Tier B — You settings sections + profile menu
4. **Profile menu** — a new dropdown on the sidebar user avatar (lives in `Shell`/a new
   component). Renders the entries in B1; **Persona entries are disabled "Coming soon"** (same
   treatment as the sidebar PERSONAS group); Switch company reuses `CompanySwitcher`; Account /
   Notifications items **navigate into the existing `/settings` sections** (e.g. deep-link to the
   section); Help routes to the new Help page; Log out reuses the existing flow.
5. **Account section** (within the shipped `/settings`) — match the pen's Profile / Sign-in &
   security / Your Persona [Coming soon] / Danger zone. Wire existing endpoints; Delete-account is
   an open question (new backend if in scope).
6. **Notifications section** — already shipped; add the pen's "Email delivery · Set up SMTP" tile
   linking to the Email section.
7. **Email (SMTP) section + backend** — add the section under COMPANY in the Settings nav, and:
   - SMTP config `Setting` (host/port/security/username/password-encrypted/from).
   - Endpoints `GET /api/settings/smtp`, `PUT /api/settings/smtp` (validate + store), `POST
     /api/settings/smtp/test` (send a test email). A small `smtp.py` service wraps `smtplib`.
   - **An `email` notification channel** in `notify.py` (currently `{push, app}`): add `email` as
     a channel so **decision notices and the weekly digest deliver via the configured SMTP**
     (owner decision — SMTP is wired to real delivery in v1, not just config+test). Omilo composes
     the email body; `smtp.py` sends it through the company's mail server to the owner's address
     (`User.email`). Respect notification prefs/quiet-hours for the email channel like the others.
8. **Help page** — a new route rendering static/markdown guide content (frontend; reuse the
   markdown renderer), reached from the profile menu.

### Cross-cutting
- Follow existing patterns: router endpoints in `routers/`, service logic in a module under
  `omilo_api/`, secrets encrypted the way connector/harness secrets are, audit-logged where other
  mutations are. Front-end uses the existing `api()` helper + `usePageActions` + Page Header v2.
- No test harness in `apps/web`; backend has `pytest` tests under `apps/api/tests` — **new backend
  endpoints get pytest coverage** (the backend DOES have a test culture, unlike the web).

## Constraints

- Backend: FastAPI + SQLAlchemy, multi-company schema isolation, existing auth/session model,
  encrypted-secret pattern, `pytest` tests expected for new endpoints.
- Frontend: Next.js App Router, custom CSS tokens, `api()` helper, Page Header v2, Remix Icon.
- Faithful to the pen frames for the You pages and the ⌘K answer state.
- `./node_modules/.bin/tsc --noEmit` + `npm run build` green for web; `pytest` green for api.

## Resolved owner decisions

- **SMTP delivery (v1):** config + test-send **+ wire a real `email` notification channel** —
  decision notices and the weekly digest deliver via the company's SMTP. Not a dead-end.
- **`/ask` sources (v1):** **cross-surface** — KB + Inbox + Plan + Docs/vault (build the
  lightweight cross-surface retrieval layer now, not KB-only).
- **Account Delete (danger zone):** **deferred — render as "Coming soon"** (disabled); no
  delete-account/company backend in v1.
- **"You" pages = Settings sections** (resolved by the pen): Account/Notifications/Email are
  sections of the shipped `/settings`, NOT new routes. Only Email(SMTP) is a new section; Help &
  guides is the one genuinely new page.
- **Personas + Persona Studio:** stay **"Coming soon"** everywhere (sidebar PERSONAS group + the
  profile-menu "Your Persona / Persona Studio" entries).

## Builder's calls (settled here; flagged so the owner can check)

- **`ai_status` field:** reflects the **Claude Code pool readiness** (from `harness.pool_summary`),
  computed **cheaply** — skip the per-request CLI shell-out (cache or omit `cli_version` from the
  hot path) so adding it to `GET /overview` doesn't slow page loads. Shape ~ `{ ok: bool, label,
  detail? }`. If true per-provider health is wanted later, promote to its own polled endpoint.
- **Account edit v1:** wire existing endpoints — name edit (`PATCH /auth/me`), password, sessions,
  tokens. **Email shown read-only** (changing the login identifier has auth/uniqueness
  implications — out of v1). **User avatar deferred** (no `User` avatar storage today).

## Left to the builder

- Exact `/ask` retrieval-K per surface, token ceiling, timeout, answer prompt, and merge/ranking
  across surfaces; the engine-seam choice (new compose primitive vs synthesized `ChatContext`).
- Exact fields feeding `ai_status` beyond pool readiness, if any.
- Help/guide content source (static bundled markdown vs authored in the vault).
- Per-page/section markup read from the pen frames at implementation
  (`UGXA0 / g0oafn / x51oB / nRHse / ipDJM`, and the profile menu `Wpq5w`).
- Whether email-channel delivery reuses the existing nudge/digest composition or adds a small
  email formatter.
