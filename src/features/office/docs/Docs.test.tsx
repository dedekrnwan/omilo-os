import { beforeEach, describe, expect, test } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { Toaster, useToasts } from '../../../ui/ds/Toaster'
import { OfficeDocsRoute } from './OfficeDocsRoute'

function renderDocs() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ReposProvider repos={createMockRepos()}>
          <Outlet />
          <Toaster />
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const docs = createRoute({ getParentRoute: () => root, path: '/docs', component: OfficeDocsRoute })
  const router = createRouter({ routeTree: root.addChildren([docs]), history: createMemoryHistory({ initialEntries: ['/docs'] }) })
  render(<RouterProvider router={router} />)
}

beforeEach(() => useToasts.setState({ toasts: [] }))

describe('Docs', () => {
  test('views switch from an icon-only button group', async () => {
    const user = userEvent.setup()
    renderDocs()
    const tabs = await screen.findByRole('tablist', { name: 'Docs views' })
    const graph = within(tabs).getByRole('tab', { name: 'Graph' })
    expect(graph.textContent).toBe('Graph') // only the tooltip carries text
    await user.click(graph)
    expect(await screen.findByRole('application', { name: 'Document graph' })).toBeInTheDocument()
  })

  test('right-click a doc: pin it, delete it, undo', async () => {
    const user = userEvent.setup()
    renderDocs()
    const row = await screen.findByRole('button', { name: 'Postmortem #482' })
    fireEvent.contextMenu(row)
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to top' }))
    expect(screen.getAllByLabelText('pinned').length).toBeGreaterThan(1)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Postmortem #482' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(screen.queryByRole('button', { name: 'Postmortem #482' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Postmortem #482' })).toBeInTheDocument()
  })

  test('graph node menu opens the note', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('tab', { name: 'Graph' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Postmortem #482' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open note' }))
    expect(await screen.findByRole('tablist', { name: 'Docs views' })).toBeInTheDocument()
    expect(within(screen.getByRole('tablist', { name: 'Docs views' })).getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
  })

  test('knowledge: review a lesson, ask, and drop files', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('tab', { name: 'Knowledge' }))
    await user.click(await screen.findByRole('button', { name: /Turn on Knowledge/ }))
    expect(await screen.findByRole('application', { name: 'Knowledge graph' })).toBeInTheDocument()
    // Mascot nodes, memories and company facts share one graph
    expect(screen.getByRole('button', { name: 'Chief' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Company facts' })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /2 need review/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('button', { name: /1 need review/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'What did agents learn this week?' }))
    const panel = await screen.findByRole('complementary', { name: 'Ask & teach' })
    expect(within(panel).getByText('Run migrations once')).toBeInTheDocument()

    const board = screen.getByRole('application', { name: 'Knowledge graph' }).parentElement!
    const files = [new File(['x'], 'Harga sewa balai.xlsx')]
    act(() => {
      fireEvent.dragEnter(board, { dataTransfer: { types: ['Files'], files } })
    })
    expect(screen.getByText('Drop to teach the whole company')).toBeInTheDocument()
    act(() => {
      fireEvent.drop(board, { dataTransfer: { types: ['Files'], files } })
    })
    expect((await screen.findAllByRole('button', { name: /Harga sewa balai\.xlsx/ })).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByText(/facts added from Harga sewa balai\.xlsx/)).toBeInTheDocument(), { timeout: 3000 })
  })
})
