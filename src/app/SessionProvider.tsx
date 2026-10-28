/**
 * SessionProvider.tsx — calls hydrate() once on mount.
 *
 * While status === 'loading' renders nothing (null) to avoid flashing
 * unauthenticated UI. Children are rendered as soon as status resolves.
 */

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useSession } from './session'

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const { hydrate, status } = useSession()

  useEffect(() => {
    void hydrate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'loading') {
    // Minimal splash — renders nothing while hydration is in progress.
    return null
  }

  return <>{children}</>
}
