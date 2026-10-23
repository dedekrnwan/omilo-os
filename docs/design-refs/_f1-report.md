# F1 Chrome Fidelity Report

## Changes

### Rail (`src/ui/Rail.tsx`)
Rebuilt from a plain icon list to a proper company rail:
- **Top**: two rounded-square company icons (orange "S" for Sahabat Warga active, indigo "K" for a second company), a dashed "+" add button.
- **Bottom**: Activity icon, Dots icon, Chat bubble (mode toggle), Lock/Settings icon, round "DK" avatar.
- Mode toggle is now the chat bubble icon; aria-label carries "Chat"/"Office" so existing toggle tests still pass.

### ChannelSidebar (`src/features/chat/ChannelSidebar.tsx`)
Fully rewritten to match `b3vqC5.png` / `gTI4y.png`:
- **Header**: active channel name + "Channel · Chief + 3 agents" subtitle + chevron → opens a channel-switcher dropdown.
- **Dropdown** (`gTI4y.png`): search input, YOUR CHANNELS list (real channels from `useChannels()` with area dots and static subtitle metadata), check mark on active channel, "+ Create channel" and "Manage channels" actions.
- **New chat button**: dark primary pill below the header.
- **Nav items**: Chats (active), Goals (count 4), Flows, Docs, Analytics — each with a leading SVG icon.
- **FOLDERS section**: Q4 Launch (expanded with 3 session rows), Infra migration, Incident reviews — static placeholder data.
- **RECENT section**: 6 static recent sessions.
- **User row** (bottom): "DK" avatar + "Dede Kurniawan" — triggers a user menu popup with Account, Settings, Log out, etc.

### OfficeSidebar (`src/features/office/OfficeSidebar.tsx`)
Rewritten to match `hR0PJ.png`:
- **Header**: "Sahabat Warga" + "Office · 5 areas".
- **Nav items**: Goals, Inbox (active, with aria-current and count badge), Flows, Routines, Docs, Analytics.
- **AREAS section**: All areas (14), General (2, ops color), Engineering (5, dev color), Marketing (4, marketing color), Business (3, finance color) — area dots use `helperColor` tokens.

### TopBar (`src/ui/TopBar.tsx`) — new file
Thin 44px header above center content:
- **Left**: breadcrumb/title derived from route pattern (regex match, no queries).
  - `/chat` → "New chat · General"
  - `/chat/$channelId` → "New chat · {channelName}"
  - `/chat/$channelId/$sessionId` → "Passkey rollout plan · Engineering / Q4 Launch"
  - `/office/inbox` → "Inbox · 4 need you"
- **Right**: two overlapping agent avatars (teal + indigo), Share button, More (…) button.

### Shell (`src/app/Shell.tsx`)
Added `<TopBar />` above the route `<Outlet>` column.

## Tests adjusted

Three `ChannelSidebar` unit tests in `src/features/chat/ChatRoute.test.tsx` were updated:

1. **"lists General, Engineering, Marketing channels"** — channels are now in the dropdown; test now opens the dropdown via `fireEvent.click` before asserting.
2. **"each channel row has an area dot"** — same: opens dropdown first.
3. **"active channel is highlighted"** — opens dropdown, then finds the button with both `/engineering/i` name and `aria-current="true"` (using `getAllByRole` + `.find`), because the header also shows "Engineering" as the active channel name.

All 39/39 tests pass. `bun run build` green.

## Ref mapping

| Reference | What it maps to now |
|---|---|
| `gTI4y.png` (General · channel switcher open) | Rail + ChannelSidebar dropdown (open state) + TopBar "New chat · General" |
| `b3vqC5.png` (Engineering · session open) | Rail + ChannelSidebar (header "Engineering", Q4 Launch folder expanded) + TopBar "Passkey rollout plan · Engineering / Q4 Launch" |
| `hR0PJ.png` (Office · Inbox) | Rail + OfficeSidebar (Inbox active, AREAS section) + TopBar "Inbox · 4 need you" |
