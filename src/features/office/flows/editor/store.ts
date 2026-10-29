import { create } from 'zustand'
import type { Flow } from '../../../../core/domain/types'
import { DEFAULT_SETTINGS, IF_H, NODE_H, NODE_W } from './data'
import type { AiStepDetail, FlowEdge, FlowNode, FlowSettings, PaletteItem } from './data'
import { fromApiGraph } from './graphMap'

/** Vertical room one inserted step takes (node + gap). */
const ROW = 140

export interface Graph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** idle → requested (any page asked for a test) → running (POST in flight) → done. */
export type TestState = 'idle' | 'requested' | 'running' | 'done'

export interface FlowEditorState {
  graph: Graph
  past: Graph[]
  future: Graph[]
  selected: string | null
  ai: Record<string, AiStepDetail>
  enabled: boolean
  /** Canvas edits not saved to the server yet (autosave clears it). */
  dirty: boolean
  /** Server graph version the canvas was seeded from / last saved as. */
  serverVersion: number | null
  /** True once seeded from the live flow. */
  hydrated: boolean
  test: TestState
  /** The test run being shown in the test panel. */
  testRunId: string | null
  settings: FlowSettings
  savedSettings: FlowSettings
  /** Step whose name is being edited in the inspector */
  renamingId: string | null
}

/** Empty editor state until CanvasPage / SettingsPage seed it from GET /v1/flows/{id}. */
function makeFlow(): FlowEditorState {
  const settings = { ...DEFAULT_SETTINGS }
  return {
    graph: { nodes: [], edges: [] },
    past: [],
    future: [],
    selected: null,
    ai: {},
    enabled: false,
    dirty: false,
    serverVersion: null,
    hydrated: false,
    test: 'idle',
    testRunId: null,
    settings,
    savedSettings: settings,
    renamingId: null,
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
  /**
   * Seed the editor from a live Flow: title/area/enabled always; the graph only
   * on first load or when the server version moved on and there are no local edits.
   */
  seed(flowId: string, flow: Flow): void
  /** Autosave finished: the server now holds `version`. */
  markSaved(flowId: string, version: number | null): void
  select(flowId: string, id: string | null): void
  /** Commit a graph change (undoable). */
  edit(flowId: string, fn: (g: Graph) => Graph): void
  undo(flowId: string): void
  redo(flowId: string): void
  moveNode(flowId: string, id: string, x: number, y: number, commit: boolean): void
  addStep(flowId: string, item: PaletteItem, at?: { x: number; y: number }): void
  insertOnEdge(flowId: string, edge: FlowEdge, item: PaletteItem): void
  /** Manually connect two steps (drag from one node's out-port to another's in-port). */
  addEdge(flowId: string, from: string, to: string): void
  removeStep(flowId: string, id: string): void
  duplicateStep(flowId: string, id: string): void
  updateNode(flowId: string, id: string, patch: Partial<FlowNode>): void
  updateAi(flowId: string, id: string, patch: Partial<AiStepDetail>): void
  setEnabled(flowId: string, on: boolean): void
  /** Ask the canvas to run a real test (CanvasPage performs POST /test-run). */
  startTest(flowId: string): void
  setTest(flowId: string, test: TestState, runId?: string | null): void
  closeTest(flowId: string): void
  setSettings(flowId: string, patch: Partial<FlowSettings>): void
  saveSettings(flowId: string): void
  discardSettings(flowId: string): void
  setRenaming(flowId: string, id: string | null): void
}

type Store = { flows: Record<string, FlowEditorState> } & Actions

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

  return {
    flows: {},
    get: (flowId) => get().flows[flowId] ?? FALLBACK.get(flowId),

    seed: (flowId, flow) => {
      patch(flowId, (f) => {
        const name = flow.title
        const areaId = flow.areas?.[0] ?? f.settings.areaId
        const base: Partial<FlowEditorState> = {
          settings: { ...f.settings, name, areaId },
          savedSettings: { ...f.savedSettings, name, areaId },
          enabled: flow.enabled,
        }
        const version = flow.version ?? null
        const fresh = !f.hydrated || (!f.dirty && version !== null && version !== f.serverVersion)
        if (!fresh) return base
        const g = fromApiGraph(flow.nodes ?? [], flow.edges ?? [])
        const keep = f.selected && g.nodes.some((n) => n.id === f.selected)
        return {
          ...base,
          graph: { nodes: g.nodes, edges: g.edges },
          ai: g.ai,
          past: [],
          future: [],
          dirty: false,
          hydrated: true,
          serverVersion: version,
          selected: keep ? f.selected : (g.nodes.find((n) => n.kind === 'ai') ?? g.nodes[0])?.id ?? null,
        }
      })
    },

    markSaved: (flowId, version) => patch(flowId, () => ({ dirty: false, serverVersion: version })),

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
    addEdge: (flowId, from, to) => {
      const f = get().get(flowId)
      const target = f.graph.nodes.find((n) => n.id === to)
      // No self-loops, no duplicates, and a trigger can't be a target (it starts the flow).
      if (from === to || !target || target.kind === 'trigger') return
      if (f.graph.edges.some((e) => e.from === from && e.to === to)) return
      commit(flowId, (g) => ({ ...g, edges: [...g.edges, { from, to, plus: true }] }), () => ({ selected: to }))
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
    startTest: (flowId) => patch(flowId, () => ({ test: 'requested', testRunId: null })),
    setTest: (flowId, test, runId) => patch(flowId, (f) => ({ test, testRunId: runId === undefined ? f.testRunId : runId })),
    closeTest: (flowId) => patch(flowId, () => ({ test: 'idle', testRunId: null })),
    setSettings: (flowId, p) => patch(flowId, (f) => ({ settings: { ...f.settings, ...p } })),
    saveSettings: (flowId) => patch(flowId, (f) => ({ savedSettings: f.settings })),
    discardSettings: (flowId) => patch(flowId, (f) => ({ settings: f.savedSettings })),
    setRenaming: (flowId, id) => patch(flowId, () => ({ renamingId: id, selected: id ?? get().get(flowId).selected })),
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
  FALLBACK.cache.clear()
  useFlowStore.setState({ flows: {} })
}
