# Omilo — Section 09 Chat Components (reusable standard) — Design

**Date:** 2026-10-21
**Status:** Approved (scope confirmed in chat)
**Owner:** Dede Kurniawan
**Design source of truth:** pen.dev `omilo.pen`, **Section 09 · Chat components · agentic staff** (frame `roxVp`), the full JSON of which the owner supplied. Read nodes via the `mcp__pencil__execute` MCP; never Read/Grep the `.pen` file.

---

## Intent & why

The chat-v2 merge already shipped a reusable agentic-reply component library (`components/chat/blocks.tsx` with 20 block renderers, `Reply.tsx`), and three surfaces already share one `Conversation → Reply → renderBlocks` pipeline. But the components were built to the earlier chat-v2 look, not to the canonical **Section 09** spec, a few are only partial, and one chat surface (onboarding) renders its own bespoke chat. This project makes **Section 09 the single, pixel-exact reusable standard**, and has every chat surface use it.

## Goals

- **Pixel-exact fidelity** of all 16 Section 09 components against the pen frames (fonts, spacing, colors, exact structure).
- **Build the 4 partial components** to match the pen.
- **One renderer across all chat surfaces**: workspace 3-pane, floating drawer, chat page (already shared) **+ the onboarding assistant chat** (refactor to the standard), and retire the duplicate legacy card variants in `Conversation.tsx` so there is a single source.

## The 16 components (pen reusable-frame ids for reference)

Message `U2Lljm` · Hover actions `B0Ksmn` · Usage meter `lrtjv` · Feedback bar `ihBIG` (+ expanded `MJprW`) · Streaming `duDp0` · Reasoning `HwExk` (collapsed) / `mEXXW` (open) · Action card `pT9bB` · Confirmation `T4FR5` (+ done `kMvfJ`) · Approval-while-streaming `RvtWB` · Task `CGKLK` · Todos `LZwtY` · Document `K4wTQ` · Sources `yp4g8` · Markdown `c0DKyw` · Code `Jxjui` · Image generation `SQBGY` (generating) / `Qnb06` (done). Full-reply composition example: `GAtoS`.

### Current status (from the code audit)
- **Exist, need fidelity pass:** Message (`Reply.tsx`), Hover actions, Usage meter, Feedback bar, Reasoning, Confirmation, Approval-while-streaming, Task, Todos, Document, Sources, Markdown.
- **Partial — build to match the pen:**
  - **Streaming** (`blocks.tsx` StreamingBlock): add the caret + a status line "Writing… · N tokens" + an inline **Stop** button.
  - **Action card** (ActionCardBlock): add the three actions — **Open PR / Change something / Not now** (primary / secondary / quiet), wired to the block's decision callback.
  - **Code** (CodeBlock): add the dark file-header (filename + lang + Copy + Apply) and **diff lines** (red `-` / green `+` with line numbers) when the block carries a diff.
  - **Image generation** (ImageBlock): add the **generating** 2-up shimmer tiles + progress + Stop, and the **done** 2-up option tiles + **Use option N / Try again / Edit prompt** actions.

## Non-goals / constraints

- **No backend changes.** The message `blocks[]` union already carries every field these components need (the audit confirms the data shape); where a new field is needed (e.g. `code.diff`, `image.options`) it is an OPTIONAL addition the renderer tolerates, with graceful fallback when absent. Do not add API endpoints.
- **Keep behavior.** Interactive blocks (choices, proposals, access, confirmations, approval, feedback) keep their existing callbacks/wiring; this is a restyle + gap-fill, not a data-flow rewrite.
- **Onboarding:** adopt the shared Message/Reply + the relevant standard blocks for the interview's **conversational turns** (owner message, assistant message, choice options) so it matches the standard look. The interview's stepper/form logic stays. (Builder's call on exactly how much of the interview renders through `Reply` vs is restyled in place — pick the lowest-risk path that makes it visually the Section 09 standard.)
- Stack: Next.js/React, custom CSS tokens in `app/globals.css`, Remix Icon (NOTE: the pen uses `lucide` icon names — map each to the nearest Remix Icon, or add the needed lucide glyphs; keep one icon system). No web test harness → verify `./node_modules/.bin/tsc --noEmit` + `npm run build` + visual-vs-pen (screenshot the reusable frame). **NO dead CSS.**

## Decided approach (the "how")

1. Treat `components/chat/blocks.tsx` + `components/chat/Reply.tsx` + their CSS in `app/globals.css` as the canonical library; restyle each renderer to match its pen reusable frame exactly (screenshot it with `TakeScreenshot([id])`).
2. Build the 4 partials to match their pen frames, tolerating absent optional fields.
3. Converge surfaces: verify workspace/drawer/chat still render through the shared pipeline after the restyle; refactor the onboarding assistant chat onto the standard; remove the legacy duplicate card variants in `Conversation.tsx` (route all agent content through `Reply`/`renderBlocks`).
4. Keep the full-reply example (`GAtoS`) as the acceptance reference: a single reply composing Reasoning + Todos + Markdown + Code + Action card + Sources + Usage meter + Hover actions + Feedback bar must look like the pen.

## Open questions for the owner

(Compiled during the builder-check; see handoff.)

## Left to the builder

- Exact per-component spacing/pixels read from each pen reusable frame at implementation.
- The lucide→Remix icon mapping per component.
- The onboarding convergence path (full `Reply` re-render vs in-place restyle) — lowest-risk that achieves the standard look.
- Optional new block fields (`code.diff`, `image.options`) names/shapes, kept backward-compatible.
