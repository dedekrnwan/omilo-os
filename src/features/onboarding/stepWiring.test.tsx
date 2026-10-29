/** Task 5.3 — onboarding step wiring: StepTeam selection + StepCheck editable notes. */
import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { StepTeam } from './StepTeam'
import { StepCheck } from './StepCheck'
import { getInterview } from './interviewApi'
import type { TeamHelper } from './data'

vi.mock('../../app/session', () => ({
  useSession: (sel: (s: { company: { name: string } }) => unknown) =>
    sel({ company: { name: 'Acme' } }),
}))

// Mock mode: interviewApi runs its offline practice interview + rules team.
describe('StepTeam', () => {
  test('Create my team passes Chief + the planned helpers that are on', async () => {
    const onNext = vi.fn()
    render(<StepTeam onBack={() => {}} onNext={onNext} />)
    await screen.findByText('Grower')
    fireEvent.click(screen.getByRole('button', { name: /Create my team/ }))
    expect(onNext).toHaveBeenCalledTimes(1)
    const ids = (onNext.mock.calls[0][0] as TeamHelper[]).map((h) => h.id)
    expect(ids).toEqual(['chief', 'grower', 'support'])
  })

  test('toggling a helper off drops it from the selection; Chief cannot be turned off', async () => {
    const onNext = vi.fn()
    render(<StepTeam onBack={() => {}} onNext={onNext} />)
    fireEvent.click(await screen.findByRole('switch', { name: /Hire Grower/ }))
    expect(screen.getByRole('switch', { name: /Hire Chief of Staff/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /Create my team/ }))
    expect((onNext.mock.calls[0][0] as TeamHelper[]).map((h) => h.id)).not.toContain('grower')
  })
})

describe('StepCheck', () => {
  test('a note edited and saved is stored (PUT /onboarding/notes) and shown', async () => {
    render(<StepCheck onBack={() => {}} onNext={() => {}} />)
    // Empty notes open in edit mode; type into Company and save.
    const textarea = (await screen.findByRole('textbox', { name: /Company note/ })) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'We run a laundry in Bandung' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Company/ }))
    await waitFor(() => expect(screen.getByText('We run a laundry in Bandung')).toBeInTheDocument())
    expect((await getInterview()).notes.company).toBe('We run a laundry in Bandung')
  })

  test('Add something I missed opens an extra note', async () => {
    render(<StepCheck onBack={() => {}} onNext={() => {}} />)
    const before = (await screen.findAllByRole('textbox')).length
    fireEvent.click(screen.getByRole('button', { name: /Add something I missed/ }))
    expect(screen.getAllByRole('textbox').length).toBe(before + 1)
    expect(screen.getByRole('textbox', { name: /Something I missed note/ })).toBeInTheDocument()
  })
})
