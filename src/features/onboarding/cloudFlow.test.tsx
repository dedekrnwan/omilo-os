/**
 * Your AI → Cloud settles the company's plan (storage tiers, no credits) and
 * its own AI key inside the wizard; the interview only opens once both are set.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { createMockCommands } from '../../adapters/mock/mockCommands'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const mockMode = { on: true }
vi.mock('../../app/useAuth', async (orig) => ({
  ...(await orig<typeof import('../../app/useAuth')>()),
  isMockMode: () => mockMode.on,
}))

const aiStatus = vi.fn()
vi.mock('./interviewApi', async (orig) => ({
  ...(await orig<typeof import('./interviewApi')>()),
  getAiStatus: () => aiStatus(),
}))

import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'

function wrap(ui: React.ReactNode, opts: { noAccounts?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const repos = createMockRepos()
  if (opts.noAccounts) repos.aiAccounts = { list: async () => [] }
  return render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={repos}>
        <CommandsProvider commands={createMockCommands()}>{ui}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navigate.mockClear()
  aiStatus.mockReset()
  mockMode.on = true
})

describe('Your AI → Cloud', () => {
  test('lists the storage plans and the free trial — no credits, no navigation away', async () => {
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={() => {}} />)
    expect(await screen.findByRole('radio', { name: /Start a 14-day free trial/ })).toBeInTheDocument()
    expect(await screen.findByRole('radio', { name: /Starter.*5 GB storage/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Business.*250 GB storage/ })).toBeInTheDocument()
    expect(screen.queryByText(/buy credits|credit pack|credits left/i)).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('the free trial continues to the interview', async () => {
    const onNext = vi.fn()
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={onNext} />)
    fireEvent.click(await screen.findByRole('button', { name: /Start free and continue/ }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cloud', cloudPick: 'trial' })))
  })

  test('Cloud needs the company’s own AI key before anything else', async () => {
    mockMode.on = false
    const onNext = vi.fn()
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={onNext} />, { noAccounts: true })
    expect(await screen.findByText(/YOUR COMPANY’S AI KEY/)).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /Start free and continue/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cloud plans don’t include AI')
    expect(onNext).not.toHaveBeenCalled()
  })

  test('picking a plan subscribes to it', async () => {
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={() => {}} />)
    fireEvent.click(await screen.findByRole('radio', { name: /^Starter/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Subscribe to Starter and continue/ })).toBeInTheDocument())
  })
})

describe('Get to know you — needs an AI first', () => {
  test('without an AI it shows the gate with a way back, and no interview starts', async () => {
    aiStatus.mockResolvedValue({ ready: false, label: 'Practice mode', pooled: false, mode: 'local',
      reason: 'Connect an AI: a Claude or OpenAI key, or Claude Code signed in on this computer.' })
    const onBack = vi.fn()
    wrap(<StepKnowYou onNext={() => {}} onBack={onBack} />)
    expect(await screen.findByRole('heading', { name: 'I need an AI before we talk' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Back to Your AI/ }))
    expect(onBack).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Interview' })).toBeNull()
  })
})
