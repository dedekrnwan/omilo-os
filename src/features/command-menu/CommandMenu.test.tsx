/**
 * CommandMenu behavior tests.
 *
 * Covers: clicking a page result closes the menu (onOpenChange(false)) and
 *         navigates to its target route; pressing Enter on the highlighted
 *         row behaves identically to clicking.
 */
import { describe, test, expect, vi } from 'vitest'
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandMenu } from './CommandMenu'

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a router whose root component mounts the CommandMenu alongside an
 * <Outlet />, so that navigation within the menu reflects in router state.
 */
function makeTestRouter(
  open: boolean,
  onOpenChange: (v: boolean) => void,
  initialPath = '/chat',
) {
  // The corpus is built from live queries (mock repos by default).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <div>
          <CommandMenu open={open} onOpenChange={onOpenChange} />
          <Outlet />
        </div>
      </QueryClientProvider>
    ),
  })

  const chatRoute = createRoute({
    getParentRoute: () => root,
    path: '/chat',
    component: () => <div data-testid="page-chat">chat</div>,
  })
  const goalsRoute = createRoute({
    getParentRoute: () => root,
    path: '/goals',
    component: () => <div data-testid="page-goals">goals</div>,
  })
  const inboxRoute = createRoute({
    getParentRoute: () => root,
    path: '/inbox',
    component: () => <div data-testid="page-inbox">inbox</div>,
  })
  const teamRoute = createRoute({
    getParentRoute: () => root,
    path: '/team',
    component: () => <div data-testid="page-team">team</div>,
  })
  const flowsRoute = createRoute({
    getParentRoute: () => root,
    path: '/flows',
    component: () => <div data-testid="page-flows">flows</div>,
  })

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({
    routeTree: root.addChildren([chatRoute, goalsRoute, inboxRoute, teamRoute, flowsRoute]),
    history,
  })
  return router
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CommandMenu — result row navigation', () => {
  test('clicking a "Goals" result row closes the menu and navigates to /office/goals', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const router = makeTestRouter(true, onOpenChange, '/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    // In empty-query state, "Goals" appears in the JUMP TO section
    const goalsRow = await screen.findByRole('option', { name: /^Goals/ })
    await act(async () => {
      await user.click(goalsRow)
    })

    // Menu must be closed
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Route must have changed
    expect(router.state.location.pathname).toBe('/goals')
  })

  test('pressing Enter on the highlighted row closes the menu and navigates', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const router = makeTestRouter(true, onOpenChange, '/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    const input = await screen.findByRole('combobox', { name: /search/i })

    // Wait for the live corpus (recent chats) to load, then move down once.
    await screen.findByRole('option', { name: /^Inbox/ })
    await act(async () => {
      await user.type(input, '{ArrowDown}')
    })

    // Press Enter to run the active item (Inbox → /office/inbox)
    await act(async () => {
      await user.keyboard('{Enter}')
    })

    // The menu must have been closed
    expect(onOpenChange).toHaveBeenCalledWith(false)
    // Router should have navigated away from /chat
    expect(router.state.location.pathname).not.toBe('/chat')
  })

  test('clicking an "Inbox" result navigates to /office/inbox', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const router = makeTestRouter(true, onOpenChange, '/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    const inboxRow = await screen.findByRole('option', { name: /^Inbox/ })
    await act(async () => {
      await user.click(inboxRow)
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.state.location.pathname).toBe('/inbox')
  })
})

describe('CommandMenu — live corpus', () => {
  test('searching finds a real chat from the sessions query and opens it', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const router = makeTestRouter(true, onOpenChange, '/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    const input = await screen.findByRole('combobox', { name: /search/i })
    await act(async () => {
      await user.type(input, 'investor')
    })
    const row = await screen.findByRole('option', { name: /October investor update/ })
    await act(async () => {
      await user.click(row)
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(router.state.location.pathname).toBe('/chat/sess-investor')
  })

  test('Inbox shows the real needs-you count', async () => {
    const router = makeTestRouter(true, vi.fn(), '/chat')
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('option', { name: /^Inbox\s*\d+ need you/ })).toBeInTheDocument()
  })
})
