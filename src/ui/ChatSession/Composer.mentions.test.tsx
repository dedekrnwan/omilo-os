import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Composer } from './Composer'
import { DEFAULT_MODEL } from './ModelMenu'

function renderComposer() {
  return render(<Composer sessionId="s1" selectedModel={DEFAULT_MODEL} onModelChange={() => {}} />)
}

describe('Composer + menu', () => {
  test('the + button opens a menu with the trigger shortcuts and attach', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('Mention someone')).toBeInTheDocument()
    expect(screen.getByText('Add context')).toBeInTheDocument()
    expect(screen.getByText('Commands')).toBeInTheDocument()
    expect(screen.getByText('Attach file')).toBeInTheDocument()
  })
})

describe('Composer mention picker', () => {
  test('typing @ opens the mention picker', async () => {
    const user = userEvent.setup()
    renderComposer()
    const editor = screen.getByRole('textbox', { name: 'Message' })
    await user.click(editor)
    await user.type(editor, '@')
    expect(await screen.findByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('Chief of Staff')).toBeInTheDocument()
  })

  test('typing a query filters the list', async () => {
    const user = userEvent.setup()
    renderComposer()
    const editor = screen.getByRole('textbox', { name: 'Message' })
    await user.click(editor)
    await user.type(editor, '@bu')
    await screen.findByRole('listbox')
    expect(screen.getByText('Builder')).toBeInTheDocument()
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument()
    expect(screen.queryByText('Chief of Staff')).not.toBeInTheDocument()
  })

  test('arrow-down + Enter inserts a mention chip and closes the picker', async () => {
    const user = userEvent.setup()
    renderComposer()
    const editor = screen.getByRole('textbox', { name: 'Message' })
    await user.click(editor)
    await user.type(editor, '@')
    await screen.findByRole('listbox')
    // rows: [Everyone(@all), Chief, Builder, …]; move down twice to Builder, select
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    const chip = editor.querySelector('[data-chip]')
    expect(chip).not.toBeNull()
    expect(chip).toHaveTextContent('@Builder')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  test('@all can be selected and inserts an @all chip', async () => {
    const user = userEvent.setup()
    renderComposer()
    const editor = screen.getByRole('textbox', { name: 'Message' })
    await user.click(editor)
    await user.type(editor, '@all')
    await screen.findByRole('listbox')
    expect(screen.getByText('Everyone')).toBeInTheDocument()
    await user.keyboard('{Enter}')
    const chip = editor.querySelector('[data-chip]')
    expect(chip).toHaveTextContent('@all')
  })
})
