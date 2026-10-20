# Tier A — Finish ⌘K (Ask Chief of Staff) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the ⌘K palette's "Ask Chief of Staff" return a real inline answer with cited cross-surface sources, show real AI health, and enable RECENT/@helper/#chat modes.

**Architecture:** New backend `POST /api/ask` — async FastAPI endpoint that gathers candidate context from KB + Inbox + Plan + Docs (a new `ask.py` retrieval service), composes a short grounded answer via the existing engine seam (synthetic `ChatContext`, like `tune._ask_json`), and returns `{answer, sources, tokens, cost_usd, ms}`. A cheap `ai_status` field is added to `GET /api/overview`. The already-shipped `CommandPalette` is wired to render the inline answer + AI-status + RECENT/@/# modes.

**Tech Stack:** FastAPI + SQLAlchemy (async route), existing `engines/` + `kb.py` + `board.py` + `plan.py` + `docs.py`; `pytest` (asyncio_mode=auto) for backend. Next.js/React + custom CSS for the palette (no web test harness → `tsc`+`build`+manual).

**Spec:** `docs/superpowers/specs/2026-10-21-omilo-backend-integration-gaps-design.md`

## Global Constraints

- **No breaking changes to existing endpoints.** `ai_status` is an ADDED field on `/overview` (propagates to `/api/system` for free since both return `overview(...)`).
- **`/api/ask` MUST be `async def`** and award the engine via `await get_engine(cfg).chat(ctx)` (copy the `tune._ask_json` / `ai_check` pattern). It must NOT spin up a full agent/task run.
- **`ai_status` must be CHEAP** — derive from `harness.pool_summary()` reading only `{ready,total}` (DB-only); do NOT trigger `cli_version()`/`find_cli()` subprocess on the hot `/overview` path.
- Backend: new endpoints get `pytest` coverage; run `cd apps/api && pytest`. Secrets/audit follow house style (`S.audit(...)`).
- Frontend: verify `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`; no dead CSS.
- Source shape is uniform across surfaces: `{title: str, ref: str, url: str|None, surface: "kb"|"inbox"|"plan"|"docs", score: float}`.

## Review Focus

1. **No AI configured/available** → `/api/ask` returns **503** with a reason; palette renders the "AI unavailable" state (pen `y59pKp`), never a hang or 500. → Task 2 + Task 4.
2. **Empty/whitespace query** → `/api/ask` returns **422** (Pydantic min_length) before any engine call. → Task 2.
3. **A retrieval surface is empty** (no KB sources / no goals / no docs) → ask still answers from whatever surfaces returned hits; zero total hits still returns an answer (or a graceful "nothing found" answer), never crashes. → Task 1.
4. **`ai_status` cost** → computing it must not run a subprocess; `/overview` latency unchanged. → Task 3.
5. **Slow answer** → palette shows a loading state while awaiting `/ask` and Esc/close cancels cleanly; the palette input isn't frozen. → Task 4.

---

## File Structure

- Create `apps/api/omilo_api/ask.py` — cross-surface retrieval + answer composition service.
- Modify `apps/api/omilo_api/routers/api.py` — add `AskIn` model + `POST /api/ask`; add `ai_status` to `overview()`.
- Create `apps/api/tests/test_ask.py` — pytest for retrieval, endpoint, ai_status.
- Modify `apps/web/components/CommandPalette.tsx` — inline answer, AI-unavailable, AI-status, RECENT/@/#.
- Modify `apps/web/lib/api.ts` and/or `apps/web/components/Shell.tsx` — add `ai_status` to the `Overview` type; add an `AskResult` type.

---

### Task 1: Cross-surface retrieval service

**Files:**
- Create: `apps/api/omilo_api/ask.py`
- Test: `apps/api/tests/test_ask.py`

