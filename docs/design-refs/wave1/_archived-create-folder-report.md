# Archived Chats · Create Channel Dialog · Folder View — Implementation Report

**Date**: 2026-10-24  
**Branch**: feat/ui-full  
**Refs**: PHRy6.png (Archived), W0f1Ji.png (Create channel), A8lWSN.png (Folder)

---

## What was built

### 1. Archived Chats (PHRy6.png → `/chat/$channelId/archived`)

**File**: `src/features/chat/ArchivedRoute.tsx`

- Topbar: Archive icon · "Archived" title · "N chats" meta · "Delete all" secondary button
- Search bar below topbar (inline input, no separate button wrapper)
- List of 6 static archived chat rows matching the ref: title, channel, archived date
- Each row has hover-revealed "Restore" + trash icon buttons (no nesting — both are siblings inside a plain `div`)
- Footer note: "Archived chats are deleted after 180 days unless restored."
- Route: `chatArchivedRoute` added as child of `$channelId` at path `archived`
- Sidebar: `NavLink` "Archived" wired to `navigate('/chat/$channelId/archived')` with `active={activeNav === 'Archived'}`; `ChatChannelLayout.useActiveNav` recognises the path

### 2. Create Channel Dialog (W0f1Ji.png)

**File**: `src/features/chat/CreateChannelDialog.tsx`

- Radix `Dialog.Root/Portal/Overlay/Content` with `rounded-dialog` (20px), shadow, backdrop-blur
- Header: title "Create channel", subtitle, × close button (Dialog.Close asChild — no nesting)
- **Name & icon** fieldset: swatch-preview span + text input + 8 colour-swatch buttons (self-closing, no nesting)
- **Agents** fieldset: 3 agent rows (Chief locked "Always", Support toggle ON, Ops toggle OFF) — Toggle is a custom `<button role="switch">` inside a plain `<div>`, not inside another button
- **Context** fieldset: two `<label>` radio options (Isolated / Isolated + General)
- Footer: "Visible to 4 people" · Cancel · Create channel buttons
- Trigger: channel-switcher popover "Create channel" item now calls `onCreateChannel()` → sets `createChannelOpen` state in `ChannelSidebar`

### 3. Folder View (A8lWSN.png → `/chat/$channelId/folder/$folderId`)

**File**: `src/features/chat/FolderRoute.tsx`

- Topbar: Folder icon · breadcrumb "Folder › {name}" · Share button · "New chat in folder" primary button
- Folder hero: icon tile, folder name h1, chat/file/sharing meta
- Two-column panel: Folder instructions (static text + Edit button) | Files (3 static file chips + Add button)
- "Chats in this folder" section: chat rows from real fixture data (useChannelFolders + useChannelSessions)
- Each chat row: participant avatar initials, title, updated time, agent/goal preview, hover options button — all non-nested siblings inside a `<div>`
- Route: `chatFolderRoute` added at path `folder/$folderId`
- Sidebar: `FolderRow.onToggle` now also calls `openFolder(f.id)` when toggling open, navigating to the folder view

---

## Routes added

| Path | Component |
|---|---|
| `/chat/$channelId/archived` | `ArchivedRoute` |
| `/chat/$channelId/folder/$folderId` | `FolderRoute` |

Dialog triggered by: `ChannelSidebar` → popover "Create channel" item

---

## Tests

**File**: `src/features/chat/ArchivedFolderDialog.test.tsx` (13 tests)

- `ArchivedRoute`: topbar+list renders, distinct content (no hero), search input, footer text
- `FolderRoute`: header+chat list renders, distinct content (no hero), fixture chats visible, instructions panel
- `CreateChannelDialog`: open/closed, close button, Cancel button, form fields present

**Result**: 57/57 tests pass (11 test files). Build green.

---

## Nested interactive element check

- `ArchivedRoute`: Restore/Delete buttons are sibling `<button>` elements inside a plain `<div>` hover group. No nesting.
- `FolderRoute`: Options `<button>` is a sibling inside a `<div>`. File chips and Edit/Add are standalone buttons. No nesting.
- `CreateChannelDialog`: `Dialog.Close asChild` passes props to child `<button>` (not a wrapper). Swatch buttons are self-closing. Toggle is a standalone `<button role="switch">` inside a `<div>`. Footer `<Button>` components render into a footer `<div>`. **No nested interactive elements.**

---

## Design constraints honoured

- All colours via `var(--color-*)` tokens or Tailwind aliases (`bg-surface`, `text-muted`, etc.) — no hardcoded hex except inside `accents.ts` (pre-existing)
- `import type` used for all type-only imports
- Single sidebar: all three routes render MAIN CONTENT ONLY; `ChatChannelLayout` provides sidebar + `<Inset>` wrapping via `<Outlet />`
- No `verbatimModuleSyntax` violations introduced
