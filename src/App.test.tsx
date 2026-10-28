import { test, expect } from 'vitest'
import { render } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Shell } from './app/Shell'

/**
 * Render Shell inside a minimal test router so the role="application"
 * landmark is reachable synchronously.
 */
function renderShell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <Shell />
      </QueryClientProvider>
    ),
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => null,
  })
  const routeTree = rootRoute.addChildren([indexRoute])
  const history = createMemoryHistory({ initialEntries: ['/chat'] })
  const router = createRouter({ routeTree, history })
  return render(<RouterProvider router={router} />)
}

test('App renders the root shell landmark', async () => {
  const { findByRole } = renderShell()
  expect(await findByRole('application')).toBeInTheDocument()
})
