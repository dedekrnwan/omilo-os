# Connector Marketplace (v1, instance side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give non-IT owners a GitHub-indexed marketplace of connectors they connect in a few taps, whose declarative actions become helper tools (`mcp__<id>__<action>`) — all on the self-hosted instance, against a pluggable broker interface.

**Architecture:** A `pieces` module adds (1) a `CatalogPiece` table filled by a GitHub indexer that mirrors the existing `talent.py` fetch pattern, (2) a declarative runtime that compiles a piece's actions into MCP tools and executes them as templated, host-allowlisted HTTP calls using the owner's stored token, served at a new `POST /mcp/piece/{slug}` endpoint and wired into `claude_code.plan()` as `kind=="piece"` connectors, and (3) a connect flow behind a `BrokerClient` protocol (Plan 1 ships `DevBroker`; the real OAuth broker is a separate plan). The marketplace UI replaces the current connectors page.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Pydantic, httpx, PyYAML (API); Next.js/React/TypeScript (web). Tests: pytest (+ respx/httpmock for HTTP), `tsc --noEmit` for web.

**Spec:** `docs/connector-marketplace-design.md`

## Global Constraints

- Reuse, do not replace: `Connector` model (`models.py:275`), `security.py` encrypt/decrypt, `capabilities.py` resource assembly and the `mcp__<id>__<tool>` contract, `claude_code.plan()` server-dict shape `{type,url,headers}` / `{command,args,env}`.
- Pieces are interpreted data, never executed code (the `kind=="mcp-server"` escape hatch is out of scope for v1).
- Every action request host MUST be restricted to the manifest's `auth.provider` domain(s); templated/variable hosts are rejected.
- Community `logo.svg` is served sanitized via `<img>` from a proxied endpoint, never inlined.
- The word "MCP" (and URLs/keys/commands) never appears in the marketplace UI.
- The catalog is a **file-based index** (built in Task 2), mirroring `talent.py`: `pieces.root()=data_dir/"pieces"`, `index_path()=root()/"index.json"`; readers `pieces.catalog()` / `pieces.get_piece(slug)`. No new DB table, no migration. `Connector.kind` already exists; `"piece"` is a new value, no schema change. Connected connectors are per-company `Connector` rows.
- Tests: the suite has only `base_url` and `owner` (an authenticated API client) fixtures — there is **no `db`/`client` fixture**. Endpoint tests use `owner` (e.g. `owner.get("/api/...")`, pattern in `tests/test_kb.py`); API routes are mounted under `/api`. Pure/file-based units run with no fixture.
- MVP catalog ships these six slugs: `whatsapp, instagram, gmail, google-calendar, google-sheets, facebook`.
- Token storage reuses `Connector.secrets_enc` (encrypted JSON); pieces store `{"token": {...}}` there.
- The API venv lacks `pgvector` locally and DB-bound tests need Postgres; tests are authored TDD-style and run in CI/a provisioned env. Non-DB units (validation, templating, host-allowlist, tool compilation) must be tested without a DB.

## Review Focus

- **Malicious/typo manifest with an off-provider action URL** → runtime must refuse the call, not issue it with the owner's token (SSRF). *(Task 3)*
- **Upstream token expired/revoked mid-use** → action surfaces a `needs_reconnect` signal; UI shows "Needs reconnect"; nothing crashes. *(Task 3 runtime signal, Task 6 UI)*
- **GitHub pieces repo unreachable during reindex** → the last good catalog is retained; marketplace keeps working. *(Task 2)*
- **An `ask` piece action is never auto-callable** → it stays denied in `plan()` until approved for the execution task. *(Task 4)*
- **A connected piece is removed from the repo on reindex** → its index entry is marked `missing`; its connected `Connector` degrades to `needs_reconnect` rather than vanishing or erroring. *(Task 2 + Task 5)*

---

### Task 1: Manifest schema + validation (`pieces.py`, no DB)

**Files:**
- Create: `apps/api/omilo_api/pieces.py`
- Test: `apps/api/tests/test_pieces.py`

**Interfaces:**
- Produces: `validate_manifest(data: dict) -> list[str]` (empty list = valid). Manifest shape:
  `{id: slug, label, category, description, auth: {type:"oauth2", provider, scopes: [str]}, actions: [{name: slug, label, approval: "auto"|"ask", http: {method, url, auth:"bearer", body?: dict}, inputs: [{name, type, required?: bool}]}]}`.
