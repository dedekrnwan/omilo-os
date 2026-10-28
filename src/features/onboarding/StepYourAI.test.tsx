/**
 * Tests for StepYourAI — wired to real useAiAccounts() + createAiAccount command.
 *
 * Strategy:
 *   - Render via ReposProvider + QueryClientProvider (mirrors SectionAiAccounts.test.tsx).
 *   - Mock createCommands so we can spy on createAiAccount without a real backend.
 *   - Verify existing accounts are shown from the mock repo.
 *   - Verify the API key form calls createAiAccount with correct args.
 *   - Verify onNext / onBack props are called correctly.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import type { Repos } from '../../core/ports/repos'
import type { AiAccount } from '../../core/domain/types'

// ── mock createCommands ────────────────────────────────────────────────────────

const mockCreateAiAccount = vi.fn()

vi.mock('../../adapters/http/commands', () => ({
  createCommands: () => ({
    createAiAccount: mockCreateAiAccount,
  }),
}))

// ── mock @tanstack/react-router useNavigate (not needed in self-host mode) ────

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

// ── import after mocks ────────────────────────────────────────────────────────

import { StepYourAI } from './StepYourAI'

// ── fixtures ──────────────────────────────────────────────────────────────────

const MOCK_ACCOUNTS: AiAccount[] = [
  {
    id: 'acc-main',
    harness: 'anthropic',
    name: 'Anthropic main',
    tag: 'primary',
    status: 'ready',
    pctWindow: 10,
    tokens: 'sk-ant-...****',
    lastUsed: '2026-10-24T09:00:00Z',
  },
  {
    id: 'acc-overflow',
    harness: 'openai',
    name: 'OpenAI overflow',
    tag: 'overflow',
    status: 'ready',
    pctWindow: 3,
    tokens: 'sk-...####',
    lastUsed: '2026-10-22T15:30:00Z',
  },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRepos(overrides?: Partial<Repos>): Repos {
  return {
    channels: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    folders: {
      listByChannel: vi.fn().mockResolvedValue([]),
      listAll: vi.fn().mockResolvedValue([]),
    },
    goals: {
      listByChannel: vi.fn().mockResolvedValue([]),
      listAll: vi.fn().mockResolvedValue([]),
    },
    sessions: {
      get: vi.fn().mockResolvedValue(null),
      listByChannel: vi.fn().mockResolvedValue([]),
      listAll: vi.fn().mockResolvedValue([]),
    },
    messages: { listBySession: vi.fn().mockResolvedValue([]) },
    inbox: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    billingPlans: { list: vi.fn().mockResolvedValue([]) },
    billingSubscription: { get: vi.fn().mockResolvedValue(null) },
    usage: {
      get: vi.fn().mockResolvedValue({
        balance: 0,
        included: 0,
        usedThisPeriod: 0,
        byHelper: [],
        byDay: [],
      }),
    },
    wallet: {
      get: vi.fn().mockResolvedValue({
        autoTopupEnabled: false,
        autoTopupThresholdCredits: 0,
        autoTopupPack: null,
      }),
    },
    aiAccounts: { list: vi.fn().mockResolvedValue([...MOCK_ACCOUNTS]) },
    marketplace: { list: vi.fn().mockResolvedValue([]) },
    connectors: { list: vi.fn().mockResolvedValue([]) },
    mcpTokens: { list: vi.fn().mockResolvedValue([]) },
    flows: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(null),
      runs: vi.fn().mockResolvedValue([]),
    },
    routines: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    knowledge: { sources: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) },
    analytics: {
      overview: vi.fn().mockResolvedValue({ stats: [], series: [] }),
      helpers: vi.fn().mockResolvedValue([]),
    },
    skills: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    helpers: { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(null) },
    ...overrides,
  }
}

function renderStep(
  repos: Repos = makeRepos(),
  props: { onBack?: () => void; onNext?: () => void } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        <StepYourAI onBack={props.onBack ?? vi.fn()} onNext={props.onNext ?? vi.fn()} />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('StepYourAI', () => {
  beforeEach(() => {
    mockCreateAiAccount.mockClear()
  })

  test('renders step heading', () => {
    renderStep()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  test('renders existing AI accounts from mock repo', async () => {
    renderStep()
    await waitFor(() => expect(screen.getByText('Anthropic main')).toBeInTheDocument())
    expect(screen.getByText('OpenAI overflow')).toBeInTheDocument()
  })

  test('does NOT render the fake "Claude Code 2.1.169" hardcoded detection', () => {
    renderStep()
    expect(screen.queryByText(/Claude Code 2\.1\.169/)).not.toBeInTheDocument()
    expect(screen.queryByText(/signed in on this computer/)).not.toBeInTheDocument()
  })

  test('onBack is called when Back button is clicked', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    renderStep(makeRepos(), { onBack })
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  test('onNext is called when primary CTA button is clicked', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    renderStep(makeRepos(), { onNext })
    await user.click(screen.getByRole('button', { name: /connect and continue/i }))
    expect(onNext).toHaveBeenCalledOnce()
  })

  test('shows "Connect an API key" option', () => {
    renderStep()
    expect(screen.getByText(/connect an api key/i)).toBeInTheDocument()
  })

  test('clicking "Connect an API key" option expands the key form', async () => {
    const user = userEvent.setup()
    renderStep()
    await user.click(screen.getByText(/connect an api key/i))
    await waitFor(() =>
      expect(screen.getByLabelText(/api key/i)).toBeInTheDocument(),
    )
    expect(screen.getByLabelText(/account name/i)).toBeInTheDocument()
  })

  test('connect key form calls createAiAccount with correct args', async () => {
    const user = userEvent.setup()
    const newAcc: AiAccount = {
      id: 'acc-new',
      harness: 'anthropic',
      name: 'My Key',
      status: 'ready',
      pctWindow: 0,
    }
    mockCreateAiAccount.mockResolvedValueOnce(newAcc)

    renderStep()

    // Open the API key form
    await user.click(screen.getByText(/connect an api key/i))

    // Fill in the form
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toBeInTheDocument())
    await user.clear(screen.getByLabelText(/account name/i))
    await user.type(screen.getByLabelText(/account name/i), 'My Key')
    await user.type(screen.getByLabelText(/api key/i), 'sk-ant-apikey123456789')

    // Click "Connect key"
    await user.click(screen.getByRole('button', { name: /connect key/i }))

    await waitFor(() => expect(mockCreateAiAccount).toHaveBeenCalledOnce())
    expect(mockCreateAiAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: 'anthropic',
        name: 'My Key',
        tokenEnc: 'sk-ant-apikey123456789',
      }),
    )
  })

  test('newly connected account appears in the pool list after connect', async () => {
    const user = userEvent.setup()
    const newAcc: AiAccount = {
      id: 'acc-new',
      harness: 'anthropic',
      name: 'Freshly Connected',
      status: 'ready',
      pctWindow: 0,
    }
    mockCreateAiAccount.mockResolvedValueOnce(newAcc)

    renderStep()

    await user.click(screen.getByText(/connect an api key/i))
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/account name/i), 'Freshly Connected')
    await user.type(screen.getByLabelText(/api key/i), 'sk-ant-newkey0987654321')
    await user.click(screen.getByRole('button', { name: /connect key/i }))

    await waitFor(() => expect(screen.getByText('Freshly Connected')).toBeInTheDocument())
  })

  test('shows error message when createAiAccount rejects', async () => {
    const user = userEvent.setup()
    mockCreateAiAccount.mockRejectedValueOnce(new Error('Invalid API key'))

    renderStep()

    await user.click(screen.getByText(/connect an api key/i))
    await waitFor(() => expect(screen.getByLabelText(/account name/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/account name/i), 'Bad Key')
    await user.type(screen.getByLabelText(/api key/i), 'sk-bad')
    await user.click(screen.getByRole('button', { name: /connect key/i }))

    await waitFor(() => expect(screen.getByText(/invalid api key/i)).toBeInTheDocument())
  })

  test('empty repo — no accounts — shows add-one prompt', async () => {
    const repos = makeRepos({ aiAccounts: { list: vi.fn().mockResolvedValue([]) } })
    renderStep(repos)
    await waitFor(() =>
      expect(screen.getByText(/no ai accounts connected yet/i)).toBeInTheDocument(),
    )
  })
})
