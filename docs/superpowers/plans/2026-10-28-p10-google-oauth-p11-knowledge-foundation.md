# P10 Google OAuth + P11a Knowledge-Store Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development. Checkbox steps.

**Goal:** (P10) Real, config-gated Google OAuth for web + desktop — on when creds set (our cloud / `.dmg` / website), off in fully-local self-host (email+password only) — replacing the dummy `ChooseCompanyPage`. (P11a) A behavior-preserving foundation for routing the Knowledge (KB) vector store to a separate engine, so a later slice can make it local-or-cloud.

**Architecture:** Config-driven, off-by-default (same pattern as PostHog/BYO keys). Backend FastAPI+SQLAlchemy+Pydantic v2; frontend React/Vite/TS; Tauri desktop (`omilo://` deep-link already registered). Mock mode stays un-gated.

**Spec/context:** Deployment model in `docs/technical/12` + memory: fully-local repo = email+password; `.dmg`/website = our cloud → Google on. KB vectors (`KbChunk.embedding`, dim=256) currently live in the MAIN db via `get_tenant_db` (RLS).

## Global Constraints
- Branch off fresh `main`. Every task gates on its stack: backend → `cd apps/api && pytest` (full, baseline 792); frontend → `npx vitest run` (baseline 544) AND `npx tsc -b --force` (exit 0). Trust `tsc -b --force` over editor squiggles.
- **Config-driven, off by default.** No creds set → feature behaves exactly as today (Google button hidden; KB uses main db). No secrets committed.
- **Mock mode never gated** (`VITE_USE_HTTP!=='1'`): Google button hidden (publicConfig not fetched / googleEnabled false), app unchanged.
- camelCase types; snake_case request bodies + `/v1`-prefixed paths (the P9 lesson — every frontend API call MUST hit `/v1/...`).

## Review Focus
- **Disabled-path safety:** with no `GOOGLE_CLIENT_ID`, `/v1/auth/google/*` must 404/400 (not 500) and `publicConfig.googleEnabled=false` → button hidden. (T1/T3 tests.)
- **OAuth state/CSRF:** `start` must set an unguessable `state`; `callback` must reject a missing/mismatched state. (T1 test.)
- **Account linking:** Google email matching an existing user signs INTO that user (no dup); new email creates user+company (like sign-up). (T1 test.)
- **Token-in-redirect hygiene:** the JWT handed back via redirect must be consumed + stripped from the URL immediately, not left in history/state. (T3 test.)
- **KB foundation is a no-op:** with `knowledge_database_url` unset, every KB/memory test passes unchanged (same engine, same RLS). (T4 test.)

---

### Task 1: Google OAuth backend (config + public-config flag + start/callback) — P10
**Files:** `apps/api/omilo/config.py` (+`google_client_id`, `google_client_secret`, `google_redirect_base`); `apps/api/omilo/api/public_config.py` (+`googleEnabled`); new `apps/api/omilo/auth/google.py` (router); register in `apps/api/omilo/main.py`; tests `apps/api/tests/test_google_oauth.py`, extend `test_public_config.py`.
**Produces:**
- `public-config` → add `googleEnabled: bool` = `bool(settings.google_client_id and settings.google_client_secret)`.
- `GET /v1/auth/google/start?client=web|desktop` → 302 to Google's auth URL (scopes `openid email profile`), with a signed/random `state` (encodes `client` + CSRF nonce; store nonce server-side or in a signed token). If not configured → 404.
- `GET /v1/auth/google/callback?code&state` → validate state; exchange `code` at Google token endpoint (using client_id/secret + redirect_uri); fetch userinfo (email, name); **upsert**: existing user by email → use their first company; else create User+Company+owner Member (reuse the `sign_up` transaction logic / `make_access_token`). Then 302-redirect: `client=web` → `{frontend}/auth/callback#token=<jwt>`; `client=desktop` → `omilo://auth/callback?token=<jwt>`. If not configured → 404.
- Use `httpx` (already a dep) for Google token/userinfo calls; in tests, inject a fake transport / monkeypatch the exchange so NO real network.
- [ ] Step 1: failing tests — googleEnabled true/false by config; `/start` 404 when unconfigured, 302 to accounts.google.com with state when configured; `/callback` with bad state → 400; callback (fake exchange) new email → creates user+company+token-redirect; existing email → no dup, token for their company; `client=desktop` → `omilo://auth/callback?token=`.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement.
- [ ] Step 4: targeted + full `pytest` green. Commit `feat/p10-google-backend`.

### Task 2: (merged into Task 1 — public-config googleEnabled lives with the backend) — n/a

