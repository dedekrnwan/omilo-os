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
import type { StorageSummary } from '../../../core/domain/controlPanel'

import { SectionUsage } from './SectionUsage'

// ── fixtures ──────────────────────────────────────────────────────────────────

const GB = 1024 ** 3
const STORAGE: StorageSummary = {
  usedBytes: 2 * GB,
  quotaBytes: 50 * GB,
  segments: [
    { key: 'docs', label: 'Docs', bytes: 1.5 * GB, counted: true },
    { key: 'files', label: 'Files & artifacts', bytes: 0.5 * GB, counted: true },
    { key: 'knowledge', label: 'Knowledge', bytes: 0, counted: true },
    { key: 'chats', label: 'Chats & run logs (free)', bytes: 3 * GB, counted: false },
  ],
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
  } as Repos
}

function withStorage(storage: () => Promise<StorageSummary>): Partial<Repos> {
  return { controlPanel: { storage, invoices: vi.fn().mockResolvedValue([]) } } as unknown as Partial<Repos>
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
  test('shows storage used against the plan', async () => {
    renderSection(makeRepos(withStorage(vi.fn().mockResolvedValue({ ...STORAGE }))))
    await waitFor(() => expect(screen.getByText(/of 50/)).toBeInTheDocument())
    expect(screen.getByRole('meter', { name: /storage used/i })).toHaveAttribute('aria-valuenow', '4')
    expect(screen.getByText(/not counted/i)).toBeInTheDocument()
    expect(screen.queryByText(/buy credits/i)).not.toBeInTheDocument()
  })

  test('says uploads are paused when storage is full', async () => {
    renderSection(makeRepos(withStorage(vi.fn().mockResolvedValue({ ...STORAGE, usedBytes: 50 * GB }))))
    await waitFor(() => expect(screen.getByText(/new uploads are paused/i)).toBeInTheDocument())
  })

  test('error state renders when storage query rejects', async () => {
    renderSection(makeRepos(withStorage(vi.fn().mockRejectedValue(new Error('network')))))
    await waitFor(() => expect(screen.getByText(/could not measure/i)).toBeInTheDocument())
  })
})
