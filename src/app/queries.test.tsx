import { describe, test, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from './ReposProvider'
import { useChannels } from './queries'
import { channels } from '../adapters/mock/fixtures'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ReposProvider>{children}</ReposProvider>
      </QueryClientProvider>
    )
  }
}

describe('useChannels', () => {
  test('returns mock channels from the default ReposProvider', async () => {
    const { result } = renderHook(() => useChannels(), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual(channels)
  })
})
