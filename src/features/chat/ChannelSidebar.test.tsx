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
import { ChatChannelLayout } from './ChatChannelLayout'
import { ChatIndexRoute } from './ChatRoute'

/**
 * Build a test router with /chat/$channelId and a stub /control-panel/$section
 * so the "Manage channels" navigation can resolve.
 */
function makeTestRouter(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

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
    component: () => <Outlet />,
  })

  const chatChannelRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: '$channelId',
    component: ChatChannelLayout,
  })

  const chatChannelIndexRoute = createRoute({
    getParentRoute: () => chatChannelRoute,
    path: '/',
    component: ChatIndexRoute,
  })

  // Stub control-panel/$section route so navigate() resolves
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
    chatRoute.addChildren([
      chatChannelRoute.addChildren([chatChannelIndexRoute]),
    ]),
    controlPanelRoute.addChildren([controlPanelSectionRoute]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router }
}

describe('ChannelSidebar — Manage channels deep-link', () => {
  test('clicking "Manage channels" navigates to /control-panel/channels and closes the popover', async () => {
    const { router } = makeTestRouter('/chat/ch-general')
    await router.load()
    render(<RouterProvider router={router} />)

    // Open the channel switcher popover
    const switcherBtn = await screen.findByRole('button', { name: /switch channel/i })
    fireEvent.click(switcherBtn)

    // Popover should be open: the dialog should be present
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /channel switcher/i })).toBeInTheDocument()
    })

    // Click "Manage channels"
    const manageBtn = screen.getByRole('button', { name: /manage channels/i })
    fireEvent.click(manageBtn)

    // Router URL must now be /control-panel/channels
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/control-panel/channels')
    })

    // Popover must be closed (dialog gone from DOM)
    expect(screen.queryByRole('dialog', { name: /channel switcher/i })).not.toBeInTheDocument()
  })
})
