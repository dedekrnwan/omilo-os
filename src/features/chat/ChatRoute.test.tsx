import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
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
import { ChatRoute } from './ChatRoute'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal test router that mirrors the production route shape:
 *   /chat
 *   /chat/$channelId
 *   /chat/$channelId/$sessionId
 * Wraps with ReposProvider + QueryClientProvider via the wrapper component.
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

  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: ChatRoute,
  })

  const chatChannelRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: '$channelId',
    component: ChatRoute,
  })

  const chatSessionRoute = createRoute({
    getParentRoute: () => chatChannelRoute,
    path: '$sessionId',
    component: ChatRoute,
  })

  const routeTree = rootRoute.addChildren([
    chatRoute.addChildren([
      chatChannelRoute.addChildren([chatSessionRoute]),
    ]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router, queryClient }
}

// ── tests ────────────────────────────────────────────────────────────────────

// Helper: open the channel-switcher dropdown (channels now live in the dropdown)
function openChannelDropdown() {
  // The header button that opens the dropdown is identifiable by the chevron
  // and "Channel · Chief + 3 agents" subtitle text. We click the nav's first button.
  const trigger = screen.getAllByRole('button')[0]
  fireEvent.click(trigger)
}

describe('ChannelSidebar', () => {
  test('lists General, Engineering, Marketing channels', async () => {
    // Render inside a full test router so useNavigate (used by ChannelSidebar) resolves without warnings
    const { router } = makeTestRouter('/chat/ch-general')
    await router.load()
    render(<RouterProvider router={router} />)

    // Channels are shown in the dropdown — open it first
    await waitFor(() => {
      openChannelDropdown()
    })

    await waitFor(() => {
      expect(screen.getAllByText('General').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Engineering')).toBeInTheDocument()
      expect(screen.getByText('Marketing')).toBeInTheDocument()
    })
  })

  test('each channel row has an area dot', async () => {
    const { router } = makeTestRouter('/chat/ch-general')
    await router.load()
    render(<RouterProvider router={router} />)

    // Channels (and their dots) are in the dropdown — open it
    await waitFor(() => {
      openChannelDropdown()
    })

    await waitFor(() => {
      const dots = screen.getAllByRole('presentation')
      expect(dots.length).toBeGreaterThanOrEqual(3)
    })
  })

  test('active channel is highlighted', async () => {
    const { router } = makeTestRouter('/chat/ch-engineering')
    await router.load()
    render(<RouterProvider router={router} />)

    // Active channel highlight (aria-current) is on the dropdown row — open it
    await waitFor(() => {
      openChannelDropdown()
    })

    await waitFor(() => {
      // The dropdown row for the active channel has aria-current="true"
      const activeButtons = screen.getAllByRole('button', { name: /engineering/i })
      const activeRow = activeButtons.find((b) => b.getAttribute('aria-current') === 'true')
      expect(activeRow).toBeTruthy()
      expect(activeRow).toHaveAttribute('aria-current', 'true')
    })
  })
})

describe('ChatRoute — channel default view', () => {
  test('navigating to a channel (no session) shows the new-chat hero', async () => {
    const { router } = makeTestRouter('/chat/ch-general')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
    })
  })

  test('navigating to a channel+session renders that session\'s messages', async () => {
    const { router } = makeTestRouter('/chat/ch-engineering/sess-eng-1')
    await router.load()
    render(<RouterProvider router={router} />)

    // Messages from sess-eng-1 must be visible
    await waitFor(() => {
      expect(
        screen.getByText(/429s from the payment gateway/i),
      ).toBeInTheDocument()
    })
  })
})

describe('ChatRoute — stale session on channel switch', () => {
  test('switching to a different channel\'s session swaps the thread — stale message from first session is gone', async () => {
    const { router } = makeTestRouter('/chat/ch-general/sess-gen-1')
    await router.load()
    render(<RouterProvider router={router} />)

    // First session message must be visible
    await waitFor(() => {
      expect(
        screen.getByText(/Let's outline our Q4 priorities/i),
      ).toBeInTheDocument()
    })

    // Navigate to Engineering channel's session
    await act(async () => {
      await router.navigate({ to: '/chat/$channelId/$sessionId', params: { channelId: 'ch-engineering', sessionId: 'sess-eng-1' } })
    })

    // Engineering message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/429s from the payment gateway/i),
      ).toBeInTheDocument()
    })

    // The Q4 priorities message from the first session should be gone
    expect(
      screen.queryByText(/Let's outline our Q4 priorities/i),
    ).not.toBeInTheDocument()
  })
})

describe('ChatRoute — unknown channel id', () => {
  test('navigating to an unknown $channelId shows a not-found panel, not a crash', async () => {
    const { router } = makeTestRouter('/chat/ch-unknown-xyz')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Either the router-level notFound or the in-route not-found panel
      const alert = screen.queryByRole('alert') ?? screen.queryByText(/not found/i)
      expect(alert).not.toBeNull()
    })
  })
})

describe('ChatRoute — empty channel', () => {
  test('a channel with no sessions shows the new-chat hero, not a crash', async () => {
    // Override repos: ch-empty has no sessions
    const emptyChannelRepos: Repos = {
      ...createMockRepos(),
      channels: {
        list: () =>
          Promise.resolve([
            { id: 'ch-empty', name: 'Empty Channel', area: 'ops' },
          ]),
        get: (id) =>
          id === 'ch-empty'
            ? Promise.resolve({ id: 'ch-empty', name: 'Empty Channel', area: 'ops' })
            : Promise.resolve(null),
      },
      sessions: {
        get: () => Promise.resolve(null),
        listByChannel: () => Promise.resolve([]),
      },
    }

    const { router } = makeTestRouter('/chat/ch-empty', emptyChannelRepos)
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      // Hero is shown: headline present, composer placeholder present
      expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/ask a helper/i)).toBeInTheDocument()
    })
  })
})
