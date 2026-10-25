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
const OfficeLayout = () => <ModeLayout mode="office" />
import { OfficeGoalsRoute } from './OfficeGoalsRoute'
import { InboxRoute } from './InboxRoute'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a test router mirroring the production office shape:
 *   /office          → OfficeLayout (sidebar + Outlet)
 *   /office/inbox    → InboxRoute (content only)
 *   /office/goals    → OfficeGoalsRoute (content only)
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

  const officeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/office',
    component: OfficeLayout,
  })

  const officeInboxRoute = createRoute({
    getParentRoute: () => officeRoute,
    path: 'inbox',
    component: InboxRoute,
  })

  const officeGoalsRoute = createRoute({
    getParentRoute: () => officeRoute,
    path: 'goals',
    component: OfficeGoalsRoute,
  })

  const routeTree = rootRoute.addChildren([
    officeRoute.addChildren([officeInboxRoute, officeGoalsRoute]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router, queryClient }
}

// ── Goals page tests ──────────────────────────────────────────────────────────

describe('OfficeGoalsRoute — /office/goals', () => {
  test('renders its own content (company-wide goals heading), not inbox', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    // Goals page heading
    await waitFor(() => {
      expect(
        screen.getByText(/What the company is pushing on/i),
      ).toBeInTheDocument()
    })

    // Inbox-specific content should NOT appear
    expect(screen.queryByText(/Your agents propose, you decide/i)).not.toBeInTheDocument()
  })

  test('renders OfficeSidebar through the real layout + outlet nesting', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /office/i })).toBeInTheDocument()
    })
  })

  test('Goals sidebar nav link is active on /office/goals', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const goalsBtn = screen.getByRole('button', { name: /^goals$/i })
      expect(goalsBtn).toHaveAttribute('aria-current', 'true')
    })
  })

  test('shows area group headings: Engineering, Marketing, Business', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Each area appears multiple times (sidebar, tab, heading) — just verify presence
      expect(screen.getAllByText('Engineering').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Marketing').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Business').length).toBeGreaterThanOrEqual(1)
    })
  })

  test('shows goal titles from all areas', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/Passwordless login by Q4/i)).toBeInTheDocument()
      expect(screen.getByText(/Launch referral program/i)).toBeInTheDocument()
      expect(screen.getByText(/Close 5 enterprise pilots/i)).toBeInTheDocument()
    })
  })

  test('+ New goal button is visible on the page', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument()
    })
  })
})

// ── New goal dialog tests ─────────────────────────────────────────────────────

describe('NewGoalDialog — open / close', () => {
  test('dialog is not visible initially', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument()
    })

    // Dialog title should not be present when closed
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('clicking + New goal opens the dialog', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /New goal/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /New goal/i }))

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(/Say what you want to move/i)).toBeInTheDocument()
    })
  })

  test('clicking Cancel closes the dialog', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /New goal/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('clicking the X button closes the dialog', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /New goal/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Close dialog/i }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('dialog contains the goal input field', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /New goal/i }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/^Goal$/i)).toBeInTheDocument()
    })
  })

  test('dialog contains Channel and Due fields', async () => {
    const { router } = makeTestRouter('/office/goals')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /New goal/i }))
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/^Channel$/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/^Due$/i)).toBeInTheDocument()
    })
  })
})
