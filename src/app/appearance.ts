import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/** What a person chose for an area, a folder or a company. Unset fields fall back to the default look. */
export interface Look {
  /** lucide icon name from `ui/ds/iconCatalog` */
  icon?: string
  /** hex colour */
  color?: string
  /** Company only: uploaded logo as a data URL */
  image?: string
  /** Company only: the letter(s) on the tile */
  initial?: string
}

interface AppearanceState {
  companies: Record<string, Look>
  setLook(kind: 'companies', id: string, look: Look): void
  resetLook(kind: 'companies', id: string): void
}

/**
 * Company logos chosen on the rail (kept in this browser).
 * Area and folder looks are saved on the area / folder through the API
 * (PATCH /v1/channels/{id}, PATCH /v1/folders/{id}) — see `ui/ds/looks`.
 */
export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      companies: {},
      setLook(kind, id, look) {
        set((s) => ({ [kind]: { ...s[kind], [id]: { ...s[kind][id], ...look } } }) as Partial<AppearanceState>)
      },
      resetLook(kind, id) {
        set((s) => {
          const next = { ...s[kind] }
          delete next[id]
          return { [kind]: next } as Partial<AppearanceState>
        })
      },
    }),
    {
      name: 'omilo.appearance',
      storage: createJSONStorage(() => {
        try {
          return localStorage
        } catch {
          return sessionStorage
        }
      }),
      partialize: (s) => ({ companies: s.companies }),
    },
  ),
)
