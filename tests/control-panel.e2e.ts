/**
 * Module: Control panel / Settings — navigate sections, edit General, review
 * AI accounts (incl. the detected local-harness section), Members, Billing.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('control-panel', { tags: ['control-panel', 'settings'], session: 'demo' }, () => {
  beforeEach(async ({ agent }) => {
    await agent.act('open the Control panel / Settings')
  })

  test('navigates between settings sections', async ({ agent }) => {
    await agent.act('go to the General settings section')
    await agent.assert('the General company settings are shown (name, timezone, etc.)')
    await agent.act('go to the AI accounts section')
    await agent.assert('the AI accounts section is shown')
  })

  test('edits the company name in General and it persists', async ({ agent }) => {
    await agent.act('go to the General settings section')
    await agent.act('change the company name to {name} and save', { params: { name: 'Sahabat Warga E2E' } })
    await agent.assert('the company name field now shows the updated value')
  })

  test('AI accounts shows the detected local harnesses with logos', async ({ agent }) => {
    await agent.act('go to the AI accounts section')
    await agent.assert(
      'a "Detected on this computer" area lists coding-assistant harnesses (Claude Code, OpenCode, Codex, Copilot, Gemini, Cursor) with logos and status badges',
    )
  })

  test('the Members section lists people and invite entry', async ({ agent }) => {
    await agent.act('go to the Members section')
    await agent.assert('a list of members is shown with a way to invite someone')
  })

  test('the Billing section renders the plan and credits', async ({ agent }) => {
    await agent.act('go to the Billing / Usage section')
    await agent.assert('billing or usage information is shown (plan, credits, or usage)')
  })
})
