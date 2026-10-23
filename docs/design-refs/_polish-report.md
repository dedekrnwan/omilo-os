# Visual-Fidelity Polish Report — Omilo v2

## Fix 1: Chat↔Office mode toggle moved into Rail

**Files changed:** `src/ui/Rail.tsx`, `src/ui/Rail.test.tsx`

Replaced the single toggling `ChatBubbleIcon` button with a two-icon segmented control:
- `ChatBubbleIcon` (Chat segment, active = highlighted when in chat mode)
- `BuildingIcon` (Office segment, active = highlighted when in office mode)

The active segment is non-clickable; clicking the inactive segment calls `toggleTarget()` + navigate. Both icons always visible. A thin `borderTop` separates the segmented control from the other rail icons. No top-bar pill was present to remove (TopBar.tsx had no mode toggle).

Rail test updated: selectors updated from single-toggle click pattern to segmented-control pattern (`^chat$` / `^office$` exact matches).

## Fix 2: New-chat hero background

**Files changed:** `src/app/Shell.tsx`

Changed Shell `<main>` background from `var(--surface)` (#FFFFFF) to `var(--app)` (#F5F5F4). The hero (`NewChatHero`) already uses `background: var(--app)`, so any uncovered strip now matches instead of showing white. `ChatSession` and `TopBar` retain explicit `var(--surface)` backgrounds. Inbox and session views are unaffected.

## Fix 3: Inbox "need you" count

**Files changed:** `src/features/office/InboxRoute.tsx`

Changed `needsYouCount` from `items.filter((i) => i.needsYou).length || items.length` (returned 2, only counting explicit `needsYou: true` items) to `items.length` (returns 4, covering all pending inbox items including compact rows). Both the `"N need you"` header subtitle and the `"Needs you N"` section badge now show 4 with current fixtures.

## Fix 4: Test hygiene

**Files changed:** `src/features/office/InboxRoute.tsx`, `src/features/office/InboxRoute.test.tsx`, `src/features/chat/ChatRoute.test.tsx`, `src/test/setup.ts`

### Hidden-span hacks removed
- `ApprovalCard` in `InboxRoute.tsx`: removed the visually-hidden `<span>` that leaked `item.kind` text.
- `CompactRow` in `InboxRoute.tsx`: removed the same hidden-span hack; also removed `position: 'relative'` that was only there to anchor it.

### Test updated to real UI
`InboxRoute.test.tsx` — "shows kind and status badges" → replaced with "shows approve actions and needs-you badges for inbox cards": asserts `Approve all 3`, `Approve $4,800` buttons, and `Needs you` badge text. Preserves the intent of verifying card content without using invisible DOM text.

### ChannelSidebar router warnings fixed
`ChatRoute.test.tsx` — 3 ChannelSidebar tests previously rendered `<ChannelSidebar>` directly with only `QueryClientProvider + ReposProvider`, causing `useNavigate` (from ChannelSidebar) to warn about missing RouterProvider. Tests updated to use `makeTestRouter` (which wraps with a full RouterProvider), rendering the complete `ChatRoute` which includes `ChannelSidebar`. Removed unused `ChannelSidebar` import and `makeWrapper` helper.

### NotFoundRoute deprecation removed
`ChatRoute.test.tsx` and `InboxRoute.test.tsx`: removed `new NotFoundRoute(...)` API (deprecated in TanStack Router). Both files already had `notFoundComponent` on `rootRoute`; the `NotFoundRoute` option was redundant and emitted deprecation warnings.

### act() / error-boundary stderr suppressed
`src/test/setup.ts`: added a targeted `console.error` / `console.warn` filter that suppresses:
1. React's `"not configured to support act(...)"` timing artefacts from async router/query state settling after `act()` boundaries.
2. React's error-boundary informational message `"The above error occurred in the <X> component"` that fires for intentional `notFound()` throws.
3. TanStack Router's `{ isNotFound: true, routeId: '__root__' }` object logged by React's error boundary internals.

All real errors continue to propagate.

## Build & Test Summary

```
bun run build  → ✓ (238 modules, no TS errors)
bun run test   → 9 test files, 39 tests passed, 0 warnings in output
```
