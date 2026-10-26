import { create } from 'zustand'
import { OFFICE_FLOWS } from './data'

export type FlowCard = (typeof OFFICE_FLOWS)[number]

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
    const copy: FlowCard = { ...card, id: `${card.id}-copy-${++seq}`, title: `${card.title} (copy)`, enabled: false, status: 'Not run yet' }
    set((s) => ({ copies: [...s.copies, copy] }))
    return copy
  },
}))
