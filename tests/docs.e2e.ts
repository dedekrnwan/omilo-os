/**
 * Module: Docs / Knowledge — create a doc, edit its title and body, persist.
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect } from 'e2e'

describe('docs', { tags: ['docs'], session: 'demo' }, () => {
  beforeEach(async ({ app }) => {
    await app.open('/docs')
  })

  test('creates a doc and it appears', async ({ agent, screen }) => {
    await agent.act('create a new document titled {title}', { params: { title: 'E2E doc — onboarding notes' } })
    await expect(screen.getByText('E2E doc — onboarding notes')).toBeVisible()
  })

  test('edits a doc title and it persists after reopening', async ({ app, agent, screen }) => {
    await agent.act('create a new document titled {title}', { params: { title: 'E2E doc to rename' } })
    await agent.act('rename the document to {title} and save', { params: { title: 'E2E doc renamed' } })
    await app.open('/docs')
    await expect(screen.getByText('E2E doc renamed')).toBeVisible()
  })

  test('writes body content into a doc', async ({ agent }) => {
    await agent.act('create a new document titled {title}', { params: { title: 'E2E doc with body' } })
    await agent.act('type {body} into the document body', {
      params: { body: 'E2E body paragraph for the onboarding guide.' },
    })
    await agent.assert('the document body contains the text that was typed')
  })
})
