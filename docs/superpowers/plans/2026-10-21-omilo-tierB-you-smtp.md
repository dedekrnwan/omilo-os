# Tier B — "You" Settings + Email/SMTP + Profile Menu + Help — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add company-level outbound Email (SMTP) config + an `email` notification channel, a new Settings "Email (SMTP)" section, Account-section polish, a profile-menu dropdown on the sidebar avatar, and a Help & guides page.

**Architecture:** Backend adds `smtp.py` (config in a `Setting`, password Fernet-encrypted, `smtplib` send) + `GET/PUT/POST /api/settings/smtp` + an `email` channel in `notify.py` delivered alongside Web Push. Frontend adds an "Email (SMTP)" section to the existing Settings page, polishes the Account & Notifications sections, adds an avatar dropdown (via the existing `lib/menu` `openMenu`), and a `/help` page (static markdown via `<Markdown>`). Personas/Studio entries render **"Coming soon"** (inert).

**Tech Stack:** FastAPI + SQLAlchemy + `smtplib` (backend, `pytest`); Next.js/React + custom CSS (frontend, `tsc`+`build`+manual). Backend tests: `cd apps/api && uv run pytest`.

**Spec:** `docs/superpowers/specs/2026-10-21-omilo-backend-integration-gaps-design.md` (Tier B).
**Design source (read-only):** pen.dev `omilo.pen` (`/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`); frames `x51oB` (Email/SMTP), `UGXA0` (Account), `g0oafn` (Notifications), `Wpq5w` (profile menu), `nRHse`/`ipDJM` (Help). Read via `mcp__pencil__execute`; never Read/Grep the `.pen` file.

## Global Constraints

- **No backend changes beyond SMTP + the email channel.** Reuse: `services.get_setting/set_setting`, `security.encrypt/decrypt` (Fernet), `routers/settings.py` (prefix `/api`, `Depends(current_user)`, `get_db`, `S.audit`+`db.commit()`), `notify.py` channel/prefs model, `digest.py`.
- **SMTP password is Fernet-encrypted at rest** (`security.encrypt`) and **NEVER returned** by `GET /api/settings/smtp` (return a boolean `has_password`/masked, not the value).
- **`Setting.key` ≤ 64 chars.** Use a short key (e.g. `"smtp"`).
- **Email channel degrades gracefully:** if SMTP isn't configured, no email is sent and nothing errors; it respects the same prefs/quiet-hours/cap as push (`wants(p, kind, "email")`).
- **Personas/Studio + Account Delete stay "Coming soon"** — rendered disabled/inert (no route, no action).
- Backend endpoints get `pytest` coverage (mock `smtplib`/the sender — tests must NOT send real email). Frontend: `./node_modules/.bin/tsc --noEmit` + `npm run build`; NO dead CSS.
- Faithful to the pen frames.

## Review Focus

1. **SMTP password leak:** `GET /api/settings/smtp` must never return the stored password (masked/boolean only). → Task 1.
2. **SMTP test/send failure:** bad creds / unreachable host / timeout → a clean error response (not a 500 hang); `smtplib` call has a timeout. → Task 1.
3. **Email channel, SMTP unconfigured:** sending a notice with the email channel enabled but no SMTP config → no send, no exception. → Task 2.
4. **Email channel respects prefs:** `wants(p, kind, "email")` + quiet-hours + cap honored exactly like push. → Task 2.
5. **"Coming soon" items inert:** Persona/Studio menu entries + Account Delete do not navigate or fire an action. → Task 4 + Task 5.

---

## File Structure
- Create `apps/api/omilo_api/smtp.py` — SMTP config get/set + send + test.
- Modify `apps/api/omilo_api/routers/settings.py` — `GET/PUT/POST /api/settings/smtp`.
- Modify `apps/api/omilo_api/notify.py` — `email` channel + `email_pending(...)` sender.
- Create `apps/api/tests/test_smtp.py` — pytest for SMTP + email channel.
- Modify `apps/web/app/settings/page.tsx` — Email section + Account polish + Notifications tile.
- Modify `apps/web/components/NotifySettings.tsx` — email-delivery tile + email prefs column.
- Modify `apps/web/components/Shell.tsx` — avatar profile-menu dropdown.
- Create `apps/web/app/help/page.tsx` — Help & guides page.
- Modify `apps/web/app/globals.css` — section/menu/help styles (additive, no dead CSS).

