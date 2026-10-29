import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SectionSafety } from './SectionSafety'
import { CommandsProvider } from '../../../app/CommandsProvider'
import { createMockCommands } from '../../../adapters/mock/mockCommands'
import { useSession } from '../../../app/session'
import type { Commands } from '../../../adapters/http/commands'

function renderSafety(commands: Commands) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandsProvider commands={commands}>
        <SectionSafety />
      </CommandsProvider>
    </QueryClientProvider>,
  )
}

describe('SectionSafety · autonomy dial', () => {
  beforeEach(() => {
    // Seed the session store with a company so the dial can hydrate / save.
    useSession.setState({
      status: 'authed',
      user: { id: 'u1', email: 'a@b.co', name: 'A' },
      company: { id: 'cmp1', name: 'Co', currency: 'IDR', autonomyDefault: 'ask' },
      companies: [],
    })
  })

  test('Save persists autonomy via updateCompanyProfile with the real column', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'updateCompanyProfile')

    renderSafety(commands)

    // Switch the dial from Ask → YOLO (marks the section dirty).
    await user.click(screen.getByText('YOLO'))

    const save = screen.getByRole('button', { name: 'Save changes' })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ autonomyDefault: 'yolo' }))
  })
})
