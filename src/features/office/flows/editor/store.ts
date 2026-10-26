import { create } from 'zustand'
import {
  AI_DETAIL,
  DEFAULT_SETTINGS,
  IF_H,
  NODE_H,
  NODE_W,
  RUNS,
  TRIAGE_EDGES,
  TRIAGE_NODES,
  runDetail,
} from './data'
import type { AiStepDetail, FlowEdge, FlowNode, FlowRun, FlowSettings, PaletteItem, RunStep } from './data'

/** Vertical room one inserted step takes (node + gap). */
const ROW = 140

export interface Graph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface RunState extends FlowRun {
  detail: { title: string; chip: string; sub: string; steps: RunStep[] }
}

export type TestState = 'idle' | 'running' | 'done'

export interface FlowEditorState {
  graph: Graph
  past: Graph[]
  future: Graph[]
  selected: string | null
  ai: Record<string, AiStepDetail>
  enabled: boolean
  /** Unpublished edits on the canvas */
  dirty: boolean
  publishedAt: string | null
  test: TestState
  testStep: number
  runs: RunState[]
  settings: FlowSettings
  savedSettings: FlowSettings
  /** Draft (from Suggested) not turned on yet */
  draft: 'draft' | 'on' | 'discarded'
}

function makeFlow(): FlowEditorState {
  return {
    graph: { nodes: TRIAGE_NODES, edges: TRIAGE_EDGES },
    past: [],
    future: [],
    selected: 'read-logs',
    ai: AI_DETAIL,
    enabled: true,
    dirty: true,
    publishedAt: null,
    test: 'idle',
    testStep: 0,
    runs: RUNS.map((r) => ({ ...r, detail: structuredClone(runDetail(r)) })),
    settings: DEFAULT_SETTINGS,
    savedSettings: DEFAULT_SETTINGS,
    draft: 'draft',
  }
}

// Stable default state per flow until the first write
const FALLBACK = {
  cache: new Map<string, FlowEditorState>(),
  get(id: string) {
    let f = this.cache.get(id)
    if (!f) {
      f = makeFlow()
      this.cache.set(id, f)
    }
    return f
  },
}


let seq = 0
const newId = () => `step-${Date.now().toString(36)}-${++seq}`

export const nodeHeight = (n: Pick<FlowNode, 'kind'>) => (n.kind === 'if' ? IF_H : NODE_H)
export const nodeWidth = (n: Pick<FlowNode, 'kind'>) => (n.kind === 'if' ? 220 : NODE_W)

/** Turn a palette entry into a step. */
export function stepFromPalette(item: PaletteItem, x: number, y: number): FlowNode {
  const id = newId()
  switch (item.kind) {
    case 'trigger':
      return { id, kind: 'trigger', x, y, kindLabel: 'TRIGGER', source: item.label, title: `When ${item.label.toLowerCase()} fires`, desc: 'Set what starts this flow' }
    case 'ai':
      return { id, kind: 'ai', x, y, kindLabel: 'AI STEP', source: 'Ops', title: item.label, desc: 'Tell the agent what to do', helper: 'ops' }
    case 'if':
      return { id, kind: 'if', x: x + 20, y, kindLabel: 'IF', title: item.id === 'wait' ? 'Wait 10 minutes' : 'If …' }
    case 'approval':
      return { id, kind: 'approval', x, y, kindLabel: 'APPROVAL', source: 'Inbox', title: 'You approve', desc: 'Lands in Inbox, waits up to 1h', app: 'inbox' }
    default:
      return { id, kind: 'connector', x, y, kindLabel: 'CONNECTOR', source: item.label, title: `Do something in ${item.label}`, desc: 'Pick an action', app: item.id === 'github' ? 'github' : item.id === 'slack' ? 'slack' : 'chat' }
  }
}

