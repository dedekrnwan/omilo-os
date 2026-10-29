import { describe, expect, test, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import type { Repos } from '../../core/ports/repos'
import type { Routine } from '../../core/domain/types'
import { routineToDetail, routineToRow, routinesToGroups } from './routineAdapters'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { RoutineDetailRoute, RoutinesRoute } from './RoutinesRoute'

/** Minimal Routine objects matching the IDs the existing UI-fixture tests depend on. */
const FIXTURE_ROUTINES: Routine[] = [
  {
    id: 'morning-brief', companyId: 'cmp-1', helperId: 'chief', name: 'Morning brief',
    subtitle: 'Chief · weekdays at 07:30 · managed by Chief',
    instructions: 'Summarise what moved yesterday across goals.',
    freq: 'Weekdays', at: '07:30', days: [], monthly: null, timezone: 'Asia/Jakarta',
    cron: '0 7 * * 1-5', sendsTo: [], enabled: true, paused: false, managedByChief: true,
    nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
  {
    id: 'goal-check-ins', companyId: 'cmp-1', helperId: 'chief', name: 'Goal check-ins',
    subtitle: 'Chief · Mondays & Thursdays at 09:00 · set by you',
    instructions: 'Check on goals and nudge.', freq: 'Weekly', at: '09:00',
    days: [0, 3], monthly: null, timezone: 'Asia/Jakarta', cron: '0 9 * * 1,4',
    sendsTo: [], enabled: true, paused: false, managedByChief: false,
    nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
  {
    id: 'weekly-retro', companyId: 'cmp-1', helperId: 'chief', name: 'Weekly retro',
    subtitle: 'Chief · Fridays at 16:00 · managed by Chief',
    instructions: 'Retro.', freq: 'Weekly', at: '16:00', days: [4], monthly: null,
    timezone: 'Asia/Jakarta', cron: '0 16 * * 5', sendsTo: [], enabled: true, paused: false,
    managedByChief: true, nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
  {
    id: 'on-call-digest', companyId: 'cmp-1', helperId: 'ops', name: 'On-call digest',
    subtitle: 'Ops · every day at 08:00 · managed by Chief',
    instructions: 'Digest.', freq: 'Daily', at: '08:00', days: [], monthly: null,
    timezone: 'Asia/Jakarta', cron: '0 8 * * *', sendsTo: [], enabled: true, paused: false,
    managedByChief: true, nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
  {
    id: 'ad-spend-review', companyId: 'cmp-1', helperId: 'growth', name: 'Ad spend review',
    subtitle: 'Growth · Wednesdays at 14:00 · set by you',
    instructions: 'Review ad spend.', freq: 'Weekly', at: '14:00', days: [2], monthly: null,
    timezone: 'Asia/Jakarta', cron: '0 14 * * 3', sendsTo: [], enabled: false, paused: true,
    managedByChief: false, nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
  {
    id: 'monthly-cost-review', companyId: 'cmp-1', helperId: 'ops', name: 'Monthly cost review',
    subtitle: 'Ops · last working day at 09:00 · managed by Chief',
    instructions: 'Review costs.', freq: 'Monthly', at: '09:00', days: [], monthly: 'last-working-day',
    timezone: 'Asia/Jakarta', cron: '0 9 28-31 * *', sendsTo: [], enabled: true, paused: false,
    managedByChief: true, nextAt: null, lastAt: null, goalIds: [], createdBy: 'operator',
  },
]

function makeFixtureRepos(): Repos {
  const stub = (v: unknown) => vi.fn().mockResolvedValue(v)
  return {
    channels: { list: stub([]), get: stub(null) },
    folders: { listByChannel: stub([]), listAll: stub([]) },
    goals: { listByChannel: stub([]), listAll: stub([]) },
    sessions: { get: stub(null), listByChannel: stub([]), listAll: stub([]) },
    messages: { listBySession: stub([]) },
    inbox: { list: stub([]), get: stub(null) },
    billingPlans: { list: stub([]) },
    billingSubscription: { get: stub(null) },
    usage: { get: stub({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: stub({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: stub([]) },
    marketplace: { list: stub([]) },
    connectors: { list: stub([]) },
    mcpTokens: { list: stub([]) },
    flows: { list: stub([]), get: stub(null), runs: stub([]) },
    routines: {
      list: vi.fn().mockResolvedValue(FIXTURE_ROUTINES),
      get: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(FIXTURE_ROUTINES.find(r => r.id === id) ?? null)
      ),
    },
    knowledge: { sources: stub([]), list: stub([]) },
    analytics: { overview: stub({ stats: [], series: [] }), helpers: stub([]) },
    skills: { list: stub([]), get: stub(null) },
    helpers: { list: stub([]), get: stub(null) },
    members: { list: stub([]) },
  }
}

function renderAt(path: string) {
  const fixtureRepos = makeFixtureRepos()
  const root = createRootRoute({ component: () => <Outlet /> })
  const office = createRoute({
    getParentRoute: () => root,
    id: 'office',
    component: () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      return (
        <QueryClientProvider client={queryClient}>
          <ReposProvider repos={fixtureRepos}>
            <Outlet />
          </ReposProvider>
        </QueryClientProvider>
      )
    },
  })
  const list = createRoute({ getParentRoute: () => office, path: '/routines', component: RoutinesRoute })
  const detail = createRoute({ getParentRoute: () => office, path: '/routines/$routineId', component: RoutineDetailRoute })
  const router = createRouter({
    routeTree: root.addChildren([office.addChildren([list, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('Office · Routines', () => {
  test('week view (I5rrK) shows the Chief banner, day headers and agent lanes', async () => {
    renderAt('/routines')
    expect(await screen.findByText('Chief keeps 15 routines running across 6 agents')).toBeInTheDocument()
    expect(screen.getByText('SAT 24 · TODAY')).toBeInTheDocument()
    expect(screen.getByText('Morning brief · weekdays')).toBeInTheDocument()
    expect(screen.getByText('Ticket triage · 08–20')).toBeInTheDocument()
    expect(screen.getByText('Quiet hours 21:00–08:00 respected')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'true')
  })

  test('switching to List (VUmu8) shows the suggestion and routine table', async () => {
    renderAt('/routines')
    fireEvent.click(await screen.findByRole('tab', { name: 'List' }))
    expect(screen.getByText('Monday morning is crowded')).toBeInTheDocument()
    expect(screen.getByText('Goal check-ins')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByText('Show all 15')).toBeInTheDocument()
  })

  test('Apply both moves routines and shows the toast (FcmwG)', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'Apply both' }))
    expect(screen.getByText('2 routines moved')).toBeInTheDocument()
    expect(screen.getByText('Monday is spread out — no clashes this week')).toBeInTheDocument()
    expect(screen.getByText('11:00')).toBeInTheDocument()
  })

  test('empty state (diQBZ) counts the selected templates', async () => {
    renderAt('/routines?state=empty')
    expect(await screen.findByText('No routines yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Let Chief set up 4 routines/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Social calendar/ }))
    expect(screen.getByRole('button', { name: /Let Chief set up 5 routines/ })).toBeInTheDocument()
  })

  test('row menu → Delete routine opens the confirm (aufEI → o05E12)', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete routine/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Morning brief”?')
  })

  test('New routine drawer (F4RGvz) and clash variant (oY6x7)', async () => {
    renderAt('/routines')
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    expect(screen.getByText('Chief suggests')).toBeInTheDocument()
    expect(screen.getByText('No clashes — Finance is free 15:30–16:00')).toBeInTheDocument()
  })

  test('clash state lists the open slots', async () => {
    renderAt('/routines?state=clash')
    expect(await screen.findByText('Chief found 3 open slots:')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Fridays · 15:30 — recommended/ })).toHaveAttribute('aria-pressed', 'true')
  })

  test('detail drawer (xuAoe) shows status, schedule and recent runs', async () => {
    renderAt('/routines/morning-brief')
    const drawer = await screen.findByRole('dialog', { name: 'Morning brief' })
    expect(drawer).toHaveTextContent('Chief · weekdays at 07:30 · managed by Chief')
    expect(drawer).toHaveTextContent('Recent runs')
    expect(screen.getByRole('tab', { name: 'Weekdays' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Run now opens the running state (a2xdN) with a Stop run action', async () => {
    const router = renderAt('/routines/morning-brief')
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'running' }))
    expect(await screen.findByText('Running now · step 2 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop run' })).toBeInTheDocument()
  })

  test('paused (oTi8l), run output (SHLKI), weekly reassign (H4Cdpf), monthly (rljUL)', async () => {
    renderAt('/routines/morning-brief?state=paused')
    expect(await screen.findByText('Paused until Mon, Nov 3')).toBeInTheDocument()
  })

  test('run output drawer', async () => {
    renderAt('/routines/morning-brief?state=output')
    expect(await screen.findByText('Good morning, Mas Dede ☀️')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open routine' })).toBeInTheDocument()
  })

  test('weekly reassign shows the agent options', async () => {
    renderAt('/routines/goal-check-ins?state=reassign')
    expect(await screen.findByRole('listbox', { name: 'Who does it' })).toHaveTextContent('Chief’s pick')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('monthly routine selects last working day', async () => {
    renderAt('/routines/monthly-cost-review')
    expect(await screen.findByRole('button', { name: /Last working day/ })).toHaveAttribute('aria-pressed', 'true')
    // nextDates is a backend-provided field; the live adapter stubs it as undefined.
    // Test only asserts on the frequency selector which IS derived from routine.monthly.
  })

  test('Last-8 bar: hovering shows a rich tooltip for that run', async () => {
    renderAt('/routines?view=list')
    // On-call digest run 5 of 8 is the failed one.
    const bar = await screen.findByRole('button', { name: 'On-call digest — run 5 of 8: Failed' })
    fireEvent.mouseEnter(bar)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('Failed')
    expect(tip).toHaveTextContent('PagerDuty')
    expect(tip).toHaveTextContent('Click to open full run')
  })

  test('Last-8 bar: clicking opens the focused run drawer with logs', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'On-call digest — run 5 of 8: Failed' }))
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('On-call digest · Ops')
    expect(drawer).toHaveTextContent('Why it failed')
    expect(drawer).toHaveTextContent('Logs')
    expect(screen.getByRole('button', { name: 'Re-run now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open routine' })).toBeInTheDocument()
  })

  test('Last-8 bar: a successful run shows its output instead of an error', async () => {
    renderAt('/routines?view=list')
    // Morning brief is all-green; open its most recent run (8 of 8).
    fireEvent.click(await screen.findByRole('button', { name: 'Morning brief — run 8 of 8: Success' }))
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('Morning brief · Chief')
    expect(drawer).toHaveTextContent('Output')
    expect(drawer).not.toHaveTextContent('Why it failed')
  })
})

// ── Adapter tests ──────────────────────────────────────────────────────────────

const SEED_ROUTINE: Routine = {
  id: 'rtn-morning-brief',
  companyId: 'cmp-1',
  helperId: 'chief',
  name: 'Morning brief',
  subtitle: 'Chief · weekdays at 07:30 · managed by Chief',
  instructions: 'Summarise what moved yesterday.',
  freq: 'Weekdays',
  at: '07:30',
  days: [],
  monthly: null,
  timezone: 'Asia/Jakarta',
  cron: '0 7 * * 1-5',
  sendsTo: [],
  enabled: true,
  paused: false,
  managedByChief: true,
  nextAt: '2026-10-29T00:30:00Z',
  lastAt: '2026-10-28T00:30:00Z',
  goalIds: [],
  createdBy: 'operator',
}

describe('routineAdapters', () => {
  test('routineToDetail maps id, name, subtitle, freq, at, timezone from Routine', () => {
    const d = routineToDetail(SEED_ROUTINE)
    expect(d.id).toBe('rtn-morning-brief')
    expect(d.name).toBe('Morning brief')
    expect(d.subtitle).toBe('Chief · weekdays at 07:30 · managed by Chief')
    expect(d.frequency).toBe('Weekdays')
    expect(d.at).toBe('07:30')
    expect(d.zone).toBe('Asia/Jakarta')
    expect(d.managedByChief).toBe(true)
  })

  test('routineToDetail stubs missing backend fields safely', () => {
    // Test with null nextAt/lastAt to verify the '—' fallback
    const nullDates: Routine = { ...SEED_ROUTINE, nextAt: null, lastAt: null }
    const d = routineToDetail(nullDates)
    expect(d.sendsTo).toEqual([]) // TODO: backend will expose delivery channels
    expect(d.runs).toEqual([])    // TODO: backend will expose run history
    expect(d.nextRun).toBe('—')  // fallback when nextAt is null
    expect(d.lastRun).toBe('—')  // fallback when lastAt is null
    expect(d.cost).toBe('—')     // TODO: backend will expose cost estimate
  })

  test('routineToRow maps id, name, paused, enabled from Routine', () => {
    const r = routineToRow(SEED_ROUTINE)
    expect(r.id).toBe('rtn-morning-brief')
    expect(r.name).toBe('Morning brief')
    expect(r.paused).toBe(false)
    expect(r.runs).toHaveLength(8)
  })

  test('routinesToGroups groups by helperId', () => {
    const r2: Routine = { ...SEED_ROUTINE, id: 'rtn-2', helperId: 'dev', name: 'Nightly build' }
    const groups = routinesToGroups([SEED_ROUTINE, r2])
    expect(groups).toHaveLength(2)
    const chiefGroup = groups.find(g => g.agentId === 'chief')
    expect(chiefGroup?.rows).toHaveLength(1)
    expect(chiefGroup?.rows[0].name).toBe('Morning brief')
  })
})

// ── Live-data tests (mock repo + stubbed commands) ─────────────────────────────

const mockRunRoutineNow = vi.fn().mockResolvedValue({ jobId: 'job_1' })

function makeRepos(routines: Routine[]): Repos {
  const stub = (v: unknown) => vi.fn().mockResolvedValue(v)
  return {
    channels: { list: stub([]), get: stub(null) },
    folders: { listByChannel: stub([]), listAll: stub([]) },
    goals: { listByChannel: stub([]), listAll: stub([]) },
    sessions: { get: stub(null), listByChannel: stub([]), listAll: stub([]) },
    messages: { listBySession: stub([]) },
    inbox: { list: stub([]), get: stub(null) },
    billingPlans: { list: stub([]) },
    billingSubscription: { get: stub(null) },
    usage: { get: stub({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: stub({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: stub([]) },
    marketplace: { list: stub([]) },
    connectors: { list: stub([]) },
    mcpTokens: { list: stub([]) },
    flows: { list: stub([]), get: stub(null), runs: stub([]) },
    routines: {
      list: vi.fn().mockResolvedValue(routines),
      get: vi.fn().mockImplementation((id: string) =>
        Promise.resolve(routines.find(r => r.id === id) ?? null)
      ),
    },
    knowledge: { sources: stub([]), list: stub([]) },
    analytics: { overview: stub({ stats: [], series: [] }), helpers: stub([]) },
    skills: { list: stub([]), get: stub(null) },
    helpers: { list: stub([]), get: stub(null) },
    members: { list: stub([]) },
  }
}

function renderWithRepos(path: string, repos: Repos) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const commands = { ...createMockCommands(), runRoutineNow: mockRunRoutineNow }
  const root = createRootRoute({ component: () => <Outlet /> })
  const office = createRoute({ getParentRoute: () => root, id: 'office-live', component: () => (
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <CommandsProvider commands={commands}>
          <Outlet />
        </CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>
  )})
  const list = createRoute({ getParentRoute: () => office, path: '/routines', component: RoutinesRoute })
  const detail = createRoute({ getParentRoute: () => office, path: '/routines/$routineId', component: RoutineDetailRoute })
  const router = createRouter({
    routeTree: root.addChildren([office.addChildren([list, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('RoutinesBoard — live data', () => {
  beforeEach(() => {
    mockRunRoutineNow.mockClear()
  })

  test('list renders routine names from repo, not fixture', async () => {
    renderWithRepos('/routines?view=list', makeRepos([SEED_ROUTINE]))
    expect(await screen.findByText('Morning brief')).toBeInTheDocument()
  })

  test('empty state shown when repo returns zero routines', async () => {
    renderWithRepos('/routines', makeRepos([]))
    expect(await screen.findByText('No routines yet')).toBeInTheDocument()
  })

  test('error state shown when repo rejects', async () => {
    const repos = makeRepos([])
    repos.routines.list = vi.fn().mockRejectedValue(new Error('Network error'))
    renderWithRepos('/routines', repos)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('Run now calls runRoutineNow with the routine id', async () => {
    renderWithRepos('/routines/rtn-morning-brief', makeRepos([SEED_ROUTINE]))
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(mockRunRoutineNow).toHaveBeenCalledWith('rtn-morning-brief'))
  })
})

// ── CTA wiring tests (create / save / delete / skip) ────────────────────────────

/** Render with repos + a spy-wired Commands port so mutations can be asserted. */
function renderWithCommands(path: string, repos: Repos, commands: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const cmds = { ...createMockCommands(), ...commands }
  const root = createRootRoute({ component: () => <Outlet /> })
  const office = createRoute({ getParentRoute: () => root, id: 'office-cmd', component: () => (
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <CommandsProvider commands={cmds as never}>
          <Outlet />
        </CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>
  )})
  const list = createRoute({ getParentRoute: () => office, path: '/routines', component: RoutinesRoute })
  const detail = createRoute({ getParentRoute: () => office, path: '/routines/$routineId', component: RoutineDetailRoute })
  const router = createRouter({
    routeTree: root.addChildren([office.addChildren([list, detail])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('RoutinesBoard — CTA wiring', () => {
  test('New routine → Create routine calls createRoutine with the typed prompt', async () => {
    const createRoutine = vi.fn().mockResolvedValue({ id: 'rtn-new' })
    renderWithCommands('/routines', makeRepos([SEED_ROUTINE]), { createRoutine })
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    const textarea = await screen.findByLabelText('What should happen, and how often?')
    fireEvent.change(textarea, { target: { value: 'Check overdue invoices every Friday' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }))
    await waitFor(() =>
      expect(createRoutine).toHaveBeenCalledWith(
        expect.objectContaining({ instructions: 'Check overdue invoices every Friday' }),
      ),
    )
  })

  test('Delete confirm → Delete routine calls deleteRoutine with the id', async () => {
    const deleteRoutine = vi.fn().mockResolvedValue(undefined)
    renderWithCommands('/routines/rtn-morning-brief?state=delete', makeRepos([SEED_ROUTINE]), { deleteRoutine })
    const confirm = await screen.findByRole('button', { name: 'Delete routine' })
    fireEvent.click(confirm)
    await waitFor(() => expect(deleteRoutine).toHaveBeenCalled())
  })

  test('row menu → Skip next run calls skipRoutineNext', async () => {
    const skipRoutineNext = vi.fn().mockResolvedValue({ next_at: null })
    renderWithCommands('/routines?view=list', makeRepos([SEED_ROUTINE]), { skipRoutineNext })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Skip next run/ }))
    await waitFor(() => expect(skipRoutineNext).toHaveBeenCalledWith('rtn-morning-brief'))
  })

  test('detail Save calls updateRoutine with the edited instructions', async () => {
    const updateRoutine = vi.fn().mockResolvedValue({ id: 'rtn-morning-brief' })
    renderWithCommands('/routines/rtn-morning-brief', makeRepos([SEED_ROUTINE]), { updateRoutine })
    const textarea = await screen.findByLabelText('What it does')
    fireEvent.change(textarea, { target: { value: 'New instructions' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRoutine).toHaveBeenCalledWith(
        'rtn-morning-brief',
        expect.objectContaining({ instructions: 'New instructions' }),
      ),
    )
  })
})
