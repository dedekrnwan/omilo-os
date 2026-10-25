import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
import { NotificationsRoute } from './NotificationsRoute'

// ── helpers ───────────────────────────────────────────────────────────────────

function renderNotifications() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => <div data-testid="not-found">Not found</div>,
  })
  const r = createRoute({ getParentRoute: () => root, path: '/notifications', component: NotificationsRoute })
  const history = createMemoryHistory({ initialEntries: ['/notifications'] })
  const router = createRouter({ routeTree: root.addChildren([r]), history })
  return render(<RouterProvider router={router} />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsRoute — filter sidebar', () => {
  test('renders the 232px Notifications sidebar nav', async () => {
    renderNotifications()
    const nav = await screen.findByRole('navigation', { name: 'Notifications' })
    expect(nav).toBeInTheDocument()
    expect(nav.className).toContain('w-[232px]')
  })

  test('"All" filter is active by default', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })
    const allBtn = screen.getByRole('button', { name: /^All/ })
    expect(allBtn).toHaveAttribute('aria-current', 'true')
  })

  test('clicking "Needs you" hides grouped notif rows and keeps only decision cards', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })

    // Verify that grouped notif sections are present before filter
    expect(screen.getByRole('region', { name: 'TODAY' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'YESTERDAY' })).toBeInTheDocument()

    // Verify decision cards are present
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()

    // Click "Needs you" in the sidebar
    const needsYouBtn = screen.getByRole('button', { name: /^Needs you/ })
    fireEvent.click(needsYouBtn)

    // Grouped notif rows must be gone
    expect(screen.queryByRole('region', { name: 'TODAY' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'YESTERDAY' })).not.toBeInTheDocument()

    // The "Needs you" decision section must still be visible
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()

    // At least one decision card must be present
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
  })

  test('clicking "Mentions" shows only notifs with "@" in title/preview', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })

    const mentionsBtn = screen.getByRole('button', { name: /^Mentions/ })
    fireEvent.click(mentionsBtn)

    // The Builder mention notif has "@" in preview — must be visible
    expect(screen.getByText(/Builder mentioned you in Passkey rollout plan/)).toBeInTheDocument()

    // Sales notif has no "@" — must be gone
    expect(screen.queryByText(/Sales booked a call/)).not.toBeInTheDocument()
  })

  test('AREAS group renders area NavLinks with area dots', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })
    const dots = screen.getAllByTestId('area-dot')
    expect(dots.length).toBeGreaterThan(0)
  })
})
