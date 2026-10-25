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
import { OfficeLayout } from '../OfficeLayout'
import { RoutinesRoute } from '../../routines'

function makeTestRouter(initialPath: string) {
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
    path: '/office',
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

describe('/office/routines smoke test', () => {
  test('Routines sidebar NavLink has aria-current="true" and first routine name renders', async () => {
    makeTestRouter('/office/routines')

    // The Routines NavLink in OfficeSidebar receives active=true from OfficeLayout
    // (onRoutines is set) and renders aria-current="true".
    const routinesNavLink = await screen.findByRole('button', { name: 'Routines' })
    expect(routinesNavLink).toHaveAttribute('aria-current', 'true')

    // The week view is the default; the first chip label "Morning brief · weekdays" renders.
    expect(screen.getByText('Morning brief · weekdays')).toBeInTheDocument()

    // Not-found guard
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })
})
