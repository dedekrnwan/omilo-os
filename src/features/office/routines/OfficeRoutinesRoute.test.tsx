/**
 * Smoke test: /office/routines renders the Routines board and the sidebar
 * NavLink for Routines carries aria-current="true".
 *
 * Mirrors src/app/routeSmoke.test.tsx — minimal memory router that replicates
 * the production officeRoute → officeRoutinesRoute parent/child shape.
 */
import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { useUIStore } from '../../../app/store'
import { ModeLayout } from '../../shell/ModeLayout'
const OfficeLayout = () => <ModeLayout />
import { RoutinesRoute } from '../../routines'

function makeTestRouter(initialPath: string) {
  useUIStore.setState({ mode: 'office' })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const repos = createMockRepos()

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => (
      <div role="alert" data-testid="not-found">
        Not found
      </div>
    ),
  })

  const officeRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'office',
    component: OfficeLayout,
  })

  const routinesRoute = createRoute({
    getParentRoute: () => officeRoute,
    path: 'routines',
    component: RoutinesRoute,
  })

  const router = createRouter({
    routeTree: rootRoute.addChildren([officeRoute.addChildren([routinesRoute])]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  })

  render(<RouterProvider router={router} />)
  return router
}

describe('/routines smoke test', () => {
  test('Routines sidebar NavLink has aria-current="true" and first routine name renders', async () => {
    makeTestRouter('/routines')

    // The Routines NavLink in OfficeSidebar receives active=true from OfficeLayout
    // (onRoutines is set) and renders aria-current="true".
    const routinesNavLink = await screen.findByRole('button', { name: 'Routines' })
    expect(routinesNavLink).toHaveAttribute('aria-current', 'true')

    // The week view is the default; the mock "Morning brief" (daily) renders as a week-long chip.
    expect(await screen.findByText('Morning brief · every day')).toBeInTheDocument()

    // Not-found guard
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })
})
