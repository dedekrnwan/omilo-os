import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { ChatSession } from './ChatSession'
import { ShareDialog } from './ShareDialog'
import { ChatMenu } from './ChatMenu'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeWrapper(repos = createMockRepos()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ReposProvider repos={repos}>{children}</ReposProvider>
      </QueryClientProvider>
    )
  }
}

function renderSession(sessionId: string) {
  const Wrapper = makeWrapper()
  return render(
    <Wrapper>
      <ChatSession sessionId={sessionId} />
    </Wrapper>,
  )
}

// ── Share dialog ──────────────────────────────────────────────────────────────

describe('ShareDialog', () => {
  test('renders closed by default', () => {
    render(<ShareDialog title="Test chat" open={false} onOpenChange={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('opens with title when open=true', () => {
    render(<ShareDialog title="Passkey rollout plan" open={true} onOpenChange={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveAccessibleName(/Share/i)
    expect(dialog).toHaveAccessibleName(/Passkey rollout plan/i)
  })

  test('Close button triggers onOpenChange(false)', async () => {
    const user = userEvent.setup()
    let openState = true
    render(
      <ShareDialog title="Test" open={openState} onOpenChange={(v) => { openState = v }} />,
    )
    const closeBtn = screen.getByRole('button', { name: /close/i })
    await act(async () => {
      await user.click(closeBtn)
    })
    expect(openState).toBe(false)
  })

  test('Done button triggers onOpenChange(false)', async () => {
    const user = userEvent.setup()
    let openState = true
    render(
      <ShareDialog title="Test" open={openState} onOpenChange={(v) => { openState = v }} />,
    )
    const doneBtn = screen.getByRole('button', { name: /done/i })
    await act(async () => {
      await user.click(doneBtn)
    })
    expect(openState).toBe(false)
  })

  test('shows WHO HAS ACCESS section', () => {
    render(<ShareDialog title="Test" open={true} onOpenChange={() => {}} />)
    expect(screen.getByText(/who has access/i)).toBeInTheDocument()
  })

  test('shows Copy link button', () => {
    render(<ShareDialog title="Test" open={true} onOpenChange={() => {}} />)
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
  })
})

// ── Chat menu ─────────────────────────────────────────────────────────────────

describe('ChatMenu', () => {
  test('trigger renders without opening the menu', () => {
    render(
      <ChatMenu>
        <button type="button">More</button>
      </ChatMenu>,
    )
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
  })

  test('clicking trigger opens menu with expected items', async () => {
    const user = userEvent.setup()
    render(
      <ChatMenu>
        <button type="button">More</button>
      </ChatMenu>,
    )
    await act(async () => {
      await user.click(screen.getByText('More'))
    })
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Move to folder')).toBeInTheDocument()
    expect(screen.getByText('Link to goal')).toBeInTheDocument()
    expect(screen.getByText('Export as Markdown')).toBeInTheDocument()
    expect(screen.getByText('Archive chat')).toBeInTheDocument()
    expect(screen.getByText('Delete chat')).toBeInTheDocument()
  })

  test('Escape closes the menu', async () => {
    const user = userEvent.setup()
    render(
      <ChatMenu>
        <button type="button">More</button>
      </ChatMenu>,
    )
    await act(async () => {
      await user.click(screen.getByText('More'))
    })
    expect(screen.getByText('Rename')).toBeInTheDocument()
    await act(async () => {
      await user.keyboard('{Escape}')
    })
    await waitFor(() => expect(screen.queryByText('Rename')).not.toBeInTheDocument())
  })
})

// ── Model menu (existing behavior preserved + open/close) ─────────────────────

describe('ModelMenu — open/close', () => {
  test('model trigger opens model menu on click', async () => {
    const user = userEvent.setup()
    renderSession('sess-investor')
    await waitFor(() => expect(screen.getByRole('combobox', { name: /model/i })).toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('combobox', { name: /model/i }))
    })
    expect(screen.getByPlaceholderText(/search models/i)).toBeInTheDocument()
  })

  test('Escape closes model menu', async () => {
    const user = userEvent.setup()
    renderSession('sess-investor')
    await waitFor(() => expect(screen.getByRole('combobox', { name: /model/i })).toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('combobox', { name: /model/i }))
    })
    expect(screen.getByPlaceholderText(/search models/i)).toBeInTheDocument()

    await act(async () => {
      await user.keyboard('{Escape}')
    })
    await waitFor(() => expect(screen.queryByPlaceholderText(/search models/i)).not.toBeInTheDocument())
  })
})

// ── Share button in ChatSession opens dialog ───────────────────────────────────

describe('ChatSession — Share button opens dialog', () => {
  test('clicking Share opens the dialog', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')

    await waitFor(() => expect(screen.getByRole('button', { name: /share/i })).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /share/i }))
    })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
  })
})

// ── Topbar "…" opens Chat menu ────────────────────────────────────────────────

describe('ChatSession — "…" opens chat menu', () => {
  test('clicking More options opens chat menu items', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')

    await waitFor(() => expect(screen.getByRole('button', { name: /more options/i })).toBeInTheDocument())
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /more options/i }))
    })
    await waitFor(() => expect(screen.getByText('Rename')).toBeInTheDocument())
  })
})
