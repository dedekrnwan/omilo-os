/** Task 5.3 — onboarding step wiring: StepTeam selection + StepCheck editable notes. */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepTeam } from './StepTeam'
import { StepCheck } from './StepCheck'

vi.mock('../../app/session', () => ({
  useSession: (sel: (s: { company: { name: string } }) => unknown) =>
    sel({ company: { name: 'Acme' } }),
}))

describe('StepTeam', () => {
  test('Create my team passes the selected helper ids', () => {
    const onNext = vi.fn()
    render(<StepTeam onBack={() => {}} onNext={onNext} />)
    fireEvent.click(screen.getByRole('button', { name: /Create my team/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
    const ids = onNext.mock.calls[0][0] as string[]
    // The three default-on reports + always-on chief are selected by default.
    expect(ids).toContain('chief')
    expect(ids).toContain('builder')
    expect(ids).not.toContain('finance')
  })

  test('toggling a helper off drops it from the selection', () => {
    const onNext = vi.fn()
    render(<StepTeam onBack={() => {}} onNext={onNext} />)
    fireEvent.click(screen.getByRole('switch', { name: /Hire Builder/ }))
    fireEvent.click(screen.getByRole('button', { name: /Create my team/ }))
    expect(onNext.mock.calls[0][0]).not.toContain('builder')
  })
})

describe('StepCheck', () => {
  test('Edit reveals an editable note that persists its new content', () => {
    render(<StepCheck onBack={() => {}} onNext={() => {}} />)
    // The first note's Edit button toggles an inline textarea.
    const editBtn = screen.getAllByRole('button', { name: /^Edit / })[0]
    fireEvent.click(editBtn)
    const textarea = screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Updated note' } })
    expect(textarea.value).toBe('Updated note')
  })

  test('Add something I missed creates a new editable note', () => {
    render(<StepCheck onBack={() => {}} onNext={() => {}} />)
    const before = screen.queryAllByRole('textbox').length
    fireEvent.click(screen.getByRole('button', { name: /Add something I missed/ }))
    expect(screen.queryAllByRole('textbox').length).toBe(before + 1)
  })
})
