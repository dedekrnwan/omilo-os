/**
 * Module: Analytics — the board renders stats/charts and filters by Area.
 * Read-only module, so these are render + interaction checks.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('analytics', { tags: ['analytics'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/analytics')
  })

  test('the analytics board renders its summary', async ({ agent }) => {
    await agent.assert('the Analytics page shows summary stats and/or charts (not an error or blank page)')
  })

  test('filtering by an Area updates the figures', async ({ agent }) => {
    await agent.act('change the Area filter to a specific area (not "All")')
    await agent.assert('the analytics figures reflect the selected area')
  })
})
