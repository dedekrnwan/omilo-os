import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Channel } from '../../core/domain/types'
import { useAppearance } from '../../app/appearance'
import { AreaBadgeButton, FolderIconButton } from './LookControls'
import { LookPicker } from '../../ui/ds/LookPicker'

const area: Channel = {
  id: 'ch-engineering', name: 'Engineering', accent: 'dev', agentCount: 3, chatCount: 24, openItems: 5,
}

beforeEach(() => {
  useAppearance.setState({ companies: {}, areas: {}, folders: {} })
})

describe('area icon badge', () => {
  test('clicking the badge opens the picker; picking an icon and colour updates the area', async () => {
    render(<AreaBadgeButton area={area} size={24} />)
    fireEvent.click(screen.getByRole('button', { name: /change engineering icon/i }))
    expect(await screen.findByRole('dialog', { name: /engineering icon/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'rocket' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Colour #EF4444' }))
    expect(useAppearance.getState().areas['ch-engineering']).toEqual({ icon: 'rocket', color: '#EF4444' })
    expect(screen.getByTestId('area-icon').querySelector('.lucide-rocket')).not.toBeNull()
  })

  test('search filters icons and Reset restores the default', async () => {
    render(<AreaBadgeButton area={area} size={24} />)
    fireEvent.click(screen.getByRole('button', { name: /change engineering icon/i }))
    fireEvent.change(await screen.findByRole('textbox', { name: /search icons/i }), { target: { value: 'truck' } })
    expect(screen.getAllByRole('radio').filter((r) => r.closest('[aria-label="Icon"]'))).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'truck' }))
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    expect(useAppearance.getState().areas['ch-engineering']).toBeUndefined()
  })
})

describe('folder icon', () => {
  test('a folder can get its own icon', async () => {
    render(<FolderIconButton folder={{ id: 'f-q4', name: 'Q4 Launch' }} open={false} />)
    fireEvent.click(screen.getByRole('button', { name: /change q4 launch icon/i }))
    fireEvent.click(await screen.findByRole('radio', { name: 'flag' }))
    expect(useAppearance.getState().folders['f-q4']).toEqual({ icon: 'flag' })
  })
})

describe('company logo picker', () => {
  test('initials and colour can be changed', async () => {
    let patch = {}
    render(
      <LookPicker
        kind="company"
        title="Sahabat Warga logo"
        value={{ color: '#EB6834', initial: 'S' }}
        onChange={(p) => (patch = { ...patch, ...p })}
        onReset={() => {}}
      >
        <button type="button">Upload</button>
      </LookPicker>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Initials' }), { target: { value: 'sw' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Colour #6366F1' }))
    expect(patch).toEqual({ initial: 'SW', color: '#6366F1' })
    expect(screen.getByRole('button', { name: /upload logo/i })).toBeInTheDocument()
  })
})
