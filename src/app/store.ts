import { create } from 'zustand'

export type Mode = 'chat' | 'office'

export interface UIState {
  mode: Mode
  companyId: string
  lastPath: Record<Mode, string>
  defaultPath: Record<Mode, string>
  rememberPath(mode: Mode, path: string): void
  setMode(mode: Mode): void
  setCompany(id: string): void
  toggleTarget(): { mode: Mode; path: string }
  /** Home page of the mode currently in view. */
  homePath(): string
}

export const useUIStore = create<UIState>((set, get) => ({
  mode: 'chat',
  companyId: 'sahabat-warga',
  lastPath: { chat: '', office: '' },
  defaultPath: { chat: '/chat', office: '/office/inbox' },

  rememberPath(mode: Mode, path: string) {
    set(state => ({ lastPath: { ...state.lastPath, [mode]: path } }))
  },

  setMode(mode: Mode) {
    if (get().mode !== mode) set({ mode })
  },

  setCompany(id: string) {
    if (get().companyId !== id) set({ companyId: id })
  },

  toggleTarget() {
    const state = get()
    const otherMode: Mode = state.mode === 'chat' ? 'office' : 'chat'
    const path = state.lastPath[otherMode] || state.defaultPath[otherMode]
    set({ mode: otherMode })
    return { mode: otherMode, path }
  },

  homePath() {
    const state = get()
    return state.defaultPath[state.mode]
  },
}))
