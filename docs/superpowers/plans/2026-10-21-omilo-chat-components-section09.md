# Section 09 Chat Components — Pixel-Exact Reusable Standard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the pen Section 09 chat components the single, pixel-exact reusable standard, build the 4 partial ones, and have every chat surface (workspace, drawer, chat page, onboarding) render through it.

**Architecture:** Front-end only. The canonical library is `components/chat/blocks.tsx` (20 block renderers) + `components/chat/Reply.tsx` + their CSS in `app/globals.css`. Each renderer is restyled to match its pen reusable frame exactly; 4 partials are completed; the onboarding chat is converged onto the shared `Conversation → Reply → renderBlocks` pipeline and the duplicate legacy card variants in `Conversation.tsx` are retired.

**Tech Stack:** Next.js/React, custom CSS tokens (no Tailwind), Remix Icon. No web test harness → verify `./node_modules/.bin/tsc --noEmit` + `npm run build` + visual-vs-pen (`TakeScreenshot`).

**Spec:** `docs/superpowers/specs/2026-10-21-omilo-chat-components-section09-design.md`
**Design source (read-only, live):** pen.dev `omilo.pen` Section 09 (`roxVp`). Read with `mcp__pencil__execute`:
- filePath `/Users/dedekurniawan/.pencil/documents/89da3e61-94b0-4f58-9529-c66071175b31/omilo.pen`
- Dump a reusable frame's structure: `let r=[];Get(n=>{if(n.id==='<ID>'){(function w(x,d){r.push('  '.repeat(d)+x.type+(x.name?' ['+x.name+']':'')+(x.type==='text'&&x.content?' "'+String(x.content).slice(0,60)+'"':'')+(x.icon?' icon='+x.icon:'')+(x.fill&&typeof x.fill==='string'?' fill='+x.fill:''));if(d<9)(x.children||[]).forEach(c=>w(c,d+1));})(n,0);}return null;});Print(r.join('\n'));`
- `TakeScreenshot(['<ID>'])` for pixel reference. NEVER Read/Grep the `.pen` file.

## Global Constraints

