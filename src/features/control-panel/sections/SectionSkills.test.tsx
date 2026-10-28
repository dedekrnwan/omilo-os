/**
 * SectionSkills filter tests — updated for P8-T6 live repo wiring.
 *
 * SectionSkills now uses useSkills() so it needs QueryClientProvider + ReposProvider.
 * We inject mock skills matching the live Skill domain type.
 */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { Skill } from '../../../core/domain/types'
import { SectionSkills } from './SectionSkills'

const MOCK_SKILLS: Skill[] = [
  { id: 'skl-active', name: 'House voice', status: 'active', version: 1, helperId: 'h-chief', usageCount: 214 },
  { id: 'skl-draft', name: 'Release notes', status: 'draft', version: 1, helperId: 'h-dev', usageCount: 6 },
]

function makeRepos(): Repos {
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    goals: { listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    sessions: { get: vi.fn().mockResolvedValue(null), listByChannel: vi.fn().mockResolvedValue([]), listAll: vi.fn().mockResolvedValue([]) },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
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
    skills: { list: vi.fn().mockResolvedValue([...MOCK_SKILLS]), get: vi.fn().mockResolvedValue(null) },
    helpers: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
  }
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={makeRepos()}>
        <SectionSkills onDialog={() => {}} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

describe('SectionSkills filters', () => {
  test('the segmented filter narrows the grid by skill status', async () => {
    const user = userEvent.setup()
    renderSection()

    // Wait for data to load
    await waitFor(() => expect(screen.getByText('House voice')).toBeInTheDocument())
    expect(screen.getByText('Release notes')).toBeInTheDocument()

    // Filter to draft → the active skill drops out
    await user.click(screen.getByRole('tab', { name: 'draft' }))
    expect(screen.queryByText('House voice')).not.toBeInTheDocument()
    expect(screen.getByText('Release notes')).toBeInTheDocument()

    // Back to All → it returns
    await user.click(screen.getByRole('tab', { name: 'All' }))
    await waitFor(() => expect(screen.getByText('House voice')).toBeInTheDocument())
  })
})
