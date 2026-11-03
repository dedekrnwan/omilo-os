/**
 * Module: Goals — create, edit, and delete a goal on the Goals board.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('goals', { tags: ['goals'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/goals')
  })

  test('creates a goal and it appears on the board', async ({ agent, screen }) => {
    await agent.act('create a new goal titled {title}', {
      params: { title: 'E2E goal — ship the release notes' },
    })
    await expect(screen.getByText('E2E goal — ship the release notes')).toBeVisible()
  })

  test('edits a goal title', async ({ agent, screen }) => {
    await agent.act('create a new goal titled {title}', { params: { title: 'E2E goal to rename' } })
    await expect(screen.getByText('E2E goal to rename')).toBeVisible()
    await agent.act('rename the goal "E2E goal to rename" to {title}', {
      params: { title: 'E2E goal renamed' },
    })
    await expect(screen.getByText('E2E goal renamed')).toBeVisible()
  })

  test('deletes a goal', async ({ agent, screen }) => {
    await agent.act('create a new goal titled {title}', { params: { title: 'E2E goal to delete' } })
    await expect(screen.getByText('E2E goal to delete')).toBeVisible()
    await agent.act('delete the goal "E2E goal to delete" (confirm if asked)')
    await expect(screen.getByText('E2E goal to delete')).toHaveCount(0)
  })
})
