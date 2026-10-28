import { create } from 'zustand'
import type { Flow } from '../../../core/domain/types'

/**
 * FlowCard is the live Flow shape enriched with display-only fields that
 * the backend does not provide:
 *   - bars:  sparkline data  (gap: not in backend Flow; defaulted to [])
 *   - from:  chain icon id   (gap: not in backend Flow; defaulted to 'clock')
 *   - to:    chain icon id   (gap: not in backend Flow; defaulted to 'message-circle')
 */
export type FlowCard = Flow & {
  bars: number[]
  from: string
  to: string
}

/** Convert a live Flow from the repo into a FlowCard for display. */
export function flowToCard(f: Flow): FlowCard {
  return { ...f, bars: [], from: 'clock', to: 'message-circle' }
}

interface BoardState {
  /** Flows removed from the board */
  deleted: string[]
  /** Copies made with Duplicate */
  copies: FlowCard[]
  remove(id: string): void
  restore(id: string): void
  duplicate(card: FlowCard): FlowCard
}

let seq = 0

/** Board-level changes made from a flow's menu (mock backend: this tab only). */
export const useFlowBoard = create<BoardState>((set) => ({
  deleted: [],
  copies: [],
  remove: (id) => set((s) => ({ deleted: [...s.deleted, id] })),
  restore: (id) => set((s) => ({ deleted: s.deleted.filter((d) => d !== id) })),
  duplicate: (card) => {
    const copy: FlowCard = {
      ...card,
      id: `${card.id}-copy-${++seq}`,
      title: `${card.title} (copy)`,
      enabled: false,
      status: 'Not run yet',
    }
    set((s) => ({ copies: [...s.copies, copy] }))
    return copy
  },
}))
