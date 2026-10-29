import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { Commands } from '../adapters/http/commands'
import { createCommands } from '../adapters/http/commands'
import { createMockCommands } from '../adapters/mock/mockCommands'
import { platform } from '../platform'

/**
 * Resolve the default Commands client.
 *
 * HTTP mode (VITE_USE_HTTP=1) → real backend; otherwise the in-memory mock
 * client so every wired CTA still works offline (mock-mode parity).
 */
function buildDefaultCommands(): Commands {
  if (import.meta.env.VITE_USE_HTTP === '1') {
    const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
    return createCommands(baseUrl, () => platform.tokenStorage.getToken())
  }
  return createMockCommands()
}

const CommandsContext = createContext<Commands>(buildDefaultCommands())

interface CommandsProviderProps {
  commands?: Commands
  children: ReactNode
}

export function CommandsProvider({ commands, children }: CommandsProviderProps) {
  const value = useMemo(() => commands ?? buildDefaultCommands(), [commands])
  return <CommandsContext.Provider value={value}>{children}</CommandsContext.Provider>
}

export function useCommands(): Commands {
  return useContext(CommandsContext)
}
