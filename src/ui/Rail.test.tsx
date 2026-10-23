import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { Rail } from './Rail'
import { useUIStore } from '../app/store'

// Build a minimal test router with memory history
function makeTestRouter(initialPath = '/chat') {
  const rootRoute = createRootRoute({
    component: () => (
      <div>
        <Rail />
        <Outlet />
      </div>
    ),
  })

  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => <div data-testid="route-chat">chat</div>,
  })

  const officeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/office/inbox',
    component: () => <div data-testid="route-office">office/inbox</div>,
  })

  const routeTree = rootRoute.addChildren([chatRoute, officeRoute])

  const history = createMemoryHistory({ initialEntries: [initialPath] })

  const router = createRouter({ routeTree, history })

  return router
}

beforeEach(() => {
  // Reset zustand store between tests
  useUIStore.setState({
    mode: 'chat',
    lastPath: { chat: '', office: '' },
  })
})

describe('Rail mode toggle', () => {
  test('shows current mode label', async () => {
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument()
  })

  test('clicking toggle when office was never visited navigates to /office/inbox', async () => {
    const user = userEvent.setup()
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    const toggle = screen.getByRole('button', { name: /chat/i })
    await act(async () => {
      await user.click(toggle)
    })

    // Should navigate to /office/inbox (default path since lastPath['office'] is '')
    expect(router.state.location.pathname).toBe('/office/inbox')
    // The Rail now shows office mode
    expect(screen.getByRole('button', { name: /office/i })).toBeInTheDocument()
  })

  test('clicking toggle back returns to remembered chat path', async () => {
    const user = userEvent.setup()
    // Pre-set lastPath for chat so toggle back lands there
    useUIStore.setState({
      mode: 'office',
      lastPath: { chat: '/chat', office: '' },
    })
    const router = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    // Currently in office mode, toggle back to chat
    const toggle = screen.getByRole('button', { name: /office/i })
    await act(async () => {
      await user.click(toggle)
    })

    // Should navigate to the remembered /chat path
    expect(router.state.location.pathname).toBe('/chat')
    expect(screen.getByRole('button', { name: /chat/i })).toBeInTheDocument()
  })
})
