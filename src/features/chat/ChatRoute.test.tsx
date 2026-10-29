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
import { useUIStore } from '../../app/store'
import { createMockCommands } from '../../adapters/mock/mockCommands'
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

  // Pathless app layout mirrors production: neutral absolute-path children.
  const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: () => <ModeLayout /> })
  const chatIndexRoute = createRoute({ getParentRoute: () => appRoute, path: '/chat', component: ChatIndexRoute })
  const chatSessionRoute = createRoute({ getParentRoute: () => appRoute, path: '/chat/$sessionId', component: ChatSessionRoute })
  const archivedRoute = createRoute({ getParentRoute: () => appRoute, path: '/archived', component: ArchivedRoute })

  const routeTree = rootRoute.addChildren([
    appRoute.addChildren([chatIndexRoute, chatSessionRoute, archivedRoute]),
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

// ── Archive / restore / rename / pin persist through Commands (mock adapter) ──

describe('Archive / restore — chat commands', () => {
  test('archiving moves a chat to the archived list; restoring brings it back', async () => {
    const commands = createMockCommands()
    const repos = createMockRepos()
    const s = await commands.createSession({ channelId: 'ch-general', title: 'Archive me' })
    await commands.updateSession(s.id, { archived: true })
    expect((await repos.sessions.listAll()).some((x) => x.id === s.id)).toBe(false)
    const archived = await repos.chat!.archived(null)
    expect(archived[0]).toMatchObject({ id: s.id, title: 'Archive me' })
    expect(archived[0].archivedAt).toBeTruthy()

    await commands.updateSession(s.id, { archived: false })
    expect((await repos.chat!.archived(null)).some((x) => x.id === s.id)).toBe(false)
    expect((await repos.sessions.listAll()).some((x) => x.id === s.id)).toBe(true)
  })

  test('delete removes an archived chat; delete-all clears the area', async () => {
    const commands = createMockCommands()
    const repos = createMockRepos()
    const a = await commands.createSession({ channelId: 'ch-business', title: 'A' })
    const b = await commands.createSession({ channelId: 'ch-business', title: 'B' })
    await commands.updateSession(a.id, { archived: true })
    await commands.updateSession(b.id, { archived: true })
    await commands.deleteSession(a.id)
    const left = await repos.chat!.archived('ch-business')
    expect(left.some((x) => x.id === a.id)).toBe(false)
    expect(left.some((x) => x.id === b.id)).toBe(true)
    const { deleted } = await commands.deleteArchivedSessions('ch-business')
    expect(deleted).toBeGreaterThan(0)
    expect(await repos.chat!.archived('ch-business')).toEqual([])
  })

  test('rename and pin persist on the session', async () => {
    const commands = createMockCommands()
    const repos = createMockRepos()
    const s = await commands.createSession({ channelId: 'ch-general', title: 'Old' })
    await commands.updateSession(s.id, { title: 'Renamed chat', pinned: true })
    expect(await repos.sessions.get(s.id)).toMatchObject({ title: 'Renamed chat', pinned: true })
  })
})

// ── Archive navigation (router-level) ───────────────────────────────────────

describe('ChatRoute — archive navigates away from session', () => {
  beforeEach(() => {
    useUIStore.setState({ mode: 'chat', areaId: null })
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
      expect(router.state.location.pathname).toBe('/archived')
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

describe('ChatRoute — hero Composer sends', () => {
  beforeEach(() => useUIStore.setState({ mode: 'chat', areaId: null }))

  test('typing in the hero and sending creates a session and navigates to /chat/:id', async () => {
    const user = userEvent.setup()
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    await waitFor(() => {
      expect(screen.getByText(/what are we figuring out/i)).toBeInTheDocument()
    })

    const editor = screen.getByRole('textbox', { name: 'Message' })
    await act(async () => {
      editor.textContent = 'Draft the Q4 plan'
      fireEvent.input(editor)
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\/ses/)
    })
  })

  test('a "start from a goal" chip opens a session seeded by that goal', async () => {
    const user = userEvent.setup()
    const { router } = makeTestRouter('/chat')
    await router.load()
    render(<RouterProvider router={router} />)

    // Wait for the hero goal chips to render, then click one by its goal title.
    await screen.findByText(/Or start from a goal/i)
    const chip = screen.getByText('Close October books').closest('button')
    expect(chip).not.toBeNull()
    await user.click(chip as HTMLButtonElement)

    await waitFor(() => {
      expect(router.state.location.pathname).toMatch(/^\/chat\/ses/)
    })
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
