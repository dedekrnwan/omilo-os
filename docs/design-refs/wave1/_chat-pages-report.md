# Chat Pages Build Report

## Pages Built

### 1. Chat · Goals (`/chat/$channelId/goals`)
- **Ref:** `SdvDS.png`
- Topbar: Target icon · "Goals · in \<Channel\>" · "+ New goal" primary button
- Heading "What \<Channel\> is pushing on" + subtitle
- Goal list with: `StatusRing` (coloured SVG arc per status — On track/At risk/Ahead mapped to ok/warn/info tokens), title, chats/time meta, status chip (token-coloured pill), percentage, owner Mascot, Chat button
- First goal expands to sub-task rows (title · owner · time) + "+ New chat about this goal" row
- Static data: 4 engineering goals matching the ref exactly

### 2. Chat · Flows (`/chat/$channelId/flows`)
- **Refs:** `v8l9N6.png`, `Mspam.png`, `vwC5x.png`, `VgVEV.png`
- Topbar: GitFork icon · "Flows · in \<Channel\>" · "+ New flow"
- 4 tabs (Yours / Suggested by agents / Templates / Runs) — tab state is local React state, no extra routes

**Yours tab:** 3-column responsive grid of `FlowCard` (area Mascots + Toggle switch + title + status + sparkline bars), a `SuggestedCard` variant (blue highlighted card with Create button), `NewFlowCard` (dashed), and "Start from a template" horizontal scroll strip.

**Suggested tab:** helper-watch intro line, two suggested flow cards with Dismiss/Preview/Create flow actions and cost metadata.

**Templates tab:** category filter pills (All/Engineering/Ops/Reporting/Support), 3-column grid of template cards (Mascots + title + desc + "+" Use button), "12 templates" count.

**Runs tab:** stats row (142 runs / 96% success / 2 needs you / $1.84), filter pills (All/Running/Needs you/Failed/Done), table with status chips colour-coded by ok/warn/info/bad tokens.

### 3. Chat · Docs (`/chat/$channelId/docs`)
- **Ref:** `k1bhz.png`
- Topbar: FileText icon · "Docs · in \<Channel\> · 19 docs" · Recent + New doc actions
- Left panel (240px): search input, All/By you/By agents view tabs, hierarchical doc list (section label + items with icon, title, version badge, edited time, unread dot)
- Right: doc viewer with editor strip (Mascot + "Dev edited Xh ago"), Edit/Read mode tabs, action buttons (Saves, Share, Link, More), document body (bold headings, bullet lists, `[[linked doc]]` as styled anchor tags), "Agent memory is separate" strip
- Far-right panel: Links (8), Linked Here (4), Outline, History sections

## Design System Usage
- `Button`, `Mascot`, `Inset`, `Topbar`, `ContextRing` (custom StatusRing extends it) — all from `src/ui/ds/`
- Colors exclusively via CSS custom properties from `tokens.css`: `var(--color-ok)`, `var(--color-warn)`, `var(--color-info)`, `var(--color-bad-solid)`, `var(--color-helper-brand)`, `var(--color-line-strong)`, etc.
- `helperColor` token used implicitly via Mascot
- No hardcoded hex values

## Routing
- New routes added to `src/app/router.tsx` as siblings of `$sessionId` under `chatChannelRoute`
- ChannelSidebar extended with `activeNav?: ChannelNav` prop; nav items wired to navigate to `/goals`, `/flows`, `/docs`
- Active state on nav items reflects current route correctly
- Existing session/hero routes untouched

## Tests
- 4 new tests in `FlowsRoute.test.tsx`: Yours tab default render, Suggested tab switch, Templates tab switch, Runs tab switch
- All 43 tests pass (39 existing + 4 new)
- Build: green (tsc -b + vite build)
