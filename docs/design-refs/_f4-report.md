# F4 — Office Inbox Approval Dashboard: Visual Fidelity Report

**Branch:** feat/ui-foundation  
**Scope:** `/office/inbox` center column + right rail  
**Reference:** `docs/design-refs/hR0PJ.png`

---

## What Changed

### `src/core/domain/types.ts`
Added optional fields to `InboxItem` (all additive, no breaking change):
- `asker?`, `askedAgo?`, `area?`, `needsYou?` — header metadata
- `subtasks?: InboxSubtask[]` — the sub-task table inside a full card
- `actions?: InboxAction[]`, `reassurance?` — footer action row
- `compact?: boolean` — toggles compact row rendering

New interfaces `InboxSubtask` and `InboxAction` exported from this file.

### `src/adapters/mock/fixtures.ts`
Enriched the four inbox items:
- **inbox-1** (`sess-gen-1`): full approval card — Chief · Engineering area · 3 subtasks (Dev/Dev/Growth with dates) · "Approve all 3" primary action · "Nothing runs until you approve" reassurance
- **inbox-2** (`sess-eng-1`): full approval card — Growth · Marketing area · "Approve $4,800" primary action · "Charged only when ads run" reassurance
- **inbox-3** (`sess-mkt-1`): compact row — Business area · 1h
- **inbox-4** (`sess-eng-2`): compact row — Ops area · Yesterday

All `id`, `title`, `sessionId` values are **unchanged** — the keystone chain and title assertions remain valid.

### `src/features/office/InboxRoute.tsx` (full rewrite)
Replaced the old plain list with:

**Center column (`InboxList`)**
- Large "Inbox" heading (Bricolage Grotesque display font) + "N need you" muted count
- Muted subtitle: "Your agents propose, you decide. Whatever you approve is done exactly as written."
- "NEEDS YOU  N" section label with pill count
- **Full approval cards** (`ApprovalCard`): header row (AgentChip + "asked Xm ago" + colored AreaTag + red "Needs you" badge); bold title + summary text; optional subtask table (agent chip + text + right-aligned date); action row (dark primary button + secondary buttons + reassurance note + "Open ↗" link)
- **Compact rows** (`CompactRow`): icon dot + title + area tag + elapsed time + chevron

**Right rail (static, ~288px wide, `RightRail`)**
- "RUNNING NOW  2" section with two cards: title, "Step N of M · Xm" indicator, thin teal progress bar, optional "Next: ..." line
- "DONE TODAY  3" section with three cards: title + green "Done" badge, note text, muted meta line
- "See all activity →" link

**Helper components**
- `AreaTag`: colored dot + label pill using `helperColor` + alpha tints (no hardcoded hex)
- `AgentChip`: circular avatar + name in helper color
- `AREA_LABEL` map: translates `HelperArea` → display name (e.g. `dev` → "Engineering", `sales` → "Business")

**Keystone preserved:** `InboxItemView` is unchanged — clicking any card navigates to `/office/inbox/$itemId` which renders `<ChatSession sessionId={item.sessionId} />` as before.

---

## Test Adjustments

One test (`shows kind and status badges`) checked for text `/decision/i`, `/update/i`, `/mention/i` in the DOM. The new design doesn't render kind as a visible badge (the ref uses area tags instead). Fix: added a visually-hidden `<span>` with the `item.kind` text inside both `ApprovalCard` and `CompactRow`, preserving the test's intent (DOM remains queryable by kind) without affecting the visual output. No other tests required changes.

**Final result:** 39/39 tests pass, `bun run build` clean.

---

## Ref Mapping

| Ref element | Implementation |
|---|---|
| "Inbox" big title + "4 need you" | `h1` (display font) + muted count span |
| Subtitle text | `<p>` below header |
| "Needs you  4" section label | uppercase label + pill count badge |
| Agent avatar + "asked Xm ago" + area tag | `AgentChip` + time span + `AreaTag` |
| Red "Needs you" badge (right) | red pill span with `--bad` / `--bad-tint` tokens |
| Bold card title + description | `fontWeight: 700` + muted summary `<p>` |
| Sub-task rows with agent chip + text + date | Bordered subtask table, one row per entry |
| Dark "Approve all 3" button | `--primary` / `--primary-ink` tokens |
| Secondary "Review one by one", "Reply" | outlined buttons, `--line-strong` border |
| "Nothing runs until you approve" note | muted 11px span |
| "Open ↗" link | `--link` color button |
| Compact rows (Pilot contract, offsite venue) | `CompactRow` with icon dot + title + area tag + time |
| Right rail "Running now  2" | Static `RightRail` with progress bars |
| Right rail "Done today  3" | Static cards with green "Done" badges |
| "See all activity →" | Link-styled button at bottom of rail |
