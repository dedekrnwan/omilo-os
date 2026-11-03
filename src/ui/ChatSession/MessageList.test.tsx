import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MessageList } from './MessageList'
import type { Message } from '../../core/domain/types'

const chief = { kind: 'helper' as const, name: 'Chief', role: 'Chief of Staff', area: 'brand' as const }

/** An agent message whose action_card carries a backend proposalId. */
function actionMessage(): Message {
  return {
    id: 'm1',
    sessionId: 't1',
    author: chief,
    content: 'Ready to open the PR.',
    createdAt: new Date().toISOString(),
    blocks: [{ type: 'action_card', title: 'Open a pull request', actionLabel: 'Open PR', proposalId: 'prop-1' }],
  }
}

describe('MessageList — interactive blocks', () => {
  test('deciding an action_card forwards the block and decision to onBlockDecide', async () => {
    const user = userEvent.setup()
    const onBlockDecide = vi.fn()
    const messages = [actionMessage()]
    render(<MessageList messages={messages} onBlockDecide={onBlockDecide} />)
    await user.click(screen.getByRole('button', { name: 'Open PR' }))
    expect(onBlockDecide).toHaveBeenCalledWith(messages[0].blocks![0], 'approve')
  })
})
