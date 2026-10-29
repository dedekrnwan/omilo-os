/**
 * Your AI → Cloud settles the subscription inside the wizard, and the interview
 * only opens once an AI is ready. (See pricing used to jump to
 * /auth/onboarding/plan and skip the interview.)
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

const aiStatus = vi.fn()
vi.mock('./interviewApi', async (orig) => ({
  ...(await orig<typeof import('./interviewApi')>()),
  getAiStatus: () => aiStatus(),
}))

import { StepYourAI } from './StepYourAI'
import { StepKnowYou } from './StepKnowYou'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={createMockRepos()}>
        <CommandsProvider commands={createMockCommands()}>{ui}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  navigate.mockClear()
  aiStatus.mockReset()
})

describe('Your AI → Cloud', () => {
  test('See pricing opens the plans inline — no navigation away from the wizard', async () => {
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'See pricing' }))
    expect(await screen.findByLabelText('Pricing')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  test('the free trial continues to the interview once the AI is ready', async () => {
    aiStatus.mockResolvedValue({ ready: true, label: 'Omilo Cloud', pooled: true, mode: 'cloud', reason: null })
    const onNext = vi.fn()
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={onNext} />)
    fireEvent.click(await screen.findByRole('button', { name: /Start free and continue/ }))
    await waitFor(() => expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cloud', cloudPick: 'trial' })))
  })

  test('when Cloud has no AI yet, it stays on Your AI and says why', async () => {
    aiStatus.mockResolvedValue({ ready: false, label: 'Practice mode', pooled: false, mode: 'cloud',
      reason: 'Omilo Cloud’s AI isn’t set up on this server yet.' })
    const onNext = vi.fn()
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={onNext} />)
    fireEvent.click(await screen.findByRole('button', { name: /Start free and continue/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('isn’t set up on this server')
    expect(onNext).not.toHaveBeenCalled()
  })

  test('picking Monthly plan lists the real plans to choose from', async () => {
    wrap(<StepYourAI initialMode="cloud" onBack={() => {}} onNext={() => {}} />)
    fireEvent.click(await screen.findByRole('radio', { name: /Monthly plan/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /Subscribe to .* and continue/ })).toBeInTheDocument())
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
