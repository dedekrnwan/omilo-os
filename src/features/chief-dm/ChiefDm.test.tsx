// ── Chief DM unread badge ──────────────────────────────────────────────────────
// The floating Chief FAB badge is derived from the live inbox "needs you" items
// via useInbox() — no hardcoded constant. Zero such items → no badge.

import { describe, test, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import type { Repos } from '../../core/ports/repos'
import type { InboxItem } from '../../core/domain/types'
import { ChiefDm } from './ChiefDm'

function reposWithInbox(items: InboxItem[]): Repos {
  const base = createMockRepos()
  return { ...base, inbox: { ...base.inbox, list: () => Promise.resolve(items) } }
}

function item(id: string, needsYou: boolean): InboxItem {
  return {
    id,
    title: id,
    summary: '',
    sessionId: 's1',
    channelId: 'c1',
    kind: 'decision',
    status: 'pending',
    createdAt: '',
    asker: 'Ops',
    askerArea: 'ops',
    needsYou,
  }
}

function renderChief(repos: Repos) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReposProvider repos={repos}>
        {/* closed state → renders the FAB with the badge */}
        <ChiefDm initial="closed" />
      </ReposProvider>
    </QueryClientProvider>,
  )
}

describe('ChiefDm · unread badge', () => {
  test('shows no badge when no inbox items need the user', async () => {
    renderChief(reposWithInbox([item('a', false), item('b', false)]))
    // Give the inbox query a tick to resolve; the badge must stay absent.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Talk to Chief' })).toBeInTheDocument())
    expect(screen.queryByLabelText(/unread/)).not.toBeInTheDocument()
  })

  test('badge count reflects the number of "needs you" inbox items', async () => {
    renderChief(reposWithInbox([item('a', true), item('b', true), item('c', false)]))
    const badge = await screen.findByLabelText('2 unread')
    expect(badge).toHaveTextContent('2')
  })
})

// ── Private threads are real sessions (kind='chief_private') ─────────────────

describe('ChiefDm · private threads', () => {
  test('opens on the latest private chat and lists threads from the API', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={createMockRepos()}>
          <ChiefDm initial="threads" />
        </ReposProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Are we spreading too thin?')).toBeInTheDocument()
    expect(screen.getByText('Kopi Kenangan renewal')).toBeInTheDocument()
  })

  test('the open drawer shows the thread messages', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={createMockRepos()}>
          <ChiefDm initial="open" />
        </ReposProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Drafted, not applied/)).toBeInTheDocument()
  })

  test('nudge shows the real nudge body from the API', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={createMockRepos()}>
          <ChiefDm initial="nudge" />
        </ReposProvider>
      </QueryClientProvider>,
    )
    const nudge = await screen.findByRole('dialog', { name: 'Chief nudge' })
    await waitFor(() => expect(nudge).toHaveTextContent(/Got two minutes\?/))
  })
})
