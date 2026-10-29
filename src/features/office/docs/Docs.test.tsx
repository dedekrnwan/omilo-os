import { beforeEach, describe, expect, test, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { CommandsProvider } from '../../../app/CommandsProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import { createMockCommands } from '../../../adapters/mock/mockCommands'
import { resetDocsMock } from '../../../adapters/mock/docsMock'
import type { Commands } from '../../../adapters/http/commands'
import type { Repos } from '../../../core/ports/repos'
import { Toaster, useToasts } from '../../../ui/ds/Toaster'
import { OfficeDocsRoute } from './OfficeDocsRoute'

function renderDocs({ repos, commands, path = '/docs' }: { repos?: Repos; commands?: Commands; path?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos ?? createMockRepos()}>
          <CommandsProvider commands={commands}>
            <Outlet />
            <Toaster />
          </CommandsProvider>
        </ReposProvider>
      </QueryClientProvider>
    ),
  })
  const docs = createRoute({ getParentRoute: () => root, path: '/docs', component: OfficeDocsRoute })
  const doc = createRoute({ getParentRoute: () => root, path: '/docs/$docId', component: OfficeDocsRoute })
  const goals = createRoute({ getParentRoute: () => root, path: '/goals', component: () => null })
  const router = createRouter({ routeTree: root.addChildren([docs, doc, goals]), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  useToasts.setState({ toasts: [] })
  resetDocsMock()
})

