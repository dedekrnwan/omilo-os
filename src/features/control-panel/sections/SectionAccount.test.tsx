import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SectionAccount } from './SectionAccount'

// SectionAccount now persists the profile via useUpdateCompanySettings → needs a
// QueryClientProvider. CommandsProvider has a default (mock) client.
function renderAccount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SectionAccount />
    </QueryClientProvider>,
  )
}

describe('SectionAccount · Devices & tokens', () => {
  test('rows use lucide icons, not emoji, and the CLI token is revoked (not signed out)', async () => {
    const user = userEvent.setup()
    const { container } = renderAccount()

    // The three entries render.
    expect(screen.getByText('MacBook Pro · Jakarta')).toBeInTheDocument()
    expect(screen.getByText('iPhone 16 · WhatsApp linked')).toBeInTheDocument()
    expect(screen.getByText('CLI token "omilo-cli"')).toBeInTheDocument()

    // No stray emoji / placeholder glyphs left in the markup.
    expect(container.textContent).not.toMatch(/💻|^>$/m)

    // A device signs out; the CLI token is revoked.
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    const revoke = screen.getByRole('button', { name: 'Revoke' })
    await user.click(revoke)
    expect(screen.queryByText('CLI token "omilo-cli"')).not.toBeInTheDocument()
  })
})
