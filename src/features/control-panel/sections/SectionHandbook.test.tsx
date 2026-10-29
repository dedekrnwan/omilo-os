import { beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { CommandsProvider } from '../../../app/CommandsProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { createMockCommands } from '../../../adapters/mock/mockCommands'
import { resetDocsMock } from '../../../adapters/mock/docsMock'
import type { Commands } from '../../../adapters/http/commands'
import { Toaster, useToasts } from '../../../ui/ds/Toaster'
import { SectionHandbook } from './SectionHandbook'

function renderSection(commands: Commands) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ReposProvider repos={createMockRepos()}>
          <CommandsProvider commands={commands}>
            <Outlet />
            <Toaster />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const page = createRoute({ getParentRoute: () => root, path: '/control-panel/handbook', component: () => <SectionHandbook onDialog={() => {}} /> })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ['/control-panel/handbook'] }) })
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useToasts.setState({ toasts: [] })
  resetDocsMock()
})

describe('Control panel · Handbook (live)', () => {
  test('lists handbook files, the brief and readers from the API', async () => {
    renderSection(createMockCommands())
    expect(await screen.findByText('POLICIES.md')).toBeInTheDocument()
    expect(screen.getByText('1 suggested edit')).toBeInTheDocument()
    expect(await screen.findByText(/runs neighbourhood admin for 64 RTs/)).toBeInTheDocument()
    expect(await screen.findByText('3 helpers')).toBeInTheDocument()
    expect(screen.queryByText('BRIEF.md')).not.toBeInTheDocument()
  })

  test('open a file, dismiss the suggestion, edit and save', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const dismiss = vi.spyOn(commands, 'dismissHandbookSuggestion')
    const save = vi.spyOn(commands, 'saveHandbookFile')
    renderSection(commands)
    await user.click(await screen.findByText('POLICIES.md'))
    const dialog = await screen.findByText('Chief suggests an edit')
    await user.click(within(dialog.closest('div')!.parentElement!).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith('hbs-1'))
    const edits = screen.getAllByRole('button', { name: 'Edit' })
    await user.click(edits[edits.length - 1]) // the drawer footer (the brief card has its own Edit)
    const box = screen.getByRole('textbox', { name: 'Edit POLICIES.md' })
    await user.type(box, '\n- New rule.')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('POLICIES.md', { content: expect.stringContaining('New rule.') }))
  })

  test('new file is created through PUT /v1/handbook/{file}', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const save = vi.spyOn(commands, 'saveHandbookFile')
    renderSection(commands)
    await user.click(await screen.findByRole('button', { name: /New file/ }))
    await user.type(screen.getByRole('textbox', { name: 'File name' }), 'Pricing')
    await user.type(screen.getByRole('textbox', { name: 'File content' }), 'Prices.')
    await user.click(screen.getByRole('button', { name: /Create file/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith('PRICING.md', expect.objectContaining({ content: 'Prices.', title: 'Pricing' })))
  })
})
