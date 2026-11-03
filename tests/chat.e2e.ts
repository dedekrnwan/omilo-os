/**
 * Module: Chat — starting a chat, sending a message, area filtering.
 * UI-level flows: the user's own message renders deterministically; we don't
 * assert on an AI reply (that needs a configured harness/credits).
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('chat', { tags: ['chat'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/')
  })

  test('starts a new chat and the typed message appears in the thread', async ({ agent, screen }) => {
    await agent.act('start a new chat with Chief')
    await agent.act('type and send the message {msg}', {
      params: { msg: 'E2E: give me a one-line status of this week' },
    })
    await expect(screen.getByText('E2E: give me a one-line status of this week')).toBeVisible()
  })

  test('the composer clears after sending', async ({ agent, screen }) => {
    await agent.act('start a new chat')
    await agent.act('send the message {msg}', { params: { msg: 'E2E ping one' } })
    await expect(screen.getByText('E2E ping one')).toBeVisible()
    // The message input should be empty and ready for the next message.
    await agent.assert('the message composer is empty and ready for a new message')
  })

  test('filtering by an Area scopes the sidebar', async ({ agent }) => {
    await agent.act('open the Area filter and pick a specific area (not "All")')
    await agent.assert('the sidebar now reflects the selected area rather than all areas')
  })
})
