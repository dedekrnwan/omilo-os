// Inbox decisions hit the real commands (approve / reject / undo / review per task).

import { describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import { useUIStore } from '../../app/store'
import { InboxRoute } from './InboxRoute'

function renderInbox(path = '/inbox') {
  useUIStore.setState({ mode: 'office', areaId: null })
  const commands = createMockCommands()
  const spies = {
    approve: vi.spyOn(commands, 'approveProposal'),
    amended: vi.spyOn(commands, 'approveProposalAmended'),
    reject: vi.spyOn(commands, 'rejectProposal'),
    undo: vi.spyOn(commands, 'undoApproval'),
    update: vi.spyOn(commands, 'updateProposal'),
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <CommandsProvider commands={commands}>
          <ReposProvider repos={createMockRepos()}>
            <Outlet />
          </ReposProvider>
        </CommandsProvider>
      </QueryClientProvider>
    ),
  })
  const inbox = createRoute({ getParentRoute: () => root, path: '/inbox', component: InboxRoute })
  const item = createRoute({ getParentRoute: () => inbox, path: '$itemId', component: InboxRoute })
  const router = createRouter({
    routeTree: root.addChildren([inbox.addChildren([item])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(<RouterProvider router={router} />)
  return spies
}

describe('Inbox decisions', () => {
  test('Approve all approves every linked proposal, shows the banner, Undo calls undo', async () => {
    const user = userEvent.setup()
    const spies = renderInbox()
    await user.click(await screen.findByRole('button', { name: /^Approve all 3$/i }))
    await waitFor(() => expect(spies.approve).toHaveBeenCalledTimes(3))
    expect(spies.approve.mock.calls.map((c) => c[0])).toEqual(['prp-passkey-web', 'prp-passkey-android', 'prp-passkey-comms'])
    expect(await screen.findByText(/You approved 3 tasks/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Undo · 5 min/ }))
    await waitFor(() => expect(spies.undo).toHaveBeenCalledTimes(3))
    expect(await screen.findByRole('button', { name: /^Approve all 3$/i })).toBeInTheDocument()
  })

  test('Review one by one: Reject and Approve are saved per task', async () => {
    const user = userEvent.setup()
    const spies = renderInbox()
    await user.click(await screen.findByRole('button', { name: /Review one by one/i }))
    const dialog = await screen.findByRole('dialog')
    // Detail comes from the proposal (GET /proposals/{id})
    expect(await within(dialog).findByText(/behind a 10% flag/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /Reject/ }))
    await waitFor(() => expect(spies.reject).toHaveBeenCalledWith('prp-passkey-web', expect.any(String)))
    await user.click(within(dialog).getByRole('button', { name: /Approve & next/ }))
    await waitFor(() => expect(spies.approve).toHaveBeenCalledWith('prp-passkey-android', undefined))
    await user.click(within(dialog).getByRole('button', { name: /Skip/ }))
    expect(spies.approve).toHaveBeenCalledTimes(1)
  })

  test('Change amount approves with the amended params', async () => {
    const user = userEvent.setup()
    const spies = renderInbox()
    await user.click(await screen.findByRole('button', { name: /^Change amount$/i }))
    await user.click(await screen.findByRole('button', { name: '$1,600' }))
    await user.click(screen.getByRole('button', { name: /Approve \$1,600/ }))
    await waitFor(() => expect(spies.amended).toHaveBeenCalledWith('prp-ad-budget', { amount: 1600 }, undefined))
    expect(await screen.findByText(/You approved \$1,600/)).toBeInTheDocument()
  })

  test('a decision with no chat thread opens a decision view, not an empty chat', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    await commands.publishFlow('flw-morning-brief')
    renderInbox('/inbox/inbox-prp-publish-flw-morning-brief-1')
    expect(await screen.findByRole('heading', { name: /Publish flow: Morning brief/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Decided')).toBeInTheDocument()
  })
})
