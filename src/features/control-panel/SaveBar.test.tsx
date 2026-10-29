/**
 * SaveBar dirty-state behaviour tests.
 *
 * Covers:
 *  - SaveBar shows "No unsaved changes" and disabled buttons when clean.
 *  - SaveBar shows "Unsaved changes" and enabled buttons when dirty.
 *  - Clicking Save calls onSave (clears dirty in the section).
 *  - Clicking Discard calls onDiscard (resets in the section).
 *
 * Integration test via SectionNotifications (which owns the dirty state):
 *  - toggling a checkbox marks the SaveBar dirty.
 *  - clicking Save clears it.
 */

import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SaveBar } from './ControlPanelShared'
import { SectionNotifications } from './sections/SectionNotifications'

/**
 * SectionNotifications now persists through useUpdateCompanySettings, which needs
 * a QueryClientProvider. CommandsProvider has a default (mock) client, so the
 * save resolves against the in-memory fixture.
 */
function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SectionNotifications />
    </QueryClientProvider>,
  )
}

// ── Unit: SaveBar component ───────────────────────────────────────────────────

describe('SaveBar', () => {
  test('shows "No unsaved changes" and disabled buttons when clean', () => {
    render(<SaveBar dirty={false} onSave={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
  })

  test('shows "Unsaved changes" and enabled buttons when dirty', () => {
    render(<SaveBar dirty onSave={vi.fn()} onDiscard={vi.fn()} />)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /discard/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
  })

  test('calls onSave when Save is clicked', () => {
    const onSave = vi.fn()
    render(<SaveBar dirty onSave={onSave} onDiscard={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  test('calls onDiscard when Discard is clicked', () => {
    const onDiscard = vi.fn()
    render(<SaveBar dirty onSave={vi.fn()} onDiscard={onDiscard} />)
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})

// ── Integration: SectionNotifications dirty state ─────────────────────────────

describe('SectionNotifications — SaveBar dirty integration', () => {
  test('SaveBar is disabled initially (no unsaved changes)', () => {
    renderSection()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /discard/i })).toBeDisabled()
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument()
  })

  test('toggling a notification checkbox enables the SaveBar', () => {
    renderSection()

    // First checkbox in the table (In app column, first row)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
    fireEvent.click(checkboxes[0])

    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /discard/i })).not.toBeDisabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  test('clicking Save persists and clears the dirty flag', async () => {
    renderSection()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])

    // Dirty now
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()

    // Click Save — persists through the mock command, then clears dirty.
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    // Should be clean again once the save resolves.
    await waitFor(() => expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled())
  })

  test('clicking Discard resets changes and clears dirty flag', () => {
    renderSection()

    const checkboxes = screen.getAllByRole('checkbox')
    const initialChecked = checkboxes[0].getAttribute('aria-checked')
    fireEvent.click(checkboxes[0])

    // State has changed
    const afterToggle = screen.getAllByRole('checkbox')[0].getAttribute('aria-checked')
    expect(afterToggle).not.toBe(initialChecked)

    // Discard
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))

    // Dirty cleared
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    // State reverted
    const afterDiscard = screen.getAllByRole('checkbox')[0].getAttribute('aria-checked')
    expect(afterDiscard).toBe(initialChecked)
  })

  test('toggling the weekends switch enables the SaveBar', () => {
    renderSection()

    const weekendsSwitch = screen.getByRole('switch', { name: /weekends/i })
    expect(weekendsSwitch).toBeInTheDocument()
    fireEvent.click(weekendsSwitch)

    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })
})
