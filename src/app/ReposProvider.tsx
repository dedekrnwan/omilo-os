import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Repos } from '../core/ports/repos'
import { createMockRepos } from '../adapters/mock/mockRepos'
import { createHttpRepos } from '../adapters/http/httpRepos'

/** Simple token seam — sign-in UI is a later task; reads from localStorage for now. */
function getToken(): string | null {
  return localStorage.getItem('omilo_token')
}

function buildDefaultRepos(): Repos {
  if (import.meta.env.VITE_USE_HTTP === '1') {
    const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
    return createHttpRepos(baseUrl, getToken)
  }
  return createMockRepos()
}

const ReposContext = createContext<Repos>(buildDefaultRepos())

interface ReposProviderProps {
  repos?: Repos
  children: ReactNode
}

export function ReposProvider({ repos, children }: ReposProviderProps) {
  const value = useMemo(() => repos ?? buildDefaultRepos(), [repos])
  return <ReposContext.Provider value={value}>{children}</ReposContext.Provider>
}

export function useRepos(): Repos {
  return useContext(ReposContext)
}
