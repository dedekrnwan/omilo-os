import { describe, test, expect, beforeEach } from 'vitest'
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
import { useChatStore } from '../../app/store'
import { ChatChannelLayout } from './ChatChannelLayout'
import { ChatIndexRoute, ChatSessionRoute } from './ChatRoute'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a test router that mirrors the REAL production route shape:
 *   /chat
 *   /chat/$channelId          → ChatChannelLayout  (sidebar + Inset + Outlet)
 *   /chat/$channelId/         → ChatIndexRoute     (new-chat hero)
 *   /chat/$channelId/$sessionId → ChatSessionRoute (session thread)
 *
 * This structure ensures sub-routes actually mount via <Outlet />, catching
 * the class of bug where child routes silently fall back to the hero.
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
    component: () => <Outlet />,
  })

  // Layout route — renders ChannelSidebar + Inset + <Outlet />
  const chatChannelRoute = createRoute({
    getParentRoute: () => chatRoute,
    path: '$channelId',
    component: ChatChannelLayout,
  })

  // Index child — renders the new-chat hero
  const chatChannelIndexRoute = createRoute({
    getParentRoute: () => chatChannelRoute,
    path: '/',
    component: ChatIndexRoute,
  })

  // Session child — renders the session thread
  const chatSessionRoute = createRoute({
    getParentRoute: () => chatChannelRoute,
    path: '$sessionId',
    component: ChatSessionRoute,
  })

  const routeTree = rootRoute.addChildren([
    chatRoute.addChildren([
      chatChannelRoute.addChildren([chatChannelIndexRoute, chatSessionRoute]),
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
  fireEvent.click(screen.getByRole('button', { name: /switch channel/i }))
}

describe('ChannelSidebar', () => {
  test('lists General, Engineering, Marketing, Business channels', async () => {
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
      expect(screen.getByText('Business')).toBeInTheDocument()
    })
  })

  test('each channel row has its coloured channel icon', async () => {
    const { router } = makeTestRouter('/chat/ch-general')
    await router.load()
    render(<RouterProvider router={router} />)

    // Channels (and their dots) are in the dropdown — open it
    await waitFor(() => {
      openChannelDropdown()
    })

    await waitFor(() => {
      // 1 in the switcher + 4 in the popover
      expect(screen.getAllByTestId('channel-icon').length).toBe(5)
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
      const dialog = screen.getByRole('dialog', { name: /channel switcher/i })
      const activeRow = Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-current') === 'true',
      )
      expect(activeRow?.textContent).toMatch(/engineering/i)
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
    const { router } = makeTestRouter('/chat/ch-engineering/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    // Messages from sess-passkey must be visible
    await waitFor(() => {
      expect(
        screen.getByText(/WebAuthn on the legacy Android app/i),
      ).toBeInTheDocument()
    })
  })

  test('session route does NOT show the new-chat hero', async () => {
    // This test catches the bug: if child routes fall back to the hero, this fails
    const { router } = makeTestRouter('/chat/ch-engineering/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    // Wait for session content to load
    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })

    // The hero headline must NOT be visible on a session route
    expect(screen.queryByText(/what are we figuring out/i)).not.toBeInTheDocument()
  })
})

describe('ChatRoute — stale session on channel switch', () => {
  test('switching to a different channel\'s session swaps the thread — stale message from first session is gone', async () => {
    const { router } = makeTestRouter('/chat/ch-general/sess-investor')
    await router.load()
    render(<RouterProvider router={router} />)

    // First session message must be visible
    await waitFor(() => {
      expect(
        screen.getByText(/Start the October investor update/i),
      ).toBeInTheDocument()
    })

    // Navigate to Engineering channel's session
    await act(async () => {
      await router.navigate({ to: '/chat/$channelId/$sessionId', params: { channelId: 'ch-engineering', sessionId: 'sess-passkey' } })
    })

    // Engineering message should appear
    await waitFor(() => {
      expect(
        screen.getByText(/WebAuthn on the legacy Android app/i),
      ).toBeInTheDocument()
    })

    // The Q4 priorities message from the first session should be gone
    expect(
      screen.queryByText(/Start the October investor update/i),
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

// ── Archive / restore via useChatStore (state-layer tests) ──────────────────

describe('Archive / restore — useChatStore', () => {
  beforeEach(() => {
    // Reset chat store before each test
    useChatStore.setState({
      overrides: {},
      archived: [],
      removedStaticIds: new Set(),
      newFolders: [],
    })
  })

  test('archiveSession adds the session to the archived list', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    const { archived, overrides } = useChatStore.getState()
    expect(archived).toHaveLength(1)
    expect(archived[0].id).toBe('sess-passkey')
    expect(archived[0].title).toBe('Passkey rollout plan')
    expect(overrides['sess-passkey']?.archived).toBe(true)
  })

  test('restoreSession removes the session from archived and clears the flag', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    useChatStore.getState().restoreSession('sess-passkey')
    const { archived, overrides } = useChatStore.getState()
    expect(archived).toHaveLength(0)
    expect(overrides['sess-passkey']?.archived).toBe(false)
  })

  test('archiving then restoring leaves no other sessions affected', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    useChatStore.getState().archiveSession('sess-investor', 'October investor update', 'General')
    useChatStore.getState().restoreSession('sess-passkey')
    const { archived } = useChatStore.getState()
    expect(archived).toHaveLength(1)
    expect(archived[0].id).toBe('sess-investor')
  })

  test('deleteArchived removes a specific entry without affecting others', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    useChatStore.getState().archiveSession('sess-investor', 'October investor update', 'General')
    useChatStore.getState().deleteArchived('sess-passkey')
    const { archived } = useChatStore.getState()
    expect(archived).toHaveLength(1)
    expect(archived[0].id).toBe('sess-investor')
  })

  test('deleteAllArchived clears all entries', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    useChatStore.getState().archiveSession('sess-investor', 'October investor update', 'General')
    useChatStore.getState().deleteAllArchived()
    expect(useChatStore.getState().archived).toHaveLength(0)
  })

  test('patchSession renames a session', () => {
    useChatStore.getState().patchSession('sess-passkey', { title: 'Renamed chat' })
    expect(useChatStore.getState().overrides['sess-passkey']?.title).toBe('Renamed chat')
  })

  test('patchSession can pin a session', () => {
    useChatStore.getState().patchSession('sess-passkey', { pinned: true })
    expect(useChatStore.getState().overrides['sess-passkey']?.pinned).toBe(true)
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
            { id: 'ch-empty', name: 'Empty Channel', accent: 'general', agentCount: 0, chatCount: 0, openItems: 0 },
          ]),
        get: (id) =>
          id === 'ch-empty'
            ? Promise.resolve({ id: 'ch-empty', name: 'Empty Channel', accent: 'general' as const, agentCount: 0, chatCount: 0, openItems: 0 })
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
