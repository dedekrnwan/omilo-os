/**
 * AuthGate — wraps the shell's content and enforces authentication.
 *
 * Rules:
 *   - Mock mode (VITE_USE_HTTP !== '1'): always render children — the guard
 *     is a complete no-op so mock/smoke tests are unaffected.
 *   - HTTP mode + status === 'anon': redirect based on deployment mode.
 *       mode === 'local'          → /onboarding  (no cloud identity)
 *       mode === 'hybrid'|'cloud' → /auth/sign-in
 *   - HTTP mode + status === 'authed': render children.
 *   - status === 'loading' cannot reach here (SessionProvider blocks render
 *     until status resolves), but is treated as "render children" safely.
 *
 * AuthGate is rendered INSIDE shellRoute (Shell.tsx) so it NEVER wraps
 * the /auth/* or /onboarding routes (they hang off rootRoute directly).
 * No redirect loop is possible.
 *
 * Hook call ordering: useSession is always called (Rules of Hooks). In mock
 * mode the store is always 'authed' anyway, so the redirect branch is never
 * reached — but calling the hook unconditionally keeps React happy.
 */

import type { ReactNode } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useSession } from './session'
import { isMockMode } from './useAuth'

interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  // Always call hooks unconditionally (Rules of Hooks).
  const status = useSession((s) => s.status)
  const mode = useSession((s) => s.mode)
  const company = useSession((s) => s.company)

  // Mock mode: synthetic always-authed session — guard is a complete no-op.
  // isMockMode() is a plain env read, not a hook, safe to use in a branch.
  if (isMockMode()) {
    return <>{children}</>
  }

  // HTTP mode: enforce auth.
  if (status === 'anon') {
    const to = mode === 'local' ? '/onboarding' : '/auth/sign-in'
    return <Navigate to={to} />
  }

  // HTTP mode + authed but not onboarded → force to /onboarding.
  // /onboarding is outside the shell so no redirect loop is possible.
  // company?.onboarded !== true catches: onboarded=false, undefined (old response), null.
  if (status === 'authed' && company?.onboarded !== true) {
    return <Navigate to="/onboarding" />
  }

  // status === 'authed' + onboarded (or 'loading' as safe fallback — SessionProvider
  // ensures 'loading' never reaches here in practice).
  return <>{children}</>
}
