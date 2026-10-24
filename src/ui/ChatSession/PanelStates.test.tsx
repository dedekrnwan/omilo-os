/**
 * PanelStates.test.tsx — tests for the session panel states added in wave 1:
 *   - Results panel open / close
 *   - Browser panel open / close
 *   - Goal context banner + Edit goal dialog
 *   - EditGoalDialog standalone open / close
 *   - AddAgentPopover standalone
 */

import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { ChatSession } from './ChatSession'
import { EditGoalDialog } from './GoalContext'
import { AddAgentPopover } from './GoalContext'

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── Results panel ─────────────────────────────────────────────────────────────

describe('Results panel', () => {
  test('Results panel is hidden by default', async () => {
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /results panel/i })).toBeInTheDocument())
    expect(screen.queryByTestId('results-panel')).not.toBeInTheDocument()
  })

  test('clicking Results panel toggle shows the panel', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /results panel/i })).toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /results panel/i }))
    })

    expect(screen.getByTestId('results-panel')).toBeInTheDocument()
  })

  test('clicking the close button in the Results panel hides it', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /results panel/i })).toBeInTheDocument())

    // Open
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /results panel/i }))
    })
    expect(screen.getByTestId('results-panel')).toBeInTheDocument()

    // Close via panel's X button
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /close results panel/i }))
    })
    await waitFor(() => expect(screen.queryByTestId('results-panel')).not.toBeInTheDocument())
  })
})

// ── Browser panel ─────────────────────────────────────────────────────────────

describe('Browser panel', () => {
  test('Browser panel is hidden by default', async () => {
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /browser panel/i })).toBeInTheDocument())
    expect(screen.queryByTestId('browser-panel')).not.toBeInTheDocument()
  })

  test('clicking Browser panel toggle shows the panel', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /browser panel/i })).toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /browser panel/i }))
    })

    expect(screen.getByTestId('browser-panel')).toBeInTheDocument()
  })

  test('clicking the close button in the Browser panel hides it', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /browser panel/i })).toBeInTheDocument())

    // Open
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /browser panel/i }))
    })
    expect(screen.getByTestId('browser-panel')).toBeInTheDocument()

    // Close
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /close browser panel/i }))
    })
    await waitFor(() => expect(screen.queryByTestId('browser-panel')).not.toBeInTheDocument())
  })

  test('opening Browser panel closes Results panel', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /results panel/i })).toBeInTheDocument())

    // Open results
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /results panel/i }))
    })
    expect(screen.getByTestId('results-panel')).toBeInTheDocument()

    // Open browser — results should close
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /browser panel/i }))
    })
    expect(screen.queryByTestId('results-panel')).not.toBeInTheDocument()
    expect(screen.getByTestId('browser-panel')).toBeInTheDocument()
  })
})

// ── Goal context banner ───────────────────────────────────────────────────────

describe('Goal context banner', () => {
  test('goal context toggle button present for goal session (sess-passkey)', async () => {
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle goal context/i })).toBeInTheDocument())
  })

  test('goal context banner hidden by default', async () => {
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle goal context/i })).toBeInTheDocument())
    expect(screen.queryByTestId('goal-context-banner')).not.toBeInTheDocument()
  })

  test('clicking goal context toggle shows the banner', async () => {
    const user = userEvent.setup()
    renderSession('sess-passkey')
    await waitFor(() => expect(screen.getByRole('button', { name: /toggle goal context/i })).toBeInTheDocument())

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /toggle goal context/i }))
    })

    expect(screen.getByTestId('goal-context-banner')).toBeInTheDocument()
  })

  test('no goal context toggle for session without goal', async () => {
    renderSession('sess-investor')
    await waitFor(() => expect(screen.queryByRole('button', { name: /results panel/i })).toBeInTheDocument())
    // sess-investor has no goal
    expect(screen.queryByRole('button', { name: /toggle goal context/i })).not.toBeInTheDocument()
  })
})

// ── EditGoalDialog standalone ─────────────────────────────────────────────────

describe('EditGoalDialog', () => {
  test('does not render when closed', () => {
    render(<EditGoalDialog open={false} onOpenChange={() => {}} goalTitle="Passwordless login by Q4" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('renders when open', () => {
    render(<EditGoalDialog open={true} onOpenChange={() => {}} goalTitle="Passwordless login by Q4" />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/edit goal/i)
  })

  test('Close button triggers onOpenChange(false)', async () => {
    const user = userEvent.setup()
    let openState = true
    render(
      <EditGoalDialog
        open={openState}
        onOpenChange={(v) => { openState = v }}
        goalTitle="Passwordless login by Q4"
      />,
    )
    const closeBtn = screen.getByRole('button', { name: /close/i })
    await act(async () => {
      await user.click(closeBtn)
    })
    expect(openState).toBe(false)
  })

  test('Save goal button triggers onOpenChange(false)', async () => {
    const user = userEvent.setup()
    let openState = true
    render(
      <EditGoalDialog
        open={openState}
        onOpenChange={(v) => { openState = v }}
        goalTitle="Passwordless login by Q4"
      />,
    )
    const saveBtn = screen.getByRole('button', { name: /save goal/i })
    await act(async () => {
      await user.click(saveBtn)
    })
    expect(openState).toBe(false)
  })
})

// ── AddAgentPopover standalone ────────────────────────────────────────────────

describe('AddAgentPopover', () => {
  test('trigger renders without opening the popover', () => {
    render(
      <AddAgentPopover>
        <button type="button">Add agent</button>
      </AddAgentPopover>,
    )
    expect(screen.queryByPlaceholderText(/add a helper/i)).not.toBeInTheDocument()
  })

  test('clicking trigger opens agent list', async () => {
    const user = userEvent.setup()
    render(
      <AddAgentPopover>
        <button type="button">Add agent</button>
      </AddAgentPopover>,
    )
    await act(async () => {
      await user.click(screen.getByText('Add agent'))
    })
    expect(screen.getByPlaceholderText(/add a helper/i)).toBeInTheDocument()
    // At least one agent item should be visible
    expect(screen.getByText('Finance')).toBeInTheDocument()
  })
})
