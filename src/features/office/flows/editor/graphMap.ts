// Editor graph ⇄ API graph.
//
// The API / engine stores nodes as {id, kind, label, sublabel, x, y, config}
// with engine kinds (trigger · ai_step · condition · approval · connector) and
// edges as {id, from, to, label: 'Yes'|'No'}. The editor works with FlowNode /
// FlowEdge (kinds trigger · ai · if · approval · connector). Editor-only fields
// (kindLabel, source, helper, app, AI-step detail, edge routing) ride along in
// `config.ui` / `config.ai` / edge `via`/`plus`, so a round trip is lossless.

import type { HelperArea } from '../../../../core/domain/types'
import type { AiStepDetail, FlowEdge, FlowNode, StepKind } from './data'

export interface ApiNode {
  id: string
  kind: string
  label?: string
  sublabel?: string
  x?: number
  y?: number
  config?: Record<string, unknown>
}

export interface ApiEdge {
  id?: string
  from: string
  to: string
  label?: string
  via?: number
  plus?: boolean
}

const TO_API: Record<StepKind, string> = {
  trigger: 'trigger',
  ai: 'ai_step',
  if: 'condition',
  approval: 'approval',
  connector: 'connector',
}

const FROM_API: Record<string, StepKind> = {
  trigger: 'trigger',
  ai_step: 'ai',
  ai: 'ai',
  condition: 'if',
  if: 'if',
  approval: 'approval',
  connector: 'connector',
}

const KIND_LABEL: Record<StepKind, string> = {
  trigger: 'TRIGGER',
  ai: 'AI STEP',
  if: 'IF',
  approval: 'APPROVAL',
  connector: 'CONNECTOR',
}

const APPS = new Set(['github', 'slack', 'chat', 'inbox'])

type Ui = { kindLabel?: string; source?: string; helper?: HelperArea; app?: string }

/** Editor graph → PATCH /v1/flows/{id} {nodes, edges}. */
export function toApiGraph(
  nodes: FlowNode[],
  edges: FlowEdge[],
  ai: Record<string, AiStepDetail> = {},
): { nodes: ApiNode[]; edges: ApiEdge[] } {
  return {
    nodes: nodes.map((n) => {
      const ui: Ui = { kindLabel: n.kindLabel }
      if (n.source) ui.source = n.source
      if (n.helper) ui.helper = n.helper
      if (n.app) ui.app = n.app
      const config: Record<string, unknown> = { ...(n.config ?? {}), ui }
      const detail = ai[n.id]
      if (n.kind === 'ai') {
        config.brief = detail?.instructions || n.title
        if (detail) config.ai = detail
      }
      if (n.kind === 'connector' && n.source) config.name = n.source
      return {
        id: n.id,
        kind: TO_API[n.kind],
        label: n.title,
        sublabel: n.desc ?? '',
        x: Math.round(n.x),
        y: Math.round(n.y),
        config,
      }
    }),
    edges: edges.map((e) => {
      const out: ApiEdge = { id: `e-${e.from}-${e.to}`, from: e.from, to: e.to }
      if (e.branch) out.label = e.branch === 'yes' ? 'Yes' : 'No'
      if (e.via !== undefined) out.via = e.via
      if (e.plus) out.plus = true
      return out
    }),
  }
}

/** GET /v1/flows/{id} {nodes, edges} → editor graph + AI-step details. */
export function fromApiGraph(
  rawNodes: unknown[] | undefined,
  rawEdges: unknown[] | undefined,
): { nodes: FlowNode[]; edges: FlowEdge[]; ai: Record<string, AiStepDetail> } {
  const ai: Record<string, AiStepDetail> = {}
  const nodes: FlowNode[] = []
  ;(rawNodes ?? []).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return
    const n = raw as ApiNode & { title?: string; desc?: string }
    if (!n.id) return
    const kind: StepKind = FROM_API[n.kind] ?? 'connector'
    const { ui: rawUi, ai: rawAi, brief: _brief, name: _name, ...rest } = (n.config ?? {}) as Record<string, unknown>
    const ui = (rawUi ?? {}) as Ui
    const node: FlowNode = {
      id: n.id,
      kind,
      x: typeof n.x === 'number' ? n.x : 277,
      y: typeof n.y === 'number' ? n.y : 36 + i * 140,
      kindLabel: ui.kindLabel ?? KIND_LABEL[kind],
      title: n.label ?? n.title ?? KIND_LABEL[kind],
    }
    const desc = n.sublabel ?? n.desc
    if (desc) node.desc = desc
    if (ui.source) node.source = ui.source
    if (ui.helper) node.helper = ui.helper
    if (ui.app && APPS.has(ui.app)) node.app = ui.app as FlowNode['app']
    else if (kind === 'approval') node.app = 'inbox'
    if (Object.keys(rest).length) node.config = rest
    if (rawAi && typeof rawAi === 'object') ai[n.id] = rawAi as AiStepDetail
    nodes.push(node)
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges: FlowEdge[] = []
  for (const raw of rawEdges ?? []) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as ApiEdge & { branch?: 'yes' | 'no' }
    if (!ids.has(e.from) || !ids.has(e.to)) continue
    const edge: FlowEdge = { from: e.from, to: e.to }
    const branch = e.branch ?? (e.label === 'Yes' ? 'yes' : e.label === 'No' ? 'no' : undefined)
    if (branch) edge.branch = branch
    if (typeof e.via === 'number') edge.via = e.via
    if (e.plus) edge.plus = true
    edges.push(edge)
  }
  return { nodes, edges, ai }
}

/** Map an app id from GET /v1/flows `apps[]` to a FlowChain icon. */
export function chainIcon(app: string | undefined, fallback: string): string {
  switch ((app ?? '').toLowerCase()) {
    case 'github':
      return 'github'
    case 'slack':
      return 'slack'
    case 'gmail':
    case 'mail':
    case 'email':
      return 'mail'
    case 'inbox':
    case 'approval':
    case 'user-check':
      return 'user-check'
    case 'stripe':
    case 'sheets':
    case 'chart-line':
      return 'chart-line'
    case 'schedule':
    case 'clock':
      return 'clock'
    case 'siren':
      return 'siren'
    case 'file-text':
      return 'file-text'
    case 'chat':
    case 'whatsapp':
    case 'message-circle':
      return 'message-circle'
    default:
      return fallback
  }
}
