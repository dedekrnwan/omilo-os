/**
 * Tests for StepProfile — company profile fields
 * (industry, teamSize, region, currency, picRole).
 *
 * TDD: RED first, then implement StepProfile.tsx.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── module mock — intercept createCommands so we can spy on updateCompanyProfile ──
const mockUpdateCompanyProfile = vi.fn().mockResolvedValue({})

vi.mock('../../adapters/http/commands', () => ({
  createCommands: () => ({ updateCompanyProfile: mockUpdateCompanyProfile }),
}))

import { StepProfile } from './StepProfile'

// ── helpers ───────────────────────────────────────────────────────────────────

function renderStep(onNext = vi.fn()) {
  return render(<StepProfile onNext={onNext} />)
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('StepProfile', () => {
  beforeEach(() => {
    mockUpdateCompanyProfile.mockClear()
  })

  test('renders all 5 profile fields', () => {
    renderStep()

    expect(screen.getByRole('textbox', { name: /industry/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /team size/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /region/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /currency/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /your role/i })).toBeInTheDocument()
  })

  test('currency defaults to IDR', () => {
    renderStep()
    const select = screen.getByRole('combobox', { name: /currency/i }) as HTMLSelectElement
    expect(select.value).toBe('IDR')
  })

  test('submit with empty industry shows inline error and does NOT call updateCompanyProfile', async () => {
    const user = userEvent.setup()
    renderStep()

    // Fill all but industry
    await user.selectOptions(screen.getByRole('combobox', { name: /team size/i }), '1-10')
    await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Indonesia')
    // currency is already IDR by default
    await user.type(screen.getByRole('textbox', { name: /your role/i }), 'Ops Lead')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/industry is required/i)).toBeInTheDocument()
    expect(mockUpdateCompanyProfile).not.toHaveBeenCalled()
  })

  test('submit with empty picRole shows inline error and does NOT call updateCompanyProfile', async () => {
    const user = userEvent.setup()
    renderStep()

    await user.type(screen.getByRole('textbox', { name: /industry/i }), 'Fintech')
    await user.selectOptions(screen.getByRole('combobox', { name: /team size/i }), '1-10')
    await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Indonesia')
    // currency IDR default, picRole empty

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/role is required/i)).toBeInTheDocument()
    expect(mockUpdateCompanyProfile).not.toHaveBeenCalled()
  })

  test('submit with empty teamSize shows inline error and does NOT call updateCompanyProfile', async () => {
    const user = userEvent.setup()
    renderStep()

    await user.type(screen.getByRole('textbox', { name: /industry/i }), 'Fintech')
    // leave team size empty (default placeholder)
    await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Indonesia')
    await user.type(screen.getByRole('textbox', { name: /your role/i }), 'Ops Lead')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(screen.getByText(/team size is required/i)).toBeInTheDocument()
    expect(mockUpdateCompanyProfile).not.toHaveBeenCalled()
  })

  test('valid submit calls updateCompanyProfile with camelCase payload and advances', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    renderStep(onNext)

    await user.type(screen.getByRole('textbox', { name: /industry/i }), 'Fintech')
    await user.selectOptions(screen.getByRole('combobox', { name: /team size/i }), '11-50')
    await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Southeast Asia')
    await user.selectOptions(screen.getByRole('combobox', { name: /currency/i }), 'USD')
    await user.type(screen.getByRole('textbox', { name: /your role/i }), 'CTO')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(mockUpdateCompanyProfile).toHaveBeenCalledOnce()
    expect(mockUpdateCompanyProfile).toHaveBeenCalledWith({
      industry: 'Fintech',
      teamSize: '11-50',
      region: 'Southeast Asia',
      currency: 'USD',
      picRole: 'CTO',
    })
    expect(onNext).toHaveBeenCalledOnce()
  })

  test('valid submit with IDR default currency includes IDR in payload', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    renderStep(onNext)

    await user.type(screen.getByRole('textbox', { name: /industry/i }), 'Healthtech')
    await user.selectOptions(screen.getByRole('combobox', { name: /team size/i }), '1-10')
    await user.selectOptions(screen.getByRole('combobox', { name: /region/i }), 'Indonesia')
    // keep IDR default, do NOT change currency
    await user.type(screen.getByRole('textbox', { name: /your role/i }), 'Founder')

    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(mockUpdateCompanyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'IDR' }),
    )
    expect(onNext).toHaveBeenCalledOnce()
  })
})
