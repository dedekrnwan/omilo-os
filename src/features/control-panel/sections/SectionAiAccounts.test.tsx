/**
 * Tests for SectionAiAccounts — live data from useAiAccounts() + empty + error states.
 *
 * TDD: written RED first. Implementation rewires mock data to live repo.
 */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { AiAccount } from '../../../core/domain/types'

import { SectionAiAccounts } from './SectionAiAccounts'

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIVE_ACCOUNTS: AiAccount[] = [
  {
    id: 'acc-chief',
    harness: 'claude',
    name: 'Anthropic main',
    tag: 'primary',
    status: 'ready',
    pctWindow: 12,
    tokens: 'sk-ant-...****',
    lastUsed: '2026-10-24T09:00:00Z',
  },
  {
    id: 'acc-dev',
    harness: 'claude',
    name: 'Anthropic dev overflow',
    tag: 'overflow',
    status: 'ready',
    pctWindow: 4,
    tokens: 'sk-ant-...####',
    lastUsed: '2026-10-22T15:30:00Z',
  },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepos(overrides?: Partial<Repos>): Repos {
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    goals: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    sessions: { get: vi.fn().mockResolvedValue(null), listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    usage: { get: vi.fn().mockResolvedValue({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: vi.fn().mockResolvedValue({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: vi.fn().mockResolvedValue([...LIVE_ACCOUNTS]) },
    marketplace: { list: vi.fn().mockResolvedValue([]) },
    connectors: { list: vi.fn().mockResolvedValue([]) },
    mcpTokens: { list: vi.fn().mockResolvedValue([]) },
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
        <SectionAiAccounts onDialog={() => {}} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SectionAiAccounts', () => {
  test('renders live AI accounts from the repo', async () => {
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText('Anthropic main')).toBeInTheDocument())
    expect(screen.getByText('Anthropic dev overflow')).toBeInTheDocument()
  })

  test('renders account status from the repo', async () => {
    renderSection(makeRepos())
    await waitFor(() => {
      // "ready" status shown via StatusBadge
      const badges = screen.getAllByText(/ready/i)
      expect(badges.length).toBeGreaterThanOrEqual(1)
    })
  })

  test('empty state renders when no accounts returned', async () => {
    renderSection(makeRepos({ aiAccounts: { list: vi.fn().mockResolvedValue([]) } }))
    await waitFor(() => expect(screen.getByText(/no ai accounts/i)).toBeInTheDocument())
  })

  test('error state renders when aiAccounts query rejects', async () => {
    renderSection(makeRepos({ aiAccounts: { list: vi.fn().mockRejectedValue(new Error('network')) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