### Task 3: Google OAuth frontend + desktop wiring — P10
**Files:** `src/features/auth/SignInPage.tsx` + `SignUpPage.tsx` (wire GoogleButton); new `src/features/auth/GoogleCallbackPage.tsx` + route in `src/app/router.tsx` (`/auth/callback`); `src/app/useAuth.ts` or `session.ts` (consume googleEnabled); DELETE dummy data in `src/features/auth/ChooseCompanyPage.tsx` (wire to real `useSession().companies` or remove the route if unused post-OAuth); desktop deep-link handling (`src/platform/deepLink.ts` already parses `omilo://`; ensure `omilo://auth/callback` routes to the callback); tests `src/features/auth/googleAuth.test.tsx`.
**Consumes:** `publicConfig().googleEnabled` (via session hydrate → expose on `useSession`), backend `/v1/auth/google/start`.
**Produces:**
- `useSession`/publicConfig exposes `googleEnabled`; SignIn/SignUp render the GoogleButton ONLY when `googleEnabled` (hidden in mock + unconfigured local). The button does a full-document navigation to `${API}/v1/auth/google/start?client=web` (or `desktop` under Tauri — detect via `platform`).
- `/auth/callback` route: reads the token from the URL (`#token=` for web; the `omilo://auth/callback?token=` deep-link for desktop), `platform.tokenStorage.setToken`, `useSession.hydrate()` (or applySignIn via `/me`), strip the token from the URL, navigate to home. Error (no token) → `/auth/sign-in` with a message.
- Remove the fixture companies from `ChooseCompanyPage` (the fake Sahabat Warga / Kopi Kenangan / "Welcome back, Dede"); if a post-OAuth multi-company picker is still wanted, drive it from real `useSession().companies`, else drop the route.
- [ ] Step 1: failing tests — button hidden when googleEnabled=false, shown+links to /v1/auth/google/start?client=web when true; callback stores token + hydrates + navigates home; callback without token → sign-in. Grep-prove the dummy company fixtures are gone from the live path.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement.
- [ ] Step 4: `npx vitest run` + `npx tsc -b --force` green. Commit `feat/p10-google-frontend`.

### Task 4: Knowledge-store engine foundation (behavior-preserving) — P11a
**Files:** `apps/api/omilo/config.py` (+`knowledge_database_url: str | None = None`); new `apps/api/omilo/kb/db.py` (`get_knowledge_db` dependency + engine resolver); route KB/memory ops through it in `apps/api/omilo/api/knowledge.py`, `apps/api/omilo/api/memory.py` (swap `get_tenant_db` → `get_knowledge_db` for KB/memory endpoints ONLY); `kb/index.py`/`kb/retrieve.py` accept the session they're given (already do — no change if the API passes the knowledge session); tests `apps/api/tests/test_knowledge_db.py`.
**Produces:**
- `knowledge_database_url: str | None = None`. `kb/db.py`: `get_knowledge_db()` — when the URL is None (default) it yields the SAME tenant-scoped RLS session as `get_tenant_db` (ZERO behavior change); when set, it yields a session on a dedicated engine for that URL (single-tenant store; company scoping explicit by `company_id`). For P11a, FULLY IMPLEMENT the None path and the engine construction, but the separate-URL path may be minimally wired + marked with a TODO for the switching slice (P11b) — the point of P11a is the seam + no regression, not the live local/cloud switch.
- All existing knowledge + memory + kb tests pass UNCHANGED (the None default must be a true no-op).
- [ ] Step 1: failing test — `test_knowledge_db.py`: with `knowledge_database_url=None`, `get_knowledge_db` yields a session that reads/writes KbChunk identically (ingest a source, retrieve it); assert the engine is the main engine when unset.
- [ ] Step 2: run → fail.
- [ ] Step 3: implement the seam; swap the 2 API modules to `get_knowledge_db`.
- [ ] Step 4: targeted + FULL `pytest` green (no regression in knowledge/memory suites). Commit `feat/p11a-knowledge-db`.

---
## Self-Review notes
- **Coverage:** P10 = backend (T1) + frontend/desktop (T3); gated by googleEnabled so fully-local = email+password. P11a = safe seam only (T4), switching deferred to P11b.
- **Parallel safety:** T1 (backend auth), T3 (frontend auth) share only the documented contract (T1 merges first OR T3 works against the plan's contract like P9 Wave 2). T4 is backend-KB, DISJOINT from T1 (auth) — fully parallel. All isolated worktrees.
- **Risk:** the KB engine-split tenancy is the real hazard → P11a deliberately keeps the default a no-op and defers live switching. OAuth token-in-redirect uses URL fragment + immediate strip (noted hardening: one-time-code exchange later).
