import { create } from 'zustand'

export type Mode = 'chat' | 'office'

export interface UIState {
  mode: Mode
  lastPath: Record<Mode, string>
  defaultPath: Record<Mode, string>
  rememberPath(mode: Mode, path: string): void
  toggleTarget(): { mode: Mode; path: string }
}

export const useUIStore = create<UIState>((set, get) => ({
  mode: 'chat',
  lastPath: { chat: '', office: '' },
  defaultPath: { chat: '/chat', office: '/office/inbox' },

  rememberPath(mode: Mode, path: string) {
    set(state => ({ lastPath: { ...state.lastPath, [mode]: path } }))
  },

  toggleTarget() {
    const state = get()
    const otherMode: Mode = state.mode === 'chat' ? 'office' : 'chat'
    const path = state.lastPath[otherMode] || state.defaultPath[otherMode]
    set({ mode: otherMode })
    return { mode: otherMode, path }
  },
}))
