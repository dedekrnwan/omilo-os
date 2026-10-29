import { create } from 'zustand'
import type { Flow } from '../../../core/domain/types'
import type { FlowIconId } from '../../../ui/ds/FlowChain'
import { chainIcon } from './editor/graphMap'
import { formatRelative } from './runsAdapter'

/**
 * FlowCard is the live Flow plus the display fields the board needs, all
 * derived from GET /v1/flows: `runs7d` (sparkline), `apps` (from → to chain
 * icons), `lastRun` (status line).
 */
export type FlowCard = Flow & {
  bars: number[]
  from: FlowIconId
  to: FlowIconId
  /** "12m ago" / "Not run yet" / "Waiting for approval". */
  statusLabel: string
}

/** Scale daily run counts to the sparkline's 0–5 range (0 stays 0). */
export function sparkBars(days: number[] | undefined): number[] {
  const d = days ?? []
  const max = Math.max(0, ...d)
  return d.map((v) => (max > 0 && v > 0 ? Math.max(1, Math.round((v / max) * 5)) : 0))
}

/** Convert a live Flow from the repo into a FlowCard for display. */
export function flowToCard(f: Flow, now = Date.now()): FlowCard {
  const apps = f.apps ?? []
  const from = chainIcon(apps[0] ?? (f.triggerKind === 'schedule' ? 'clock' : undefined), 'clock') as FlowIconId
  const to = chainIcon(apps.length > 1 ? apps[apps.length - 1] : undefined, 'message-circle') as FlowIconId
  const statusLabel =
    f.publishState === 'pending'
      ? 'Waiting for approval'
      : f.lastRun?.status === 'needs_you'
        ? 'waiting for you'
        : f.lastRun
          ? formatRelative(f.lastRun.startedAt, now)
          : f.status === 'draft'
            ? 'Draft · not run yet'
            : 'Not run yet'
  return { ...f, bars: sparkBars(f.runs7d), from, to, statusLabel, count: f.aiSteps ?? f.count }
}

interface BoardState {
  /** Flows hidden while their delete is pending (Undo window). */
  deleted: string[]
  /** Hide now; really delete after the Undo window unless restored. */
  scheduleDelete(id: string, commit: () => void): void
  restore(id: string): void
}

/** Undo window — a touch longer than the Undo toast (6s). */
export const DELETE_DELAY_MS = 6500
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Board-level state: pending deletes (server delete waits for the Undo window). */
export const useFlowBoard = create<BoardState>((set) => ({
  deleted: [],
  scheduleDelete: (id, commit) => {
    set((s) => ({ deleted: [...s.deleted, id] }))
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        commit()
      }, DELETE_DELAY_MS),
    )
  },
  restore: (id) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    set((s) => ({ deleted: s.deleted.filter((d) => d !== id) }))
  },
}))

/** A linear draft graph (trigger → AI step(s) → app) in the API node shape. */
export function draftGraph(
  title: string,
  steps: string[],
  from: string,
  to: string,
): { nodes: unknown[]; edges: unknown[] } {
  const nodes: { id: string; kind: string; label: string; sublabel: string; x: number; y: number; config: Record<string, unknown> }[] = [
    { id: 'trigger', kind: 'trigger', label: title, sublabel: '', x: 277, y: 36, config: { ui: { kindLabel: 'TRIGGER', app: from } } },
  ]
  let y = 176
  steps.forEach((label, i) => {
    nodes.push({ id: `step-${i + 1}`, kind: 'ai_step', label, sublabel: '', x: 277, y, config: { ui: { kindLabel: 'AI STEP', source: 'Chief', helper: 'brand' }, brief: label } })
    y += 140
  })
  nodes.push({ id: 'send', kind: to === 'user-check' ? 'approval' : 'connector', label: to === 'user-check' ? 'You approve' : 'Send the result', sublabel: '', x: 277, y, config: { ui: { kindLabel: to === 'user-check' ? 'APPROVAL' : 'CONNECTOR', app: to } } })
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, from: nodes[i].id, to: n.id }))
  return { nodes, edges }
}
