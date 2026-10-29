import { describe, expect, test, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import type { Commands } from '../../adapters/http/commands'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import { JobTab } from './tabs/JobTab'
import { ChannelsTab } from './tabs/ChannelsTab'
import { LetGoDialog } from './LetGoDialog'
import { makeRecord, renderWithData } from './testRecord'
import { buildHelperRecord, statusOf } from './model'

describe('team model', () => {
  test('status and now box come from the live helper', () => {
    const h = { id: 'a', name: 'Builder', area: 'dev' as const, currentJob: { id: 'j', brief: 'Open the PR', status: 'running' } }
    expect(statusOf(h)).toBe('Working')
    const r = buildHelperRecord(h, { helpers: [h], ownerName: 'Owner', defaultModel: 'Sonnet 5.5' })
    expect(r.now).toBe('Open the PR')
    expect(r.model).toBe('Sonnet 5.5')
    expect(statusOf({ ...h, currentJob: { ...h.currentJob, status: 'waiting' } })).toBe('Needs you')
  })
})

describe('JobTab', () => {
  test('lists routines and opens a working file', () => {
    const opened: string[] = []
    const rec = makeRecord({}, {
      routines: [{ id: 'r1', name: 'Morning brief', freq: 'weekdays', at: '07:30', days: [], paused: false, enabled: true, nextAt: null }],
    })
    renderWithData(<JobTab helper={rec} onOpenFile={(f) => opened.push(f)} />)
    expect(screen.getByText('Morning brief')).toBeInTheDocument()
    fireEvent.click(screen.getByText('PLAYBOOK.md'))
    expect(opened).toEqual(['PLAYBOOK.md'])
  })

  test('shows the empty routines prompt', () => {
    renderWithData(<JobTab helper={makeRecord()} onOpenFile={() => {}} />)
    expect(screen.getByText(/No routines yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ask Chief/ })).toBeInTheDocument()
  })

  test('Save writes the job description through updateHelper', async () => {
    const commands = createMockCommands()
    const updateHelper = vi.spyOn(commands, 'updateHelper')
    renderWithData(<JobTab helper={makeRecord()} onOpenFile={() => {}} />, { commands: commands as Commands })
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New job' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(updateHelper).toHaveBeenCalledWith('h-support', { jobDescription: 'New job' }))
  })
})

describe('ChannelsTab', () => {
  test('Connect opens the channel drawer state', async () => {
    const asked: string[] = []
    renderWithData(<ChannelsTab helper={makeRecord()} onConnect={(c) => asked.push(c)} />)
    fireEvent.click((await screen.findAllByRole('button', { name: /Connect/ }))[0])
    expect(asked).toEqual(['telegram'])
  })

  test('shows saved bindings as pending setup', async () => {
    renderWithData(<ChannelsTab helper={makeRecord({ id: 'h-growth', name: 'Growth' })} onConnect={() => {}} />)
    expect(await screen.findByText('Pending setup')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp Business')).toBeInTheDocument()
    expect(screen.getByText('CONNECTED · 2')).toBeInTheDocument()
  })
})

describe('LetGoDialog', () => {
  test('names the helper, closes on Keep, and lets go on confirm', () => {
    let closed = false
    const onLetGo = vi.fn()
    const { unmount } = renderWithData(
      <LetGoDialog helper={makeRecord()} onClose={() => (closed = true)} onLetGo={onLetGo} />,
    )
    expect(screen.getByRole('alertdialog', { name: 'Let Support go?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Support' }))
    expect(closed).toBe(true)
    unmount()
    renderWithData(<LetGoDialog helper={makeRecord()} onClose={() => {}} onLetGo={onLetGo} />)
    fireEvent.click(screen.getByRole('button', { name: 'Let go' }))
    expect(onLetGo).toHaveBeenCalled()
  })
})
