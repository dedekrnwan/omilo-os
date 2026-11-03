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

  test('task shows status, meta and progress', () => {
    const blocks: MessageBlock[] = [
      { type: 'task', title: 'Pause 2 goals', status: 'running', staff: 'Dev', stepsDone: 2, stepsTotal: 4, taskId: 'job-1' },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 steps')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open job/ })).toHaveAttribute('href', '/jobs/job-1')
  })

  test('usage_meter prints compact tokens and the account', () => {
    const blocks: MessageBlock[] = [
      { type: 'usage_meter', account: 'Claude Code pool', tier: 'Max', tokensIn: 1200, tokensOut: 860 },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('1.2k in / 860 out')).toBeInTheDocument()
    expect(screen.getByText(/Claude Code pool · Max/)).toBeInTheDocument()
  })

  test('document links Open in Docs to its docPath', () => {
    const blocks: MessageBlock[] = [
      { type: 'document', title: 'Pause note', source: 'Docs', docPath: 'q4/pause-note.md' },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('Pause note')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Docs/ })).toHaveAttribute(
      'href',
      '/docs/?path=q4%2Fpause-note.md',
    )
  })

  test('pr_card shows the diff stats and dismisses on "Not now"', async () => {
    const user = userEvent.setup()
    const blocks: MessageBlock[] = [
      { type: 'pr_card', repo: 'omilo-os', branch: 'feat/x', base: 'main', filesChanged: 2, additions: 18, deletions: 4 },
    ]
    render(<ReplyBlocks blocks={blocks} />)
    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByText('Open a pull request')).toBeNull()
  })

  test('streaming shows a stop control only when onStop is given', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    const { rerender } = render(<ReplyBlocks blocks={[{ type: 'streaming', text: 'Writing a reply', tokens: 12 }]} />)
    expect(screen.getByText(/Writing… · 12 tokens/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
    rerender(<ReplyBlocks blocks={[{ type: 'streaming', text: 'Writing a reply', tokens: 12 }]} onStop={onStop} />)
    await user.click(screen.getByRole('button', { name: /Stop/ }))
    expect(onStop).toHaveBeenCalled()
  })

  test('image shows a chooser and the generating state', () => {
    const { rerender } = render(
      <ReplyBlocks blocks={[{ type: 'image', imageOptions: [{ url: 'a.png' }, { url: 'b.png' }] }]} />,
    )
    expect(screen.getByRole('button', { name: 'Use option 1' })).toBeInTheDocument()
    rerender(<ReplyBlocks blocks={[{ type: 'image', generating: true, progress: 40, prompt: 'a cat' }]} />)
    expect(screen.getByText('40%')).toBeInTheDocument()
  })
})
