import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
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
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import type { Repos } from '../../core/ports/repos'
import { useChatStore, useUIStore } from '../../app/store'
import { ModeLayout } from '../shell/ModeLayout'
import { ChatIndexRoute, ChatSessionRoute } from './ChatRoute'
import { ArchivedRoute } from './ArchivedRoute'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a test router mirroring the REAL (de-channeled) chat route shape:
 *   /chat               → ModeLayout(chat)  (unified sidebar + Inset + Outlet)
 *   /chat (index)       → ChatIndexRoute    (new-chat hero)
 *   /chat/$sessionId    → ChatSessionRoute  (session thread)
 *   /chat/archived      → ArchivedRoute
 */
function makeTestRouter(initialPath: string, repos: Repos = createMockRepos()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

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
    component: () => <ModeLayout mode="chat" />,
  })
  const chatIndexRoute = createRoute({ getParentRoute: () => chatRoute, path: '/', component: ChatIndexRoute })
  const chatSessionRoute = createRoute({ getParentRoute: () => chatRoute, path: '$sessionId', component: ChatSessionRoute })
  const chatArchivedRoute = createRoute({ getParentRoute: () => chatRoute, path: 'archived', component: ArchivedRoute })

  const routeTree = rootRoute.addChildren([
    chatRoute.addChildren([chatIndexRoute, chatSessionRoute, chatArchivedRoute]),
  ])

  const history = createMemoryHistory({ initialEntries: [initialPath] })
  const router = createRouter({ routeTree, history })

  return { router, queryClient }
}

/** Open the area switcher dropdown. */
function openAreaDropdown() {
  fireEvent.click(screen.getByRole('button', { name: /switch area/i }))
}

// ── tests ────────────────────────────────────────────────────────────────────

describe('AppSidebar — area switcher', () => {
  beforeEach(() => useUIStore.setState({ mode: 'chat', areaId: null }))

  test('lists All areas + General, Engineering, Marketing, Business', async () => {
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => openAreaDropdown())

    await waitFor(() => {
      // "All areas" shows on the switcher button and the popover row
      expect(screen.getAllByText('All areas').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('Engineering')).toBeInTheDocument()
      expect(screen.getByText('Marketing')).toBeInTheDocument()
      expect(screen.getByText('Business')).toBeInTheDocument()
    })
  })

  test('selecting an area highlights it as current', async () => {
    useUIStore.setState({ areaId: 'ch-engineering' })
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => openAreaDropdown())

    await waitFor(() => {
      const dialog = screen.getByRole('dialog', { name: /area switcher/i })
      const activeRow = Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-current') === 'true',
      )
      expect(activeRow?.textContent).toMatch(/engineering/i)
    })
  })
})

describe('ChatRoute — default view', () => {
  beforeEach(() => useUIStore.setState({ mode: 'chat', areaId: null }))

  test('navigating to /chat (no session) shows the new-chat hero', async () => {
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
    })
  })

  test('navigating to a session renders that session\'s messages', async () => {
    const { router } = makeTestRouter('/chat/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })
  })

  test('session route does NOT show the new-chat hero', async () => {
    const { router } = makeTestRouter('/chat/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/what are we figuring out/i)).not.toBeInTheDocument()
  })
})

describe('ChatRoute — stale session on switch', () => {
  beforeEach(() => useUIStore.setState({ mode: 'chat', areaId: null }))

  test('switching to a different session swaps the thread', async () => {
    const { router } = makeTestRouter('/chat/sess-investor')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/Start the October investor update/i)).toBeInTheDocument()
    })

    await act(async () => {
      await router.navigate({ to: '/chat/$sessionId', params: { sessionId: 'sess-passkey' } })
    })

    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Start the October investor update/i)).not.toBeInTheDocument()
  })
})

// ── Archive / restore via useChatStore (state-layer tests) ──────────────────

describe('Archive / restore — useChatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ overrides: {}, archived: [], removedStaticIds: new Set(), newFolders: [] })
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

// ── Archive navigation (router-level) ───────────────────────────────────────

describe('ChatRoute — archive navigates away from session', () => {
  beforeEach(() => {
    useUIStore.setState({ mode: 'chat', areaId: null })
    useChatStore.setState({ overrides: {}, archived: [], removedStaticIds: new Set(), newFolders: [] })
  })

  test('archiving a chat session navigates to /chat/archived', async () => {
    const user = userEvent.setup()
    const { router } = makeTestRouter('/chat/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })

    const moreButton = screen.getByRole('button', { name: /more options/i })
    await user.click(moreButton)
    const archiveItem = await screen.findByText('Archive chat')
    await user.click(archiveItem)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat/archived')
    })
  })

  test('deleting a chat session navigates to /chat', async () => {
    const user = userEvent.setup()
    const { router } = makeTestRouter('/chat/sess-passkey')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/WebAuthn on the legacy Android app/i)).toBeInTheDocument()
    })

    const moreButton = screen.getByRole('button', { name: /more options/i })
    await user.click(moreButton)
    const deleteItem = await screen.findByText('Delete chat')
    await user.click(deleteItem)
    const confirmButton = await screen.findByRole('button', { name: /^delete$/i })
    await user.click(confirmButton)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/chat')
    })
  })
})

describe('ChatRoute — deleteAllArchived clears static entries', () => {
  beforeEach(() => {
    useChatStore.setState({ overrides: {}, archived: [], removedStaticIds: new Set(), newFolders: [] })
  })

  test('deleteAllArchived with staticIds adds static IDs to removedStaticIds', () => {
    const staticIds = ['a-1', 'a-2', 'a-3']
    useChatStore.getState().deleteAllArchived(staticIds)
    const { removedStaticIds, archived } = useChatStore.getState()
    expect(archived).toHaveLength(0)
    staticIds.forEach((id) => expect(removedStaticIds.has(id)).toBe(true))
  })

  test('deleteAllArchived clears both dynamic and static entries together', () => {
    useChatStore.getState().archiveSession('sess-passkey', 'Passkey rollout plan', 'Engineering')
    const staticIds = ['a-1', 'a-2']
    useChatStore.getState().deleteAllArchived(staticIds)
    const { archived, removedStaticIds } = useChatStore.getState()
    expect(archived).toHaveLength(0)
    expect(removedStaticIds.has('sess-passkey')).toBe(true)
    expect(removedStaticIds.has('a-1')).toBe(true)
    expect(removedStaticIds.has('a-2')).toBe(true)
  })
})

describe('ChatRoute — empty workspace', () => {
  beforeEach(() => useUIStore.setState({ mode: 'chat', areaId: null }))

  test('no sessions shows the new-chat hero, not a crash', async () => {
    const emptyRepos: Repos = {
      ...createMockRepos(),
      sessions: {
        get: () => Promise.resolve(null),
        listByChannel: () => Promise.resolve([]),
        listAll: () => Promise.resolve([]),
      },
    }

    const { router } = makeTestRouter('/chat', emptyRepos)
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
    })
  })
})
