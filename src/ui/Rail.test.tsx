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
  test('shows both Chat and Office segment buttons', async () => {
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    // Both segment buttons are always visible
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^office$/i })).toBeInTheDocument()
  })

  test('clicking Office segment when office was never visited navigates to /office/inbox', async () => {
    const user = userEvent.setup()
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    // In chat mode, click the Office segment to switch to office
    const officeBtn = screen.getByRole('button', { name: /^office$/i })
    await act(async () => {
      await user.click(officeBtn)
    })

    // Should navigate to /office/inbox (default path since lastPath['office'] is '')
    expect(router.state.location.pathname).toBe('/office/inbox')
    // Both segment buttons still present; Office is now active
    expect(screen.getByRole('button', { name: /^office$/i })).toBeInTheDocument()
  })

  test('clicking Chat segment back returns to remembered chat path', async () => {
    const user = userEvent.setup()
    // Pre-set lastPath for chat so toggle back lands there
    useUIStore.setState({
      mode: 'office',
      lastPath: { chat: '/chat', office: '' },
    })
    const router = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    // In office mode, click the Chat segment to switch back
    const chatBtn = screen.getByRole('button', { name: /^chat$/i })
    await act(async () => {
      await user.click(chatBtn)
    })

    // Should navigate to the remembered /chat path
    expect(router.state.location.pathname).toBe('/chat')
    expect(screen.getByRole('button', { name: /^chat$/i })).toBeInTheDocument()
  })
})
