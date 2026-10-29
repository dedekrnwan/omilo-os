import { describe, test, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ReposProvider } from './ReposProvider'
import { CommandsProvider } from './CommandsProvider'
import {
  useChannels,
  useCreateGoal,
  useUpdateRoutine,
  useCompanySettings,
} from './queries'
import { channels } from '../adapters/mock/fixtures'
import { createMockCommands } from '../adapters/mock/mockCommands'

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

/** Wrapper that injects a spy-able Commands client + exposes the QueryClient. */
function makeCommandsWrapper(commands: ReturnType<typeof createMockCommands>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ReposProvider>
        <CommandsProvider commands={commands}>{children}</CommandsProvider>
      </ReposProvider>
    </QueryClientProvider>
  )
  return { Wrapper, invalidateSpy }
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

describe('P2 mutation hooks', () => {
  test('useCreateGoal calls createGoal and invalidates ["goals"]', async () => {
    const commands = createMockCommands()
    const createSpy = vi.spyOn(commands, 'createGoal')
    const { Wrapper, invalidateSpy } = makeCommandsWrapper(commands)

    const { result } = renderHook(() => useCreateGoal(), { wrapper: Wrapper })
    result.current.mutate({ channelId: 'ch-general', title: 'Goal', target: 'Q4' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(createSpy).toHaveBeenCalledWith({ channelId: 'ch-general', title: 'Goal', target: 'Q4' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['goals'] })
  })

  test('useUpdateRoutine invalidates both ["routines"] and ["routine", id]', async () => {
    const commands = createMockCommands()
    const { Wrapper, invalidateSpy } = makeCommandsWrapper(commands)

    const { result } = renderHook(() => useUpdateRoutine(), { wrapper: Wrapper })
    result.current.mutate({ id: 'rtn-morning-brief', input: { paused: true } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['routines'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['routine', 'rtn-morning-brief'] })
  })

  test('useCompanySettings reads from the Commands port', async () => {
    const commands = createMockCommands()
    const getSpy = vi.spyOn(commands, 'getCompanySettings')
    const { Wrapper } = makeCommandsWrapper(commands)

    const { result } = renderHook(() => useCompanySettings(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(getSpy).toHaveBeenCalled()
    expect(result.current.data).toBeDefined()
  })
})
