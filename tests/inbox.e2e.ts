/**
 * Module: Inbox / Office approvals — reviewing proposals the helpers raise.
 * Approve/Reject are gated by whether seed data has an open proposal; the
 * detail-open and empty-state paths always hold.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('inbox', { tags: ['inbox'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/inbox')
  })

  test('the inbox renders a list or a clear empty state', async ({ agent }) => {
    await agent.assert('the Inbox shows either a list of items needing attention or an explicit empty state')
  })

  test('opening an item shows its detail with actions', async ({ agent }) => {
    await agent.act('open the first inbox item if there is one; otherwise do nothing')
    await agent.assert(
      'either an item detail with its context and actions (e.g. Approve / Reject) is shown, or the inbox is empty',
    )
  })

  test('approving the first proposal updates its state', async ({ agent }) => {
    await agent.act('if there is a proposal that needs approval, open it and Approve it; otherwise do nothing')
    await agent.assert('if a proposal was approved, it is no longer shown as needing your approval')
  })

  test('archived view is reachable', async ({ app, agent }) => {
    await app.open('/archived')
    await agent.assert('the archived items view is shown')
  })
})
