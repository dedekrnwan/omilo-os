# Chat Route Fix Report

**Branch**: feat/ui-full  
**Fix**: `fix(chat): channel layout with outlet so goals/flows/docs/session routes render`

## Root Cause

`$channelId` route used `ChatRoute` as its component. `ChatRoute` rendered `ChannelSidebar + Inset` directly with no `<Outlet />`, so child routes (goals, flows, docs, $sessionId) never mounted. Visiting `/chat/ch-engineering/goals` showed the new-chat hero because TanStack Router rendered the parent component and stopped — there was no outlet for children to render into.

## Changes

### New file
- `src/features/chat/ChatChannelLayout.tsx` — layout component for `$channelId` route. Reads `channelId` and optionally `sessionId` from params (strict: false) to power sidebar highlighting. Derives active nav (`Goals` / `Flows` / `Docs` / undefined) from `useMatchRoute`. Renders `<ChannelSidebar>` once + `<Inset><Outlet /></Inset>`.

### Modified files
- `src/app/router.tsx` — `chatRoute` is now a passthrough `<Outlet />`. `chatChannelRoute` uses `ChatChannelLayout`. Added `chatChannelIndexRoute` (path `'/'`) → `ChatIndexRoute`. `chatSessionRoute` → `ChatSessionRoute`. Goals/Flows/Docs routes unchanged in shape but now render only their main content.
- `src/features/chat/ChatRoute.tsx` — Split into `ChatIndexRoute` (hero only) and `ChatSessionRoute` (thread only). Kept deprecated `ChatRoute` export for safety; it is not used in routing.
- `src/features/chat/GoalsRoute.tsx` — Removed `ChannelSidebar` import and `<Inset>` wrapper. Exports only main content.
- `src/features/chat/FlowsRoute.tsx` — Same as GoalsRoute.
- `src/features/chat/DocsRoute.tsx` — Same as GoalsRoute.
- `src/features/chat/ChatRoute.test.tsx` — **Updated**: `makeTestRouter` now uses `ChatChannelLayout` + `ChatIndexRoute` + `ChatSessionRoute` matching production nesting. Added a guard test ("session route does NOT show the new-chat hero") that would have caught the original bug.
- `src/features/chat/FlowsRoute.test.tsx` — **Updated**: `makeRouter` uses `ChatChannelLayout` as the `$channelId` component so `FlowsRoute` is mounted through the real `<Outlet />`.

## Route → Component Mapping

| URL | Component rendered in main area |
|-----|--------------------------------|
| `/chat/ch-engineering` | `ChatIndexRoute` (new-chat hero) |
| `/chat/ch-engineering/goals` | `GoalsRoute` (goals list) |
| `/chat/ch-engineering/flows` | `FlowsRoute` (flows tabs) |
| `/chat/ch-engineering/docs` | `DocsRoute` (docs + viewer) |
| `/chat/ch-engineering/<sessionId>` | `ChatSessionRoute` (session thread) |

All paths have exactly ONE `ChannelSidebar` from `ChatChannelLayout`.

## Build & Test
- `bun run build`: green (tsc + vite, no errors)
- `bun run test`: 44/44 passed across 10 test files

## Sidebar Active State Logic
- `/chat/$channelId` (index) → `activeNav=undefined`, ChannelSidebar defaults Chats inactive (no session = no highlight, which matches the new-chat state)
- `/chat/$channelId/$sessionId` → `activeNav=undefined`, `sessionId` prop is set → ChannelSidebar highlights Chats and the active session row
- `/chat/$channelId/goals` → `activeNav='Goals'`
- `/chat/$channelId/flows` → `activeNav='Flows'`
- `/chat/$channelId/docs` → `activeNav='Docs'`

## Concerns
- The deprecated `ChatRoute` export in `ChatRoute.tsx` should be removed once no other callers exist. Currently unused in routing.
- The index route path `'/'` in TanStack Router v1 acts as the default child when navigating to the parent path — this is correct per TanStack Router docs.
