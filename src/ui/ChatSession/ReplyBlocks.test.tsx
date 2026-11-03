import { describe, test, expect } from 'vitest'
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
})
