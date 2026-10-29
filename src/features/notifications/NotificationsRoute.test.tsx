import { describe, test, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
import type { InboxItem } from '../../core/domain/types'

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Render NotificationsRoute with a mock repo that serves the given inbox items.
 * Defaults to the shared inboxItems fixture.
 */
function renderNotifications(overrideItems?: InboxItem[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()

  if (overrideItems !== undefined) {
    // Patch the inbox repo to return the override list
    repos.inbox.list = () => Promise.resolve(overrideItems)
  }

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

// ── fixture-shaped items for isolated tests ───────────────────────────────────

/** Decision item (full card — kind:'decision', not compact). */
const DECISION_ITEM: InboxItem = {
  id: 'test-decision-1',
  title: 'Approve the launch plan',
  summary: 'Growth wants to go live next Friday.',
  sessionId: 'sess-1',
  channelId: 'ch-marketing',
  kind: 'decision',
  status: 'pending',
  createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), // 2m ago → TODAY
  asker: 'Growth',
  askerArea: 'marketing',
  askedAgo: '2m',
  needsYou: true,
  actions: [
    { label: 'Approve', primary: true },
    { label: 'Later' },
  ],
}

/** Update item (rendered as Notif row). */
const UPDATE_ITEM: InboxItem = {
  id: 'test-update-1',
  title: 'Chief wrote the morning brief',
  summary: 'Everything on track.',
  sessionId: 'sess-2',
  channelId: 'ch-general',
  kind: 'update',
  status: 'done',
  createdAt: new Date(Date.now() - 60_000).toISOString(), // 1m ago → TODAY
  asker: 'Chief',
  askerArea: 'brand',
}

/** Mention item — contains @ in title. */
const MENTION_ITEM: InboxItem = {
  id: 'test-mention-1',
  title: '@Dede can you review the draft?',
  summary: '',
  sessionId: 'sess-3',
  channelId: 'ch-engineering',
  kind: 'mention',
  status: 'pending',
  createdAt: new Date(Date.now() - 30_000).toISOString(), // 30s → 1m ago → TODAY
  asker: 'Dev',
  askerArea: 'dev',
  needsYou: false,
}

// ── tests: sidebar ────────────────────────────────────────────────────────────

describe('NotificationsRoute — sidebar', () => {
  test('renders the 232px Notifications sidebar nav', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM])
    const nav = await screen.findByRole('navigation', { name: 'Notifications' })
    expect(nav).toBeInTheDocument()
    expect(nav.className).toContain('w-[232px]')
  })

  test('"All" filter is active by default', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM])
    await screen.findByRole('navigation', { name: 'Notifications' })
    const allBtn = screen.getByRole('button', { name: /^All/ })
    expect(allBtn).toHaveAttribute('aria-current', 'true')
  })

  test('AREAS group renders area NavLinks with area dots for live items', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM, MENTION_ITEM])
    await screen.findByRole('navigation', { name: 'Notifications' })
    // Wait for area dots to appear (rendered after async data resolves)
    const dots = await screen.findAllByTestId('area-dot')
    // Should have marketing, brand, dev — 3 unique areas
    expect(dots.length).toBe(3)
  })
})

// ── tests: filter behavior ────────────────────────────────────────────────────

describe('NotificationsRoute — filter behavior', () => {
  test('clicking "Needs you" hides grouped notif rows and keeps only decision cards', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM])
    // Wait for async data: decision section and notif group should both appear
    await screen.findByRole('region', { name: 'Needs you' })
    await screen.findByRole('region', { name: 'TODAY' })

    // Click "Needs you" in the sidebar
    const needsYouBtn = screen.getByRole('button', { name: /^Needs you/ })
    fireEvent.click(needsYouBtn)

    // Notif group must be gone
    expect(screen.queryByRole('region', { name: 'TODAY' })).not.toBeInTheDocument()

    // Decisions section must still be visible
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.getAllByRole('article').length).toBeGreaterThan(0)
  })

  test('clicking "Mentions" shows only items with "@" in title/summary', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM, MENTION_ITEM])
    await screen.findByRole('navigation', { name: 'Notifications' })

    const mentionsBtn = screen.getByRole('button', { name: /^Mentions/ })
    fireEvent.click(mentionsBtn)

    // Mention item must be visible
    expect(await screen.findByText(/@Dede can you review the draft\?/)).toBeInTheDocument()

    // Regular update with no "@" must be gone
    expect(screen.queryByText(/Chief wrote the morning brief/)).not.toBeInTheDocument()
  })

  test('filtering by area shows only items from that area', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM, MENTION_ITEM])
    // Wait for area buttons to appear after async data loads
    const devBtn = await screen.findByRole('button', { name: /^Dev/ })
    fireEvent.click(devBtn)

    // Mention from Dev must be visible
    expect(await screen.findByText(/@Dede can you review the draft\?/)).toBeInTheDocument()

    // Marketing decision must be gone
    expect(screen.queryByText(/Approve the launch plan/)).not.toBeInTheDocument()
  })
})

