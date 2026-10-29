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
import { useUIStore } from '../../app/store'
import type { Repos } from '../../core/ports/repos'
import { InboxRoute } from './InboxRoute'
import { ModeLayout } from '../shell/ModeLayout'
const OfficeLayout = () => <ModeLayout />

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal test router that mirrors the production office route shape:
 *   /office  → OfficeLayout (sidebar + Outlet)
 *   /office/inbox
 *   /office/inbox/$itemId
 * Wraps with ReposProvider + QueryClientProvider inside the root route.
 */
function makeTestRouter(
  initialPath: string,
  repos: Repos = createMockRepos(),
) {
  useUIStore.setState({ mode: 'office' })
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
    id: 'office',
    component: OfficeLayout,
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
    const { router } = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText('Create 3 tasks for the passkey rollout')).toBeInTheDocument()
      expect(screen.getByText('Approve $4,800 ad budget for the referral launch')).toBeInTheDocument()
      expect(screen.getByText('Pilot contract redlines from Arunika')).toBeInTheDocument()
      expect(screen.getByText('Pick an offsite venue — 3 options')).toBeInTheDocument()
    })
  })

  test('shows item summaries in the list', async () => {
    const { router } = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/Splits the goal so web \+ iOS ship before the Nov 28 freeze/i)).toBeInTheDocument()
    })
  })

  test('shows approve actions and needs-you badges for inbox cards', async () => {
    const { router } = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Decision cards show primary approve buttons
      expect(screen.getByRole('button', { name: /^Approve all 3$/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Approve \$4,800$/i })).toBeInTheDocument()
      // "Needs you" badge is present for flagged items
      expect(screen.getAllByText(/Needs you/i).length).toBeGreaterThanOrEqual(1)
    })
  })
})

describe('InboxRoute — keystone: same primitive both modes', () => {
  test('opening inbox-passkey-tasks renders ChatSession with messages from sess-passkey', async () => {
    // inbox-1 → sessionId: 'sess-gen-1'
    // sess-gen-1 has message: "Let's outline our Q4 priorities"
    const { router } = makeTestRouter('/inbox/inbox-passkey-tasks')
    await router.load()
    render(<RouterProvider router={router} />)

    // The message that genuinely belongs to sess-gen-1 must be visible —
    // this proves the item→sessionId→ChatSession chain is wired correctly.
    await waitFor(() => {
      expect(
        screen.getByText(/WebAuthn on the legacy Android app/i),
      ).toBeInTheDocument()
    })
  })

  test('opening inbox-ad-budget renders ChatSession with messages from sess-ad-budget', async () => {
    // inbox-2 → sessionId: 'sess-eng-1'
    // sess-eng-1 has message: "429s from the payment gateway"
    const { router } = makeTestRouter('/inbox/inbox-ad-budget')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/I’d like a \$4,800 cap/i),
      ).toBeInTheDocument()
    })
  })

  test('opening inbox-arunika renders ChatSession with messages from sess-arunika', async () => {
    // inbox-3 → sessionId: 'sess-mkt-1'
    // sess-mkt-1 has message about campaign numbers
    const { router } = makeTestRouter('/inbox/inbox-arunika')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/data-export clause/i),
      ).toBeInTheDocument()
    })
  })

  test('switching between two inbox items swaps the correct session thread', async () => {
    // Open inbox-1 first (sess-gen-1)
    const { router } = makeTestRouter('/inbox/inbox-passkey-tasks')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(
        screen.getByText(/WebAuthn on the legacy Android app/i),
      ).toBeInTheDocument()
    })

    // Navigate to inbox-2 (sess-eng-1)
    await act(async () => {
      await router.navigate({ to: '/inbox/$itemId', params: { itemId: 'inbox-ad-budget' } })
    })

    await waitFor(() => {
      expect(
        screen.getByText(/I’d like a \$4,800 cap/i),
      ).toBeInTheDocument()
    })

    // Q4 message from inbox-1's session must be gone
    expect(
      screen.queryByText(/WebAuthn on the legacy Android app/i),
    ).not.toBeInTheDocument()
  })
})

describe('InboxRoute — unknown route id', () => {
  test('navigating to an unknown $itemId shows a not-found panel, not a crash', async () => {
    const { router } = makeTestRouter('/inbox/inbox-does-not-exist')
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

    const { router } = makeTestRouter('/inbox', emptyInboxRepos)
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/no items/i)).toBeInTheDocument()
    })
  })
})

describe('OfficeSidebar', () => {
  test('office sidebar is visible in inbox list view', async () => {
    const { router } = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: /office/i })).toBeInTheDocument()
    })
  })

  test('inbox nav entry is highlighted when on /office/inbox', async () => {
    const { router } = makeTestRouter('/inbox')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      const inboxBtn = screen.getByRole('button', { name: /^inbox/i })
      expect(inboxBtn).toHaveAttribute('aria-current', 'true')
    })
  })
})

describe('InboxRoute — Chief routine suggestion card', () => {
  test('renders the first suggestion from GET /v1/routines/suggestions with its moves', async () => {
    const base = createMockRepos()
    const repos: Repos = {
      ...base,
      routines: {
        ...base.routines,
        suggestions: () =>
          Promise.resolve([
            {
              id: 'sug-1',
              kind: 'clash',
              title: 'Spread Monday morning routines',
              desc: 'Two routines start within 30 minutes.',
              note: '',
              moves: [
                { routineId: 'r1', name: 'Instagram report', helperId: 'h-x', helperName: 'Grower', from: 'Mon 08:00', to: 'Mon 09:00', fromAt: '08:00', toAt: '09:00' },
                { routineId: 'r2', name: 'Dependency updates', helperId: 'h-y', helperName: 'Builder', from: 'Mon 08:15', to: 'Mon 10:00', fromAt: '08:15', toAt: '10:00' },
              ],
            },
          ]),
      },
    }
    const { router } = makeTestRouter('/inbox', repos)
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole('article', { name: 'Spread Monday morning routines' })).toBeInTheDocument()
    expect(screen.getByText('Instagram report')).toBeInTheDocument()
    expect(screen.getByText('Mon 10:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Apply both/ })).toBeInTheDocument()
  })

  test('no card when there are no suggestions', async () => {
    const base = createMockRepos()
    const repos: Repos = { ...base, routines: { ...base.routines, suggestions: () => Promise.resolve([]) } }
    const { router } = makeTestRouter('/inbox', repos)
    await router.load()
    render(<RouterProvider router={router} />)
    await screen.findAllByRole('article')
    expect(screen.queryByRole('button', { name: /Apply both/ })).not.toBeInTheDocument()
  })
})
