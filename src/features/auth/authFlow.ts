/**
 * authFlow — a tiny store that carries the in-progress email across the
 * multi-step auth transitions (sign-in → check-email / two-step, sign-up →
 * confirm-email).  Emailed-link flows (reset, invite) carry their token in the
 * URL instead and don't need this.
 */
import { create } from 'zustand'

interface AuthFlowState {
  /** The email the current code/2FA step is for. */
  email: string | null
  setEmail: (email: string | null) => void
}

export const useAuthFlow = create<AuthFlowState>((set) => ({
  email: null,
  setEmail: (email) => set({ email }),
}))

/** Read a param from the current URL query string (emailed links). */
export function searchParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}
