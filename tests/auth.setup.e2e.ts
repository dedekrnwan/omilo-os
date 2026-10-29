/**
 * Signs in once as the seeded demo account and saves the session as `demo`.
 * Every module test declares { session: 'demo' } to start already signed in.
 * Deterministic (no agent.* steps) so it's free and reliable.
 */
import { test } from '@e2e-dev/web'
import { expect, credentials } from 'e2e'

test.setup('sign in as demo', { sessions: ['demo'] }, async ({ app, screen, session }) => {
  const demo = credentials.user('demo')

  await app.open('/auth/sign-in')
  await screen.getByLabel('Work email').fill(demo.username)
  await screen.getByLabel('Password').fill(demo.password)
  await screen.getByRole('button', 'Sign in').tap()

  // Wait for the AUTHENTICATED app shell before saving — not just the sign-in
  // button disappearing. That button also vanishes the instant its label flips
  // to "Signing in…", so asserting only its absence can save a half-signed-in
  // (token-less) session, after which every module test lands back on the
  // sign-in wall. The Rail "User menu" only renders once the session is live.
  await expect(screen.getByRole('button', 'User menu')).toBeVisible()

  await session.save('demo')
})
