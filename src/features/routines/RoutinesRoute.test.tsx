import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import type { Repos } from '../../core/ports/repos'
import type {
  Helper,
  Routine,
  RoutinePreview,
  RoutineRunDetail,
  RoutineRunSummary,
  RoutineSchedule,
  RoutineScheduleItem,
  RoutineSuggestion,
} from '../../core/domain/types'
import { cadenceLabel, routineToDetail, routineToRow, routinesToGroups } from './routineAdapters'
import { buildLanes, weekRange } from './data'
import { guessCadence, guessHelper } from './guess'
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { RoutineDetailRoute, RoutinesRoute } from './RoutinesRoute'

// Real-shaped helper ids (HTTP mode uses `hlp_…`, never 'chief'/'dev').
const HELPERS: Helper[] = [
  { id: 'hlp_chief', name: 'Chief', area: 'brand', isChief: true },
  { id: 'hlp_ops', name: 'Ops', area: 'ops' },
  { id: 'hlp_fin', name: 'Finance', area: 'finance' },
]

const iso = (daysFromNow: number, hh = 7, mm = 30) => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

const run = (id: string, routineId: string, ago: number, outcome: RoutineRunSummary['outcome'] = 'ok', error: string | null = null): RoutineRunSummary => ({
  id, routineId, jobId: `job_${id}`, at: iso(-ago), outcome, duration: 110, costCredits: 3,
  trigger: 'schedule', error, feedback: null,
})

const base: Omit<Routine, 'id' | 'helperId' | 'name' | 'freq' | 'at'> = {
  companyId: 'cmp_1', subtitle: '', instructions: 'Do the thing.', days: [], monthly: null,
  timezone: 'Asia/Jakarta', cron: '', sendsTo: [], enabled: true, paused: false, managedByChief: true,
  nextAt: iso(1), lastAt: null, goalIds: [], createdBy: 'operator',
}

const ROUTINES: Routine[] = [
  { ...base, id: 'rtn_brief', helperId: 'hlp_chief', name: 'Morning brief', freq: 'weekdays', at: '07:30',
    instructions: 'Summarise what moved yesterday.',
    runs: [run('rrn_b1', 'rtn_brief', 2), run('rrn_b2', 'rtn_brief', 1)] },
  { ...base, id: 'rtn_checkins', helperId: 'hlp_chief', name: 'Goal check-ins', freq: 'weekly', days: [0, 3], at: '09:00',
    managedByChief: false },
  { ...base, id: 'rtn_digest', helperId: 'hlp_ops', name: 'On-call digest', freq: 'daily', at: '08:00',
    runs: [run('rrn_d1', 'rtn_digest', 3), run('rrn_d2', 'rtn_digest', 2, 'fail', 'PagerDuty API timed out')] },
  { ...base, id: 'rtn_ads', helperId: 'hlp_ops', name: 'Ad spend review', freq: 'weekly', days: [2], at: '14:00',
    paused: true, managedByChief: false },
  { ...base, id: 'rtn_costs', helperId: 'hlp_fin', name: 'Monthly cost review', freq: 'monthly', at: '09:00',
    monthly: 'last_working_day' },
]

const SUGGESTION: RoutineSuggestion = {
  id: 'sug_1', kind: 'clash', title: 'Ops has two routines at the same time',
  desc: 'On-call digest and Backups both start around 08:00.',
  moves: [{ routineId: 'rtn_digest', name: 'On-call digest', helperId: 'hlp_ops', helperName: 'Ops',
    from: 'Every day · 08:00', to: 'Every day · 09:00', fromAt: '08:00', toAt: '09:00' }],
  note: 'Chief never moves routines you’ve locked.',
}

