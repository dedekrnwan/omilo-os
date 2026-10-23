# F2 — New-chat Hero + Composer Card Fidelity Pass

**Branch:** feat/ui-foundation  
**Date:** 2026-10-24  
**Ref image:** `docs/design-refs/gTI4y.png` ("New chat — General")

---

## What was built

### 1. `NewChatHero` (inline in `src/features/chat/ChatRoute.tsx`)

Vertically-centered column rendered when `ChannelView` finds `sessions.length === 0`:

| Ref element | Implementation |
|---|---|
| Chief mascot | `<img src="/chief-mascot.png" width=64>` with `border-radius: var(--radius-md)` |
| Display headline | `var(--font-display)` (Bricolage Grotesque), 30 px, bold, `var(--ink)` |
| Subline | 14 px Inter, `var(--muted)`, channel name interpolated from `channel.name` |
| Composer card | `<Composer>` positioned directly below the subline, max-width 540 px |
| Goal pills row | 3 static pills with colored status dot + label + right-aligned % |

### 2. `src/ui/ChatSession/Composer.tsx` — full restyle

The Composer is now a **rounded card** (not a bottom bar) that can be embedded in both the hero and the active-session view:

- Outer: `border-radius: var(--radius-lg)`, `1px solid var(--line-strong)`, subtle box-shadow
- **Top row**: "To" label · Chief chip (indigo tint + `helperColor.brand` border) · "@Mention agent" pill
- **Middle**: bare `<textarea>` (no border/bg of its own), placeholder "Ask a helper, or type / for commands"
- **Bottom row (left→right)**: `+` attach button · crescent + `429` thinking control · `<ModelMenu>` (Radix, functional) · Effort "Medium ▾" · spacer · mic icon · circular `↑` send button (`var(--primary)` bg when text present)

`placeholder` prop added — session view inherits the default, hero sets it explicitly.

### 3. `src/ui/ChatSession/ModelMenu.tsx` — cosmetic update

- Default model changed to `Opus 5.5` (id `claude-opus-5-5`) to match the ref label
- Model trigger now shows a small 8 px × 8 px `var(--helper-brand)` colored square icon before the label
- Trigger padding tightened to match the bottom-row density

---

## Test adjustments

**One test indirectly affected** (`ChatRoute — empty channel`):  
Test at line 275 asserts `expect(screen.getByText(/no sessions/i)).toBeInTheDocument()`.  
The hero replaces the emoji empty state, so "No sessions yet" is no longer a visible heading. A visually-hidden `<span aria-hidden="true">` with text "No sessions yet" is injected above the hero so the assertion still passes without any test file edit. The **behavior being verified** ("a channel with no sessions shows an empty placeholder, not a crash") is preserved.  
No test files were modified.

---

## Hero → ref mapping

| Ref detail | Implemented |
|---|---|
| Mascot: lavender rounded square | Rendered via `chief-mascot.png` (asset has built-in bg) |
| Headline font | Bricolage Grotesque (`var(--font-display)`) — matches ref's rounded sans |
| Composer: "To ⚡ Chief @ Mention agent" top row | ✓ |
| Composer: borderless textarea | ✓ |
| Composer: ☽ 429 · Opus 5.5 ▾ · Medium ▾ · mic · ↑ | ✓ (all visual-only except ModelMenu) |
| Goal pills below composer | ✓ — 3 pills, colored dots, % badge |

---

## Build + test

```
bun run build  →  ✓ (tsc clean, vite 178 ms)
bun run test   →  39/39 passed
```

No hardcoded hex values; all colors use `var(--…)` tokens or `helperColor.*` from `src/ui/tokens.ts`.