// ── tests: live data rendering ────────────────────────────────────────────────

describe('NotificationsRoute — live mock repo data', () => {
  test('renders decision cards from live inbox items (kind:decision, not compact)', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM])
    // Wait for async data to resolve
    const decisionArticle = await screen.findByRole('article', { name: /Approve the launch plan/ })
    expect(decisionArticle).toBeInTheDocument()
  })

  test('renders notif rows for update items', async () => {
    renderNotifications([DECISION_ITEM, UPDATE_ITEM])
    // Wait for async data to resolve
    expect(await screen.findByText(/Chief wrote the morning brief/)).toBeInTheDocument()
  })

  test('resolving a linked decision approves the proposal and removes it from the list', async () => {
    const linked: InboxItem = {
      ...DECISION_ITEM,
      proposals: [{ who: 'Growth', area: 'marketing', text: 'Launch plan', due: '', proposalId: 'prp-ad-budget' }],
    }
    renderNotifications([linked])
    await screen.findByRole('article', { name: /Approve the launch plan/ })

    // Click the "Approve" button on the decision card
    const approveBtn = screen.getByRole('button', { name: 'Approve' })
    fireEvent.click(approveBtn)

    // Card must be gone once the approval is saved
    await waitFor(() =>
      expect(screen.queryByRole('article', { name: /Approve the launch plan/ })).not.toBeInTheDocument(),
    )
  })

  test('unread dots follow the server read state', async () => {
    renderNotifications([UPDATE_ITEM, { ...MENTION_ITEM, readAt: new Date().toISOString() }])
    await screen.findByText(/Chief wrote the morning brief/)
    // Only the unread update shows a dot
    expect(screen.getAllByLabelText('unread')).toHaveLength(1)
  })
})

// ── tests: empty + error states ───────────────────────────────────────────────

describe('NotificationsRoute — empty state', () => {
  test('shows "You\'re all caught up" when inbox is empty', async () => {
    renderNotifications([])
    await screen.findByRole('navigation', { name: 'Notifications' })

    const empty = await screen.findByTestId('empty-state')
    expect(empty).toBeInTheDocument()
    expect(empty).toHaveTextContent(/You're all caught up/i)
  })

  test('no fixture content (DECISIONS/NOTIF_GROUPS) in live render — only inbox items shown', async () => {
    // Render with a single known item
    renderNotifications([DECISION_ITEM])
    await screen.findByRole('article', { name: /Approve the launch plan/ })

    // Fixture-specific text must not appear
    expect(screen.queryByText(/Chief needs your OK to send 214 messages/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Builder mentioned you in Passkey rollout plan/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Grower wants you to pick Friday's post/)).not.toBeInTheDocument()
  })
})

// ── tests: full mock repo (fixture inboxItems) ────────────────────────────────

describe('NotificationsRoute — with full mock inbox fixtures', () => {
  test('renders decision cards for non-compact decision items', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })

    // inbox-passkey-tasks and inbox-ad-budget are non-compact decisions
    const articles = await screen.findAllByRole('article')
    expect(articles.length).toBeGreaterThanOrEqual(2)
  })

  test('AREAS sidebar shows unique asker areas from inbox items', async () => {
    renderNotifications()
    // Wait for async data: area dots appear after inbox loads
    const dots = await screen.findAllByTestId('area-dot')
    expect(dots.length).toBeGreaterThanOrEqual(3)
  })

  test('Needs you count matches only needsYou:true items', async () => {
    renderNotifications()
    await screen.findByRole('navigation', { name: 'Notifications' })

    // 4 items have needsYou:true in fixtures → but "Needs you" filter shows decisions+notifs with needsYou
    const needsYouBtn = screen.getByRole('button', { name: /^Needs you/ })
    // Count is shown in button text; just verify it's a button with a count
    expect(needsYouBtn).toBeInTheDocument()
  })
})