- Produces: `SLUG` regex (reuse the `^[a-z0-9][a-z0-9-]{0,40}$` from `capabilities.py:SLUG`).

- [ ] **Step 1: Write failing tests**

```python
def test_valid_manifest_has_no_errors():
    assert validate_manifest(GMAIL_MANIFEST) == []

def test_missing_id_and_bad_action_approval_reported():
    bad = {**GMAIL_MANIFEST, "id": "", "actions": [{**GMAIL_MANIFEST["actions"][0], "approval": "sometimes"}]}
    errs = validate_manifest(bad)
    assert any("id" in e for e in errs) and any("approval" in e for e in errs)

def test_action_url_must_be_absolute_https():
    bad = {**GMAIL_MANIFEST, "actions": [{**GMAIL_MANIFEST["actions"][0], "http": {"method": "POST", "url": "/relative", "auth": "bearer"}}]}
    assert any("url" in e for e in validate_manifest(bad))
```
(`GMAIL_MANIFEST` is a module-level fixture in the test matching the shape above.)

- [ ] **Step 2: Run tests, verify they fail** — `pytest apps/api/tests/test_pieces.py -v` → FAIL (`validate_manifest` undefined).
- [ ] **Step 3: Implement `validate_manifest(data: dict) -> list[str]`** in `pieces.py`: check slug `id`, non-empty `label`/`category`, `auth.type=="oauth2"` with non-empty `provider` and `scopes`, each action's slug `name`, `approval in {"auto","ask"}`, `http.method` in a small verb set, `http.url` absolute `https://`, `http.auth=="bearer"`, inputs well-formed. Collect messages; don't raise.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(pieces): manifest schema validation`.

---

### Task 2: GitHub catalog indexer + `CatalogPiece` model

**Files:**
- Modify: `apps/api/omilo_api/models.py` (add `CatalogPiece`)
- Modify: `apps/api/omilo_api/pieces.py` (add fetch/reindex)
- Test: `apps/api/tests/test_pieces_index.py`

**Interfaces:**
- Consumes: `validate_manifest` (Task 1); `talent.py` fetch/extract pattern (`talent.py:98 fetch`, `:131 _extract`) as the template.
- Produces: `class CatalogPiece(Base)` — columns: `slug: str (PK, 64)`, `label`, `category`, `description: Text`, `logo_rel: str` (repo-relative logo path), `manifest: JSON`, `repo_ref: str`, `status: str` (`ok`|`invalid`|`missing`), `error: Text`, `updated_at: datetime`.
- Produces: `fetch(dest: Path | None = None) -> Path` (downloads/overlays the pieces repo; honors `OMILO_PIECES_SOURCE` local checkout first, then tarball — mirror `talent.fetch`); `reindex(db) -> dict` returns `{"ok": n, "invalid": n, "missing": n}`.
- Constant: `PIECES_REPO` (default `omilo/pieces`), overridable via env.

- [ ] **Step 1: Write failing tests** (use a temp dir as `OMILO_PIECES_SOURCE`; `reindex` takes a `Session` — gate DB assertions behind the conftest DB fixture, keep parsing assertions DB-free by testing a `_parse_source(path) -> list[dict]` helper directly):

```python
def test_parse_source_reads_valid_and_flags_invalid(tmp_path):
    _write_piece(tmp_path, "gmail", GMAIL_MANIFEST)          # pieces/gmail/piece.yaml + logo.svg
    _write_piece(tmp_path, "bad", {"id": ""})               # invalid
    parsed = _parse_source(tmp_path)
    by = {p["slug"]: p for p in parsed}
    assert by["gmail"]["status"] == "ok" and by["bad"]["status"] == "invalid"

