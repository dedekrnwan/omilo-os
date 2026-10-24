import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
import { FlowsRoute } from './FlowsRoute'

function makeRouter(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })

  const chatRoute = createRoute({ getParentRoute: () => rootRoute, path: '/chat', component: () => <Outlet /> })
  const channelRoute = createRoute({ getParentRoute: () => chatRoute, path: '$channelId', component: () => <Outlet /> })
  const flowsRoute = createRoute({ getParentRoute: () => channelRoute, path: 'flows', component: FlowsRoute })

  const tree = rootRoute.addChildren([chatRoute.addChildren([channelRoute.addChildren([flowsRoute])])])
  const history = createMemoryHistory({ initialEntries: [path] })
  return createRouter({ routeTree: tree, history })
}

describe('FlowsRoute — tab switching', () => {
  test('renders Yours tab by default showing flow cards', async () => {
    const router = makeRouter('/chat/ch-engineering/flows')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Deploy failure triage')).toBeInTheDocument()
    })
  })

  test('clicking Suggested tab shows suggested flows', async () => {
    const router = makeRouter('/chat/ch-engineering/flows')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const suggestedTab = screen.getByRole('button', { name: /suggested by agents/i })
      fireEvent.click(suggestedTab)
    })

    await waitFor(() => {
      expect(screen.getByText(/triage failed deploys for you\?/i)).toBeInTheDocument()
    })
  })

  test('clicking Templates tab shows template grid', async () => {
    const router = makeRouter('/chat/ch-engineering/flows')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Find the nav-level "Templates" tab (not the category filter pills)
      const buttons = screen.getAllByRole('button', { name: 'Templates' })
      fireEvent.click(buttons[0])
    })

    await waitFor(() => {
      expect(screen.getByText('Incident → postmortem')).toBeInTheDocument()
      expect(screen.getByText('12 templates')).toBeInTheDocument()
    })
  })

  test('clicking Runs tab shows stats and table', async () => {
    const router = makeRouter('/chat/ch-engineering/flows')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const runsTab = screen.getByRole('button', { name: 'Runs' })
      fireEvent.click(runsTab)
    })

    await waitFor(() => {
      // Stats row
      expect(screen.getByText('142')).toBeInTheDocument()
      // Table row
      expect(screen.getByText('Freeze-window guard')).toBeInTheDocument()
    })
  })
})
