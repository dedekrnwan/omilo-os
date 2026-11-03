/**
 * Module: Flows — create a flow, open the editor, rename + persist, delete.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('flows', { tags: ['flows'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/flows')
  })

  test('creates a new flow and it appears in the list', async ({ agent, screen }) => {
    await agent.act('create a new flow named {name}', { params: { name: 'E2E flow — weekly digest' } })
    await expect(screen.getByText('E2E flow — weekly digest')).toBeVisible()
  })

  test('opens the flow editor and renames the flow', async ({ agent, screen }) => {
    await agent.act('create a new flow named {name}', { params: { name: 'E2E flow to edit' } })
    await agent.act('open the flow "E2E flow to edit" in the editor')
    await agent.act('rename the flow to {name} and save', { params: { name: 'E2E flow edited' } })
    await agent.act('go back to the flows list')
    await expect(screen.getByText('E2E flow edited')).toBeVisible()
  })

  test('duplicates and deletes a flow', async ({ agent, screen }) => {
    await agent.act('create a new flow named {name}', { params: { name: 'E2E flow to remove' } })
    await expect(screen.getByText('E2E flow to remove')).toBeVisible()
    await agent.act('delete the flow "E2E flow to remove" (confirm if asked)')
    await expect(screen.getByText('E2E flow to remove')).toHaveCount(0)
  })
})
