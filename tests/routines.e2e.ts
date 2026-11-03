/**
 * Module: Routines — create a scheduled routine, inspect it, pause/skip, delete.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('routines', { tags: ['routines'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/routines')
  })

  test('creates a routine and it appears in the list', async ({ agent, screen }) => {
    await agent.act('create a new routine named {name} that runs daily', {
      params: { name: 'E2E routine — morning digest' },
    })
    await expect(screen.getByText('E2E routine — morning digest')).toBeVisible()
  })

  test('opens a routine and pauses it', async ({ agent }) => {
    await agent.act('create a new routine named {name}', { params: { name: 'E2E routine to pause' } })
    await agent.act('open the routine "E2E routine to pause" and pause it')
    await agent.assert('the routine "E2E routine to pause" is shown as paused')
  })

  test('deletes a routine', async ({ agent, screen }) => {
    await agent.act('create a new routine named {name}', { params: { name: 'E2E routine to delete' } })
    await expect(screen.getByText('E2E routine to delete')).toBeVisible()
    await agent.act('delete the routine "E2E routine to delete" (confirm if asked)')
    await expect(screen.getByText('E2E routine to delete')).toHaveCount(0)
  })
})
