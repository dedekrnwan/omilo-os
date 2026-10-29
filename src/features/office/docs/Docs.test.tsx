import { beforeEach, describe, expect, test } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../../app/ReposProvider'
import { createMockRepos } from '../../../adapters/mock/mockRepos'
import type { Repos } from '../../../core/ports/repos'
import type { KbItem } from '../../../core/domain/types'
import { Toaster, useToasts } from '../../../ui/ds/Toaster'
import { OfficeDocsRoute } from './OfficeDocsRoute'

function renderDocs(repos?: Repos) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={qc}>
        <ReposProvider repos={repos ?? createMockRepos()}>
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

/** Build a minimal Repos stub that returns custom KbItems and nothing else. */
function reposWithKb(items: KbItem[]): Repos {
  const base = createMockRepos()
  return {
    ...base,
    knowledge: {
      sources: () => Promise.resolve([]),
      list: () => Promise.resolve(items),
    },
  }
}

beforeEach(() => useToasts.setState({ toasts: [] }))

// ── Live-data tests (docs/knowledge from useKnowledge, not fixture) ───────────

describe('Docs — live data from useKnowledge()', () => {
  const liveItems: KbItem[] = [
    { sourceId: 'src-1', heading: 'Live Security Policy',    text: 'Security rules', kind: 'skill',  score: 0.95 },
    { sourceId: 'src-2', heading: 'Live Q3 Board Deck',      text: 'Revenue up 12%', kind: 'upload', score: 0.80 },
    { sourceId: 'src-3', heading: 'Live Onboarding Runbook', text: 'Steps to onboard', kind: 'skill', score: 0.70 },
  ]

  test('NotesSidebar renders doc rows from live KbItems (not fixture)', async () => {
    renderDocs(reposWithKb(liveItems))
    // Items from live KbItems should appear
    expect(await screen.findByRole('button', { name: 'Live Security Policy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live Q3 Board Deck' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live Onboarding Runbook' })).toBeInTheDocument()
    // DOC_AREAS fixture items (e.g. "Postmortem #482") should NOT appear in sidebar when live data is used
    expect(screen.queryByRole('button', { name: 'Postmortem #482' })).not.toBeInTheDocument()
  })

  test('NotesSidebar shows empty state when useKnowledge() returns no items', async () => {
    renderDocs(reposWithKb([]))
    expect(await screen.findByText(/no docs yet/i)).toBeInTheDocument()
  })

  test('NotesSidebar shows error state when useKnowledge() rejects', async () => {
    const base = createMockRepos()
    const errRepos: Repos = {
      ...base,
      knowledge: {
        sources: () => Promise.reject(new Error('server error')),
        list: () => Promise.reject(new Error('server error')),
      },
    }
    renderDocs(errRepos)
    expect(await screen.findByText(/couldn't load docs/i)).toBeInTheDocument()
  })

  test('KnowledgeView memory count reflects live KbItems via useKnowledge()', async () => {
    const user = userEvent.setup()
    renderDocs(reposWithKb(liveItems))
    await user.click(await screen.findByRole('tab', { name: 'Knowledge' }))
    await user.click(await screen.findByRole('button', { name: /Turn on Knowledge/ }))
    // topbar meta should show count from live data (3 items)
    expect(await screen.findByText(/3 memories/i)).toBeInTheDocument()
  })
})

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
    // NotesSidebar now reads from useKnowledge(); the mock returns kbItems from fixtures:
    // "Passkey Rollout" (skill) and "Q3 Board Deck" (upload).
    const user = userEvent.setup()
    renderDocs()
    const row = await screen.findByRole('button', { name: 'Passkey Rollout' })
    fireEvent.contextMenu(row)
    await user.click(await screen.findByRole('menuitem', { name: 'Pin to top' }))
    expect(screen.getAllByLabelText('pinned').length).toBeGreaterThan(0)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Passkey Rollout' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    expect(screen.queryByRole('button', { name: 'Passkey Rollout' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Passkey Rollout' })).toBeInTheDocument()
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

describe('Docs — New doc (Task 5.4)', () => {
  test('clicking New doc creates a draft and toasts', async () => {
    const user = userEvent.setup()
    renderDocs()
    await user.click(await screen.findByRole('button', { name: 'New doc' }))
    expect(await screen.findByText('Draft created')).toBeInTheDocument()
  })
})
