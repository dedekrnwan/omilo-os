import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
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
import type { Repos } from '../../core/ports/repos'
import { InboxRoute } from './InboxRoute'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal test router that mirrors the production office route shape:
 *   /office/inbox
 *   /office/inbox/$itemId
 * Wraps with ReposProvider + QueryClientProvider inside the root route.
 */
function makeTestRouter(
  initialPath: string,
  repos: Repos = createMockRepos(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => (
      <div role="alert" data-testid="not-found">
        Not found
      </div>
    ),
  })

  const officeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/office',
    component: () => <Outlet />,
  })

  const officeInboxRoute = createRoute({
    getParentRoute: () => officeRoute,
    path: 'inbox',
    component: InboxRoute,
  })

  const officeInboxItemRoute = createRoute({
    getParentRoute: () => officeInboxRoute,
    path: '$itemId',
    component: InboxRoute,
  })

  const routeTree = rootRoute.addChildren([
    officeRoute.addChildren([
      officeInboxRoute.addChildren([officeInboxItemRoute]),
    ]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router, queryClient }
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('InboxRoute — inbox list', () => {
  test('lists all mock inbox items with titles', async () => {
    const { router } = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Approve Q4 planning timeline')).toBeInTheDocument()
      expect(screen.getByText('API rate-limit rollback approved')).toBeInTheDocument()
      expect(screen.getByText('Campaign debrief highlights')).toBeInTheDocument()
      expect(screen.getByText('Database migration plan ready')).toBeInTheDocument()
    })
  })

  test('shows item summaries in the list', async () => {
    const { router } = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/Aria has drafted the Q4 milestone timeline/i)).toBeInTheDocument()
    })
  })

  test('shows approve actions and needs-you badges for inbox cards', async () => {
    const { router } = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Decision cards show primary approve buttons
      expect(screen.getByRole('button', { name: /Approve all 3/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Approve \$4,800/i })).toBeInTheDocument()
      // "Needs you" badge is present for flagged items
      expect(screen.getAllByText(/Needs you/i).length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('InboxRoute — keystone: same primitive both modes', () => {
  test('opening inbox-1 renders ChatSession with messages from sess-gen-1', async () => {
    // inbox-1 → sessionId: 'sess-gen-1'
    // sess-gen-1 has message: "Let's outline our Q4 priorities"
    const { router } = makeTestRouter('/office/inbox/inbox-1')
    await router.load()
    render(<RouterProvider router={router} />)

    // The message that genuinely belongs to sess-gen-1 must be visible —
    // this proves the item→sessionId→ChatSession chain is wired correctly.
    await waitFor(() => {
      expect(
        screen.getByText(/Let's outline our Q4 priorities/i),
      ).toBeInTheDocument()
    })
  })

  test('opening inbox-2 renders ChatSession with messages from sess-eng-1', async () => {
    // inbox-2 → sessionId: 'sess-eng-1'
    // sess-eng-1 has message: "429s from the payment gateway"
    const { router } = makeTestRouter('/office/inbox/inbox-2')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/429s from the payment gateway/i),
      ).toBeInTheDocument()
    })
  })

  test('opening inbox-3 renders ChatSession with messages from sess-mkt-1', async () => {
    // inbox-3 → sessionId: 'sess-mkt-1'
    // sess-mkt-1 has message about campaign numbers
    const { router } = makeTestRouter('/office/inbox/inbox-3')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/240k impressions/i),
      ).toBeInTheDocument()
    })
  })

  test('switching between two inbox items swaps the correct session thread', async () => {
    // Open inbox-1 first (sess-gen-1)
    const { router } = makeTestRouter('/office/inbox/inbox-1')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/Let's outline our Q4 priorities/i),
      ).toBeInTheDocument()
    })

    // Navigate to inbox-2 (sess-eng-1)
    await act(async () => {
      await router.navigate({ to: '/office/inbox/$itemId', params: { itemId: 'inbox-2' } })
    })

    await waitFor(() => {
      expect(
        screen.getByText(/429s from the payment gateway/i),
      ).toBeInTheDocument()
    })

    // Q4 message from inbox-1's session must be gone
    expect(
      screen.queryByText(/Let's outline our Q4 priorities/i),
    ).not.toBeInTheDocument()
  })
})

describe('InboxRoute — unknown route id', () => {
  test('navigating to an unknown $itemId shows a not-found panel, not a crash', async () => {
    const { router } = makeTestRouter('/office/inbox/inbox-does-not-exist')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const alert = screen.queryByRole('alert') ?? screen.queryByText(/not found/i)
      expect(alert).not.toBeNull()
    })
  })
})

describe('InboxRoute — empty inbox', () => {
  test('an empty inbox shows an empty placeholder, not a crash', async () => {
    // Inject empty inbox via ReposProvider — test-only injection, never leaks into feature code
    const emptyInboxRepos: Repos = {
      ...createMockRepos(),
      inbox: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(null),
      },
    }

    const { router } = makeTestRouter('/office/inbox', emptyInboxRepos)
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/no items/i)).toBeInTheDocument()
    })
  })
})

describe('OfficeSidebar', () => {
  test('office sidebar is visible in inbox list view', async () => {
    const { router } = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /office/i })).toBeInTheDocument()
    })
  })

  test('inbox nav entry is highlighted when on /office/inbox', async () => {
    const { router } = makeTestRouter('/office/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const inboxBtn = screen.getByRole('button', { name: /inbox/i })
      expect(inboxBtn).toHaveAttribute('aria-current', 'true')
    })
  })
})
