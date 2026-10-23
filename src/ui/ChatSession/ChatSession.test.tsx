import { describe, test, expect } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from '../../app/ReposProvider'
import { createMockRepos } from '../../adapters/mock/mockRepos'
import { messages } from '../../adapters/mock/fixtures'
import { ChatSession } from './ChatSession'

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

function renderSession(sessionId: string, repos = createMockRepos()) {
  const Wrapper = makeWrapper(repos)
  return render(
    <Wrapper>
      <ChatSession sessionId={sessionId} />
    </Wrapper>,
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('ChatSession', () => {
  test('renders each message content for a session with messages', async () => {
    renderSession('sess-gen-1')

    const sessionMessages = messages.filter(m => m.sessionId === 'sess-gen-1')
    expect(sessionMessages.length).toBeGreaterThan(0)

    for (const msg of sessionMessages) {
      await waitFor(() =>
        expect(screen.getByText(msg.content)).toBeInTheDocument(),
      )
    }
  })

  test('renders empty placeholder for a session with no messages — no crash', async () => {
    // Use a sessionId that has no messages in fixtures
    renderSession('sess-no-messages')

    await waitFor(() =>
      expect(screen.getByText(/no messages/i)).toBeInTheDocument(),
    )
  })

  test('opening the ModelMenu and selecting a model updates the trigger label', async () => {
    const user = userEvent.setup()
    renderSession('sess-gen-1')

    // Wait for session to load
    await waitFor(() => expect(screen.getByRole('combobox', { name: /model/i })).toBeInTheDocument())

    const trigger = screen.getByRole('combobox', { name: /model/i })
    // Get the label text from data attribute for reliable comparison
    const defaultLabel = trigger.getAttribute('data-model-label') ?? ''
    expect(defaultLabel).toBeTruthy()

    // Open the dropdown
    await act(async () => {
      await user.click(trigger)
    })

    // Find a menu item that is NOT the currently selected one
    const items = screen.getAllByRole('menuitem')
    const otherItem = items.find(item => item.textContent !== defaultLabel)
    expect(otherItem).toBeDefined()

    const newLabel = otherItem!.textContent ?? ''

    await act(async () => {
      await user.click(otherItem!)
    })

    // Trigger should now show the new label
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /model/i }).getAttribute('data-model-label')).toBe(newLabel),
    )
  })

  test('re-rendering with a different sessionId resets the selected model to default', async () => {
    const user = userEvent.setup()
    const Wrapper = makeWrapper()
    const { rerender } = render(
      <Wrapper>
        <ChatSession sessionId="sess-gen-1" />
      </Wrapper>,
    )

    // Wait for load
    await waitFor(() => expect(screen.getByRole('combobox', { name: /model/i })).toBeInTheDocument())

    const trigger = screen.getByRole('combobox', { name: /model/i })
    const defaultLabel = trigger.getAttribute('data-model-label') ?? ''
    expect(defaultLabel).toBeTruthy()

    // Change model
    await act(async () => {
      await user.click(trigger)
    })
    const items = screen.getAllByRole('menuitem')
    const otherItem = items.find(item => item.textContent !== defaultLabel)!
    const newLabel = otherItem.textContent ?? ''
    await act(async () => {
      await user.click(otherItem)
    })
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /model/i }).getAttribute('data-model-label')).toBe(newLabel),
    )

    // Re-render with a different sessionId
    await act(async () => {
      rerender(
        <Wrapper>
          <ChatSession sessionId="sess-eng-1" />
        </Wrapper>,
      )
    })

    // Model should reset to default
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /model/i }).getAttribute('data-model-label')).toBe(defaultLabel),
    )
  })
})
