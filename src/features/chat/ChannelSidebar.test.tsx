import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
import { ModeLayout } from '../shell/ModeLayout'
import { ChatIndexRoute } from './ChatRoute'

/**
 * Build a test router with /chat (ModeLayout) and a stub /control-panel/$section
 * so the "Manage areas" navigation can resolve.
 */
function makeTestRouter(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={createMockRepos()}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })

  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => <ModeLayout mode="chat" />,
  })
  const chatIndexRoute = createRoute({ getParentRoute: () => chatRoute, path: '/', component: ChatIndexRoute })

  const controlPanelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/control-panel',
    component: () => <Outlet />,
  })
  const controlPanelSectionRoute = createRoute({
    getParentRoute: () => controlPanelRoute,
    path: '$section',
    component: () => <div data-testid="control-panel-section">Control panel</div>,
  })

  const routeTree = rootRoute.addChildren([
    chatRoute.addChildren([chatIndexRoute]),
    controlPanelRoute.addChildren([controlPanelSectionRoute]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router }
}

describe('AppSidebar — Manage areas deep-link', () => {
  test('clicking "Manage areas" navigates to /control-panel/channels and closes the popover', async () => {
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    // Open the area switcher popover
    const switcherBtn = await screen.findByRole('button', { name: /switch area/i })
    fireEvent.click(switcherBtn)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /area switcher/i })).toBeInTheDocument()
    })

    const manageBtn = screen.getByRole('button', { name: /manage areas/i })
    fireEvent.click(manageBtn)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/control-panel/channels')
    })

    expect(screen.queryByRole('dialog', { name: /area switcher/i })).not.toBeInTheDocument()
  })
})
