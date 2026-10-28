/**
 * SessionProvider.tsx — calls hydrate() once on mount.
 *
 * While status === 'loading' renders nothing (null) to avoid flashing
 * unauthenticated UI. Children are rendered as soon as status resolves.
 *
 * Also registers the Tauri deep-link listener for `omilo://auth/callback?token=`
 * so Google OAuth works on the desktop: the deep-link fires, we navigate to
 * /auth/callback?token=<jwt> which GoogleCallbackPage handles.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useSession } from './session'
import { platform } from '../platform'
import { router } from './router'

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const { hydrate, status } = useSession()

  useEffect(() => {
    void hydrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Register deep-link listener for desktop OAuth callback.
  useEffect(() => {
    const unlisten = platform.deepLinks.onOpen(({ route, params }) => {
      if (route === '/auth/callback' && params.token) {
        // Navigate the SPA to the callback page with the token in the query string.
        // GoogleCallbackPage reads it from window.location.search as a fallback.
        void router.navigate({ to: '/auth/callback', search: { token: params.token } as Record<string, string> })
      }
    })
    return unlisten
  }, [])

  if (status === 'loading') {
    // Minimal splash — renders nothing while hydration is in progress.
    return null
  }

  return <>{children}</>
}