---

### Task 1: SMTP config service + endpoints (backend)

**Files:** Create `apps/api/omilo_api/smtp.py`; Modify `routers/settings.py`; Test `apps/api/tests/test_smtp.py`.
**Interfaces (produces):**
- `smtp.get_config(db) -> dict` → the stored config WITHOUT the password: `{host, port, security, username, from_addr, has_password: bool}` (empty/defaults when unset).
- `smtp.set_config(db, cfg: dict) -> None` → validate + store in `Setting["smtp"]`; password (if provided & non-empty) stored via `security.encrypt`; an empty/omitted password preserves the existing one.
- `smtp.send_email(db, to: str, subject: str, body: str) -> None` → read config, `security.decrypt` the password, send via `smtplib` (SMTP/SMTP_SSL per `security`, `starttls` when `security=="tls"`, **`timeout=10`**). Raises `SmtpError` (a module exception) on misconfig/failure.
- `smtp.test_send(db, to: str) -> None` → compose a canned test message, call `send_email`; let `SmtpError` propagate.
- Route body `class SmtpIn(BaseModel): host:str; port:int=587; security:Literal["none","tls","ssl"]="tls"; username:str=""; password:str|None=None; from_addr:str` (field names your call; `from_addr` maps to the `From`).
- Routes (in `settings.py`, prefix `/api`, `Depends(current_user)`, `get_db`, `S.audit`+`db.commit()`): `GET /settings/smtp` → `smtp.get_config(db)`; `PUT /settings/smtp` (body `SmtpIn`) → `set_config` + audit + 200; `POST /settings/smtp/test` (body `{to?:str}`, default to the owner's email) → `test_send`; map `SmtpError` → `HTTPException(400, str)`.
- Consumes: `services.get_setting/set_setting`, `security.encrypt/decrypt`.

- [ ] **Step 1: Write failing tests** in `tests/test_smtp.py` (use the `owner` fixture; **monkeypatch `smtplib.SMTP`/`SMTP_SSL`** so NO real email is sent):
  - `test_put_then_get_smtp_hides_password` — PUT a config with a password, then `GET /api/settings/smtp`; assert 200 and the response has `has_password == True` and does NOT contain the password string anywhere.
  - `test_put_smtp_encrypts_password` — after PUT, read `Setting["smtp"]` via `session_scope()`; assert the stored password is NOT the plaintext (it's the Fernet token) and `security.decrypt` returns the plaintext.
  - `test_smtp_test_send_invokes_smtplib` — monkeypatch `smtplib.SMTP` to a recording fake; `POST /api/settings/smtp/test` with a configured server → assert 200 and the fake's `send_message`/`sendmail` was called once with the from/to.
  - `test_smtp_test_send_error_is_400` — make the fake raise on connect; assert `POST /settings/smtp/test` → 400 (not 500).
- [ ] **Step 2:** `cd apps/api && uv run pytest tests/test_smtp.py -v` → FAIL.
- [ ] **Step 3:** Implement `smtp.py` + the three routes. `smtplib` calls use `timeout=10`. Never return the password from `get_config`.
- [ ] **Step 4:** `uv run pytest tests/test_smtp.py -v` → PASS. (RED/GREEN in report.)
- [ ] **Step 5: Commit** `feat(api): company SMTP config + test-send endpoints`.

### Task 2: `email` notification channel (backend)

**Files:** Modify `apps/api/omilo_api/notify.py`; Test `apps/api/tests/test_smtp.py` (append).
**Interfaces:**
- Add `"email"` to `CHANNELS` (`notify.py:30`) and to each `DEFAULT_KINDS` entry (`:31-32`) as `{..., "email": False}` (off by default). `_normalize`/prefs carry the `email` sub-flag per kind.
- `notify.email_pending(db_factory, auth_factory, label, company) -> int` — analogue of `push_pending`: iterate fresh `Notice` rows, gate each with `wants(p, n.kind, "email")` AND honor `held()`/quiet/cap, render via `serialize(n)`, send via `smtp.send_email(db, owner_email, subject, body)`, log a `Notification(channel="email", action="sent")` row. **If SMTP is not configured (`get_config(...).has_password`/host empty) → return 0, send nothing, raise nothing.** Returns count sent.
- Consumes: `smtp.send_email`, `smtp.get_config`, the existing `wants`/`held`/`serialize`/`plan_pushes`-style cap, `Notification` model.
- Wire `email_pending` into the same worker tick that calls `push_pending` (find where `push_pending` is invoked — likely `worker.py`/a scheduler — and add the email call next to it, guarded).

- [ ] **Step 1: Write failing tests** (append to `tests/test_smtp.py`; monkeypatch `smtp.send_email` to a recorder):
  - `test_email_channel_in_config` — `GET /api/notify` → `channels` includes `"email"`; a kind's prefs include an `email` flag.
  - `test_email_pending_sends_when_enabled_and_configured` — configure SMTP, set a kind's `email` pref True, create a matching open `Notice`, call `email_pending(...)` → asserts the recorder got one send and a `Notification(channel="email")` row exists.
  - `test_email_pending_noop_when_smtp_unconfigured` — email pref True but NO SMTP config → `email_pending` returns 0, recorder not called, no exception. (Review Focus #3.)
  - `test_email_pending_respects_pref_off` — SMTP configured but the kind's `email` pref False → no send. (Review Focus #4.)
- [ ] **Step 2:** `uv run pytest tests/test_smtp.py -v` → new tests FAIL.
- [ ] **Step 3:** Implement the channel + `email_pending` + the worker wiring.
- [ ] **Step 4:** `uv run pytest tests/test_smtp.py -v` → PASS (all).
- [ ] **Step 5: Commit** `feat(api): email notification channel over SMTP`.

### Task 3: Email (SMTP) Settings section (frontend)

**Files:** Modify `apps/web/app/settings/page.tsx`; Modify `apps/web/app/globals.css`. Reference pen `x51oB`.
**Interfaces:** Consumes `GET/PUT/POST /api/settings/smtp` (Task 1).

- [ ] **Step 1:** Read pen `x51oB` (Email (SMTP): Head + Columns [Mail server | Right]) + `TakeScreenshot(['x51oB'])`. Read `app/settings/page.tsx` GROUPS/section pattern.
- [ ] **Step 2:** Add an `{ id: "email", label: "Email (SMTP)", icon, words, desc }` Item under the **Company** group in `GROUPS[0].items`, and an `{s === "email" && <EmailSmtp/>}` case in the section switch. Build `EmailSmtp`: a form (host, port, security select, username, password [write-only; show "saved" when `has_password`], from) with **Save** (PUT) and **Send test** (POST test) + result/error feedback. Match pen `x51oB` ("Omilo writes the emails; your own mail server sends them").
- [ ] **Step 3:** Append v2 CSS; reuse `.set-row`/`.paper`/form classes; NO dead CSS (grep).
- [ ] **Step 4: Verify** `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Report + confirm save/test wired, password write-only. (Review Focus #1 at the UI: never pre-fills the password.)
- [ ] **Step 5: Commit** `feat(web): Settings — Email (SMTP) section`.

### Task 4: Account polish + Notifications email tile (frontend)

**Files:** Modify `apps/web/app/settings/page.tsx` (Account section); Modify `apps/web/components/NotifySettings.tsx`; Modify `apps/web/app/globals.css`. Reference pens `UGXA0`, `g0oafn`.
**Interfaces:** Account wires existing `/auth/me`, `/auth/password`, `/auth/sessions`, `/auth/tokens` (already rendered). NotifySettings consumes `/notify` (now with `email` channel from Task 2).

- [ ] **Step 1:** Read pens `UGXA0` (Account: Profile / Sign-in & security / Your Persona / Danger zone-Delete) + `g0oafn` (Notifications: Email delivery tile + What reaches you) + screenshots.
- [ ] **Step 2:** Account section — match `UGXA0`: keep existing Profile (name/email read-only) + Sign-in & security (password); ADD a **"Your Persona"** block rendered **disabled "Coming soon"** (inert) and a **"Danger zone"** with a **Delete** button rendered **disabled "Coming soon"** (no action, no backend). Notifications — in `NotifySettings` add the pen's **"Email delivery · Set up SMTP"** tile linking to the Email section (`/settings/?s=email`), and an **email** column/toggle in the per-kind prefs grid (now that `channels` includes `email`), wired through the existing prefs save.
- [ ] **Step 3:** Append v2 CSS; NO dead CSS. Inert "Coming soon" = the established pattern (disabled, `tabIndex -1`, no href/onClick, a "Soon" pill).
- [ ] **Step 4: Verify** tsc + build. Report + confirm Persona/Delete inert (Review Focus #5), email prefs toggle saves, existing account/password/sessions preserved.
- [ ] **Step 5: Commit** `feat(web): Settings — Account polish + Notifications email delivery`.

### Task 5: Profile-menu dropdown + Help page (frontend)

**Files:** Modify `apps/web/components/Shell.tsx`; Create `apps/web/app/help/page.tsx`; Modify `apps/web/app/globals.css`. Reference pens `Wpq5w`, `nRHse`, `ipDJM`.
**Interfaces:** Consumes `lib/menu` `openMenu(x,y,items: MenuItem[])` + `MenuItem` shape; `logout`, `CompanySwitcher` (existing in Shell); `components/Markdown` `{ Markdown }` named export.

- [ ] **Step 1:** Read pens `Wpq5w` (profile menu entries), `nRHse` (Help & guides index), `ipDJM` (Guide article) + screenshots. Read `Shell.tsx` `.foot` block (~L187) + the Topbar `handleMore`/`openMenu` pattern (~L251).
- [ ] **Step 2:** Make the sidebar `.foot` avatar/name open a dropdown via `openMenu(rect..., items)`. Items (pen `Wpq5w`): a header "Me" (name/email), **Your Persona [disabled "Coming soon"]**, **Persona Studio [disabled "Coming soon"]**, sep, **Account** → `/settings/?s=account`, **Notifications** → `/settings/?s=notifications`, **Switch company** (trigger the existing CompanySwitcher, or a submenu — simplest: link/known affordance), **Help & guides** → `/help/`, sep, **Log out** → `onSelect: logout`. Use `MenuItem.disabled` for the coming-soon entries so they're inert.
- [ ] **Step 3:** Create `app/help/page.tsx` (`"use client"`) — a Help & guides index rendering `<Markdown text={HELP_MD} />` (static guide content; a few sections matching `nRHse`), with an article view for `ipDJM` if a `?a=` param selects one (keep simple: static guides). It auto-gets Shell chrome (not in bare/own lists). Optionally add a `/help` nav entry.
- [ ] **Step 4:** Append v2 CSS for the profile menu + help page; reuse `.menu`/`.mi`/`.md`; NO dead CSS.
- [ ] **Step 5: Verify** tsc + build. Report + confirm the dropdown opens with the right items, Persona/Studio inert (Review Focus #5), Account/Notifications/Help navigate, Log out works, `/help` renders.
- [ ] **Step 6: Commit** `feat(web): profile-menu dropdown + Help & guides page`.

---

## Self-review notes
- Spec coverage: B4 SMTP = Tasks 1-2; B4 email channel = Task 2; Email section = Task 3; B2 Account polish + B3 Notifications tile = Task 4; B1 profile menu + B5 Help = Task 5. Matches the design's Tier B.
- Backend (1-2) = `pytest` TDD with `smtplib`/sender MOCKED (never sends real email); frontend (3-5) = `tsc`+`build`+manual.
- Shared files: `app/settings/page.tsx` (T3 Email section, T4 Account — different sections, serial); `globals.css` (serial, additive); `notify.py` (T2 only). No cross-task producer/consumer except T3/T4 consume Task-1/2 endpoints.
- Review Focus: 5 items pinned (password leak #1→T1; send-failure #2→T1; unconfigured no-op #3→T2; prefs honored #4→T2; coming-soon inert #5→T4/T5).
- NO-DEAD-CSS enforced per frontend task (the recurring finding).
