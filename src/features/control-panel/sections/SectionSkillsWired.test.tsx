/**
 * P8-T6: SectionSkills wired to live repos (useSkills) + publishSkill command.
 *
 * RED → impl → GREEN.
 *
 * Pattern mirrors SectionConnectors.test.tsx.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { Skill } from '../../../core/domain/types'

// ── command mocks ─────────────────────────────────────────────────────────────

const mockPublishSkill = vi.fn()

vi.mock('../../../adapters/http/commands', () => ({
  createCommands: () => ({
    publishSkill: mockPublishSkill,
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

import { SectionSkills } from './SectionSkills'

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIVE_SKILLS: Skill[] = [
  {
    id: 'skl-live-standard',
    name: 'Live Standard Skill',
    status: 'active',
    version: 1,
    helperId: 'h-chief',
    usageCount: 10,
  },
  {
    id: 'skl-live-draft',
    name: 'Live Draft Skill',
    status: 'draft',
    version: 1,
    helperId: 'h-dev',
    usageCount: 0,
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
    skills: { list: vi.fn().mockResolvedValue([...LIVE_SKILLS]), get: vi.fn().mockResolvedValue(null) },
    helpers: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    ...overrides,
  }
}

function renderSection(repos: Repos) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <SectionSkills onDialog={() => {}} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SectionSkills — live repo', () => {
  beforeEach(() => {
    mockPublishSkill.mockClear()
    mockPublishSkill.mockResolvedValue({})
  })

  test('renders skills from useSkills() (not the static fixture)', async () => {
    renderSection(makeRepos())
    // Names from the live mock, not from the hardcoded SKILLS in SectionSkills.tsx
    await waitFor(() => expect(screen.getByText('Live Standard Skill')).toBeInTheDocument())
    expect(screen.getByText('Live Draft Skill')).toBeInTheDocument()
    // Old hardcoded fixture names should NOT appear
    expect(screen.queryByText('House voice')).toBeNull()
    expect(screen.queryByText('Reconcile payouts')).toBeNull()
  })

  test('Publish button calls publishSkill with the skill id', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText('Live Standard Skill')).toBeInTheDocument())

    // Click publish on the first skill
    const publishBtn = screen.getAllByRole('button', { name: /publish/i })[0]
    await user.click(publishBtn)

    expect(mockPublishSkill).toHaveBeenCalledOnce()
    expect(mockPublishSkill).toHaveBeenCalledWith(LIVE_SKILLS[0].id)
  })

  test('empty state when repo returns no skills', async () => {
    renderSection(makeRepos({ skills: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) } }))
    await waitFor(() => expect(screen.getByText(/no skills/i)).toBeInTheDocument())
  })

  test('error state when skills query rejects', async () => {
    renderSection(makeRepos({ skills: { list: vi.fn().mockRejectedValue(new Error('net')), get: vi.fn().mockResolvedValue(null) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