interface Actions {
  get(flowId: string): FlowEditorState
  select(flowId: string, id: string | null): void
  /** Commit a graph change (undoable). */
  edit(flowId: string, fn: (g: Graph) => Graph): void
  undo(flowId: string): void
  redo(flowId: string): void
  moveNode(flowId: string, id: string, x: number, y: number, commit: boolean): void
  addStep(flowId: string, item: PaletteItem, at?: { x: number; y: number }): void
  insertOnEdge(flowId: string, edge: FlowEdge, item: PaletteItem): void
  removeStep(flowId: string, id: string): void
  duplicateStep(flowId: string, id: string): void
  updateNode(flowId: string, id: string, patch: Partial<FlowNode>): void
  updateAi(flowId: string, id: string, patch: Partial<AiStepDetail>): void
  setEnabled(flowId: string, on: boolean): void
  publish(flowId: string): void
  startTest(flowId: string): void
  closeTest(flowId: string): void
  approve(flowId: string, runId: string, ok: boolean): void
  cancelRun(flowId: string, runId: string): void
  retryRun(flowId: string, runId: string): string
  setSettings(flowId: string, patch: Partial<FlowSettings>): void
  saveSettings(flowId: string): void
  discardSettings(flowId: string): void
  restoreVersion(flowId: string): void
  setDraft(flowId: string, draft: FlowEditorState['draft']): void
}

type Store = { flows: Record<string, FlowEditorState> } & Actions

