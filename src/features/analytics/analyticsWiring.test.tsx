/** Analytics wiring: activity filters drive the feed query + BudgetDrawer saves the real budget. */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CommandsProvider } from '../../app/CommandsProvider'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import type { Commands } from '../../adapters/http/commands'
import type { ActivityQuery, Repos } from '../../core/ports/repos'
import { ActivityTab } from './tabs'
import { BudgetDrawer } from './BudgetDrawer'
import type { HelperStat } from './data'

afterEach(cleanup)

function wrap(children: ReactNode, repos: Repos = createMockRepos(), commands?: Commands) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ReposProvider repos={repos}>
        <CommandsProvider commands={commands}>{children}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>,
  )
}

const HELPER: HelperStat = {
  id: 'h1',
  name: 'Builder',
  area: 'dev',
  role: 'Engineering',
  doing: 'Fixing OTP retry limit',
  status: 'working',
  jobs: '12',
  success: '98%',
  tokens: '1.2M',
  spend: '600 cr',
  budget: { spent: 600, limit: 1500, warn: false },
  lastActive: '2m ago',
}

describe('ActivityTab', () => {
  test('lists the feed and unchecking every helper empties it', async () => {
    wrap(<ActivityTab helpers={[HELPER, { ...HELPER, id: 'h2', name: 'Support', area: 'support' }]} />)
    expect(await screen.findByText(/finished Open PR/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Builder' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Support' }))
    expect(await screen.findByText('No activity matches these filters.')).toBeInTheDocument()
  })

  test('kind checkboxes are sent to the activity endpoint', async () => {
    const calls: ActivityQuery[] = []
    const base = createMockRepos()
    const repos: Repos = {
      ...base,
      analytics: {
        ...base.analytics,
        activity: (q) => {
          calls.push(q)
          return base.analytics.activity!(q)
        },
      },
    }
    wrap(<ActivityTab helpers={[HELPER]} />, repos)
    await screen.findByText('Show')
    // Started is off by default
    expect(calls[0].kinds).toEqual(['done', 'needs_you', 'failed'])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Failures' }))
    await waitFor(() => expect(calls.at(-1)?.kinds).toEqual(['done', 'needs_you']))
  })
})

function renderBudget(
  updateCompanySettings: ReturnType<typeof vi.fn>,
  updateHelper: ReturnType<typeof vi.fn>,
  initialSettings: Record<string, unknown> = {},
) {
  const commands = {
    getCompanySettings: vi.fn().mockResolvedValue(initialSettings),
    updateCompanySettings,
    updateHelper,
  } as unknown as Commands
  return wrap(<BudgetDrawer helper={HELPER} onClose={() => {}} />, createMockRepos(), commands)
}

describe('BudgetDrawer', () => {
  test('Save sets the enforced credit cap on the helper and the alert settings per helper', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    const updateHelper = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings, updateHelper)
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalledTimes(1))
    expect(updateCompanySettings.mock.calls[0][0].budgets).toEqual({
      h1: { amount: 1500, threshold: '80%', mode: 'pause' },
    })
    expect(updateHelper).toHaveBeenCalledWith('h1', { budgetCreditsMonth: 1500 })
  })

  test('Remove clears only this helper, leaving other helpers untouched', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    const updateHelper = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings, updateHelper)
    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalled())
    const arg = updateCompanySettings.mock.calls[0][0]
    expect(arg.budgets).toEqual({ h1: null })
    expect(arg.autoTopupEnabled).toBeUndefined()
    expect(updateHelper).toHaveBeenCalledWith('h1', { budgetCreditsMonth: null })
  })

  test('loads the drawer from the saved per-helper entry', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    const updateHelper = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings, updateHelper, {
      budgets: { h1: { amount: 4200, threshold: '90%', mode: 'stop' } },
    })
    await waitFor(() => expect(screen.getByDisplayValue('4200 cr')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalled())
    expect(updateCompanySettings.mock.calls[0][0].budgets).toEqual({
      h1: { amount: 4200, threshold: '90%', mode: 'stop' },
    })
  })
})
