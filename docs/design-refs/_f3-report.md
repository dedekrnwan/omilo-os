# F3 Visual Fidelity Pass — Chat Session Thread

**Branch**: feat/ui-foundation  
**Date**: 2026-10-24

## Scope

Center thread + session composer footer matching the pen.dev "Chat · Session (Engineering)" reference (`b3vqC5.png`). Rail/sidebar/Shell untouched.

## Changes Made

### 1. `src/core/domain/types.ts` — optional type extensions
Added `MessageAttachment`, `MessageAction` interfaces and three optional fields to `Message`:
- `system?: boolean` — renders as centered system/event line
- `attachment?: MessageAttachment` — doc card inside a message
- `actions?: MessageAction[]` — action buttons below message content

All fields are optional; existing code and contract tests are unaffected.

### 2. `src/adapters/mock/fixtures.ts` — additive mock data for sess-eng-1
Added 5 new messages after the existing 4 (which remain intact for test assertions):
- `msg-eng-1-5` — user question about Q4 passkey shipping
- `msg-eng-1-6` — Chief reply (brand/ops agent, plain text)
- `msg-eng-1-sys-1` — system event line: "Chief added Dev to this chat"
- `msg-eng-1-7` — Dev reply with doc attachment card ("Passkey rollout — v1")
- `msg-eng-1-8` — Chief action-prompt with "Create 3 tasks in Goal" + "Not yet" buttons

### 3. `src/ui/ChatSession/MessageList.tsx` — new rendering logic
- **Agent messages**: replaced bordered card + left-accent bar with borderless plain text: colored circular avatar, bold name + muted role text + muted time on one line, then a plain `<p>` paragraph below — matches ref exactly.
- **User messages**: dark right-aligned bubble unchanged.
- **`SystemLine`** component: centered muted row with `✓` prefix.
- **`AttachmentCard`** component: small bordered card (doc icon + title + meta + open-arrow ↗).
- **Action buttons**: dark primary button + plain ghost button row below message content.

### 4. `src/ui/ChatSession/ChatSession.tsx`
- Added optional `channelName` prop.
- Composer placeholder hard-set to `"Reply — Chief and Dev are in this chat"` for session context.
- Footer note `"◈ Agents here only read {channelName} goals, docs and chats"` rendered below composer card.

### 5. `src/ui/TopBar.tsx`
- Avatar colors use `var(--helper-dev)` and `var(--helper-brand)` tokens (not hardcoded hex).
- Goal pill `"✓ Passwordless login by Q4"` (green ok-tint/ok-line tokens) shown only when `chatSessionMatch` is truthy.

### 6. `src/features/chat/ChatRoute.tsx`
- Added `CHANNEL_NAMES` map.
- Passes `channelName` to `<ChatSession>` from route params.

## Reference Mapping

| Ref element | Implementation |
|---|---|
| Agent messages borderless plain text | `MessageList` plain-text branch, `<p>` tag, no border |
| Colored circular avatar + bold name + muted role + time | `Avatar` + header row in agent branch |
| System line "✓ Chief added Dev to this chat" | `SystemLine` component, `msg-eng-1-sys-1` fixture |
| Doc attachment card | `AttachmentCard` component, `msg-eng-1-7` fixture |
| Action-prompt with buttons | `msg-eng-1-8` fixture, action buttons render block |
| Composer placeholder "Reply — Chief and Dev are in this chat" | `placeholder` prop in `ChatSession` |
| Footer note "Agents here only read Engineering goals, docs and chats" | Footer `<p>` below composer |
| Top bar: goal pill "Passwordless login by Q4" + avatars | `TopBar.tsx` session-conditional pill |

## Tests

- **No tests changed** — all 39 pass as-is.
- Existing assertions (`/429s from the payment gateway/i`, `/Let's outline our Q4 priorities/i`) continue to work because new messages are additive; original `msg-eng-1-1..4` remain.

## Build

`bun run build` — green, 473 kB JS bundle, 18 kB CSS.

## Token discipline

All colors use `var(--...)` CSS custom properties or `helperColor[area]` from tokens.ts. No hardcoded hex values introduced.