function schedule(from: string, to: string): RoutineSchedule {
  const r = weekRange(0)
  const items: RoutineScheduleItem[] = [0, 1, 2, 3, 4].map((d) => {
    const t = new Date(r.start)
    t.setDate(t.getDate() + d)
    t.setHours(7, 30)
    return { routineId: 'rtn_brief', helperId: 'hlp_chief', name: 'Morning brief', at: t.toISOString(), status: 'scheduled', runId: null, trigger: 'schedule' }
  })
  const f = new Date(r.start)
  f.setDate(f.getDate() + 1)
  f.setHours(8, 0)
  items.push({ routineId: 'rtn_digest', helperId: 'hlp_ops', name: 'On-call digest', at: f.toISOString(), status: 'fail', runId: 'rrn_d2', trigger: 'schedule' })
  return { from, to, items }
}

const RUN_DETAIL: RoutineRunDetail = {
  run: run('rrn_b2', 'rtn_brief', 1),
  routine: { id: 'rtn_brief', name: 'Morning brief', helperId: 'hlp_chief', helperName: 'Chief', sendsTo: [] },
  job: { id: 'job_rrn_b2', status: 'done', error: null, attempts: 1, costCredits: 3, tokensIn: 10, tokensOut: 5, startedAt: iso(-1), endedAt: iso(-1, 7, 32) },
  running: false,
  steps: [
    { at: iso(-1), text: 'Run started · schedule trigger', error: false },
    { at: iso(-1, 7, 32), text: 'Produced output', error: false },
  ],
  logs: [{ at: iso(-1), level: 'info', text: 'status: started' }],
  output: { headline: 'Three goals moved', bodyMd: '- Passkeys shipped', lines: ['Passkeys shipped', 'Postgres at risk'] },
  sources: [{ title: 'Goals' }],
  delivery: { sendsTo: [], delivered: false, note: 'Saved to the activity log' },
}

const FAIL_DETAIL: RoutineRunDetail = {
  ...RUN_DETAIL,
  run: run('rrn_d2', 'rtn_digest', 2, 'fail', 'PagerDuty API timed out'),
  routine: { id: 'rtn_digest', name: 'On-call digest', helperId: 'hlp_ops', helperName: 'Ops', sendsTo: [] },
  job: { ...RUN_DETAIL.job!, status: 'failed', error: 'PagerDuty API timed out' },
  steps: [{ at: iso(-2), text: 'PagerDuty API timed out', error: true }],
  logs: [{ at: iso(-2), level: 'error', text: 'failed: PagerDuty API timed out' }],
  output: null,
}

function makeRepos(routines: Routine[] = ROUTINES, opts: { suggestions?: RoutineSuggestion[]; runDetail?: Partial<RoutineRunDetail> } = {}): Repos {
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
      get: vi.fn().mockImplementation((id: string) => Promise.resolve(routines.find((r) => r.id === id) ?? null)),
      schedule: vi.fn().mockImplementation((from: string, to: string) => Promise.resolve(schedule(from, to))),
      run: vi.fn().mockImplementation((_rid: string, runId: string) =>
        Promise.resolve(runId === 'rrn_d2' ? FAIL_DETAIL : { ...RUN_DETAIL, ...opts.runDetail }),
      ),
      suggestions: vi.fn().mockResolvedValue(opts.suggestions ?? [SUGGESTION]),
    },
    knowledge: { sources: stub([]), list: stub([]) },
    analytics: { overview: stub({ stats: [], series: [] }), helpers: stub([]) },
    skills: { list: stub([]), get: stub(null) },
    helpers: { list: stub(HELPERS), get: stub(null) },
    members: { list: stub([]) },
  }
}

