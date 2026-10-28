/**
 * Tests for SectionConnectors — live connectors + marketplace install + disconnect via ConfirmDialog.
 *
 * TDD: written RED first, then implementation brings them GREEN.
 * Pattern: inject mock repos via ReposProvider + QueryClientProvider (mirrors CreateChannelDialog.test.tsx).
 * Commands are provided via vi.mock so we can spy on installConnector / disconnectConnector.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { Connector, Piece } from '../../../core/domain/types'

// ── command mocks ─────────────────────────────────────────────────────────────

const mockInstallConnector = vi.fn()
const mockUpdateConnector = vi.fn()
const mockDisconnectConnector = vi.fn()

vi.mock('../../../adapters/http/commands', () => ({
  createCommands: () => ({
    installConnector: mockInstallConnector,
    updateConnector: mockUpdateConnector,
    disconnectConnector: mockDisconnectConnector,
  }),
}))

import { SectionConnectors } from './SectionConnectors'

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIVE_CONNECTORS: Connector[] = [
  { id: 'con-slack', pieceId: 'piece-slack', label: 'Slack', source: 'marketplace', status: 'connected', enabled: true },
  { id: 'con-github', pieceId: 'piece-github', label: 'GitHub', source: 'marketplace', status: 'connected', enabled: true },
]

const PIECES: Piece[] = [
  { id: 'piece-notion', label: 'Notion', category: 'productivity', description: 'Notion pages', authType: 'oauth2', actionCount: 10, logo: null, status: 'ok' },
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
    billingPlans: { list: vi.fn().mockResolvedValue([]) },
    billingSubscription: { get: vi.fn().mockResolvedValue(null) },
    usage: { get: vi.fn().mockResolvedValue({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: vi.fn().mockResolvedValue({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: vi.fn().mockResolvedValue([]) },
    marketplace: { list: vi.fn().mockResolvedValue(PIECES) },
    connectors: { list: vi.fn().mockResolvedValue([...LIVE_CONNECTORS]) },
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
        <SectionConnectors onDialog={() => {}} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SectionConnectors', () => {
  beforeEach(() => {
    mockInstallConnector.mockClear()
    mockUpdateConnector.mockClear()
    mockDisconnectConnector.mockClear()
    mockInstallConnector.mockResolvedValue({ id: 'con-new', pieceId: 'piece-notion', label: 'Notion', source: 'marketplace', status: 'connected', enabled: true })
    mockDisconnectConnector.mockResolvedValue(undefined)
    mockUpdateConnector.mockResolvedValue({ id: 'con-slack', pieceId: 'piece-slack', label: 'Slack', source: 'marketplace', status: 'connected', enabled: false })
  })

  test('renders live connectors from the repo', async () => {
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText('Slack')).toBeInTheDocument())
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })

  test('renders marketplace pieces in the browse area', async () => {
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText('Notion')).toBeInTheDocument())
  })

  test('Install button calls installConnector with the piece id', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())

    await waitFor(() => expect(screen.getByText('Notion')).toBeInTheDocument())
    const installBtn = screen.getByRole('button', { name: /install/i })
    await user.click(installBtn)

    expect(mockInstallConnector).toHaveBeenCalledOnce()
    expect(mockInstallConnector).toHaveBeenCalledWith('piece-notion')
  })

  test('Disconnect opens ConfirmDialog — disconnectConnector NOT called before confirm', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())

    await waitFor(() => expect(screen.getByText('Slack')).toBeInTheDocument())

    // Open the ⋯ menu for the Slack connector
    const moreBtn = screen.getByRole('button', { name: /slack options/i })
    await user.click(moreBtn)

    // Click "Disconnect" inside the dropdown
    const disconnectItem = screen.getByRole('menuitem', { name: /disconnect/i })
    await user.click(disconnectItem)

    // Dialog must appear — disconnectConnector NOT yet called
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockDisconnectConnector).not.toHaveBeenCalled()

    // Confirm in the sad-mascot dialog
    const confirmBtn = screen.getByRole('button', { name: /disconnect/i })
    await user.click(confirmBtn)

    await waitFor(() => expect(mockDisconnectConnector).toHaveBeenCalledOnce())
    expect(mockDisconnectConnector).toHaveBeenCalledWith('con-slack')
  })

  test('empty state renders when no connectors returned', async () => {
    renderSection(makeRepos({ connectors: { list: vi.fn().mockResolvedValue([]) } }))
    await waitFor(() => expect(screen.getByText(/no connectors/i)).toBeInTheDocument())
  })

  test('error state renders when connector query rejects', async () => {
    renderSection(makeRepos({ connectors: { list: vi.fn().mockRejectedValue(new Error('network')) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
