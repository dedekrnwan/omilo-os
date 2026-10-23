import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { Repos } from '../core/ports/repos'
import { createMockRepos } from '../adapters/mock/mockRepos'

const ReposContext = createContext<Repos>(createMockRepos())

interface ReposProviderProps {
  repos?: Repos
  children: ReactNode
}

export function ReposProvider({ repos, children }: ReposProviderProps) {
  const value = repos ?? createMockRepos()
  return <ReposContext.Provider value={value}>{children}</ReposContext.Provider>
}

export function useRepos(): Repos {
  return useContext(ReposContext)
}
