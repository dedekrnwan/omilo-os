/**
 * Tests for CreateChannelDialog — icon picker, purpose, context_scope, and
 * form submission wired to createArea.
 *
 * TDD: RED first (no createArea wiring yet), then implement in
 * CreateChannelDialog.tsx.
 *
 * Pattern mirrors StepProfile.test.tsx: vi.mock createCommands, then import
 * the component under test.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ── module mock — intercept createCommands so we can spy on createArea ────────
const mockCreateArea = vi.fn().mockResolvedValue({
  id: 'ch-new',
  name: 'Test Area',
  accent: 'support',
  agentCount: 0,
  chatCount: 0,
  openItems: 0,
  contextScope: 'isolated',
})

vi.mock('../../adapters/http/commands', () => ({
  createCommands: () => ({ createArea: mockCreateArea }),
}))

import { CreateChannelDialog } from './CreateChannelDialog'

// ── helpers ───────────────────────────────────────────────────────────────────

function renderDialog(open = true, onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return {
    queryClient,
    onOpenChange,
    ...render(
      <QueryClientProvider client={queryClient}>
        <CreateChannelDialog open={open} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    ),
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CreateChannelDialog', () => {
  beforeEach(() => {
    mockCreateArea.mockClear()
  })

  // ── render ────────────────────────────────────────────────────────────────

  test('renders name input, color swatches, purpose textarea, and context-scope options', () => {
    renderDialog()
    expect(screen.getByLabelText(/area name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/area purpose/i)).toBeInTheDocument()
    // At least two context-scope radios
    const radios = screen.getAllByRole('radio', { name: /isolated/i })
    expect(radios.length).toBeGreaterThanOrEqual(2)
    // Color swatches — aria-label includes "Color"
    const swatches = screen.getAllByRole('button', { name: /color/i })
    expect(swatches.length).toBeGreaterThanOrEqual(1)
  })

  test('renders icon picker with multiple icon options', () => {
    renderDialog()
    // Icon picker renders radio buttons with icon names
    const iconPicker = screen.getByRole('group', { name: /icon/i })
    const iconOptions = iconPicker ? iconPicker.querySelectorAll('[role="radio"]') : []
    // Should have multiple icon choices
    expect(iconOptions.length).toBeGreaterThanOrEqual(4)
  })

  // ── context scope default ─────────────────────────────────────────────────

  test('context scope defaults to isolated', () => {
    renderDialog()
    // The context radio's accessible name includes the description text,
    // so query by value attribute on the hidden radio input.
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    const isolatedRadio = radios.find((r) => r.value === 'isolated')
    expect(isolatedRadio).toBeDefined()
    expect(isolatedRadio!.checked).toBe(true)
  })

  test('selecting the general option sends isolated_general to createArea', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderDialog(true, onOpenChange)

    // Fill name (clear default and type new)
    const nameInput = screen.getByLabelText(/area name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Marketing')

    // Select "isolated_general" context scope option (query by value)
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    const generalRadio = radios.find((r) => r.value === 'isolated_general')!
    await user.click(generalRadio)

    // Submit
    await user.click(screen.getByRole('button', { name: /^create area$/i }))

    await waitFor(() => {
      expect(mockCreateArea).toHaveBeenCalledOnce()
    })
    expect(mockCreateArea).toHaveBeenCalledWith(
      expect.objectContaining({ contextScope: 'isolated_general' }),
    )
  })

  // ── valid submission ───────────────────────────────────────────────────────

  test('valid submit calls createArea with full camelCase payload and closes', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    renderDialog(true, onOpenChange)

    // Set name
    const nameInput = screen.getByLabelText(/area name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Support Team')

    // Set purpose
    await user.type(screen.getByLabelText(/area purpose/i), 'Handle tickets and refunds')

    // Pick an icon
    const iconPicker = screen.getByRole('group', { name: /icon/i })
    const firstIcon = iconPicker.querySelector('[role="radio"]') as HTMLElement
    if (firstIcon) fireEvent.click(firstIcon)

    // Submit
    await user.click(screen.getByRole('button', { name: /^create area$/i }))

    await waitFor(() => {
      expect(mockCreateArea).toHaveBeenCalledOnce()
    })

    const payload = mockCreateArea.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      name: 'Support Team',
      purpose: 'Handle tickets and refunds',
      contextScope: 'isolated',
    })
    expect(typeof payload.color).toBe('string')
    expect(payload.color).not.toBe('')
    // Dialog closes
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // ── empty name blocks submit ───────────────────────────────────────────────

  test('empty name blocks submit — createArea NOT called, inline hint shown', async () => {
    const user = userEvent.setup()
    renderDialog()

    // Clear the pre-filled name
    const nameInput = screen.getByLabelText(/area name/i)
    await user.clear(nameInput)

    await user.click(screen.getByRole('button', { name: /^create area$/i }))

    expect(mockCreateArea).not.toHaveBeenCalled()
    // Inline hint text appears
    expect(screen.getByText(/name is required/i)).toBeInTheDocument()
  })

  test('whitespace-only name also blocks submit', async () => {
    const user = userEvent.setup()
    renderDialog()

    const nameInput = screen.getByLabelText(/area name/i)
    await user.clear(nameInput)
    await user.type(nameInput, '   ')

    await user.click(screen.getByRole('button', { name: /^create area$/i }))

    expect(mockCreateArea).not.toHaveBeenCalled()
  })

  // ── icon and color are included ───────────────────────────────────────────

  test('createArea payload includes color and icon when an icon is selected', async () => {
    const user = userEvent.setup()
    renderDialog()

    const nameInput = screen.getByLabelText(/area name/i)
    await user.clear(nameInput)
    await user.type(nameInput, 'Dev')

    // Click the first icon radio
    const iconPicker = screen.getByRole('group', { name: /icon/i })
    const icons = iconPicker.querySelectorAll('[role="radio"]')
    fireEvent.click(icons[0])

    await user.click(screen.getByRole('button', { name: /^create area$/i }))

    await waitFor(() => {
      expect(mockCreateArea).toHaveBeenCalledOnce()
    })
    const payload = mockCreateArea.mock.calls[0][0] as Record<string, unknown>
    expect(payload.icon).toBeDefined()
    expect(typeof payload.icon).toBe('string')
    expect(payload.color).toBeDefined()
  })
})
