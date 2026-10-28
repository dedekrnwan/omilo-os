/**
 * Tests for SectionMcpTokens — list tokens, mint (shows raw secret once), revoke via ConfirmDialog.
 *
 * TDD: written RED first, then implementation brings them GREEN.
 * Pattern: ReposProvider + QueryClientProvider.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import type { Repos } from '../../../core/ports/repos'
import type { McpToken } from '../../../core/domain/types'

// ── command mocks ─────────────────────────────────────────────────────────────

const RAW_SECRET = 'omilo-mcp-secret-abc123xyz'

const mockMintMcpToken = vi.fn()
const mockRevokeMcpToken = vi.fn()

vi.mock('../../../adapters/http/commands', () => ({
  createCommands: () => ({
    mintMcpToken: mockMintMcpToken,
    revokeMcpToken: mockRevokeMcpToken,
  }),
}))

import { SectionMcpTokens } from './SectionMcpTokens'

// ── fixtures ──────────────────────────────────────────────────────────────────

const LIVE_TOKENS: McpToken[] = [
  {
    id: 'mct-chief-cursor',
    label: 'Chief · Cursor',
    helperId: 'h-chief',
    scopes: ['identity', 'goals'],
    expiresAt: null,
    lastUsedAt: '2026-10-24T08:45:00Z',
    revokedAt: null,
    active: true,
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
    billingPlans: { list: vi.fn().mockResolvedValue([]) },
    billingSubscription: { get: vi.fn().mockResolvedValue(null) },
    usage: { get: vi.fn().mockResolvedValue({ balance: 0, included: 0, usedThisPeriod: 0, byHelper: [], byDay: [] }) },
    wallet: { get: vi.fn().mockResolvedValue({ autoTopupEnabled: false, autoTopupThresholdCredits: 0, autoTopupPack: null }) },
    aiAccounts: { list: vi.fn().mockResolvedValue([]) },
    marketplace: { list: vi.fn().mockResolvedValue([]) },
    connectors: { list: vi.fn().mockResolvedValue([]) },
    mcpTokens: { list: vi.fn().mockResolvedValue([...LIVE_TOKENS]) },
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
        <SectionMcpTokens />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('SectionMcpTokens', () => {
  beforeEach(() => {
    mockMintMcpToken.mockClear()
    mockRevokeMcpToken.mockClear()
    mockMintMcpToken.mockResolvedValue({
      id: 'mct-new',
      label: 'Test token',
      helperId: 'h-chief',
      scopes: ['identity'],
      expiresAt: null,
      lastUsedAt: null,
      revokedAt: null,
      active: true,
      token: RAW_SECRET,
    })
    mockRevokeMcpToken.mockResolvedValue(undefined)
  })

  test('renders live tokens from the repo', async () => {
    renderSection(makeRepos())
    await waitFor(() => expect(screen.getByText('Chief · Cursor')).toBeInTheDocument())
  })

  test('Mint token dialog: mints and shows raw secret ONCE in a copyable field', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())

    // Open the Mint token dialog
    const mintBtn = screen.getByRole('button', { name: /mint token/i })
    await user.click(mintBtn)

    // Fill out the dialog form
    const labelInput = screen.getByRole('textbox', { name: /label/i })
    await user.clear(labelInput)
    await user.type(labelInput, 'Test token')

    // Submit the form
    const createBtn = screen.getByRole('button', { name: /create/i })
    await user.click(createBtn)

    // Secret must be shown exactly once — visible in a copyable field
    await waitFor(() => expect(screen.getByDisplayValue(RAW_SECRET)).toBeInTheDocument())
    expect(mockMintMcpToken).toHaveBeenCalledOnce()
  })

  test('raw secret is NOT shown in the token list rows — absent before mint and after dialog close', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())

    // Before any action, secret not in DOM
    expect(screen.queryByText(RAW_SECRET)).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue(RAW_SECRET)).not.toBeInTheDocument()

    // Mint a token
    const mintBtn = screen.getByRole('button', { name: /mint token/i })
    await user.click(mintBtn)

    const labelInput = screen.getByRole('textbox', { name: /label/i })
    await user.clear(labelInput)
    await user.type(labelInput, 'Test token')

    const createBtn = screen.getByRole('button', { name: /create/i })
    await user.click(createBtn)

    // Secret appears after mint
    await waitFor(() => expect(screen.getByDisplayValue(RAW_SECRET)).toBeInTheDocument())

    // Dismiss the dialog — the secret input should be gone
    const doneBtn = screen.getByRole('button', { name: /done/i })
    await user.click(doneBtn)

    // After dismissal: secret no longer visible
    expect(screen.queryByDisplayValue(RAW_SECRET)).not.toBeInTheDocument()
    expect(screen.queryByText(RAW_SECRET)).not.toBeInTheDocument()
  })

  test('Revoke opens ConfirmDialog — revokeMcpToken NOT called before confirm', async () => {
    const user = userEvent.setup()
    renderSection(makeRepos())

    await waitFor(() => expect(screen.getByText('Chief · Cursor')).toBeInTheDocument())

    // Open the ⋯ menu for the token
    const moreBtn = screen.getByRole('button', { name: /chief · cursor options/i })
    await user.click(moreBtn)

    // Click Revoke in the dropdown
    const revokeItem = screen.getByRole('menuitem', { name: /revoke/i })
    await user.click(revokeItem)

    // ConfirmDialog must appear — revokeMcpToken NOT yet called
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(mockRevokeMcpToken).not.toHaveBeenCalled()

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /revoke/i })
    await user.click(confirmBtn)

    await waitFor(() => expect(mockRevokeMcpToken).toHaveBeenCalledOnce())
    expect(mockRevokeMcpToken).toHaveBeenCalledWith('mct-chief-cursor')
  })

  test('empty state renders when no tokens returned', async () => {
    renderSection(makeRepos({ mcpTokens: { list: vi.fn().mockResolvedValue([]) } }))
    await waitFor(() => expect(screen.getByText(/no mcp tokens/i)).toBeInTheDocument())
  })

  test('error state renders when mcpTokens query rejects', async () => {
    renderSection(makeRepos({ mcpTokens: { list: vi.fn().mockRejectedValue(new Error('network')) } }))
    await waitFor(() => expect(screen.getByText(/could not load/i)).toBeInTheDocument())
  })
})