**Interfaces:**
- Produces:
  - `Source = TypedDict("Source", {"title": str, "ref": str, "url": str|None, "surface": str, "score": float, "text": str})`
  - `def retrieve(db: Session, q: str, k: int = 8) -> list[Source]` — query KB (`kb.search(db, q, k, via="ask", log_it=False)`), Inbox (open `InboxItem` matching q), Plan (`plan.goals_for_prompt(db)` filtered by q), Docs (`docs.search(db, q, k)`), normalize each hit to `Source` with its `surface`, merge, sort by `score` desc, return top `k`. KB hits map `title/ref/url/score/text` directly; inbox `surface="inbox"` (ref=item id, title=item title); plan `surface="plan"` (ref=goal id); docs `surface="docs"` (ref=path, title, text=snippet).
- Consumes: `kb.search` (returns `{"results":[{title,ref,url,text,score,kind,...}], ...}`), `plan.goals_for_prompt` (`[{id,title,target,due}]`), `docs.search` (`[{path,title,score,snippet}]`), `board.build` or a direct `select(InboxItem).where(status=="open")` for inbox.

- [ ] **Step 1: Write failing tests** in `tests/test_ask.py`:
  - `test_retrieve_returns_kb_sources` — seed a KB note source containing a keyword via `session_scope()` (or reuse the `owner` fixture's company), call `ask.retrieve(db, "<keyword>", 8)`, assert ≥1 result with `surface=="kb"` and the uniform `Source` keys present.
  - `test_retrieve_includes_other_surfaces` — seed an open `InboxItem` and a `Goal` whose title contains a keyword; assert `retrieve` returns results with `surface` in `{"inbox","plan"}` for that keyword.
  - `test_retrieve_empty_surfaces_no_crash` — query a nonsense string on an otherwise-seeded company; assert it returns a `list` (possibly empty), does not raise.
  - `test_retrieve_capped_and_sorted` — assert `len(result) <= k` and scores are non-increasing.
- [ ] **Step 2: Run** `cd apps/api && pytest tests/test_ask.py -v` — expect FAIL (module/func missing). (Requires `make db` running.)
- [ ] **Step 3: Implement** `Source` + `retrieve(db, q, k)` in `ask.py` per the Interfaces block. Normalize each surface's native shape into `Source`; guard each surface read in its own try/except so one empty/failing surface doesn't sink the others.
- [ ] **Step 4: Run** `pytest tests/test_ask.py -v` — expect PASS.
- [ ] **Step 5: Commit** `feat(api): cross-surface ask retrieval (kb+inbox+plan+docs)`.

### Task 2: `POST /api/ask` endpoint

**Files:**
- Modify: `apps/api/omilo_api/ask.py` (add `answer(...)`)
- Modify: `apps/api/omilo_api/routers/api.py` (add `AskIn` + endpoint)
- Test: `apps/api/tests/test_ask.py`

**Interfaces:**
- Consumes: `retrieve(db, q, k)` (Task 1); `get_engine(cfg)` + `ChatContext` + `EngineResult` from `engines`; the active engine config (resolve the company/Chief-of-Staff engine config the way `tune.py` does).
- Produces:
  - `async def answer(db: Session, q: str) -> dict` in `ask.py` → `{"answer": str, "sources": list[Source], "tokens": int, "cost_usd": float, "ms": int}`. Builds a synthetic `ChatContext(thread_id="ask", scope="staff", is_chief=True, history=[{"role":"owner","text": <q + rendered sources>}], shared=True, engine_config=cfg)`, `res = await get_engine(cfg).chat(ctx)`, returns `res.text` as `answer` with the `sources` used + `res.tokens`/`res.cost_usd` + elapsed ms. Raises a domain error when no usable engine (so the route maps it to 503).
  - Route: `class AskIn(BaseModel): q: str = Field(min_length=1, max_length=2000)` ; `@router.post("/ask") async def ask(body: AskIn, db=Depends(get_db), user=Depends(current_user))` → returns `await ask.answer(db, body.q)`; on "no engine available" return **HTTP 503** `{"detail": "AI is unavailable"}`. Audit via `S.audit(db, user.id, "ask", "", q=body.q)`.

- [ ] **Step 1: Write failing tests** (use the `owner` httpx client fixture):
  - `test_ask_returns_answer_and_sources` — the test company runs the **fake engine**; `r = owner.post("/api/ask", json={"q":"what is waiting on me"})`; assert `r.status_code==200`, body has keys `answer, sources, tokens, cost_usd, ms`, `answer` is a non-empty str, `sources` is a list.
  - `test_ask_empty_query_422` — `owner.post("/api/ask", json={"q":"  "})` → but note Pydantic min_length counts whitespace; assert the endpoint rejects blank: strip in the model validator so `"   "` → 422 (add a `@field_validator` that strips and enforces non-empty). Assert `status_code==422`.
  - `test_ask_ai_unavailable_503` — force no usable engine (e.g. monkeypatch `get_engine` to raise / return an engine whose `chat` signals unavailable, or set the company engine config to an unconfigured provider), assert `status_code==503`.
- [ ] **Step 2: Run** `pytest tests/test_ask.py -v` — expect the new tests FAIL.
- [ ] **Step 3: Implement** `answer(...)` in `ask.py` and the `AskIn`+`ask` route in `routers/api.py`. Resolve engine config via the same path `tune.py` uses; map the no-engine/unavailable case to a `503` in the route (catch the domain error, or check availability before awaiting).
- [ ] **Step 4: Run** `pytest tests/test_ask.py -v` — expect PASS (all).
- [ ] **Step 5: Commit** `feat(api): POST /api/ask — synchronous grounded answer with sources`.

### Task 3: `ai_status` on `/api/overview`

**Files:**
- Modify: `apps/api/omilo_api/routers/api.py` (`overview()` ~L80; small helper, possibly in `harness.py`)
- Test: `apps/api/tests/test_ask.py` (or a new `test_overview.py`)

**Interfaces:**
- Produces: an `ai_status` key on the `/overview` (and therefore `/system`) response: `{"ok": bool, "label": str, "detail": str|None}`. Derived **cheaply** from `harness.pool_summary()` reading only `ready`/`total` (DB-only) — `ok = ready > 0`, `label` e.g. `"Claude Code pool"` / `"No AI accounts"`. Add a helper `def ai_status(db) -> dict` (in `harness.py` or near `overview`) that does the cheap DB read and does NOT call `cli_version()`/`find_cli()`.
- Consumes: `harness.pool_summary()` (read only ready/total) or a direct `select(HarnessAccount)` count.

- [ ] **Step 1: Write failing tests:**
  - `test_overview_has_ai_status` — `r = owner.get("/api/overview")`; assert `"ai_status" in r.json()` and it has keys `ok, label`.
  - `test_ai_status_reflects_pool` — with the seeded fake-engine company, assert `ai_status.ok` is a bool and consistent with whether any harness account/engine is ready (assert the shape + type; exact truth depends on seed).
  - `test_ai_status_is_cheap` — assert computing it does not shell out: monkeypatch `harness.cli_version` / `harness.find_cli` to raise, then `owner.get("/api/overview")` still returns 200 with `ai_status` (proves the hot path never calls them).
- [ ] **Step 2: Run** `pytest -k ai_status -v` — expect FAIL.
- [ ] **Step 3: Implement** the `ai_status(db)` helper (cheap) and add the field in `overview()` at `routers/api.py:80`.
- [ ] **Step 4: Run** `pytest -k "ai_status or overview" -v` — expect PASS.
- [ ] **Step 5: Commit** `feat(api): ai_status on overview (cheap pool readiness)`.

### Task 4: Palette — inline answer, AI-unavailable, AI-status

**Files:**
- Modify: `apps/web/components/CommandPalette.tsx`
- Modify: `apps/web/lib/api.ts` (add `AskResult` type) and the `Overview` type (add `ai_status`) — the `Overview` type lives in `lib/api.ts`; `components/Shell.tsx` consumes it.

**Interfaces:**
- Consumes: `POST /ask` → `AskResult = { answer: string; sources: {title:string; ref:string; url?:string; surface:string; score:number}[]; tokens:number; cost_usd:number; ms:number }`; `overview.ai_status = { ok:boolean; label:string; detail?:string }`.
- Replaces the current ask-mode behavior (CommandPalette.tsx ~L129 `// GAP` — today opens a chat thread) with: call `api<AskResult>("/ask", {body:{q}})`, render the inline answer state (pen `JxYA6`): answer text + a Sources list (each source title + surface chip, link if `url`) + a meta line (`Answered in {ms}ms · {tokens} tokens · ${cost_usd}`), plus actions and **⌘↵ "continue in chat"** (the existing open-thread path) as the escalation. On a **503** (or network error) render the **AI-unavailable** state (pen `y59pKp`). Show a **loading** state while awaiting; Esc/close cancels.
- The footer AI-status line (CommandPalette.tsx ~L277, currently hardcoded) reads `overview.ai_status` (`ok`→label; not-ok→"AI unavailable").

- [ ] **Step 1:** Add `AskResult` to `lib/api.ts`; add `ai_status?: {ok:boolean;label:string;detail?:string}` to the `Overview` type.
- [ ] **Step 2:** In `CommandPalette.tsx` ask mode, replace the thread-bounce with the `/ask` call + loading/answer/unavailable states per the Interfaces block; keep ⌘↵ continue-in-chat. Remove the now-stale `// GAP` comments (129, and 276/277 once the status line reads real data). Reference pen `JxYA6` (answer) and `y59pKp` (unavailable) for layout.
- [ ] **Step 3:** Point the footer AI-status line at `overview.ai_status`.
- [ ] **Step 4: Verify** `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Manual (Review Focus #1, #5): ask returns an inline answer with sources; a 503 shows AI-unavailable; a slow answer shows loading and Esc cancels. No dead CSS (grep new classes).
- [ ] **Step 5: Commit** `feat(web): ⌘K inline Ask answer + real AI-status`.

### Task 5: Palette — RECENT / @helper / #chat modes

**Files:**
- Modify: `apps/web/components/CommandPalette.tsx`

**Interfaces:**
- Consumes existing endpoints: `GET /threads` (recent threads), `GET /staff` (helpers for `@`), `GET /threads` group/chat scope (for `#`). No backend change.

- [ ] **Step 1:** Add a RECENT group to the default results sourced from `GET /threads` (most-recent N, open the thread on select). Remove the `// GAP` RECENT comment (nav.ts/CommandPalette header note).
- [ ] **Step 2:** Wire `@` prefix → filter `GET /staff` (select → open that helper's chat / mention); `#` prefix → filter chats from `GET /threads`. Keep them lazy (fetch on first use), degrade gracefully if a fetch fails.
- [ ] **Step 3: Verify** `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`. Manual: RECENT shows recent threads; `@` filters helpers; `#` filters chats; keyboard nav still works. No dead CSS.
- [ ] **Step 4: Commit** `feat(web): ⌘K RECENT / @helper / #chat modes`.

---

## Self-review notes
- Spec coverage: A1 (`/ask` cross-surface) = Tasks 1-2; A2 (`ai_status`) = Task 3; A3 (RECENT/@/#) = Task 5; palette inline-answer render = Task 4. Matches the design's Tier A.
- Backend tasks (1-3) use real `pytest` TDD (RED→GREEN) against the `owner` fixture / `session_scope()`; frontend tasks (4-5) use `tsc`+`build`+manual (no web harness) per the established pattern.
- Interface consistency: `Source`/`AskResult` shape identical across `ask.py`, the route, and `lib/api.ts`; `ai_status` shape identical in Task 3 and Task 4.
- Review Focus: 5 items pinned — #1/#5 → Task 4 manual, #2 → Task 2 test, #3 → Task 1 test, #4 → Task 3 test.
- Proportion: plan pins the new signatures/shapes/tests and references existing modules by name rather than reproducing them.
