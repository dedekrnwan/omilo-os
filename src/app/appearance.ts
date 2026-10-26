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
  areas: Record<string, Look>
  folders: Record<string, Look>
  setLook(kind: 'companies' | 'areas' | 'folders', id: string, look: Look): void
  resetLook(kind: 'companies' | 'areas' | 'folders', id: string): void
}

/**
 * Custom logos and icons (mock backend: kept in this browser).
 * Real persistence will move behind a repo port when the API lands.
 */
export const useAppearance = create<AppearanceState>()(
  persist(
    (set) => ({
      companies: {},
      areas: {},
      folders: {},
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
      partialize: (s) => ({ companies: s.companies, areas: s.areas, folders: s.folders }),
    },
  ),
)
