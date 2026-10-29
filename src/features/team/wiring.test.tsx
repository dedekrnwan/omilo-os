import { describe, expect, test, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SelectField, InputField } from './ui'
import type { SelectOption } from './ui'
import { SetupDialog } from './SetupDialog'
import type { HireSubmit } from './SetupDialog'
import { ConnectTelegramDialog } from './channel-dialogs/ConnectTelegramDialog'
import { ConnectEmailDialog } from './channel-dialogs/ConnectEmailDialog'
import { makeRecord, renderWithData } from './testRecord'
import { createMockCommands } from '../../adapters/mock/mockCommands'
import type { Commands } from '../../adapters/http/commands'

const OPTS: SelectOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]

describe('SelectField (controlled)', () => {
  test('shows the selected label and emits onChange from the dropdown', () => {
    const onChange = vi.fn()
    render(<SelectField label="Pick" value="a" options={OPTS} onChange={onChange} />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick' }))
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })

  test('without options it stays a display-only button', () => {
    render(<SelectField value="static" />)
    expect(screen.getByText('static')).toBeInTheDocument()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('InputField (controlled)', () => {
  test('is controlled when onChange is provided', () => {
    const onChange = vi.fn()
    render(<InputField label="Name" value="hi" onChange={onChange} />)
    const input = screen.getByLabelText('Name') as HTMLInputElement
    expect(input.value).toBe('hi')
    fireEvent.change(input, { target: { value: 'hey' } })
    expect(onChange).toHaveBeenCalledWith('hey')
  })
})

describe('SetupDialog hire flow', () => {
  test('submits bound fields via onHire', () => {
    let submitted: HireSubmit | undefined
    renderWithData(
      <SetupDialog
        optionId="sales"
        onClose={() => {}}
        onBack={() => {}}
        onHire={(v) => (submitted = v)}
      />,
    )
    const name = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: 'Leads' } })
    fireEvent.click(screen.getByRole('button', { name: /Hire Leads/ }))
    expect(submitted?.name).toBe('Leads')
    expect(submitted?.area).toBe('sales')
    expect(submitted?.role).toBe('Sales')
    // Omilo chat is built in, so no extra channel binding by default
    expect(submitted?.channels).toEqual([])
  })

  test('disables hire when the name is blank', () => {
    renderWithData(<SetupDialog optionId="sales" onClose={() => {}} onBack={() => {}} onHire={() => {}} />)
    const name = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(name, { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: /Hire/ })).toBeDisabled()
  })
})

describe('ConnectTelegramDialog', () => {
  test('Connect stays disabled until a valid-looking token is entered', () => {
    renderWithData(<ConnectTelegramDialog helper={makeRecord()} onClose={() => {}} />)
    const connect = screen.getByRole('button', { name: 'Connect Telegram' })
    expect(connect).toBeDisabled()
    const token = screen.getByLabelText('Bot token') as HTMLInputElement
    fireEvent.change(token, { target: { value: '7104829315:AAHk3VqABCDEFGHIJKLMNOPQRSTUVWXYZ012' } })
    expect(connect).not.toBeDisabled()
  })

  test('Connect saves the bot token on the helper channel binding', async () => {
    const commands = createMockCommands()
    const spy = vi.spyOn(commands, 'connectHelperChannel')
    renderWithData(<ConnectTelegramDialog helper={makeRecord()} onClose={() => {}} />, { commands: commands as Commands })
    const token = '7104829315:AAHk3VqABCDEFGHIJKLMNOPQRSTUVWXYZ012'
    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: token } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect Telegram' }))
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('h-support', {
        kind: 'telegram',
        config: { audience: 'anyone' },
        secrets: { bot_token: token },
      }),
    )
  })
})

describe('ConnectEmailDialog', () => {
  test('From name and Signature are bound', () => {
    renderWithData(<ConnectEmailDialog helper={makeRecord()} onClose={() => {}} />)
    const from = screen.getByLabelText('From name') as HTMLInputElement
    fireEvent.change(from, { target: { value: 'Support Desk' } })
    expect(from.value).toBe('Support Desk')
  })
})
