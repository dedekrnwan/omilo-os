/**
 * useAuth — the consumer-facing auth API for feature code (sign-in/up/out pages,
 * company switcher, onboarding). Wraps the auth adapter + the `useSession` store
 * actions so feature components never construct the adapter themselves.
 *
 * `getAuthAdapter()` builds the HTTP adapter the same way the session store does
 * (baseUrl from `import.meta.env.VITE_API_URL`, platform token storage).
 *
 * `isMockMode()` mirrors the session store's gate: when true the app runs on the
 * mock repos with a synthetic session and NO backend — auth screens should treat
 * submit as a local navigation, not a network call.
 */

import { useMemo } from 'react'
import { createAuthAdapter } from '../adapters/http/auth'
import type { AuthAdapter } from '../adapters/http/auth'
import { platform } from '../platform'
import { useSession } from './session'

export function isMockMode(): boolean {
  return import.meta.env.VITE_USE_HTTP !== '1'
}

export function getAuthAdapter(): AuthAdapter {
  const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
  return createAuthAdapter(baseUrl, platform.tokenStorage)
}

export interface UseAuth {
  adapter: AuthAdapter
  applySignIn: ReturnType<typeof useSession.getState>['applySignIn']
  signOut: ReturnType<typeof useSession.getState>['signOut']
  mock: boolean
}

/** Hook: the auth adapter + session actions for feature components. */
export function useAuth(): UseAuth {
  const applySignIn = useSession((s) => s.applySignIn)
  const signOut = useSession((s) => s.signOut)
  const adapter = useMemo(() => getAuthAdapter(), [])
  return { adapter, applySignIn, signOut, mock: isMockMode() }
}
