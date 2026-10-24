# Office Goals — Implementation Report

## What was built

### Routes added
- `/office/goals` — company-wide Goals page (OfficeGoalsRoute)
- `/office` — now uses `OfficeLayout` as the parent layout component

### Files created
- `src/features/office/OfficeLayout.tsx` — sidebar + Outlet layout (mirrors ChatChannelLayout)
- `src/features/office/OfficeAreaContext.tsx` — React context sharing area-filter state between layout and inbox
- `src/features/office/OfficeGoalsRoute.tsx` — company-wide goals page + NewGoalDialog
- `src/features/office/OfficeGoalsRoute.test.tsx` — 12 tests: layout nesting, goals content, dialog open/close

### Files modified
- `src/app/router.tsx` — officeRoute now uses OfficeLayout; officeGoalsRoute added as child
- `src/features/office/OfficeSidebar.tsx` — added `activeNav` prop; Goals link now navigates + highlights
- `src/features/office/InboxRoute.tsx` — sidebar + Inset wrapper removed (provided by layout); uses `useOfficeArea()` context
- `src/features/office/InboxRoute.test.tsx` — test router updated to use OfficeLayout as parent

## Office layout nesting
`/office` → `OfficeLayout` renders `<OfficeSidebar>` once + `<Inset><Outlet/></Inset>`.
Child routes (`inbox`, `inbox/$itemId`, `goals`) render main content only — no duplicate sidebar.
Active nav derived from `useMatchRoute` inside the layout.
Area-filter state lives in `OfficeAreaProvider` context so both the sidebar and InboxRoute share it.

## Design fidelity (qDPJo.png + DlkiJ.png)
- Goals page: heading "What the company is pushing on", goal count meta, area tabs (All/Engineering/Marketing/Business), status filter tabs (All/Needs you/At risk/Blocked/On track), area group sections with accent dot + color heading, per-goal progress ring (status-colored), status chip, Needs you badge, owner mascot, Chat button, Open button, expandable sub-items
- New goal dialog: title, description, Goal textarea, Channel selector (with area dot), Due input, Measured by + Target fields, Helpers on it avatars, "Let Chief draft key results" toggle, footer with "or describe it in chat" link, Cancel + Create goal buttons

## Nested-interactive check
GoalRow places the expand-toggle button and the Chat/Open buttons as siblings inside a `<div>`, not nested. No button-in-button violations found.

## Build & test
- `bun run build` (tsc -b && vite build): ✓ built in ~300ms
- `bun run test`: 14 test files, 99 tests, all passing
