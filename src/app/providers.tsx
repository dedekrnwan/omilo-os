import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
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
        <SessionProvider>{children}</SessionProvider>
      </ReposProvider>
    </QueryClientProvider>
  )
}
