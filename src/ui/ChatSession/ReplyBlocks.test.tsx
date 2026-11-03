import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReplyBlocks } from './ReplyBlocks'
import type { MessageBlock } from '../../core/domain/types'

describe('ReplyBlocks', () => {
  test('reasoning is a collapsed pill that expands on click', async () => {
    const user = userEvent.setup()
    const blocks: MessageBlock[] = [{ type: 'reasoning', durationS: 12, text: 'I **weighed** two options.' }]
    render(<ReplyBlocks blocks={blocks} />)
    // Collapsed: shows the "Thought for 12s" label, body hidden.
    const pill = screen.getByRole('button', { name: /Thought for 12s/ })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('weighed')).toBeNull()
    // Expand: body appears.
    await user.click(pill)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('weighed')).toBeInTheDocument()
  })

  test('code block shows its filename and a copy button', () => {
    const blocks: MessageBlock[] = [{ type: 'code', lang: 'python', name: 'main.py', text: 'print("hi")' }]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('main.py')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Copy/ })).toBeInTheDocument()
    expect(screen.getByText('print("hi")')).toBeInTheDocument()
  })

  test('markdown block renders bold emphasis', () => {
    const blocks: MessageBlock[] = [{ type: 'markdown', text: 'Pause **two goals** until December' }]
    render(<ReplyBlocks blocks={blocks} />)
    const strong = screen.getByText('two goals')
    expect(strong.tagName).toBe('STRONG')
  })

  test('an unknown block type falls back to markdown', () => {
    const blocks: MessageBlock[] = [{ type: 'future_widget', text: 'still **readable**' }]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('readable').tagName).toBe('STRONG')
  })

  test('todos shows the done count and each step', () => {
    const blocks: MessageBlock[] = [
      {
        type: 'todos',
        title: 'Plan',
        items: [
          { text: 'Read the goals', status: 'done' },
          { text: 'Draft the note', status: 'active' },
          { text: 'Apply it', status: 'pending' },
        ],
      },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument()
    expect(screen.getByText('Draft the note')).toBeInTheDocument()
  })

  test('sources pills expand into a linked list on click', async () => {
    const user = userEvent.setup()
    const blocks: MessageBlock[] = [
      { type: 'sources', sources: [{ title: 'Goals board', subtitle: '7 open', url: 'https://x.test' }] },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    // Collapsed: no link yet.
    expect(screen.queryByRole('link')).toBeNull()
    await user.click(screen.getByRole('button', { name: /Goals board/ }))
    const link = screen.getByRole('link', { name: /Goals board/ })
    expect(link).toHaveAttribute('href', 'https://x.test')
  })

  test('action_card approve calls onDecide and shows the decided state', async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    const blocks: MessageBlock[] = [
      { type: 'action_card', title: 'Open a pull request', target: 'repo → main', actionLabel: 'Open PR' },
    ]
    render(<ReplyBlocks blocks={blocks} onDecide={onDecide} />)
    await user.click(screen.getByRole('button', { name: 'Open PR' }))
    expect(onDecide).toHaveBeenCalledWith(blocks[0], 'approve')
    expect(screen.getByText('Opening…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull()
  })

  test('confirmation confirm calls onDecide and collapses to an undo row', async () => {
    const user = userEvent.setup()
    const onDecide = vi.fn()
    const blocks: MessageBlock[] = [
      {
        type: 'confirmation',
        title: 'Send the renewal reply?',
        text: 'Offers 6%.',
        actionLabel: 'Send to 1',
        who: 'Sales',
        when: '2m ago',
      },
    ]
    render(<ReplyBlocks blocks={blocks} onDecide={onDecide} />)
    expect(screen.getByText(/Sales asked/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Send to 1' }))
    expect(onDecide).toHaveBeenCalledWith(blocks[0], 'approve')
    expect(screen.getByText(/You approved/)).toBeInTheDocument()
    expect(screen.getByText(/Undo for 5 min/)).toBeInTheDocument()
  })
})
