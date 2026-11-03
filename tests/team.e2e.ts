/**
 * Module: Team — the helper roster and a helper's detail view.
 */
import { describe, test } from '@e2e-dev/web'

describe('team', { tags: ['team'], session: 'demo' }, () => {
  test('the team roster lists helpers', async ({ agent }) => {
    await agent.act('open the Team (the roster of helpers / AI staff)')
    await agent.assert('a roster of helpers is shown (e.g. Chief of Staff and area helpers)')
  })

  test('opening a helper shows its detail', async ({ agent }) => {
    await agent.act('open the Team and then open the detail for one helper')
    await agent.assert("the helper's detail is shown (role, status, or job description)")
  })
})
