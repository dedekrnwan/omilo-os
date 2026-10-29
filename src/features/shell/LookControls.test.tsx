import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Channel } from '../../core/domain/types'
import { CommandsProvider } from '../../app/CommandsProvider'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import { AreaBadgeButton, FolderIconButton } from './LookControls'
import { LookPicker } from '../../ui/ds/LookPicker'

// Area / folder looks persist through the API (PATCH /v1/channels|folders/{id}).
let commands = createMockCommands()
function render(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(
    <QueryClientProvider client={qc}>
      <CommandsProvider commands={commands}>{ui}</CommandsProvider>
    </QueryClientProvider>,
  )
}

const area: Channel = {
  id: 'ch-engineering', name: 'Engineering', accent: 'dev', agentCount: 3, chatCount: 24, openItems: 5, contextScope: 'isolated',
}

beforeEach(() => {
  commands = createMockCommands()
  vi.spyOn(commands, 'updateArea')
  vi.spyOn(commands, 'updateFolder')
})

describe('area icon badge', () => {
  test('a saved look on the area drives the tile', () => {
    render(<AreaBadgeButton area={{ ...area, icon: 'rocket', color: '#EF4444' }} size={24} />)
    expect(screen.getByTestId('area-icon').querySelector('.lucide-rocket')).not.toBeNull()
  })

  test('clicking the badge opens the picker; picking an icon and colour updates the area', async () => {
    render(<AreaBadgeButton area={area} size={24} />)
    fireEvent.click(screen.getByRole('button', { name: /change engineering icon/i }))
    expect(await screen.findByRole('dialog', { name: /engineering icon/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'rocket' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Colour #EF4444' }))
    await waitFor(() => expect(commands.updateArea).toHaveBeenCalledWith('ch-engineering', { icon: 'rocket' }))
    expect(commands.updateArea).toHaveBeenCalledWith('ch-engineering', { color: '#EF4444' })
  })

  test('search filters icons and Reset restores the default', async () => {
    render(<AreaBadgeButton area={area} size={24} />)
    fireEvent.click(screen.getByRole('button', { name: /change engineering icon/i }))
    fireEvent.change(await screen.findByRole('textbox', { name: /search icons/i }), { target: { value: 'truck' } })
    expect(screen.getAllByRole('radio').filter((r) => r.closest('[aria-label="Icon"]'))).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'truck' }))
    fireEvent.click(screen.getByRole('button', { name: /reset/i }))
    await waitFor(() => expect(commands.updateArea).toHaveBeenLastCalledWith('ch-engineering', { icon: null, color: null }))
  })
})

describe('folder icon', () => {
  test('a folder can get its own icon', async () => {
    render(<FolderIconButton folder={{ id: 'f-q4', name: 'Q4 Launch' }} open={false} />)
    fireEvent.click(screen.getByRole('button', { name: /change q4 launch icon/i }))
    fireEvent.click(await screen.findByRole('radio', { name: 'flag' }))
    await waitFor(() => expect(commands.updateFolder).toHaveBeenCalledWith('f-q4', { icon: 'flag' }))
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
