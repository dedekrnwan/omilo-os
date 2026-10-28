/**
 * GoogleCallbackPage — /auth/callback
 *
 * Handles the redirect back from Google OAuth via the backend.
 *
 * Web:     backend redirects to `{frontendBase}/auth/callback#token=<jwt>`
 *          → read token from window.location.hash
 *
 * Desktop: backend redirects to `omilo://auth/callback?token=<jwt>`
 *          → Tauri deep-link fires; the platform deepLinks.onOpen listener routes
 *            the URL here; token is carried in the search params via navigation state.
 *            As a fallback, also check window.location.search for `?token=`.
 *
 * On success:
 *   1. platform.tokenStorage.setToken(token)
 *   2. useSession.getState().hydrate() — re-fetches /me to populate the session
 *   3. history.replaceState to strip the token from the URL
 *   4. navigate to MODE_HOME
 *
 * On failure (no token):
 *   navigate to /auth/sign-in
 */

import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { platform } from '../../platform'
import { useSession } from '../../app/session'
import { MODE_HOME, useUIStore } from '../../app/store'

export function GoogleCallbackPage() {
  const navigate = useNavigate()

  useEffect(() => {
    void handleCallback()

    async function handleCallback() {
      const token = extractToken()

      if (!token) {
        await navigate({ to: '/auth/sign-in' })
        return
      }

      // Store the token.
      await platform.tokenStorage.setToken(token)

      // Strip the token from the URL immediately (before hydrate so it never shows in history).
      if (typeof window !== 'undefined') {
        history.replaceState(null, '', window.location.pathname)
      }

      // Hydrate the session — calls /me to populate user/company/companies.
      await useSession.getState().hydrate()

      // Navigate home.
      const home = MODE_HOME[useUIStore.getState().mode]
      await navigate({ to: home })
    }
  }, [navigate])

  return null
}

/**
 * Extract the JWT token from the current URL.
 *
 * Web:     `#token=<jwt>` (URL fragment)
 * Desktop: `?token=<jwt>` (query string, written by the router when it receives
 *          the deep-link and navigates to /auth/callback)
 */
function extractToken(): string | null {
  if (typeof window === 'undefined') return null

  // 1. URL fragment — standard web redirect: `#token=<jwt>`
  const hash = window.location.hash
  if (hash.startsWith('#')) {
    const params = new URLSearchParams(hash.slice(1))
    const token = params.get('token')
    if (token) return token
  }

  // 2. Query string — desktop deep-link forwarded via router: `?token=<jwt>`
  const search = new URLSearchParams(window.location.search)
  const token = search.get('token')
  if (token) return token

  return null
}
