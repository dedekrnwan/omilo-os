import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import { goals as goalsFixture } from '../../adapters/mock/fixtures'
import type { Goal } from '../../core/domain/types'
import { useUIStore } from '../../app/store'
import { ModeLayout } from '../shell/ModeLayout'
import { OfficeGoalsRoute } from './GoalsRoute'

// Snapshot the goals fixture so each test starts from the same list (the mock
// command layer mutates the shared array in place).
const GOALS_SNAPSHOT: Goal[] = goalsFixture.map((g) => ({ ...g }))
function resetGoals() {
  goalsFixture.splice(0, goalsFixture.length, ...GOALS_SNAPSHOT.map((g) => ({ ...g })))
}

function makeRouter(initialPath = '/goals', overrides: Partial<ReturnType<typeof createMockCommands>> = {}) {
  useUIStore.setState({ mode: 'office', areaId: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  const commands = { ...createMockCommands(), ...overrides }

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <CommandsProvider commands={commands}>
            <Outlet />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const officeRoute = createRoute({ getParentRoute: () => rootRoute, id: 'office', component: () => <ModeLayout /> })
  const goalsRoute = createRoute({ getParentRoute: () => officeRoute, path: 'goals', component: OfficeGoalsRoute })
  const chatSessionRoute = createRoute({
    getParentRoute: () => officeRoute,
    path: 'chat/$sessionId',
    component: () => <div data-testid="session">session</div>,
  })

  const routeTree = rootRoute.addChildren([officeRoute.addChildren([goalsRoute, chatSessionRoute])])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  return { router: createRouter({ routeTree, history }) }
}

// Rendering the full board is slow on a loaded CI box; the first test also pays warm-up.
describe('Goals CRUD wiring', { timeout: 20_000 }, () => {
  beforeEach(() => resetGoals())

  test('Create goal adds a new goal that appears in the list', async () => {
    const user = userEvent.setup()
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /New goal/i }))

    const input = await screen.findByLabelText(/^Goal$/i)
    fireEvent.change(input, { target: { value: 'Ship the new onboarding' } })

    await user.click(screen.getByRole('button', { name: /^Create goal$/i }))

    await waitFor(() => {
      expect(screen.getByText('Ship the new onboarding')).toBeInTheDocument()
    })
  })

  test('Create goal button is disabled when the goal text is blank', async () => {
    const user = userEvent.setup()
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /New goal/i }))

    await screen.findByLabelText(/^Goal$/i)
    const create = screen.getByRole('button', { name: /^Create goal$/i })
    expect(create).toBeDisabled()
  })

  test('Delete goal via the sad-mascot confirm removes the row', async () => {
    const user = userEvent.setup()
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByText('Close October books')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Goal options for Close October books/i }))
    await user.click(await screen.findByText('Delete goal'))

    // Confirm dialog appears with the destructive button
    const confirm = await screen.findByRole('button', { name: /^Delete$/i })
    await user.click(confirm)

    await waitFor(() => {
      expect(screen.queryByText('Close October books')).not.toBeInTheDocument()
    })
  })

  test('Edit goal opens the dialog seeded with the goal title', async () => {
    const user = userEvent.setup()
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByText('Close October books')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Goal options for Close October books/i }))
    await user.click(await screen.findByText('Edit goal'))

    const input = (await screen.findByLabelText(/^Goal$/i)) as HTMLTextAreaElement
    expect(input.value).toBe('Close October books')
    expect(screen.getByRole('button', { name: /^Save goal$/i })).toBeInTheDocument()
  })

  test('clicking a goal title opens its chat session', async () => {
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByText('Close October books')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Close October books' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\/ses/)
    })
  })

  // ── sweep/goals-routines ──

  test('status drives the ring label, tabs counts and filtering', async () => {
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(screen.getByText('Postgres 16 upgrade')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /^Blocked\s*1$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Needs you\s*1$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Blocked/ }))
    await waitFor(() => expect(screen.queryByText('Close October books')).not.toBeInTheDocument())
    expect(screen.getByText('Postgres 16 upgrade')).toBeInTheDocument()
  })

  test('topbar shows the goals’ real period', async () => {
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('All areas · Q4 2026')).toBeInTheDocument()
  })

  test('opening a goal creates its session once, then reuses it', async () => {
    const openGoalSession = vi.fn().mockResolvedValue({ id: 'ses-goal-x', title: 'x', updated: 'now' })
    const { router } = makeRouter('/goals', { openGoalSession })
    await router.load()
    render(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Close October books' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat/ses-goal-x'))
    expect(openGoalSession).toHaveBeenCalledWith('g-books')
  })

  test('Replan calls replanGoal', async () => {
    const user = userEvent.setup()
    const replanGoal = vi.fn().mockResolvedValue({ jobId: 'job-1' })
    const { router } = makeRouter('/goals', { replanGoal })
    await router.load()
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('button', { name: /Goal options for Close October books/i }))
    await user.click(await screen.findByText('Replan'))
    await waitFor(() => expect(replanGoal).toHaveBeenCalledWith('g-books'))
  })

  test('create sends measured by, helpers and the draft-key-results flag', async () => {
    const createGoal = vi.fn().mockResolvedValue({ id: 'g-new', channelId: 'ch-general', title: 'X', progress: 0 })
    const { router } = makeRouter('/goals', { createGoal })
    await router.load()
    render(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: /New goal/i }))
    fireEvent.change(await screen.findByLabelText(/^Goal$/i), { target: { value: 'Grow signups' } })
    fireEvent.change(screen.getByLabelText(/^Measured by$/i), { target: { value: 'Weekly signups' } })
    fireEvent.change(screen.getByLabelText(/^Target$/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/^Due$/i), { target: { value: '2026-12-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add helper' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Growth' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Let Chief draft key results' }))
    fireEvent.click(screen.getByRole('button', { name: /^Create goal$/i }))
    await waitFor(() =>
      expect(createGoal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Grow signups', measuredBy: 'Weekly signups', target: '500', due: '2026-12-15',
          helperIds: ['h-growth'], draftKeyResults: false, period: '2026-Q4',
        }),
      ),
    )
  })

  test('edit prefills target / measured by / due and can override status', async () => {
    const user = userEvent.setup()
    const updateGoal = vi.fn().mockResolvedValue({ id: 'g-books', channelId: 'ch-general', title: 'Close October books', progress: 70 })
    const { router } = makeRouter('/goals', { updateGoal })
    await router.load()
    render(<RouterProvider router={router} />)
    await user.click(await screen.findByRole('button', { name: /Goal options for Close October books/i }))
    await user.click(await screen.findByText('Edit goal'))
    expect(await screen.findByLabelText(/^Target$/i)).toHaveValue('100%')
    expect(screen.getByLabelText(/^Measured by$/i)).toHaveValue('Accounts reconciled')
    expect(screen.getByLabelText(/^Due$/i)).toHaveValue('2026-11-07')
    fireEvent.change(screen.getByLabelText(/^Status$/i), { target: { value: 'at_risk' } })
    fireEvent.click(screen.getByRole('button', { name: /^Save goal$/i }))
    await waitFor(() =>
      expect(updateGoal).toHaveBeenCalledWith('g-books', expect.objectContaining({ target: '100%', status: 'at_risk' })),
    )
  })

  test('expanding a goal shows the work Chief planned', async () => {
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show work for Close October books' }))
    const list = await screen.findByRole('list', { name: 'Key results' })
    expect(list).toHaveTextContent('Step 1 toward: Close October books')
  })
})
