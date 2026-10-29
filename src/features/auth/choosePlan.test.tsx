/**
 * Tests for ChoosePlanPage — P12-T3
 *
 * TDD: covers:
 * 1. Renders ONE cloud plan from a stubbed usePlans repo
 * 2. Toggle monthly↔yearly changes displayed price + interval sent to changePlan
 * 3. CTA calls changePlan(planId, selectedInterval)
 * 4. Trial countdown renders "N days left" from stubbed subscription (is_trial)
 * 5. Static PLANS fixture ($39/$159) is gone from the page output
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router'
import { ReposProvider } from '../../app/ReposProvider'
import type { Repos } from '../../core/ports/repos'
import type { BillingPlan, BillingSubscription } from '../../core/domain/types'

// ── fixtures ──────────────────────────────────────────────────────────────────

const MOCK_PLAN: BillingPlan = {
  id: 'plan-cloud',
  tier: 'cloud',
  name: 'Cloud',
  monthlyPriceUsd: 39,
  monthlyPriceIdr: 599_000,
  yearlyPriceUsd: 31,
  yearlyPriceIdr: 479_000,
  includedCredits: 2_000,
  seats: 5,
  trialDays: 14,
}

const MOCK_SUB_TRIAL: BillingSubscription = {
  planId: 'plan-cloud',
  status: 'trialing',
  currentPeriodEnd: '2026-11-11T00:00:00Z',
  seats: 5,
  billingInterval: 'yearly',
  isTrial: true,
  trialEndsAt: '2026-11-11T00:00:00Z',
  trialDaysLeft: 7,
}

// ── commands mock ─────────────────────────────────────────────────────────────

const changePlanMock = vi.fn().mockResolvedValue({})

vi.mock('../../features/control-panel/sections/getCommands', () => ({
  getCommands: () => ({ changePlan: changePlanMock }),
}))

// ── isMockMode mock ───────────────────────────────────────────────────────────

vi.mock('../../app/useAuth', () => ({
  isMockMode: () => false,
  useAuth: () => ({ mock: false }),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepos(overrides?: Partial<Repos>): Repos {
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    goals: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    sessions: { get: vi.fn().mockResolvedValue(null), listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    billingPlans: { list: vi.fn().mockResolvedValue([MOCK_PLAN]) },
    billingSubscription: { get: vi.fn().mockResolvedValue(null) },
    usage: { get: vi.fn().mockResolvedValue({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: vi.fn().mockResolvedValue({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: vi.fn().mockResolvedValue([]) },
    marketplace: { list: vi.fn().mockResolvedValue([]) },
    connectors: { list: vi.fn().mockResolvedValue([]) },
    mcpTokens: { list: vi.fn().mockResolvedValue([]) },
    flows: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null), runs: vi.fn().mockResolvedValue([]) },
    routines: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    knowledge: { sources: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) },
    analytics: { overview: vi.fn().mockResolvedValue({ stats: [], series: [] }), helpers: vi.fn().mockResolvedValue([]) },
    skills: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    helpers: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    members: { list: vi.fn().mockResolvedValue([]) },
    ...overrides,
  }
}

async function renderPage(repos: Repos) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  // ChoosePlanPage uses useNavigate so it must be inside a Router
  const { ChoosePlanPage } = await import('./ChoosePlanPage')

  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <Outlet />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const planRoute = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: ChoosePlanPage,
  })
  const history = createMemoryHistory({ initialEntries: ['/'] })
  const router = createRouter({ routeTree: root.addChildren([planRoute]), history })
  return render(<RouterProvider router={router} />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ChoosePlanPage', () => {
  beforeEach(() => {
    changePlanMock.mockClear()
    changePlanMock.mockResolvedValue({})
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('renders ONE cloud plan card from stubbed usePlans', async () => {
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByRole('region', { name: /cloud/i })).toBeInTheDocument())
    // should render the plan name
    expect(screen.getByText('Cloud')).toBeInTheDocument()
  })

  test('yearly price is shown by default (Rp 479.000)', async () => {
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())
    // 479,000 in id-ID locale
    expect(screen.getByText(/479/)).toBeInTheDocument()
  })

  test('toggling to Monthly shows monthly price (Rp 599.000)', async () => {
    const user = userEvent.setup()
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: /monthly/i }))
    expect(screen.getByText(/599/)).toBeInTheDocument()
  })

  test('toggling back to Yearly shows yearly price again', async () => {
    const user = userEvent.setup()
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())

    await user.click(screen.getByRole('radio', { name: /monthly/i }))
    await user.click(screen.getByRole('radio', { name: /yearly/i }))
    expect(screen.getByText(/479/)).toBeInTheDocument()
  })

  test('CTA calls changePlan with planId and default interval (yearly)', async () => {
    const user = userEvent.setup()
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText(/14-day trial/i)).toBeInTheDocument())

    await user.click(screen.getByText(/14-day trial/i))
    await waitFor(() => expect(changePlanMock).toHaveBeenCalled())
    expect(changePlanMock).toHaveBeenCalledWith('plan-cloud', 'yearly')
  })

  test('CTA calls changePlan with monthly interval when monthly is selected', async () => {
    const user = userEvent.setup()
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())

    // Switch to monthly first
    await user.click(screen.getByRole('radio', { name: /monthly/i }))
    await user.click(screen.getByText(/14-day trial/i))

    await waitFor(() => expect(changePlanMock).toHaveBeenCalled())
    expect(changePlanMock).toHaveBeenCalledWith('plan-cloud', 'monthly')
  })

  test('redirects browser when hosted_url is returned', async () => {
    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: assignMock },
      writable: true,
    })
    changePlanMock.mockResolvedValueOnce({ hosted_url: 'https://pay.doit.id/abc' })

    const user = userEvent.setup()
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText(/14-day trial/i)).toBeInTheDocument())

    await user.click(screen.getByText(/14-day trial/i))
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith('https://pay.doit.id/abc'))
  })

  test('static $39/$159 price labels are NOT present in the page', async () => {
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())
    expect(screen.queryByText('$39')).not.toBeInTheDocument()
    expect(screen.queryByText('$159')).not.toBeInTheDocument()
  })

  test('"Yearly · save 20%" label is shown', async () => {
    await renderPage(makeRepos())
    await waitFor(() => expect(screen.getByText('Cloud')).toBeInTheDocument())
    expect(screen.getByText(/save 20%/i)).toBeInTheDocument()
  })
})

// ── SectionUsage trial banner tests ──────────────────────────────────────────

describe('SectionUsage — trial countdown', () => {
  test('shows "Free trial · 7 days left" when subscription is_trial + trial_days_left=7', async () => {
    const { SectionUsage } = await import('../control-panel/sections/SectionUsage')
    const repos = makeRepos({
      billingSubscription: { get: vi.fn().mockResolvedValue(MOCK_SUB_TRIAL) },
      usage: {
        get: vi.fn().mockResolvedValue({
          balance: 1000,
          included: 2000,
          usedThisPeriod: 100,
          byHelper: [],
          byDay: [],
        }),
      },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { render: rtlRender, screen: rtlScreen, waitFor: rtlWaitFor } = await import('@testing-library/react')

    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <SectionUsage onDialog={() => {}} />
        </ReposProvider>
      </QueryClientProvider>,
    )

    await rtlWaitFor(() => expect(rtlScreen.getByText(/free trial · 7 days? left/i)).toBeInTheDocument())
  })

  test('shows Subscribe CTA when on trial', async () => {
    const { SectionUsage } = await import('../control-panel/sections/SectionUsage')
    const repos = makeRepos({
      billingSubscription: { get: vi.fn().mockResolvedValue(MOCK_SUB_TRIAL) },
      usage: {
        get: vi.fn().mockResolvedValue({
          balance: 1000,
          included: 2000,
          usedThisPeriod: 100,
          byHelper: [],
          byDay: [],
        }),
      },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { render: rtlRender, screen: rtlScreen, waitFor: rtlWaitFor } = await import('@testing-library/react')

    rtlRender(
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>
          <SectionUsage onDialog={() => {}} />
        </ReposProvider>
      </QueryClientProvider>,
    )

    await rtlWaitFor(() => expect(rtlScreen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument())
  })
})
