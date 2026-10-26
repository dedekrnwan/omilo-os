import { useEffect } from 'react'
import { create } from 'zustand'

/** Surfaces with their own bottom-right controls can ask the Chief bubble to step aside. */
export const useFabHidden = create<{ count: number; add(d: number): void }>((set) => ({
  count: 0,
  add: (d) => set((s) => ({ count: Math.max(0, s.count + d) })),
}))

export function useHideChiefFab(hide = true) {
  useEffect(() => {
    if (!hide) return
    useFabHidden.getState().add(1)
    return () => useFabHidden.getState().add(-1)
  }, [hide])
}
