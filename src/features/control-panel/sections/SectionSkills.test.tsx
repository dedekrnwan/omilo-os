import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SectionSkills } from './SectionSkills'

describe('SectionSkills filters', () => {
  test('the segmented filter narrows the grid by skill type', async () => {
    const user = userEvent.setup()
    render(<SectionSkills onDialog={() => {}} />)

    // All shows both a Standard and an On-demand skill
    expect(screen.getByText('House voice')).toBeInTheDocument()
    expect(screen.getByText('Release notes')).toBeInTheDocument()

    // Filter to On demand → the Standard skill drops out
    await user.click(screen.getByRole('tab', { name: 'On demand' }))
    expect(screen.queryByText('House voice')).not.toBeInTheDocument()
    expect(screen.getByText('Release notes')).toBeInTheDocument()

    // Back to All → it returns
    await user.click(screen.getByRole('tab', { name: 'All' }))
    expect(screen.getByText('House voice')).toBeInTheDocument()
  })
})