const timers = new Set<ReturnType<typeof setTimeout>>()
function later(ms: number, fn: () => void) {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

/** Editor state per flow — kept while you switch Canvas / Runs / Settings. */
export const useFlowStore = create<Store>()((set, get) => {
  const patch = (flowId: string, fn: (f: FlowEditorState) => Partial<FlowEditorState>) =>
    set((s) => {
      const f = s.flows[flowId] ?? FALLBACK.get(flowId)
      return { flows: { ...s.flows, [flowId]: { ...f, ...fn(f) } } }
    })

  const commit = (flowId: string, fn: (g: Graph) => Graph, extra?: (f: FlowEditorState) => Partial<FlowEditorState>) =>
    patch(flowId, (f) => ({
      past: [...f.past.slice(-49), f.graph],
      future: [],
      graph: fn(f.graph),
      dirty: true,
      ...extra?.(f),
    }))

  const updateRun = (flowId: string, runId: string, fn: (r: RunState) => RunState) =>
    patch(flowId, (f) => ({ runs: f.runs.map((r) => (r.id === runId ? fn(r) : r)) }))

  return {
    flows: {},
    get: (flowId) => get().flows[flowId] ?? FALLBACK.get(flowId),
    select: (flowId, id) => patch(flowId, () => ({ selected: id })),
    edit: (flowId, fn) => commit(flowId, fn),
    undo: (flowId) =>
      patch(flowId, (f) => {
        const prev = f.past.at(-1)
        if (!prev) return {}
        return { graph: prev, past: f.past.slice(0, -1), future: [f.graph, ...f.future], dirty: true }
      }),
    redo: (flowId) =>
      patch(flowId, (f) => {
        const [next, ...rest] = f.future
        if (!next) return {}
        return { graph: next, future: rest, past: [...f.past, f.graph], dirty: true }
      }),
    moveNode: (flowId, id, x, y, isCommit) => {
      const move = (g: Graph): Graph => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) })
      if (isCommit) commit(flowId, move)
      else patch(flowId, (f) => ({ graph: move(f.graph) }))
    },
    addStep: (flowId, item, at) => {
      const f = get().get(flowId)
      const from = f.graph.nodes.find((n) => n.id === f.selected)
      let pos = at
      if (!pos) {
        const bottom = Math.max(...f.graph.nodes.map((n) => n.y + nodeHeight(n)), 0)
        pos = { x: from ? from.x + (nodeWidth(from) - NODE_W) / 2 : 277, y: bottom + 44 }
      }
      const node = stepFromPalette(item, Math.round(pos.x), Math.round(pos.y))
      commit(
        flowId,
        (g) => ({
          nodes: [...g.nodes, node],
          edges: from ? [...g.edges, { from: from.id, to: node.id, plus: true }] : g.edges,
        }),
        () => ({ selected: node.id }),
      )
    },
    insertOnEdge: (flowId, edge, item) => {
      const f = get().get(flowId)
      const from = f.graph.nodes.find((n) => n.id === edge.from)
      const to = f.graph.nodes.find((n) => n.id === edge.to)
      if (!from || !to) return
      const node = stepFromPalette(item, from.x + (nodeWidth(from) - NODE_W) / 2, to.y)
      const fromId = from.id
      commit(
        flowId,
        (g) => ({
          nodes: [
            ...g.nodes.map((n) => (n.y >= to.y ? { ...n, y: n.y + ROW } : n)),
            node,
          ],
          edges: [
            ...g.edges
              .filter((e) => !(e.from === edge.from && e.to === edge.to))
              .map((e) => (e.via !== undefined && e.via >= to.y ? { ...e, via: e.via + ROW } : e)),
            { from: fromId, to: node.id, plus: true, branch: edge.branch, via: edge.via },
            { from: node.id, to: edge.to, plus: true },
          ],
        }),
        () => ({ selected: node.id }),
      )
    },
    removeStep: (flowId, id) =>
      commit(
        flowId,
        (g) => {
          const ins = g.edges.filter((e) => e.to === id)
          const outs = g.edges.filter((e) => e.from === id)
          // Reconnect a simple chain step so the flow stays whole
          const bridge =
            ins.length === 1 && outs.length === 1
              ? [{ from: ins[0].from, to: outs[0].to, via: ins[0].via ?? outs[0].via, branch: ins[0].branch }]
              : []
          return {
            nodes: g.nodes.filter((n) => n.id !== id),
            edges: [...g.edges.filter((e) => e.from !== id && e.to !== id), ...bridge],
          }
        },
        (f) => ({ selected: f.selected === id ? null : f.selected }),
      ),
    duplicateStep: (flowId, id) => {
      const f = get().get(flowId)
      const n = f.graph.nodes.find((x) => x.id === id)
      if (!n) return
      const copy = { ...n, id: newId(), x: n.x + 24, y: n.y + 24, title: `${n.title} (copy)`, last: undefined }
      commit(flowId, (g) => ({ ...g, nodes: [...g.nodes, copy] }), () => ({
        selected: copy.id,
        ai: f.ai[id] ? { ...f.ai, [copy.id]: f.ai[id] } : f.ai,
      }))
    },
    updateNode: (flowId, id, p) =>
      commit(flowId, (g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) })),
    updateAi: (flowId, id, p) =>
      patch(flowId, (f) => ({ ai: { ...f.ai, [id]: { ...(f.ai[id] ?? blankAi()), ...p } }, dirty: true })),
    setEnabled: (flowId, on) => patch(flowId, () => ({ enabled: on })),
    publish: (flowId) => patch(flowId, () => ({ dirty: false, publishedAt: 'just now' })),
    startTest: (flowId) => {
      patch(flowId, () => ({ test: 'running', testStep: 0 }))
      for (let i = 1; i <= 5; i++) {
        later(i * 380, () =>
          patch(flowId, (f) => (f.test === 'running' ? { testStep: i, test: i === 5 ? 'done' : 'running' } : {})),
        )
      }
    },
    closeTest: (flowId) => patch(flowId, () => ({ test: 'idle', testStep: 0 })),
    approve: (flowId, runId, ok) => {
      updateRun(flowId, runId, (r) => {
        const steps = r.detail.steps.map((s): RunStep => {
          if (s.state === 'waiting')
            return { ...s, state: ok ? 'done' : 'failed', title: ok ? 'You approved the fix' : 'You declined the fix', time: ok ? 'just now' : 'declined', approval: undefined }
          if (s.state === 'queued' && !ok) return { ...s, state: 'queued', time: 'skipped' }
          return s
        })
        return ok
          ? { ...r, status: 'waiting', detail: { ...r.detail, steps, chip: 'Running' } }
          : { ...r, status: 'noop', detail: { ...r.detail, steps, chip: 'Declined — nothing changed' } }
      })
      if (!ok) return
      // Run the remaining steps one by one
      const queued = get().get(flowId).runs.find((r) => r.id === runId)?.detail.steps.filter((s) => s.state === 'queued').length ?? 0
      for (let i = 1; i <= queued; i++) {
        later(i * 700, () =>
          updateRun(flowId, runId, (r) => {
            let done = false
            const steps = r.detail.steps.map((s) => {
              if (!done && s.state === 'queued') {
                done = true
                return { ...s, state: 'done' as const, time: i === 1 ? '38s · $0.004' : '0.3s' }
              }
              return s
            })
            const last = i === queued
            return {
              ...r,
              status: last ? 'succeeded' : r.status,
              what: last ? r.what.replace('migration step failed', 'fix PR opened') : r.what,
              detail: { ...r.detail, steps, chip: last ? 'Succeeded' : 'Running' },
            }
          }),
        )
      }
    },
    cancelRun: (flowId, runId) =>
      updateRun(flowId, runId, (r) => ({
        ...r,
        status: 'failed',
        detail: {
          ...r.detail,
          chip: 'Cancelled',
          steps: r.detail.steps.map((s) =>
            s.state === 'waiting' || s.state === 'queued' ? { ...s, state: 'queued', time: 'cancelled', approval: undefined } : s,
          ),
        },
      })),
    retryRun: (flowId, runId) => {
      const f = get().get(flowId)
      const src = f.runs.find((r) => r.id === runId)
      const number = Math.max(...f.runs.map((r) => r.number)) + 1
      const id = `r${number}`
      if (!src) return id
      const run: RunState = {
        ...src,
        id,
        number,
        status: 'succeeded',
        when: 'just now',
        retry: false,
        what: src.what.replace('timed out', 'retried, passed'),
        detail: {
          ...src.detail,
          title: `Run #${number}`,
          chip: 'Succeeded',
          sub: `Retried from run #${src.number} · just now`,
          steps: src.detail.steps.map((s) => ({ ...s, state: 'done' as const, time: s.state === 'failed' ? '9.1s' : s.time })),
        },
      }
      patch(flowId, (fl) => ({ runs: [run, ...fl.runs] }))
      return id
    },
    setSettings: (flowId, p) => patch(flowId, (f) => ({ settings: { ...f.settings, ...p } })),
    saveSettings: (flowId) => patch(flowId, (f) => ({ savedSettings: f.settings })),
    discardSettings: (flowId) => patch(flowId, (f) => ({ settings: f.savedSettings })),
    restoreVersion: (flowId) => patch(flowId, () => ({ dirty: true })),
    setDraft: (flowId, draft) => patch(flowId, () => ({ draft, enabled: draft === 'on' })),
  }
})

export function blankAi(): AiStepDetail {
  return {
    instructionsLead: 'Use',
    input: 'Trigger.data',
    instructions: 'Describe what this step should do.',
    returns: ['result'],
    guardrails: [
      { label: 'Read-only — can’t change code or infra', on: true },
      { label: 'Stop after 3 tool calls', on: true },
      { label: 'Ask in Inbox if unsure', on: false },
    ],
    costNote: '~$0.004 a run',
  }
}

/** Subscribe to one flow's editor state. */
export function useFlow(flowId: string): FlowEditorState {
  return useFlowStore((s) => s.flows[flowId]) ?? FALLBACK.get(flowId)
}
/** Reset (tests). */
export function resetFlows() {
  timers.forEach(clearTimeout)
  timers.clear()
  FALLBACK.cache.clear()
  useFlowStore.setState({ flows: {} })
}
