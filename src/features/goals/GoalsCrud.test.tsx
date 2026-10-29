import { describe, test, expect, beforeEach } from 'vitest'
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

function makeRouter(initialPath = '/goals') {
  useUIStore.setState({ mode: 'office', areaId: null })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  const commands = createMockCommands()

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

describe('Goals CRUD wiring', () => {
  beforeEach(() => resetGoals())

  test('Create goal adds a new goal that appears in the list', async () => {
    const user = userEvent.setup()
    const { router } = makeRouter()
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /New goal/i }))

    const input = await screen.findByLabelText(/^Goal$/i)
    await user.type(input, 'Ship the new onboarding')

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
})
