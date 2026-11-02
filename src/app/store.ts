import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Mode = 'chat' | 'office'

/**
 * How much helpers may do on their own, workspace-wide.
 *
 * NOTE: this is the real `company.autonomy_default` column, NOT UI store state.
 * It lives on the session company and is read/written via `useAutonomy()` so the
 * Rail popover and the Control Panel stay in sync. (It used to be duplicated in
 * this store, which drifted — see useAutonomy.ts.)
 */
export type Autonomy = 'strict' | 'ask' | 'yolo'

/**
 * Home route of each mode. Mode is NOT encoded in the URL — it's persisted
 * client state. This map is only consulted when a mode change wants to land
 * on that mode's primary surface (the Rail toggle, company switch).
 */
export const MODE_HOME: Record<Mode, string> = { chat: '/chat', office: '/inbox' }

export interface UIState {
  /** Current view mode — persisted, never derived from the URL. */
  mode: Mode
  companyId: string
  /** Selected Area filter (a channel id), or null for "All areas". Shared across both modes. */
  areaId: string | null
  /** User opted into desktop / browser push. The OS permission is the real gate. */
  pushEnabled: boolean
  setMode(mode: Mode): void
  setCompany(id: string): void
  setArea(id: string | null): void
  setPushEnabled(on: boolean): void
}

/**
 * UI store. `mode`, `companyId` and `areaId` persist to localStorage so a
 * reload keeps your view mode and filters without putting any of it in the URL
 * (every route is mode-neutral).
 */
export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      mode: 'chat',
      companyId: 'sahabat-warga',
      areaId: null,
      pushEnabled: false,

      setMode(mode: Mode) {
        if (get().mode !== mode) set({ mode })
      },
      setCompany(id: string) {
        if (get().companyId !== id) set({ companyId: id })
      },
      setArea(id: string | null) {
        if (get().areaId !== id) set({ areaId: id })
      },
      setPushEnabled(on: boolean) {
        if (get().pushEnabled !== on) set({ pushEnabled: on })
      },
    }),
    {
      name: 'omilo-ui',
      partialize: (s) => ({ mode: s.mode, companyId: s.companyId, areaId: s.areaId, pushEnabled: s.pushEnabled }),
    },
  ),
)
