import { describe, test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SectionAccount } from './SectionAccount'
import { CommandsProvider } from '../../../app/CommandsProvider'
import { createMockCommands } from '../../../adapters/mock/mockCommands'
import type { Commands } from '../../../adapters/http/commands'

// SectionAccount now persists the profile via useUpdateCompanySettings → needs a
// QueryClientProvider. CommandsProvider has a default (mock) client.
function renderAccount(commands?: Commands) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CommandsProvider commands={commands}>
        <SectionAccount />
      </CommandsProvider>
    </QueryClientProvider>,
  )
}

describe('SectionAccount · Devices & tokens', () => {
  test('rows use lucide icons, not emoji, and the CLI token is revoked (not signed out)', async () => {
    const user = userEvent.setup()
    const { container } = renderAccount()

    // The three sign-in sessions (GET /v1/me/sessions; mock fixture) render.
    expect(await screen.findByText('Chrome · Mac')).toBeInTheDocument()
    expect(screen.getByText('Safari · iPhone')).toBeInTheDocument()
    expect(screen.getByText('Command line')).toBeInTheDocument()
    // The current device can't be signed out from here.
    expect(screen.getByText('This device · active now')).toBeInTheDocument()

    // No stray emoji / placeholder glyphs left in the markup.
    expect(container.textContent).not.toMatch(/💻|^>$/m)

    // A device signs out; the CLI token is revoked.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    const revoke = screen.getByRole('button', { name: 'Revoke' })
    await user.click(revoke)
    await waitFor(() => expect(screen.queryByText('Command line')).not.toBeInTheDocument())
  })
})

describe('SectionAccount · Profile name save', () => {
  test('saving the Name field calls updateMe with the new name', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const updateMeSpy = vi.spyOn(commands, 'updateMe')

    renderAccount(commands)

    const nameInput = screen.getByLabelText('Name')
    // Wait for the account to hydrate before editing.
    await waitFor(() => expect(nameInput).not.toHaveValue(''))
    await user.clear(nameInput)
    await user.type(nameInput, 'New Name')

    // The SaveBar appears once the field is dirty.
    const save = await screen.findByRole('button', { name: /save/i })
    await user.click(save)

    await waitFor(() => {
      expect(updateMeSpy).toHaveBeenCalledWith({ name: 'New Name' })
    })
  })
})
