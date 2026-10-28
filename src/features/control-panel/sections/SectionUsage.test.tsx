/**
 * Tests for SectionUsage — live data from useUsage() + empty + error states.
 *
 * TDD: written RED first. Implementation rewires mock data to live repo.
 */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { UsageSummary } from '../../../core/domain/types'

import { SectionUsage } from './SectionUsage'

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIVE_USAGE: UsageSummary = {
  balance: 4_200,
  included: 2_000,
  usedThisPeriod: 1_450,
  byHelper: [
    { helperId: 'h-chief', credits: 820 },
    { helperId: 'h-dev', credits: 430 },
  ],
  byDay: [
    { day: '2026-10-01', credits: 180 },
    { day: '2026-10-08', credits: 260 },
  ],
  pendingTopups: { count: 0, totalCredits: 0 },
  lastPayment: null,
}

// ── helpers ───────────────────────────────────────────────────────────────────

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
    usage: { get: vi.fn().mockResolvedValue({ ...LIVE_USAGE }) },
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
    ...overrides,
  }
}

function renderSection(repos: Repos) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <SectionUsage onDialog={() => {}} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SectionUsage', () => {
  test('renders live balance from the repo', async () => {
    renderSection(makeRepos())
    // balance 4200 credits should appear
    await waitFor(() => expect(screen.getByText(/4,?200/)).toBeInTheDocument())
  })

  test('renders usedThisPeriod from the repo', async () => {
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText(/1,?450/)).toBeInTheDocument())
  })

  test('empty state renders when usage returns zero values', async () => {
    const emptyUsage: UsageSummary = {
      balance: 0,
      included: 0,
      usedThisPeriod: 0,
      byHelper: [],
      byDay: [],
    }
    renderSection(makeRepos({ usage: { get: vi.fn().mockResolvedValue(emptyUsage) } }))
    await waitFor(() => expect(screen.getByText(/no usage/i)).toBeInTheDocument())
  })

  test('error state renders when usage query rejects', async () => {
    renderSection(makeRepos({ usage: { get: vi.fn().mockRejectedValue(new Error('network')) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
