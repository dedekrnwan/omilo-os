/**
 * Module: Authentication — sign-in validation, sign-out, password-reset entry.
 * These run WITHOUT the demo session (they test the signed-out surface).
 */
import { beforeEach, describe, test } from '@e2e-dev/web'
import { expect, credentials } from 'e2e'

describe('auth', { tags: ['auth'] }, () => {
  beforeEach(async ({ app }) => {
    await app.clearState()
    await app.open('/auth/sign-in')
  })

  test('rejects wrong credentials with an inline error', async ({ screen }) => {
    const demo = credentials.user('demo')
    await screen.getByLabel('Work email').fill(demo.username)
    await screen.getByLabel('Password').fill('totally-wrong-password')
    await screen.getByRole('button', 'Sign in').tap()

    // Stays on the sign-in page and shows an error alert.
    await expect(screen.getByRole('alert')).toBeVisible()
    await expect(screen.getByRole('button', 'Sign in')).toBeVisible()
  })

  test('signs in with the demo account and reaches the app', async ({ screen, agent }) => {
    const demo = credentials.user('demo')
    await screen.getByLabel('Work email').fill(demo.username)
    await screen.getByLabel('Password').fill(demo.password)
    await screen.getByRole('button', 'Sign in').tap()

    await expect(screen.getByRole('button', 'Sign in')).toHaveCount(0)
    await agent.assert('the main app is shown (a sidebar or workspace is visible), not a sign-in form')
  })

  test('forgot-password takes you to the reset request screen', async ({ screen, agent }) => {
    await agent.act('open the "Forgot password?" flow')
    await expect(screen.getByRole('button', 'Send reset link')).toBeVisible()
  })

  test('the email-a-code link needs an email first', async ({ screen }) => {
    await screen.getByRole('button', 'Email me a sign-in code instead').tap()
    // With no email entered, it surfaces guidance rather than navigating.
    await expect(screen.getByRole('alert')).toBeVisible()
  })

  test('sign out returns to the sign-in page', { session: 'demo' }, async ({ app, agent, screen }) => {
    await app.open('/')
    await agent.act('sign out of Omilo (open account or settings if needed)')
    await expect(screen.getByRole('button', 'Sign in')).toBeVisible()
  })
})
