import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { HelperArea } from '../core/domain/types'
import type { MascotProp, MascotShape } from '../ui/ds/Mascot'

/**
 * A helper's customised look from its Profile tab (team/tabs/ProfileTab).
 * Keyed by HelperArea so every `<Mascot area={…}/>` across the app reflects it.
 * Unset fields fall back to the helper's default colour / shape / prop.
 */
export interface MascotLook {
  color?: string
  shape?: MascotShape
  prop?: MascotProp
}

interface MascotLookState {
  looks: Partial<Record<HelperArea, MascotLook>>
  setLook(area: HelperArea, look: MascotLook): void
  resetLook(area: HelperArea): void
}

/**
 * Per-helper mascot looks (mock backend: kept in this browser).
 * Real persistence will move behind a repo port when the API lands.
 */
export const useMascotLook = create<MascotLookState>()(
  persist(
    (set) => ({
      looks: {},
      setLook(area, look) {
        set((s) => ({ looks: { ...s.looks, [area]: { ...s.looks[area], ...look } } }))
      },
      resetLook(area) {
        set((s) => {
          const next = { ...s.looks }
          delete next[area]
          return { looks: next }
        })
      },
    }),
    {
      name: 'omilo.mascotLook',
      storage: createJSONStorage(() => {
        try {
          return localStorage
        } catch {
          return sessionStorage
        }
      }),
      partialize: (s) => ({ looks: s.looks }),
    },
  ),
)
