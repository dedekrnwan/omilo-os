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

function renderBudget(updateWallet: ReturnType<typeof vi.fn>) {
  const commands = { updateWallet } as unknown as Commands
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
  test('Save budget calls updateWallet with the bound amount/threshold', async () => {
    const updateWallet = vi.fn().mockResolvedValue({})
    renderBudget(updateWallet)
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }))
    await waitFor(() => expect(updateWallet).toHaveBeenCalledTimes(1))
    const arg = updateWallet.mock.calls[0][0]
    expect(arg.autoTopupPack).toBe('$15')
    expect(arg.autoTopupThresholdCredits).toBe(12) // 15 * 80%
  })

  test('Remove budget disables auto-topup', async () => {
    const updateWallet = vi.fn().mockResolvedValue({})
    renderBudget(updateWallet)
    fireEvent.click(screen.getByRole('button', { name: 'Remove budget' }))
    await waitFor(() => expect(updateWallet).toHaveBeenCalled())
    expect(updateWallet.mock.calls[0][0].autoTopupEnabled).toBe(false)
  })
})
