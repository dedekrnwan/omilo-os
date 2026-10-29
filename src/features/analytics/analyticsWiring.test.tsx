/** Task 5.4 — analytics wiring: activity filter actually filters + BudgetDrawer saves. */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CommandsProvider } from '../../app/CommandsProvider'
import type { Commands } from '../../adapters/http/commands'
import { ActivityTab } from './tabs'
import { BudgetDrawer } from './BudgetDrawer'
import type { HelperStat } from './data'

afterEach(cleanup)

describe('ActivityTab filter', () => {
  test('unchecking all helpers empties the list', () => {
    render(<ActivityTab />)
    // By default some activity rows render.
    expect(screen.queryByText('No activity matches these filters.')).not.toBeInTheDocument()
    // Uncheck every helper in the Helpers filter group.
    const helperBoxes = screen
      .getAllByRole('checkbox')
      .filter((b) => ['Chief of Staff', 'Builder', 'Grower', 'Support'].some((n) => b.getAttribute('aria-label') === n))
    helperBoxes.forEach((b) => fireEvent.click(b))
    expect(screen.getByText('No activity matches these filters.')).toBeInTheDocument()
  })
})

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
  spend: '$6',
  budget: { spent: 6, limit: 15, warn: false },
  lastActive: '2m ago',
}

function renderBudget(
  updateCompanySettings: ReturnType<typeof vi.fn>,
  initialSettings: Record<string, unknown> = {},
) {
  const commands = {
    getCompanySettings: vi.fn().mockResolvedValue(initialSettings),
    updateCompanySettings,
  } as unknown as Commands
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CommandsProvider commands={commands}>
        <BudgetDrawer helper={HELPER} onClose={() => {}} />
      </CommandsProvider>
    </QueryClientProvider>,
  )
}

describe('BudgetDrawer', () => {
  test('Save writes the per-helper budget key (amount/threshold/mode), not the shared wallet', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings)
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalledTimes(1))
    const arg = updateCompanySettings.mock.calls[0][0]
    // Persists under budgets[helper.id] — one helper never clobbers another.
    expect(arg.budgets).toEqual({ h1: { amount: 15, threshold: '80%', mode: 'pause' } })
  })

  test('Remove clears only this helper, leaving other helpers untouched', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings)
    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalled())
    const arg = updateCompanySettings.mock.calls[0][0]
    // Only this helper's entry is cleared (set to null); no company-wide toggle.
    expect(arg.budgets).toEqual({ h1: null })
    expect(arg.autoTopupEnabled).toBeUndefined()
  })

  test('loads the drawer from the saved per-helper entry', async () => {
    const updateCompanySettings = vi.fn().mockResolvedValue({})
    renderBudget(updateCompanySettings, {
      budgets: { h1: { amount: 42, threshold: '90%', mode: 'stop' } },
    })
    // Amount input hydrates from the saved entry.
    await waitFor(() => expect(screen.getByDisplayValue('$42')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(updateCompanySettings).toHaveBeenCalled())
    expect(updateCompanySettings.mock.calls[0][0].budgets).toEqual({
      h1: { amount: 42, threshold: '90%', mode: 'stop' },
    })
  })
})
