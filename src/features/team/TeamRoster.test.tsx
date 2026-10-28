/**
 * P8-T6: TeamRoster + HelperDetail wired to live repos (useHelpers / useHelper).
 *
 * RED → impl → GREEN.
 *
 * Pattern mirrors SectionConnectors.test.tsx:
 *   - Inject mock repos via ReposProvider + QueryClientProvider.
 *   - Commands are vi.mock-ed so we can spy on publishSkill.
 *   - Empty + error states are verified on each wired list.
 */

import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { ReposProvider } from '../../app/ReposProvider'
import type { Repos } from '../../core/ports/repos'
import type { Helper } from '../../core/domain/types'

// ── command mocks ─────────────────────────────────────────────────────────────

const mockPublishSkill = vi.fn()

vi.mock('../../adapters/http/commands', () => ({
  createCommands: () => ({
    publishSkill: mockPublishSkill,
    // other commands unused in these tests
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
    requestChanges: vi.fn(),
    mintMcpToken: vi.fn(),
    revokeMcpToken: vi.fn(),
    installConnector: vi.fn(),
    updateConnector: vi.fn(),
    connectorCredentials: vi.fn(),
    disconnectConnector: vi.fn(),
    createArea: vi.fn(),
    updateWallet: vi.fn(),
    topup: vi.fn(),
    changePlan: vi.fn(),
    updateCompanyProfile: vi.fn(),
    publishFlow: vi.fn(),
    runFlow: vi.fn(),
    testRunFlow: vi.fn(),
    runRoutineNow: vi.fn(),
    replanGoal: vi.fn(),
  }),
}))

// Import AFTER the mock so the module uses the mocked commands
import { TeamRoster } from './TeamRoster'
import { HelperDetail } from './HelperDetail'
import { TeamLayout } from './TeamLayout'

// ── fixture helpers ────────────────────────────────────────────────────────────

const LIVE_HELPERS: Helper[] = [
  {
    id: 'h-chief',
    name: 'LiveChief',
    area: 'brand',
    role: 'Chief of Staff',
    status: 'active',
    isChief: true,
  },
  {
    id: 'h-dev',
    name: 'LiveDev',
    area: 'dev',
    role: 'Engineering',
    status: 'active',
    isChief: false,
  },
]

function makeRepos(overrides?: Partial<Repos>): Repos {
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    goals: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    sessions: { get: vi.fn().mockResolvedValue(null), listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    billingPlans: { list: vi.fn().mockResolvedValue([]) },
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
    helpers: { list: vi.fn().mockResolvedValue([...LIVE_HELPERS]), get: vi.fn().mockResolvedValue(null) },
    ...overrides,
  }
}

// ── render helpers ─────────────────────────────────────────────────────────────

function renderRoster(repos: Repos) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const root = createRootRoute({ notFoundComponent: () => <div>Not found</div> })
  const team = createRoute({ getParentRoute: () => root, path: '/team', component: TeamLayout })
  const roster = createRoute({ getParentRoute: () => team, path: '/', component: TeamRoster })
  const routeTree = root.addChildren([team.addChildren([roster])])
  const history = createMemoryHistory({ initialEntries: ['/team/'] })
  const router = createRouter({ routeTree, history })

  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <RouterProvider router={router} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

function renderHelperDetail(helperId: string, repos: Repos) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  const root = createRootRoute({ notFoundComponent: () => <div data-testid="not-found">Not found</div> })
  const team = createRoute({ getParentRoute: () => root, path: '/team', component: TeamLayout })
  const detail = createRoute({ getParentRoute: () => team, path: '$helperId', component: HelperDetail })
  const routeTree = root.addChildren([team.addChildren([detail])])
  const history = createMemoryHistory({ initialEntries: [`/team/${helperId}`] })
  const router = createRouter({ routeTree, history })

  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <RouterProvider router={router} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── TeamRoster ─────────────────────────────────────────────────────────────────

describe('TeamRoster — live repo', () => {
  test('renders helpers from useHelpers() (not the fixture)', async () => {
    renderRoster(makeRepos())
    // LiveChief and LiveDev come from the mock repo, not from teamData.ts HELPERS
    await waitFor(() => expect(screen.getByText('LiveChief')).toBeInTheDocument())
    expect(screen.getByText('LiveDev')).toBeInTheDocument()
  })

  test('renders "Hire a helper" card from the roster', async () => {
    renderRoster(makeRepos())
    await waitFor(() => expect(screen.getByText('Hire a helper')).toBeInTheDocument())
  })

  test('empty state when repo returns no helpers', async () => {
    renderRoster(makeRepos({ helpers: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) } }))
    await waitFor(() => expect(screen.getByText(/no helpers/i)).toBeInTheDocument())
  })

  test('error state when helpers query rejects', async () => {
    renderRoster(makeRepos({ helpers: { list: vi.fn().mockRejectedValue(new Error('network')), get: vi.fn().mockResolvedValue(null) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})

// ── HelperDetail ──────────────────────────────────────────────────────────────

describe('HelperDetail — live repo', () => {
  test('renders helper data from useHelper(id)', async () => {
    const helper = LIVE_HELPERS[0]
    const repos = makeRepos({
      helpers: {
        list: vi.fn().mockResolvedValue(LIVE_HELPERS),
        get: vi.fn().mockImplementation((id: string) =>
          Promise.resolve(LIVE_HELPERS.find((h) => h.id === id) ?? null),
        ),
      },
    })
    renderHelperDetail(helper.id, repos)
    await waitFor(() => expect(screen.getByText('LiveChief')).toBeInTheDocument())
    // not the fixture's "Chief" string
    expect(screen.queryByText(/^Chief$/)).toBeNull()
  })

  test('not-found state when helper id not in repo', async () => {
    const repos = makeRepos()
    renderHelperDetail('unknown-id', repos)
    await waitFor(() => expect(screen.getByText(/helper not found/i)).toBeInTheDocument())
  })
})
