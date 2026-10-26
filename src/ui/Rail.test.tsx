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

// Build a minimal test router with memory history. Routes are mode-neutral:
// the chat primary is /chat, the office primary is /inbox.
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

  const inboxRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inbox',
    component: () => <div data-testid="route-inbox">inbox</div>,
  })

  const routeTree = rootRoute.addChildren([chatRoute, inboxRoute])
  const history = createMemoryHistory({ initialEntries: [initialPath] })
  return createRouter({ routeTree, history })
}

beforeEach(() => {
  // Mode is persisted client state; reset to chat before each test.
  useUIStore.setState({ mode: 'chat' })
})

describe('Rail mode toggle', () => {
  test('shows both Chat and Office segment buttons', async () => {
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    expect(screen.getByRole('button', { name: /^chat$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^office$/i })).toBeInTheDocument()
  })

  test('clicking Office from the chat primary flips mode and lands on /inbox', async () => {
    const user = userEvent.setup()
    const router = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^office$/i }))
    })

    // Leaving the chat primary → lands on the office home.
    expect(router.state.location.pathname).toBe('/inbox')
    expect(useUIStore.getState().mode).toBe('office')
  })

  test('clicking Chat from the office primary flips mode and lands on /chat', async () => {
    const user = userEvent.setup()
    useUIStore.setState({ mode: 'office' })
    const router = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^chat$/i }))
    })

    expect(router.state.location.pathname).toBe('/chat')
    expect(useUIStore.getState().mode).toBe('chat')
  })
})