def test_reindex_marks_removed_piece_missing(db):
    # gmail present then absent across two reindexes -> status flips to "missing", row kept
    ...
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `_parse_source(path) -> list[dict]` (walk `pieces/*/piece.yaml`, load YAML, run `validate_manifest`, set `status`), `fetch(...)` (reuse talent's source-order + `_extract`), and `reindex(db)` (upsert by slug; slugs absent from the source that still exist → `status="missing"`; on `fetch` failure, log and leave existing rows untouched). Register `CatalogPiece` so `create_all` builds it.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(pieces): GitHub catalog indexer and CatalogPiece`.

---

### Task 3: Declarative runtime — compile + execute actions (no DB)

**Files:**
- Modify: `apps/api/omilo_api/pieces.py`
- Test: `apps/api/tests/test_pieces_runtime.py` (use `respx` or `httpmock` to stub httpx)

**Interfaces:**
- Consumes: a validated `manifest: dict` (Task 1).
- Produces: `action_tools(manifest: dict) -> list[dict]` → MCP tool defs `[{"name": action.name, "description": action.label, "inputSchema": {...from inputs...}}]`.
- Produces: `run_action(manifest: dict, action: str, args: dict, token: str) -> tuple[str, dict]` → `(summary_text, {"status", "needs_reconnect": bool, "raw"?})`.
- Produces: `provider_hosts(manifest) -> set[str]` and internal `_check_host(url, manifest)`.

- [ ] **Step 1: Write failing tests**

```python
def test_action_tools_builds_inputschema_from_inputs():
    tools = action_tools(GMAIL_MANIFEST)
    t = next(t for t in tools if t["name"] == "send_email")
    assert t["inputSchema"]["required"] == ["to", "message"]

def test_run_action_templates_body_and_injects_bearer(respx_mock):
    route = respx_mock.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send").respond(200, json={"id": "x"})
    text, meta = run_action(GMAIL_MANIFEST, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")
    assert route.calls.last.request.headers["authorization"] == "Bearer TOK"
    assert meta["status"] == 200 and meta["needs_reconnect"] is False

def test_run_action_rejects_off_provider_host():
    tampered = _with_action_url(GMAIL_MANIFEST, "send_email", "https://evil.example.com/x")
    with pytest.raises(ValueError):
        run_action(tampered, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")

def test_run_action_flags_needs_reconnect_on_401(respx_mock):
    respx_mock.post(url__regex=r"https://gmail\.googleapis\.com/.*").respond(401)
    _, meta = run_action(GMAIL_MANIFEST, "send_email", {"to": "a@b.com", "message": "hi"}, token="TOK")
    assert meta["needs_reconnect"] is True
```

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `action_tools` (map `inputs` → JSON Schema: types + `required`), `provider_hosts` (derive allowed hostnames from each action's declared `http.url` whose host must match the provider; reject templated hosts), `_check_host`, and `run_action` (template `http.url`/`http.body` from `args` with a minimal safe substitution — support `{{ var }}` and a fixed allowlist of helpers like `base64(...)`; never template the host; inject `Authorization: Bearer <token>`; call via httpx; map `401/403` → `needs_reconnect=True`; summarize response).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(pieces): declarative action runtime with host allowlist`.

---

### Task 4: Piece MCP endpoint + `plan()` wiring

**Files:**
- Modify: `apps/api/omilo_api/mcp_server.py` (add `POST /mcp/piece/{slug}`; reuse the JSON-RPC `_handle`/auth used by `POST /mcp:449`)
- Modify: `apps/api/omilo_api/capabilities.py` (`connector_runtime` emits a `piece` runtime dict; `resolve` includes piece connectors)
- Modify: `apps/api/omilo_api/engines/claude_code.py` (`plan()` `kind=="piece"` branch, near `:44-49`)
- Modify: `apps/api/omilo_api/config.py` (add `piece_mcp_url(slug) -> str`)
- Test: `apps/api/tests/test_pieces_plan.py`

**Interfaces:**
- Consumes: `action_tools`, `run_action` (Task 3); `pieces.get_piece(slug)` (Task 2, file-based); `connector_secrets` (`capabilities.py:61`).
- Produces: `piece_mcp_url(slug: str) -> str` (e.g. `{mcp_url_base}/piece/{slug}`).
- Produces: `connector_runtime(c)` returns, for `c.kind=="piece"`, `{"id","label","kind":"piece","url": piece_mcp_url(c.id),"headers": {...bearer at run time},"approval": c.approval}` (url/headers populated by `plan()` like the http case).
- Produces (unchanged contract): `plan()` adds `servers[c["id"]] = {"type":"http","url": piece_mcp_url(c["id"]),"headers":{"Authorization": f"Bearer {cfg['_mcp_token']}"}}` and applies the same `auto`/`allow_connectors` tool-allow logic (`claude_code.py:49`).

- [ ] **Step 1: Write failing tests**

```python
def test_plan_adds_http_server_for_connected_piece():
    res = _resources(connectors=[{"id": "gmail", "label": "Gmail", "kind": "piece", "approval": "auto", "url": "", "headers": {}, "command": "", "args": [], "env": {}}])
    servers, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)
    assert servers["gmail"]["type"] == "http" and servers["gmail"]["url"].endswith("/piece/gmail")

def test_ask_piece_tools_not_allowed_until_approved():
    res = _resources(connectors=[{"id": "gmail", "kind": "piece", "approval": "ask", ...}])
    servers, tools, _ = plan({"_mcp_url": "http://x/mcp", "_mcp_token": "T"}, res)
    assert "mcp__gmail" not in " ".join(tools)   # denied by dontAsk until request_action
```
(The `POST /mcp/piece/{slug}` JSON-RPC list/call test is DB-bound → authored here, gated on the conftest DB fixture; it asserts `tools/list` returns the piece's `action_tools` and `tools/call` routes to `run_action` with the decrypted token.)

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `piece_mcp_url` in config; the `POST /mcp/piece/{slug}` route (authenticate the staff MCP token as `POST /mcp` does; load the manifest via `pieces.get_piece(slug)`; `tools/list` → `action_tools`; `tools/call` → decrypt the connected `Connector.secrets_enc["token"]`, call `run_action`, and on `needs_reconnect` mark the `Connector`); the `connector_runtime` `piece` branch; the `plan()` `kind=="piece"` branch.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(pieces): MCP endpoint and engine wiring for piece connectors`.

---

### Task 5: Connect flow behind `BrokerClient` (+ `DevBroker`)

**Files:**
- Create: `apps/api/omilo_api/broker.py` (`BrokerClient` protocol + `DevBroker`)
- Modify: `apps/api/omilo_api/routers/api.py` (connect/poll/disconnect routes, near existing `/connectors:873`)
- Test: `apps/api/tests/test_pieces_connect.py`

**Interfaces:**
- Consumes: `pieces.get_piece(slug)` (Task 2, file-based); `set_connector_secrets`/`connector_secrets` (`capabilities.py:69/61`); `security.encrypt`; existing connector routes near `routers/api.py:873` (routes are under the `/api` prefix).
- Produces: `class BrokerClient(Protocol)` — `start_connect(manifest: dict) -> dict` (`{"auth_url": str, "state": str}`), `poll(state: str) -> dict | None` (`{"token": {...}}` when ready). `DevBroker` implements both for testing (returns a fixture token immediately; `auth_url` is a local stub page). The real `HttpBroker` is deferred to the broker plan.
- Produces: routes `POST /connectors/pieces/{slug}/connect` → `{auth_url, state}`; `GET /connectors/pieces/connect/{state}` → `{status: "pending"|"connected"}` (on connected, upserts a per-company `Connector(id=slug, kind="piece", label, approval from manifest default)` with the token stored encrypted via `set_connector_secrets`/`secrets_enc`); `DELETE /connectors/{id}` → local token clear (+ best-effort `broker.revoke`).

- [ ] **Step 1: Write failing tests** (DB-bound, gated on conftest fixture):

```python
def test_connect_creates_piece_connector(owner):
    # seed a "gmail" piece into the catalog index (write a source + pieces.reindex()) first
    state = owner.post("/api/connectors/pieces/gmail/connect").json()["state"]
    assert owner.get(f"/api/connectors/pieces/connect/{state}").json()["status"] == "connected"
    c = next(c for c in owner.get("/api/connectors").json() if c["id"] == "gmail")
    assert c["kind"] == "piece"                       # token stored encrypted server-side, never returned

def test_disconnect_removes_connector(owner):
    ...  # after connect, DELETE /api/connectors/gmail -> gmail no longer in /api/connectors
```
(The token-is-encrypted property is asserted at the storage layer via `connector_secrets`; the public connector view never returns the token.)

- [ ] **Step 2: Run tests, verify fail.**
- [ ] **Step 3: Implement** `BrokerClient`/`DevBroker`, and the three routes using `DevBroker` as the injected default. Approval default comes from the manifest's action defaults (connector-level `approval` = most-restrictive of its actions, or `ask` if any action is `ask`).
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `feat(pieces): connect/disconnect flow behind BrokerClient`.

---

### Task 6: Marketplace UI + `/catalog` route

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (add `GET /catalog`; add a sanitized logo-proxy route)
- Modify: `apps/web/app/connectors/page.tsx` (marketplace grid + connect/disconnect)
- Test: `apps/api/tests/test_catalog_route.py` (route); `tsc --noEmit` (web)

**Interfaces:**
- Consumes: `pieces.catalog()` (Task 2, file-based); connect routes (Task 5); `connector_public` for connected status.
- Produces: `GET /catalog` → `[{slug, label, category, logo_url, connected: bool, needs_reconnect: bool}]` (from `pieces.catalog()`; `connected`/`needs_reconnect` by joining the current company's `Connector` rows by id==slug).
- Produces: UI states per card — `Connect` / `Connected ✓ (Disconnect)` / `Needs reconnect (Reconnect)`.

- [ ] **Step 1: Write failing test**

```python
def test_catalog_lists_only_valid_pieces_with_connected_flag(owner):
    # seed the catalog index with one ok "gmail" + one invalid "bad" (source + pieces.reindex()), connect gmail
    rows = owner.get("/api/catalog").json()
    slugs = {r["slug"]: r for r in rows}
    assert "bad" not in slugs and slugs["gmail"]["connected"] is True
```

- [ ] **Step 2: Run test, verify fail.**
- [ ] **Step 3: Implement** `GET /catalog` and the logo-proxy (serve `logo.svg` with `Content-Type: image/svg+xml` + sanitize, same posture as `capabilities.serve_headers`). Then rewrite `connectors/page.tsx` as a category-grouped logo grid: `Connect` opens `auth_url` (new tab/popup) and polls `GET /connectors/pieces/connect/{state}` until `connected`, then refreshes; `Disconnect` calls `DELETE /connectors/{id}`; `Needs reconnect` reruns connect. No URLs/keys/MCP wording. Follow the antislop UI gate (`.agents/skills/antislop-ui`).
- [ ] **Step 4: Verify** — `pytest apps/api/tests/test_catalog_route.py -v` PASS; `cd apps/web && node_modules/.bin/tsc --noEmit` exit 0.
- [ ] **Step 5: Commit** — `feat(connectors): marketplace UI and /catalog route`.

---

## Follow-up (separate plan): Central OAuth broker

Out of scope here. A second plan covers the Omilo-operated broker service: registered OAuth apps per provider, public callback, NAT-safe instance-initiated polling, code→token exchange + refresh (holds client secret, streams-and-forgets), per-instance auth/tenancy — and replaces `DevBroker` with `HttpBroker` implementing the same `BrokerClient` protocol defined in Task 5. Everything above is testable without it.

## Self-Review

- **Spec coverage:** catalog/GitHub index → T2; declarative runtime/one-engine → T3+T4; marketplace UI/non-IT connect → T6+T5; reuse Connector/security/capabilities/mcp-prefix → T4/T5; SSRF + logo safety → T3/T6; approval gate survives → T4; broker (permanent, NAT-safe) → explicitly deferred to the follow-up plan with a `BrokerClient` seam in T5. MVP six slugs are catalog data, not code. v2 triggers correctly absent.
- **Type consistency:** `validate_manifest`/`_parse_source`/`reindex` (T1–T2); `action_tools`/`run_action` signatures identical in T3 and consumed verbatim in T4; `plan()` server dict matches `claude_code.py:46-48`; `BrokerClient` protocol defined once (T5) and referenced by the follow-up plan.
- **Review Focus:** off-provider URL (T3 test), token-expiry/`needs_reconnect` (T3 + T6), GitHub unreachable keeps last catalog (T2 implement note; add assertion in T2 if fetch stub fails), `ask` not auto-callable (T4 test), removed-piece→missing/needs_reconnect (T2 test + T5 handling). All owned.
- **Proportion:** six tasks, bodies only where an algorithm isn't determined by signature+tests; code blocks are test assertions and shapes, not implementations.
```
