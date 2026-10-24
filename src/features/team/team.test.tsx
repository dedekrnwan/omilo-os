import { describe, expect, test } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HELPERS, getHelper } from './teamData'
import { JobTab } from './tabs/JobTab'
import { ChannelsTab } from './tabs/ChannelsTab'
import { LetGoDialog } from './LetGoDialog'

describe('team data', () => {
  test('roster has Chief plus five reports', () => {
    expect(HELPERS[0].id).toBe('chief')
    expect(HELPERS).toHaveLength(6)
  })
})

describe('JobTab', () => {
  test('lists routines and opens a working file', () => {
    const opened: string[] = []
    render(<JobTab helper={getHelper('chief')!} onOpenFile={(f) => opened.push(f)} />)
    expect(screen.getByText('Morning brief')).toBeInTheDocument()
    expect(screen.getByText('Chief also manages 15 routines for the whole team.')).toBeInTheDocument()
    fireEvent.click(screen.getByText('PLAYBOOK.md'))
    expect(opened).toEqual(['PLAYBOOK.md'])
  })

  test('shows the empty routines prompt for Sales', () => {
    render(<JobTab helper={getHelper('sales')!} onOpenFile={() => {}} />)
    expect(screen.getByText(/No routines yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ask Chief/ })).toBeInTheDocument()
  })
})

describe('ChannelsTab', () => {
  test('Connect opens the channel drawer state', () => {
    const asked: string[] = []
    render(<ChannelsTab helper={getHelper('support')!} onConnect={(c) => asked.push(c)} />)
    fireEvent.click(screen.getAllByRole('button', { name: /Connect/ })[0])
    expect(asked).toEqual(['telegram'])
  })
})

describe('LetGoDialog', () => {
  test('names the helper and closes on Keep', () => {
    let closed = false
    render(<LetGoDialog helper={getHelper('support')!} onClose={() => (closed = true)} />)
    expect(screen.getByRole('alertdialog', { name: 'Let Support go?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep Support' }))
    expect(closed).toBe(true)
  })
})
