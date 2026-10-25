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
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { ControlPanelRoute } from './ControlPanelRoute'

function makeRoot() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  return createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
}

function renderControlPanelAt(path: string) {
  const root = makeRoot()
  const cp = createRoute({ getParentRoute: () => root, path: '/control-panel', component: ControlPanelRoute })
  const section = createRoute({ getParentRoute: () => cp, path: '$section', component: ControlPanelRoute })
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({ routeTree: root.addChildren([cp.addChildren([section])]), history })
  return render(<RouterProvider router={router} />)
}

describe('ControlPanelRoute — sidebar promotion smoke', () => {
  test('/control-panel/members renders the 232px sidebar nav AND the Members section', async () => {
    renderControlPanelAt('/control-panel/members')

    // The promoted sidebar must be a <nav> with the correct aria-label
    const nav = await screen.findByRole('navigation', { name: 'Control panel sections' })
    expect(nav).toBeInTheDocument()
    // The SidebarFrame renders with w-[232px] — verify via className
    expect(nav.className).toContain('w-[232px]')

    // The Members section heading must be visible in the Inset
    expect(await screen.findByRole('heading', { name: /members & roles/i })).toBeInTheDocument()

    // Not-found fallback must NOT appear
    expect(screen.queryByTestId('not-found')).not.toBeInTheDocument()
  })

  test('/control-panel (index) renders the sidebar nav with General active', async () => {
    renderControlPanelAt('/control-panel')

    const nav = await screen.findByRole('navigation', { name: 'Control panel sections' })
    expect(nav).toBeInTheDocument()

    // "General" nav link should be the active item (aria-current="true")
    const generalBtn = screen.getByRole('button', { name: /^general$/i })
    expect(generalBtn).toHaveAttribute('aria-current', 'true')
  })
})