describe('Docs · Notes — live docs from GET /v1/memory', () => {
  test('sidebar lists company docs and the handbook; no demo fixture import', async () => {
    renderDocs()
    expect(await screen.findByRole('button', { name: 'Passkey rollout — v1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch checklist' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Company handbook' })).toBeInTheDocument()
  })

  test('empty state when there are no docs', async () => {
    const base = createMockRepos()
    renderDocs({ repos: { ...base, docs: { ...base.docs!, list: () => Promise.resolve([]) } } })
    expect(await screen.findByText(/no docs yet/i)).toBeInTheDocument()
  })

  test('error state when the docs list fails', async () => {
    const base = createMockRepos()
    renderDocs({ repos: { ...base, docs: { ...base.docs!, list: () => Promise.reject(new Error('boom')) } } })
    expect(await screen.findByText(/couldn't load docs/i)).toBeInTheDocument()
  })

  test('viewer shows the selected doc and Save patches that doc (not a demo body)', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const patchDoc = vi.spyOn(commands, 'patchDoc')
    renderDocs({ commands })
    await user.click(await screen.findByRole('button', { name: 'Launch checklist' }))
    expect(await screen.findByRole('heading', { name: 'Launch checklist' })).toBeInTheDocument()
    expect(screen.getByText('The steps every launch follows.')).toBeInTheDocument()
    // links parsed from [[wikilinks]] + outline from headings
    expect(screen.getByText('LINKS FROM HERE').parentElement!.textContent).toContain('2')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const body = screen.getByRole('textbox', { name: 'Doc body' })
    expect((body as HTMLTextAreaElement).value).toContain('The steps every launch follows.')
    await user.type(body, ' More.')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(patchDoc).toHaveBeenCalledWith('d-launch', { content: expect.stringContaining('More.') }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  test('/docs/$docId opens that doc', async () => {
    renderDocs({ path: '/docs/d-freeze' })
    expect(await screen.findByRole('heading', { name: 'Freeze exceptions' })).toBeInTheDocument()
  })

  test('right-click a doc: pin, rename, delete with undo', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const patchDoc = vi.spyOn(commands, 'patchDoc')
    const deleteDoc = vi.spyOn(commands, 'deleteDoc')
    renderDocs({ commands })
    const row = (await screen.findAllByRole('button', { name: 'Freeze exceptions' }))[0]
    fireEvent.contextMenu(row)
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to top' }))
    await waitFor(() => expect(patchDoc).toHaveBeenCalledWith('d-freeze', { pinned: true }))

    fireEvent.contextMenu(screen.getAllByRole('button', { name: 'Freeze exceptions' })[0])
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'New name' })
    await user.clear(input)
    await user.type(input, 'Freeze rules{Enter}')
    await waitFor(() => expect(patchDoc).toHaveBeenCalledWith('d-freeze', { title: 'Freeze rules' }))

    const renamed = (await screen.findAllByRole('button', { name: 'Freeze rules' }))[0]
    fireEvent.contextMenu(renamed)
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(renamed).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect((await screen.findAllByRole('button', { name: 'Freeze rules' })).length).toBeGreaterThan(0)
    expect(deleteDoc).not.toHaveBeenCalled()
  })

  test('duplicate creates a copy through createDoc', async () => {
    const user = userEvent.setup()
    renderDocs()
    fireEvent.contextMenu((await screen.findAllByRole('button', { name: 'Freeze exceptions' }))[0])
    await user.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(await screen.findByRole('button', { name: 'Freeze exceptions (copy)' })).toBeInTheDocument()
  })

  test('clicking New doc creates a draft and toasts', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('button', { name: 'New doc' }))
    expect(await screen.findByText('Draft created')).toBeInTheDocument()
  })
})

describe('Docs · Graph', () => {
  test('views switch from an icon-only button group; the graph comes from GET /v1/memory/graph', async () => {
    const user = userEvent.setup()
    renderDocs()
    const tabs = await screen.findByRole('tablist', { name: 'Docs views' })
    const graph = within(tabs).getByRole('tab', { name: 'Graph' })
    expect(graph.textContent).toBe('Graph') // only the tooltip carries text
    await user.click(graph)
    expect(await screen.findByRole('application', { name: 'Document graph' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Postmortem #482' })).toBeInTheDocument()
  })

  test('graph node menu opens the note', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('tab', { name: 'Graph' }))
    fireEvent.contextMenu(await screen.findByRole('button', { name: 'Postmortem #482' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Open note' }))
    expect(within(screen.getByRole('tablist', { name: 'Docs views' })).getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByRole('heading', { name: 'Postmortem #482' })).toBeInTheDocument()
  })
})

describe('Docs · Knowledge', () => {
  test('turn on, review a lesson, ask, and drop a file', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('tab', { name: 'Knowledge' }))
    await user.click(await screen.findByRole('button', { name: /Turn on Knowledge/ }))
    expect(await screen.findByRole('application', { name: 'Knowledge graph' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Chief' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Company facts' })).toBeInTheDocument()

    expect(await screen.findByRole('button', { name: /2 need review/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('button', { name: /1 need review/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'What did agents learn this week?' }))
    const panel = await screen.findByRole('complementary', { name: 'Ask & teach' })
    expect(await within(panel).findByText('Urgent → WhatsApp')).toBeInTheDocument()

    const board = screen.getByRole('application', { name: 'Knowledge graph' }).parentElement!
    const files = [new File(['Hall rental 250k.\n\nDeposit 200k.'], 'prices.md', { type: 'text/markdown' })]
    act(() => {
      fireEvent.dragEnter(board, { dataTransfer: { types: ['Files'], files } })
    })
    expect(screen.getByText('Drop to teach the whole company')).toBeInTheDocument()
    act(() => {
      fireEvent.drop(board, { dataTransfer: { types: ['Files'], files } })
    })
    expect(await screen.findByText(/2 facts added from prices\.md/)).toBeInTheDocument()
  }, 15000)

  test('teach saves a lesson through createLesson', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    await commands.updateCompanySettings({ knowledge: { enabled: true } })
    const createLesson = vi.spyOn(commands, 'createLesson')
    renderDocs({ commands })
    await user.click(await screen.findByRole('tab', { name: 'Knowledge' }))
    await user.click(await screen.findByRole('button', { name: 'Teach: refunds need an owner’s OK first' }))
    const panel = await screen.findByRole('complementary', { name: 'Ask & teach' })
    await user.click(within(panel).getByRole('button', { name: /Save lesson/ }))
    await waitFor(() => expect(createLesson).toHaveBeenCalledWith(expect.objectContaining({ text: 'Refunds need an owner’s OK first', helperId: 'h-chief' })))
  })
})

describe('Docs · Ask Chief + Handbook', () => {
  test('Ask Chief answers with citations from POST /v1/ask', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('tab', { name: 'Ask Chief' }))
    const [suggestion] = await screen.findAllByRole('button', { name: /What does “.+” say\?/ })
    await user.click(suggestion)
    expect(await screen.findByText(/read \d+ sources?/)).toBeInTheDocument()
    expect(screen.getByText(/Agent memory wasn't searched/)).toBeInTheDocument()
  })

  test('handbook opens from the Notes list and a change can be suggested', async () => {
    const user = userEvent.setup()
    const commands = createMockCommands()
    const suggest = vi.spyOn(commands, 'suggestHandbookEdit')
    renderDocs({ commands })
    await user.click(await screen.findByRole('button', { name: 'Company handbook' }))
    expect(await screen.findByRole('heading', { name: 'Policies' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Suggest a change' }))
    await user.type(screen.getByRole('textbox', { name: 'Suggested change' }), 'Waive late fee for 65+')
    await user.click(screen.getByRole('button', { name: 'Send suggestion' }))
    await waitFor(() => expect(suggest).toHaveBeenCalledWith({ file: 'POLICIES.md', text: 'Waive late fee for 65+' }))
  })
})
