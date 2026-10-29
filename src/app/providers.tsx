import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CommandsProvider } from './CommandsProvider'
import { ReposProvider } from './ReposProvider'
import { SessionProvider } from './SessionProvider'

const queryClient = new QueryClient()

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