function renderAt(path: string, repos: Repos = makeRepos(), commands: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const cmds = { ...createMockCommands(), ...commands }
  const root = createRootRoute({ component: () => <Outlet /> })
  const office = createRoute({
    getParentRoute: () => root,
    id: 'office',
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <CommandsProvider commands={cmds as never}>
            <Outlet />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const list = createRoute({ getParentRoute: () => office, path: '/routines', component: RoutinesRoute })
  const detail = createRoute({ getParentRoute: () => office, path: '/routines/$routineId', component: RoutineDetailRoute })
  const chat = createRoute({ getParentRoute: () => office, path: '/chat', component: () => <div>chat</div> })
  const router = createRouter({
    routeTree: root.addChildren([office.addChildren([list, detail, chat])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return router
}

describe('Routines · Week', () => {
  test('banner, today header, lanes and legend come from real data', async () => {
    renderAt('/routines')
    // A failed run this week turns the banner red.
    expect(await screen.findByText('1 routine run failed this week')).toBeInTheDocument()
    expect(screen.getByText(/On-call digest · .* · PagerDuty API timed out/)).toBeInTheDocument()
    expect(screen.getByText(/· TODAY$/)).toBeInTheDocument()
    expect(await screen.findByText('Morning brief · weekdays')).toBeInTheDocument()
    expect(screen.getByText('Set by you · 2')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Ops' })).toBeInTheDocument()
  })

  test('without failures the banner summarises routines, next run and suggestions', async () => {
    const repos = makeRepos()
    repos.routines.schedule = vi.fn().mockImplementation((from: string, to: string) => {
      const s = schedule(from, to)
      return Promise.resolve({ ...s, items: s.items.filter((i) => i.status !== 'fail') })
    })
    renderAt('/routines', repos)
    expect(await screen.findByText('Chief keeps 5 routines running across 3 agents')).toBeInTheDocument()
    expect(await screen.findByText(/1 suggestion from Chief/)).toBeInTheDocument()
  })

  test('failed chip opens the failure popover with the real error; Retry runs it', async () => {
    const runRoutineNow = vi.fn().mockResolvedValue({ jobId: 'job_x', runId: 'rrn_x' })
    renderAt('/routines', makeRepos(), { runRoutineNow })
    fireEvent.click(await screen.findByRole('button', { name: /failed — details/ }))
    const pop = await screen.findByRole('dialog', { name: 'On-call digest failed' })
    expect(pop).toHaveTextContent('PagerDuty API timed out')
    fireEvent.click(within(pop).getByRole('button', { name: /Retry now/ }))
    await waitFor(() => expect(runRoutineNow).toHaveBeenCalledWith('rtn_digest'))
  })

  test('prev / today / next move the week', async () => {
    const repos = makeRepos()
    renderAt('/routines', repos)
    const label = weekRange(0).label
    await screen.findByText(label)
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(await screen.findByText(weekRange(1).label)).toBeInTheDocument()
    await waitFor(() => expect(repos.routines.schedule).toHaveBeenCalledWith(weekRange(1).start.toISOString(), weekRange(1).end.toISOString()))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(await screen.findByText(label)).toBeInTheDocument()
  })
})

describe('Routines · List', () => {
  test('shows the Chief suggestion and rows with real helper names', async () => {
    renderAt('/routines?view=list')
    expect(await screen.findByText('Ops has two routines at the same time')).toBeInTheDocument()
    expect(await screen.findByText('Goal check-ins')).toBeInTheDocument()
    expect(screen.getByText('Mon & Thu · 09:00')).toBeInTheDocument()
    expect(screen.getByText('Paused')).toBeInTheDocument()
    const region = screen.getByRole('region', { name: 'Routines' })
    expect(within(region).getByText('Finance')).toBeInTheDocument()
  })

  test('Apply calls applyRoutineSuggestion and shows the toast', async () => {
    const applyRoutineSuggestion = vi.fn().mockResolvedValue({ applied: ['rtn_digest'] })
    renderAt('/routines?view=list', makeRepos(), { applyRoutineSuggestion })
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyRoutineSuggestion).toHaveBeenCalledWith('sug_1'))
    expect(await screen.findByText('1 routine moved')).toBeInTheDocument()
    expect(screen.getByText('On-call digest → Every day · 09:00')).toBeInTheDocument()
  })

  test('Not now dismisses the suggestion', async () => {
    const dismissRoutineSuggestion = vi.fn().mockResolvedValue(undefined)
    renderAt('/routines?view=list', makeRepos(), { dismissRoutineSuggestion })
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(dismissRoutineSuggestion).toHaveBeenCalledWith('sug_1'))
  })

  test('agent filter narrows the list', async () => {
    renderAt('/routines?view=list')
    await screen.findByText('Goal check-ins')
    fireEvent.click(screen.getByRole('button', { name: 'Filter by agent' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Finance' }))
    await waitFor(() => expect(screen.queryByText('Goal check-ins')).not.toBeInTheDocument())
    expect(screen.getByText('Monthly cost review')).toBeInTheDocument()
  })

  test('row switch pauses / resumes via updateRoutine', async () => {
    const updateRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    renderAt('/routines?view=list', makeRepos(), { updateRoutine })
    fireEvent.click(await screen.findByRole('switch', { name: 'Morning brief on' }))
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('rtn_brief', { paused: true }))
    fireEvent.click(screen.getByRole('switch', { name: 'Ad spend review on' }))
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('rtn_ads', { paused: false }))
  })

  test('row menu: Run now calls runRoutineNow and opens the running state', async () => {
    const runRoutineNow = vi.fn().mockResolvedValue({ jobId: 'job_1', runId: 'rrn_b2' })
    const router = renderAt('/routines?view=list', makeRepos(), { runRoutineNow })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Run now/ }))
    await waitFor(() => expect(runRoutineNow).toHaveBeenCalledWith('rtn_brief'))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'running', run: 'rrn_b2' }))
  })

  test('row menu: Skip shows the real next date and calls skipRoutineNext', async () => {
    const skipRoutineNext = vi.fn().mockResolvedValue({ nextAt: iso(2) })
    renderAt('/routines?view=list', makeRepos(), { skipRoutineNext })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    const d = new Date(ROUTINES[0].nextAt!)
    const hint = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()}`
    const item = screen.getByRole('menuitem', { name: /Skip next run/ })
    expect(item).toHaveTextContent(hint)
    fireEvent.click(item)
    await waitFor(() => expect(skipRoutineNext).toHaveBeenCalledWith('rtn_brief'))
  })

  test('row menu → Delete confirm; Pause instead patches paused', async () => {
    const updateRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    renderAt('/routines?view=list', makeRepos(), { updateRoutine })
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for Morning brief' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete routine/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete “Morning brief”?')
    fireEvent.click(screen.getByRole('button', { name: 'Pause instead' }))
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('rtn_brief', { paused: true }))
  })

  test('Delete confirm deep link deletes that routine', async () => {
    const deleteRoutine = vi.fn().mockResolvedValue(undefined)
    renderAt('/routines/rtn_brief?state=delete', makeRepos(), { deleteRoutine })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete routine' }))
    await waitFor(() => expect(deleteRoutine).toHaveBeenCalledWith('rtn_brief'))
  })

  test('Last-8 bar: tooltip from the run, click opens the run detail', async () => {
    renderAt('/routines?view=list')
    const bar = await screen.findByRole('button', { name: 'On-call digest — run 8 of 8: Failed' })
    fireEvent.mouseEnter(bar)
    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent('PagerDuty API timed out')
    expect(tip).toHaveTextContent('Ops')
    fireEvent.click(bar)
    const drawer = await screen.findByRole('dialog')
    expect(drawer).toHaveTextContent('On-call digest · Ops')
    await waitFor(() => expect(drawer).toHaveTextContent('Why it failed'))
    expect(drawer).toHaveTextContent('Logs')
    expect(screen.getByRole('button', { name: 'Re-run now' })).toBeInTheDocument()
  })

  test('Last-8 bar: a successful run shows its output', async () => {
    renderAt('/routines?view=list')
    fireEvent.click(await screen.findByRole('button', { name: 'Morning brief — run 8 of 8: Success' }))
    const drawer = await screen.findByRole('dialog')
    await waitFor(() => expect(drawer).toHaveTextContent('Passkeys shipped'))
    expect(drawer).not.toHaveTextContent('Why it failed')
  })

  test('unknown helper ids fall back instead of crashing', async () => {
    renderAt('/routines?view=list', makeRepos([{ ...ROUTINES[0], helperId: 'hlp_gone' }], { suggestions: [] }))
    expect(await screen.findByText('Morning brief')).toBeInTheDocument()
    expect(screen.getByText('Helper')).toBeInTheDocument()
  })
})

describe('Routines · Empty + New', () => {
  test('empty state sets up the checked templates with real helpers', async () => {
    const createRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    renderAt('/routines', makeRepos([]), { createRoutine })
    expect(await screen.findByText('No routines yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Social calendar/ }))
    const cta = await screen.findByRole('button', { name: /Let Chief set up 5 routines/ })
    await waitFor(() => expect(screen.getAllByText(/^Finance · Weekdays · 10:00$/).length).toBe(1))
    fireEvent.click(cta)
    await waitFor(() => expect(createRoutine).toHaveBeenCalledTimes(5))
    expect(createRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Invoice chaser', helperId: 'hlp_fin', freq: 'weekdays', at: '10:00' }),
    )
    expect(createRoutine).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Weekly retro', helperId: 'hlp_chief', freq: 'weekly', days: [4] }),
    )
  })

  test('New routine reads cadence + helper from the prompt and sends days + timezone', async () => {
    const createRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    renderAt('/routines', makeRepos(), { createRoutine })
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    const textarea = await screen.findByLabelText('What should happen, and how often?')
    expect(textarea).toHaveValue('')
    fireEvent.change(textarea, { target: { value: 'Every Friday at 15:30 check overdue invoices' } })
    expect(await screen.findByText('Fridays · 15:30')).toBeInTheDocument()
    await screen.findByText(/No clashes — Finance is free at 15:30/)
    fireEvent.click(screen.getByRole('button', { name: 'Create routine' }))
    await waitFor(() =>
      expect(createRoutine).toHaveBeenCalledWith(
        expect.objectContaining({
          instructions: 'Every Friday at 15:30 check overdue invoices',
          helperId: 'hlp_fin',
          freq: 'weekly',
          days: [4],
          at: '15:30',
          timezone: expect.any(String),
          allowChiefShift: true,
        }),
      ),
    )
  })

  test('clash: preview clashes list open slots; picking one moves the time', async () => {
    const preview: RoutinePreview = {
      nextAt: iso(2), nextDates: [iso(2)], label: 'Fridays · 15:00',
      clashes: [{ routineId: 'rtn_x', name: 'Payout reconcile', helperId: 'hlp_fin', at: '15:00', cadence: 'Fridays · 15:00', when: iso(2) }],
      suggestedSlots: [
        { freq: 'weekly', at: '15:30', days: [4], monthly: null, label: 'Fridays · 15:30', nextAt: null, recommended: true, reason: 'Right after Payout reconcile' },
        { freq: 'weekly', at: '16:00', days: [4], monthly: null, label: 'Fridays · 16:00', nextAt: null, recommended: false, reason: 'Right after Payout reconcile' },
      ],
    }
    const previewRoutine = vi.fn().mockImplementation((input: { at: string }) =>
      Promise.resolve(input.at === '15:00' ? preview : { ...preview, clashes: [], suggestedSlots: [] }),
    )
    renderAt('/routines?state=clash', makeRepos(), { previewRoutine })
    const textarea = await screen.findByLabelText('What should happen, and how often?')
    fireEvent.change(textarea, { target: { value: 'Every Friday at 15:00 reconcile invoices' } })
    expect(await screen.findByText('Fridays · 15:00 clashes with Payout reconcile')).toBeInTheDocument()
    expect(screen.getByText('Chief found 2 open slots:')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Fridays · 15:30 — recommended/ }))
    expect(await screen.findByText(/No clashes — Finance is free at 15:30/)).toBeInTheDocument()
  })
})

describe('Routines · Detail drawer', () => {
  test('detail shows real status tiles, schedule and recent runs', async () => {
    renderAt('/routines/rtn_brief')
    const drawer = await screen.findByRole('dialog', { name: 'Morning brief' })
    expect(drawer).toHaveTextContent('Chief · weekdays at 07:30 · managed by Chief')
    expect(drawer).toHaveTextContent('Recent runs')
    expect(drawer).toHaveTextContent('~3 credits a run')
    expect(screen.getByRole('tab', { name: 'Weekdays' })).toHaveAttribute('aria-selected', 'true')
  })

  test('Save sends instructions + normalised schedule + flags', async () => {
    const updateRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    renderAt('/routines/rtn_brief', makeRepos(), { updateRoutine })
    fireEvent.change(await screen.findByLabelText('What it does'), { target: { value: 'New instructions' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Let Chief move this' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(updateRoutine).toHaveBeenCalledWith(
        'rtn_brief',
        expect.objectContaining({ instructions: 'New instructions', freq: 'weekdays', at: '07:30', helperId: 'hlp_chief', allowChiefShift: false }),
      ),
    )
  })

  test('Run now → running state polls the run; Stop calls cancelJob', async () => {
    const runRoutineNow = vi.fn().mockResolvedValue({ jobId: 'job_live', runId: 'rrn_live' })
    const cancelJob = vi.fn().mockResolvedValue({ jobId: 'job_live', status: 'cancelled' })
    const repos = makeRepos(ROUTINES, { runDetail: { running: true, job: { ...RUN_DETAIL.job!, id: 'job_live', status: 'running', endedAt: null } } })
    const router = renderAt('/routines/rtn_brief', repos, { runRoutineNow, cancelJob })
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(runRoutineNow).toHaveBeenCalledWith('rtn_brief'))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'running', run: 'rrn_live' }))
    expect(await screen.findByText(/Running now · step 3 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await waitFor(() => expect(cancelJob).toHaveBeenCalledWith('job_live'))
  })

  test('run-now errors are surfaced, not swallowed', async () => {
    const runRoutineNow = vi.fn().mockRejectedValue(new Error('Out of credits'))
    renderAt('/routines/rtn_brief', makeRepos(), { runRoutineNow })
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(runRoutineNow).toHaveBeenCalled())
    // notify() pushes a toast into the store; the board stays on the detail.
    expect(screen.getByRole('dialog', { name: 'Morning brief' })).toBeInTheDocument()
  })

  test('Pause patches paused and Resume clears it', async () => {
    const updateRoutine = vi.fn().mockResolvedValue(ROUTINES[0])
    const router = renderAt('/routines/rtn_brief', makeRepos(), { updateRoutine })
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('rtn_brief', { paused: true }))
    await waitFor(() => expect(router.state.location.search).toEqual({ state: 'paused' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Resume now' }))
    await waitFor(() => expect(updateRoutine).toHaveBeenCalledWith('rtn_brief', { paused: false }))
  })

  test('paused-until date patches pausedUntil', async () => {
    const updateRoutine = vi.fn().mockResolvedValue(ROUTINES[3])
    renderAt('/routines/rtn_ads?state=paused', makeRepos(), { updateRoutine })
    const input = await screen.findByLabelText('Paused until')
    fireEvent.change(input, { target: { value: '2030-01-15' } })
    await waitFor(() =>
      expect(updateRoutine).toHaveBeenCalledWith('rtn_ads', { pausedUntil: new Date('2030-01-15T00:00:00').toISOString() }),
    )
  })

  test('output drawer shows the run output; feedback + re-send are wired', async () => {
    const routineRunFeedback = vi.fn().mockResolvedValue(RUN_DETAIL.run)
    const resendRoutineRun = vi.fn().mockResolvedValue({ resent: false, jobId: 'j', runId: 'r', message: 'Ran again' })
    renderAt('/routines/rtn_brief?state=output&run=rrn_b2', makeRepos(), { routineRunFeedback, resendRoutineRun })
    expect(await screen.findByText('Three goals moved')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }))
    await waitFor(() => expect(routineRunFeedback).toHaveBeenCalledWith('rrn_b2', 'up'))
    fireEvent.click(screen.getByRole('button', { name: /Re-send/ }))
    await waitFor(() => expect(resendRoutineRun).toHaveBeenCalledWith('rrn_b2'))
    expect(screen.getByRole('button', { name: 'Open routine' })).toBeInTheDocument()
  })

  test('weekly reassign lists real helpers; days reflect the routine', async () => {
    renderAt('/routines/rtn_checkins?state=reassign')
    const list = await screen.findByRole('listbox', { name: 'Who does it' })
    expect(list).toHaveTextContent('Finance')
    expect(list).toHaveTextContent('Chief’s pick')
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'false')
  })

  test('monthly routine selects last working day', async () => {
    renderAt('/routines/rtn_costs')
    expect(await screen.findByRole('button', { name: /Last working day/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('routine adapters + helpers', () => {
  test('routineToDetail maps fields, runs, cost and sendsTo', () => {
    const d = routineToDetail({ ...ROUTINES[0], sendsTo: [{ channel: 'whatsapp', id: '+62' }] }, 'Chief')
    expect(d.frequency).toBe('Weekdays')
    expect(d.agentId).toBe('hlp_chief')
    expect(d.sendsTo).toEqual([{ icon: 'message-circle', label: 'WhatsApp' }])
    expect(d.runs).toHaveLength(2)
    expect(d.cost).toBe('~3 credits a run')
    expect(d.latestRunId).toBe('rrn_b2')
  })

  test('routineToRow pads runs to 8 bars, newest last', () => {
    const r = routineToRow(ROUTINES[2])
    expect(r.runs).toEqual(['none', 'none', 'none', 'none', 'none', 'none', 'ok', 'fail'])
    expect(r.runRefs[7]?.id).toBe('rrn_d2')
  })

  test('routinesToGroups groups by helperId', () => {
    const groups = routinesToGroups(ROUTINES)
    expect(groups.map((g) => g.agentId)).toEqual(['hlp_chief', 'hlp_ops', 'hlp_fin'])
  })

  test('cadenceLabel', () => {
    expect(cadenceLabel(ROUTINES[1])).toBe('Mon & Thu · 09:00')
    expect(cadenceLabel(ROUTINES[4])).toBe('Last working day · 09:00')
  })

  test('buildLanes merges consecutive days into one chip', () => {
    const range = weekRange(0)
    const lanes = buildLanes(schedule(range.start.toISOString(), range.end.toISOString()).items, range, () => 1)
    const chief = lanes.find((l) => l.agentId === 'hlp_chief')!
    expect(chief.chips).toHaveLength(1)
    expect(chief.chips[0]).toMatchObject({ span: 5, label: 'Morning brief · weekdays', day: 0 })
    expect(lanes.find((l) => l.agentId === 'hlp_ops')!.chips[0].failed).toBe(true)
  })

  test('guessCadence / guessHelper', () => {
    expect(guessCadence('every weekday at 7:30am')).toMatchObject({ freq: 'Weekdays', at: '07:30' })
    expect(guessCadence('Mondays and Thursdays 9am')).toMatchObject({ freq: 'Weekly', days: [0, 3], at: '09:00' })
    expect(guessCadence('last working day of the month')).toMatchObject({ freq: 'Monthly', monthly: 'last-working-day' })
    expect(guessHelper('chase overdue invoices', HELPERS)?.id).toBe('hlp_fin')
    expect(guessHelper('something general', HELPERS)?.id).toBe('hlp_chief')
  })
})