- **No backend changes.** `message.blocks[]` already carries the fields (audit-confirmed). New optional fields (e.g. `code.diff`, `image.options`) are additive and the renderer MUST tolerate their absence (graceful fallback).
- **Preserve all interactive behavior:** every block's existing callbacks (`onPick`/`onDecide`/`onProposal`/`onAnswer`/`onStop`/feedback) keep working after the restyle.
- **Icons:** the pen uses `lucide` names; map each to the nearest Remix Icon (the app's system) — no broken/empty glyphs. Keep ONE icon system.
- **Pixel-exact** to the cited pen reusable frame (fonts `$font-sans/display/mono`, the token colors, spacing, radii). Use existing CSS tokens (`--ink`,`--muted`,`--faint`,`--soft`,`--line`,`--helper-brand`,`--ok`,`--bad`,`--r-*`, etc.).
- Additive CSS; **NO dead CSS** (grep each new class). Reuse existing `.reply-*`/`.blk-*`/chat classes; rename cleanly (remove orphaned old rules).
- Verify each task: `./node_modules/.bin/tsc --noEmit` exit 0 + `npm run build`.

## Review Focus

Manual/visual checks pinned to the owning task (no unit harness):
1. **Interactive blocks still work** post-restyle — choices/proposal/access/confirmation/approval/feedback fire their callbacks. → each task that touches them.
2. **Graceful fallback for optional fields** — Code with no diff → plain highlighted code; Image with no options → single image; Streaming with no token count → no empty status. → Task 3, 5.
3. **Icon mapping** — no missing/placeholder icons after lucide→Remix. → all.
4. **Onboarding flow intact** — the interview stepper/answer/submit still works after the chat turns adopt the standard. → Task 6.
5. **Single renderer** — after retiring `Conversation.tsx` legacy card variants, all agent content routes through `Reply`/`renderBlocks`; no duplicate/dead renderers or CSS. → Task 6.

---

## File Structure
Tasks 1–5 edit `components/chat/blocks.tsx` and/or `components/chat/Reply.tsx` + append/adjust `app/globals.css` (shared, serial under SDD). Task 6 edits `components/Conversation.tsx`, `app/onboarding/page.tsx` (+ `components/onboarding/*`) + `globals.css`.

---

### Task 1: Reply chrome — Message, Hover actions, Feedback bar, Usage meter
**Files:** `components/chat/Reply.tsx`, `components/chat/blocks.tsx` (UsageMeterBlock `:653`), `app/globals.css`. Pen: Message `U2Lljm`, Hover actions `B0Ksmn`, Feedback bar `ihBIG`+`MJprW`, Usage meter `lrtjv`.
- [ ] Step 1: Dump + screenshot the 4 pen frames.
- [ ] Step 2: Restyle the Reply shell to the Message frame (avatar ref + Body: Who row [name 13/600, role 12 muted, time 12 faint] + Content slot + Footer slot). Restyle HoverActions to the pen hover bar (surface, line-strong border, soft shadow, icon buttons Copy/Retry/Edit request/Pin to Docs/Share · sep · More) — keep existing copy/quote/re-ask callbacks, add the missing icon buttons as no-op-safe where a handler doesn't exist yet (wire to existing where present). Restyle FeedbackBar: idle ("Was this useful?" + thumbs up/down) and expanded ("What went wrong?" + reason pills [Wrong facts/Too long/Ignored a rule/Wrong tone, selected = `--primary`] + note input + Save as lesson) — keep the existing feedback callback. Restyle UsageMeterBlock to the meter row (top 1px line; dot + "Claude Code pool · cloud" · tokens mono · cost mono · time mono · spacer · "of today" + mini track). 
- [ ] Step 3: Append/adjust CSS; NO dead CSS.
- [ ] Step 4: `tsc`+`build`. Screenshot the running reply shell is not required; confirm structure matches + callbacks intact; report.
- [ ] Step 5: Commit `feat(web): chat Message/Hover/Feedback/Usage match Section 09`.

### Task 2: Info blocks — Reasoning, Todos, Sources, Document
**Files:** `components/chat/blocks.tsx` (ReasoningBlock `:385`, TodosBlock `:402`, SourcesBlock `:607`, DocumentBlock `:683`), `app/globals.css`. Pen: Reasoning `HwExk`/`mEXXW`, Todos `LZwtY`, Sources `yp4g8`, Document `K4wTQ`.
- [ ] Step 1: Dump + screenshot the pen frames.
- [ ] Step 2: Restyle to match exactly: **Reasoning** collapsed pill ("brain" icon + "Thought for 12s" + chevron) / open (head + left-border lines list). **Todos** card (Plan head + "N of M done" + Add step; rows: done=green check muted text, active=spinner + soft bg + ink, pending=circle faint + grip). **Sources** (inline numbered pills "1/2/3 · label"; expanded list rows: number mono + icon + title/subtitle + arrow). **Document** (peek thumbnail 92×116 with line placeholders + title + Chip + meta + snippet + Open in Docs/Download). Keep click/preview callbacks.
- [ ] Step 3: CSS, NO dead CSS.
- [ ] Step 4: `tsc`+`build`; report.
- [ ] Step 5: Commit `feat(web): chat Reasoning/Todos/Sources/Document match Section 09`.

### Task 3: Markdown + Code (with diff + copy/apply)
**Files:** `components/chat/blocks.tsx` (MarkdownBlock `:426`, CodeBlock `:436`), `app/globals.css`, possibly `components/Markdown.tsx`. Pen: Markdown `c0DKyw`, Code `Jxjui`.
- [ ] Step 1: Dump + screenshot.
- [ ] Step 2: **Markdown** — confirm headings/bullets/inline-code/table/quote match the pen type scale (display heading, bullets, inline `code` chip, table with soft header row, left-border quote). **Code (gap)** — build the dark card: header (`file-code` icon + filename mono + lang + spacer + Copy + **Apply**) and, when the block carries a `diff` (optional new field: array of `{ n, sign: " "|"+"|"-", text }` or similar — define + tolerate absence), render diff lines (line-number faint + `+` green bg `#15803D33` / `-` red bg `#DC262633` / context) in the dark theme; with NO diff, keep the existing highlighted fenced code. Copy keeps working; Apply is wired if a handler exists else a safe no-op/hidden.
- [ ] Step 3: CSS, NO dead CSS.
- [ ] Step 4: `tsc`+`build`; confirm plain-code fallback (Review Focus #2); report.
- [ ] Step 5: Commit `feat(web): chat Markdown + Code (diff/apply) match Section 09`.

### Task 4: Decision blocks — Action card (+ buttons), Confirmation, Task, Approval-while-streaming
**Files:** `components/chat/blocks.tsx` (ActionCardBlock `:452`, ConfirmationBlock `:484`, TaskBlock `:574`, StreamingApprovalBlock `:523`), `app/globals.css`. Pen: Action card `pT9bB`, Confirmation `T4FR5`/`kMvfJ`, Task `CGKLK`, Approval `RvtWB`.
- [ ] Step 1: Dump + screenshot.
- [ ] Step 2: **Action card (gap)** — restyle to the pen (Top: tile icon + title + target mono + "Needs you" chip; Details soft box with icon rows; **Actions: primary `Open PR` (check) / secondary `Change something` (pencil) / quiet `Not now`**) wired to the block's decision callback (reuse the proposal/confirmation decision path; add the three-way handler). **Confirmation** — asking state (tile `--bad-tint`/`send` icon + bold ask + body + Cancel/Send + "asked · time") and answered state (check + "You approved…" + "Undo for 5 min") — keep callback. **Task** — card (status icon + "Task · handed to X" + chip; title; meta row owner/due/branch/goal; progress track + "N of M steps" + Open job). **Approval-while-streaming** — intro + bordered Ask (helper-brand) with pause head + quote + Looks-right/Change/Skip + dimmed "steps left". Keep all callbacks.
- [ ] Step 3: CSS, NO dead CSS.
- [ ] Step 4: `tsc`+`build`; confirm the three Action-card actions fire the decision callback (Review Focus #1); report.
- [ ] Step 5: Commit `feat(web): chat Action card/Confirmation/Task/Approval match Section 09`.

### Task 5: Streaming (caret/stop) + Image generation (options)
**Files:** `components/chat/blocks.tsx` (StreamingBlock `:730`, ImageBlock `:705`), `app/globals.css`. Pen: Streaming `duDp0`, Image `SQBGY` (generating) / `Qnb06` (done).
- [ ] Step 1: Dump + screenshot.
- [ ] Step 2: **Streaming (gap)** — render the partial text with a trailing block **caret** (helper-brand, blink) and a **status row** (spinner + "Writing… · N tokens" + spacer + **Stop**). Tokens line hidden gracefully if no count (Review Focus #2). Stop wired to the existing stop callback. **Image generation (gap)** — generating: top (image icon + "Making N …" + spacer + % + Stop) + 2-up shimmer tiles + prompt italic; done: 2-up option tiles (selected = `--ink` 2px border) + **Use option N / Try again / Edit prompt** actions. Tolerate 1 image (no options) → single tile, no action row. Keep existing image/generating fields.
- [ ] Step 3: CSS (shimmer keyframe, caret blink), NO dead CSS.
- [ ] Step 4: `tsc`+`build`; confirm fallbacks; report.
- [ ] Step 5: Commit `feat(web): chat Streaming + Image generation match Section 09`.

### Task 6: Converge surfaces — onboarding + retire legacy renderers
**Files:** `components/Conversation.tsx`, `app/onboarding/page.tsx` (+ `components/onboarding/*` as needed), `app/globals.css`.
- [ ] Step 1: Read `Conversation.tsx` legacy inline card variants (Choices/JobProposal/AccessRequest/AccessCard/Proposal/Question `:20–329`) and confirm each has an equivalent block renderer in `blocks.tsx`. Read the onboarding interview chat rendering (`app/onboarding/page.tsx` `hist.map(...)` ~`:456`).
- [ ] Step 2: Route ALL agent content in `Conversation.tsx` through `Reply`/`renderBlocks`; remove the now-duplicate legacy inline card components + their orphaned CSS (grep to confirm unused elsewhere). Refactor the onboarding assistant chat so its conversational turns (owner message / assistant message / choice options) render through the shared Message/Reply + choices block (lowest-risk path that yields the Section 09 standard look); **keep the interview stepper/answer/submit logic intact** (Review Focus #4).
- [ ] Step 3: CSS cleanup; NO dead CSS / no duplicate renderers (Review Focus #5).
- [ ] Step 4: `tsc`+`build`; confirm workspace/drawer/chat still render; onboarding interview still completes; report.
- [ ] Step 5: Commit `feat(web): single chat renderer — onboarding on standard, legacy variants retired`.

---

## Self-review notes
- Spec coverage: all 16 components (T1 Message/Hover/Feedback/Usage; T2 Reasoning/Todos/Sources/Document; T3 Markdown/Code; T4 Action/Confirmation/Task/Approval; T5 Streaming/Image) + the 4 partials (T3 Code, T4 Action card, T5 Streaming+Image) + surface convergence (T6). Matches the design's 3 workstreams.
- Each task is a component cluster = independently testable; shared `blocks.tsx`/`globals.css` ⇒ serial under SDD.
- Verification adapted to the no-harness reality (tsc+build+visual-vs-pen).
- Review Focus: 5 pinned — interactive-preserved, optional-field fallback, icon mapping, onboarding flow, single-renderer.
- NO-DEAD-CSS enforced per task (recurring finding across prior phases).
