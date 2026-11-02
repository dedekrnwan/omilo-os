import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ApiError } from '../adapters/http/client'
import { CommandsProvider } from './CommandsProvider'
import { ReposProvider } from './ReposProvider'
import { SessionProvider } from './SessionProvider'
import { useSession } from './session'

/**
 * A 401 from any query or mutation means the session is no longer valid
 * (token expired or revoked). Retrying can't fix that, so sign out and send
 * the user to sign-in — once. Done globally here rather than per-call so no
 * screen can silently swallow an auth failure and render stale/empty state.
 * Best-effort probes that must NOT log the owner out (e.g. the onboarding
 * profile suggestion) call the API outside React Query and swallow their own
 * errors, so they never reach this handler.
 */
function handleApiError(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return
  if (useSession.getState().status !== 'anon') useSession.getState().signOut()
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
    window.location.assign('/auth/sign-in')
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleApiError }),
  mutationCache: new MutationCache({ onError: handleApiError }),
  defaultOptions: {
    queries: {
      // Never retry an auth failure — it won't succeed and only delays the redirect.
      retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 3,
    },
  },
})

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ReposProvider>
        <CommandsProvider>
          <SessionProvider>{children}</SessionProvider>
        </CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>
  )
}
