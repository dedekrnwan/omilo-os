import { describe, test, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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
import type { AnalyticsOverview, HelperStat } from '../../core/domain/types'
import { useUIStore } from '../../app/store'
import { useSession } from '../../app/session'
import { ChatAnalyticsRoute } from './ChatAnalyticsRoute'
import { OfficeAnalyticsRoute } from './OfficeAnalyticsRoute'

function makeRouter(path: string, reposOverride?: Partial<Repos>) {
  const repos = { ...createMockRepos(), ...reposOverride }
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const chat = createRoute({ getParentRoute: () => rootRoute, path: '/chat/$channelId/analytics', component: ChatAnalyticsRoute })
  const office = createRoute({ getParentRoute: () => rootRoute, path: '/office/analytics', component: OfficeAnalyticsRoute })
  return createRouter({
    routeTree: rootRoute.addChildren([chat, office]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
}

async function mount(path: string, reposOverride?: Partial<Repos>) {
  const router = makeRouter(path, reposOverride)
  await router.load()
  render(<RouterProvider router={router} />)
}

// Seed a real company name for all tests so useSession(s => s.company?.name) returns a known string.
const TEST_COMPANY = { id: 'cmp-test', name: 'Demo Workspace', currency: 'IDR', onboarded: true }

beforeEach(() => {
  useSession.setState({ status: 'authed', company: TEST_COMPANY, companies: [TEST_COMPANY] })
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  useUIStore.setState({ areaId: null })
  useSession.setState({ status: 'loading', company: null, companies: [] })
})

describe('ChatAnalyticsRoute', () => {
  // Chat analytics is area-driven: a selected area shows that area's overview.
  beforeEach(() => useUIStore.setState({ areaId: 'ch-engineering' }))

  test('renders the channel overview', async () => {
    await mount('/chat/ch-engineering/analytics')
    // Title reflects live area name from mock repos (channel 'ch-engineering' → 'Engineering')
    expect(await screen.findByText('Analytics · Engineering')).toBeInTheDocument()
    // Tokens chart built from GET /v1/analytics/tokens-by-helper
    expect(await screen.findByText('Tokens by helper')).toBeInTheDocument()
    // Stats label from the overview endpoint
    expect(screen.getByText('Jobs done')).toBeInTheDocument()
    // helpersSub reflects the live helper rows scoped to the area
    expect(screen.getByText(/^2 helpers/)).toBeInTheDocument()
  })

  test('switches between tabs', async () => {
    await mount('/chat/ch-engineering/analytics')
    await screen.findByText('Analytics · Engineering')
    fireEvent.click(screen.getByRole('tab', { name: /Helpers/ }))
    expect(screen.getByText('Hire a helper')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Loops/ }))
    expect(await screen.findByText('PR digest to #engineering')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Reliability/ }))
    expect(screen.getByText('Recent failures')).toBeInTheDocument()
    expect(screen.getByText('Top causes')).toBeInTheDocument()
    expect(await screen.findByText('Weekly latency report')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Activity/ }))
    expect(await screen.findByText('TODAY')).toBeInTheDocument()
    expect(screen.getByText('Show')).toBeInTheDocument()
  })

  test('Set budget opens the budget drawer', async () => {
    await mount('/chat/ch-engineering/analytics')
    await screen.findByText('Analytics · Engineering')
    // Dev has no budget in the mock data; pick the first "Set" button
    const setBtns = await screen.findAllByRole('button', { name: 'Set' })
    fireEvent.click(setBtns[0])
    // BudgetDrawer opens for the helper whose "Set" was clicked
    expect(await screen.findByText(/Budget for/i)).toBeInTheDocument()
    expect(screen.getByText('When the budget runs out')).toBeInTheDocument()
  })

  test('a helper that hit its budget shows the toast and the reached card', async () => {
    const reached: HelperStat[] = [
      {
        helperId: 'h-dev', name: 'Dev', area: 'dev', jobs: 4, success: 100, tokens: 1000, spend: 50,
        status: 'paused', budget: { spent: 1000, limit: 1000 }, budgetReached: true,
      },
    ]
    window.history.replaceState(null, '', '/?tab=helpers')
    await mount('/chat/ch-engineering/analytics', {
      analytics: {
        overview: () => Promise.resolve({ stats: [], series: [] }),
        helpers: () => Promise.resolve(reached),
      },
    })
    expect(await screen.findByText('Budget limit reached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Raise budget' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Allow this job' })).toBeInTheDocument()
  })
})

describe('OfficeAnalyticsRoute', () => {
  test('renders the company overview', async () => {
    await mount('/office/analytics')
    // In mock mode the session company is "Demo Workspace" (from session.ts DEMO_COMPANY)
    expect(await screen.findByText('Analytics · Demo Workspace')).toBeInTheDocument()
    // Spend chart built from GET /v1/analytics/spend-by-channel
    expect(await screen.findByText('Spend by channel')).toBeInTheDocument()
    // helpersSub reflects the live helper rows (3 helpers, 2 working)
    expect(screen.getByText('3 helpers · 2 working now')).toBeInTheDocument()
  })
})

describe('OfficeAnalyticsRoute — live data', () => {
  test('renders stats from useAnalyticsOverview, not fixture', async () => {
    const overview: AnalyticsOverview = {
      stats: [
        { label: 'Jobs done', value: 999 },
        { label: 'Success rate', value: 88, note: '%' },
      ],
      series: [],
    }
    await mount('/office/analytics', {
      analytics: {
        overview: () => Promise.resolve(overview),
        helpers: () => Promise.resolve([]),
      },
    })
    expect(await screen.findByText('999')).toBeInTheDocument()
    expect(screen.getByText('88%')).toBeInTheDocument()
    // fixture value '418' (officeStats Jobs done) must not appear
    expect(screen.queryByText('418')).not.toBeInTheDocument()
  })

  test('renders helper rows from useAnalyticsHelpers', async () => {
    const helpers: HelperStat[] = [
      { helperId: 'h-a', name: 'Alpha Helper', jobs: 7, success: 100, tokens: 5000, spend: 10 },
    ]
    await mount('/office/analytics', {
      analytics: {
        overview: () => Promise.resolve({ stats: [], series: [] }),
        helpers: () => Promise.resolve(helpers),
      },
    })
    expect(await screen.findByText('Alpha Helper')).toBeInTheDocument()
  })

  test('range selector drives refetch — 30 days pill changes query key', async () => {
    let capturedRange: string | undefined
    await mount('/office/analytics', {
      analytics: {
        overview: async (range) => {
          capturedRange = range
          return { stats: [], series: [] }
        },
        helpers: () => Promise.resolve([]),
      },
    })
    await screen.findByRole('button', { name: /30 days/i })
    fireEvent.click(screen.getByRole('button', { name: /30 days/i }))
    // The toolbar label is mapped to the API range key
    await waitFor(() => expect(capturedRange).toBe('month'))
  })

  test('empty state: no stats or helpers renders placeholder', async () => {
    await mount('/office/analytics', {
      analytics: {
        overview: () => Promise.resolve({ stats: [], series: [] }),
        helpers: () => Promise.resolve([]),
      },
    })
    expect(await screen.findByText(/no data/i)).toBeInTheDocument()
  })

  test('error state: failed overview renders error banner', async () => {
    await mount('/office/analytics', {
      analytics: {
        overview: () => Promise.reject(new Error('network')),
        helpers: () => Promise.resolve([]),
      },
    })
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
  })
})
