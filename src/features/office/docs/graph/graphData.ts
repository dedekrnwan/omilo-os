import type { DocGraph, Helper, HelperArea, KbSource, Lesson } from '../../../../core/domain/types'
import type { FileKind, GEdge, GNode } from './NetworkGraph'

// Frames are the pen canvases (Czmj0, eU7Fc); live data is laid out inside them.

// ── Docs · Graph (Czmj0) — canvas 911 × 843 ───────────────────────────────────

export const DOC_FRAME = { w: 911, h: 843 }

/** Pen colours for the four default areas; other areas get a stable palette colour. */
const AREA_COLOR: Record<string, string> = {
  engineering: '#14B8A6',
  marketing: '#F97316',
  business: '#8B5CF6',
  general: '#A8A29E',
  goal: '#15803D',
}
const PALETTE = ['#0EA5E9', '#EC4899', '#F59E0B', '#10B981', '#6366F1', '#EF4444']

export function areaColor(label: string): string {
  const key = label.toLowerCase()
  if (AREA_COLOR[key]) return AREA_COLOR[key]
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export interface DocGraphNode extends GNode {
  /** Area label ('Engineering', 'General', …) */
  area: string
  /** Notes view doc id it opens (absent for goals) */
  docId?: string
  excerpt?: string
  by?: 'team' | 'agents'
  updatedAt?: string | null
}

/**
 * Lay docs out in one cluster per area around the canvas centre, goals in the
 * middle; links come straight from the server graph.
 */
export function layoutDocGraph(graph: DocGraph, labelOf: (area: string | null) => string): DocGraphNode[] {
  const cx = DOC_FRAME.w / 2
  const cy = DOC_FRAME.h / 2 - 20
  const docs = graph.nodes.filter((n) => n.kind !== 'goal')
  const goals = graph.nodes.filter((n) => n.kind === 'goal')
  const degree = new Map<string, number>()
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }
  const byArea = new Map<string, typeof docs>()
  for (const n of docs) {
    const label = labelOf(n.area)
    byArea.set(label, [...(byArea.get(label) ?? []), n])
  }
  const areas = [...byArea.keys()]
  const out: DocGraphNode[] = []
  areas.forEach((label, ai) => {
    const angle = (ai / Math.max(1, areas.length)) * Math.PI * 2 - Math.PI / 2
    const ring = areas.length === 1 ? 0 : 250
    const ax = cx + Math.cos(angle) * ring
    const ay = cy + Math.sin(angle) * ring * 0.85
    const members = byArea.get(label)!
    members.forEach((n, i) => {
      const r = i === 0 ? 0 : 55 + Math.floor((i - 1) / 6) * 50
      const a = ((i - 1) % 6) * (Math.PI / 3) + ai
      out.push({
        id: n.id,
        kind: 'doc',
        label: n.title,
        x: Math.round(ax + Math.cos(a) * r),
        y: Math.round(ay + Math.sin(a) * r),
        area: label,
        color: areaColor(label),
        big: (degree.get(n.id) ?? 0) >= 3,
        docId: n.id,
        excerpt: n.excerpt,
        by: n.by,
        updatedAt: n.updatedAt,
      })
    })
  })
  goals.forEach((g, i) => {
    out.push({
      id: g.id,
      kind: 'goal',
      label: `Goal · ${g.title}`,
      x: Math.round(cx + (i - (goals.length - 1) / 2) * 120),
      y: Math.round(cy + (i % 2 ? 40 : -40)),
      area: 'goal',
      color: AREA_COLOR.goal,
      by: 'team',
    })
  })
  return out
}

// ── Docs · Knowledge (eU7Fc) — canvas 1145 × 843 ─────────────────────────────

export const KNOW_FRAME = { w: 1145, h: 843 }
const HUB = { x: 572, y: 300 }

export type MemTag = 'lesson' | 'preference' | 'fact'
export const TAG_COLOR: Record<MemTag, string> = {
  lesson: '#F59E0B',
  preference: '#EC4899',
  fact: '#A8A29E',
}

export interface KnowNode extends GNode {
  tag?: MemTag
  owner?: string
  /** Where it was learned */
  source?: string
  review?: boolean
}

/** Where added sources land around Company facts (cUtde). */
export const SOURCE_SLOTS = [
  { x: 711, y: 286 },
  { x: 673, y: 344 },
  { x: 639, y: 404 },
  { x: 760, y: 400 },
  { x: 700, y: 230 },
]

const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Knowledge graph: Company facts hub in the middle, one mascot per helper on
 * an ellipse around it, each lesson/preference next to its owner, company
 * facts around the hub.
 */
export function layoutKnowledge(helpers: Helper[], lessons: Lesson[]): { nodes: KnowNode[]; edges: GEdge[] } {
  const nodes: KnowNode[] = [{ id: 'hub', kind: 'hub', label: 'Company facts', ...HUB }]
  const edges: GEdge[] = []
  const owners = helpers.slice(0, 8)
  const pos = new Map<string, { x: number; y: number; angle: number }>()
  owners.forEach((h, i) => {
    const angle = (i / Math.max(1, owners.length)) * Math.PI * 2 - Math.PI * 0.75
    const p = { x: Math.round(HUB.x + Math.cos(angle) * 300), y: Math.round(HUB.y + 40 + Math.sin(angle) * 190), angle }
    pos.set(h.id, p)
    nodes.push({ id: h.id, kind: 'agent', label: h.name, x: p.x, y: p.y, helper: h.area as HelperArea })
    edges.push({ from: 'hub', to: h.id })
  })
  const counts = new Map<string, number>()
  for (const l of lessons) {
    const owner = l.helperId && pos.has(l.helperId) ? l.helperId : 'hub'
    const i = counts.get(owner) ?? 0
    counts.set(owner, i + 1)
    const base = owner === 'hub' ? { x: HUB.x, y: HUB.y, angle: -Math.PI / 2 } : pos.get(owner)!
    // Fan memories out on the side away from the hub.
    const a = base.angle + (i % 2 ? 1 : -1) * (0.45 + Math.floor(i / 2) * 0.42) + (i === 0 ? 0.45 : 0)
    const r = 95 + (i % 3) * 14
    const x = Math.round(base.x + Math.cos(a) * r)
    nodes.push({
      id: l.id,
      kind: 'memory',
      label: short(l.text),
      x,
      y: Math.round(base.y + Math.sin(a) * r * 0.8),
      tag: l.tag,
      owner,
      color: TAG_COLOR[l.tag] ?? TAG_COLOR.fact,
      source: l.source,
      review: l.status === 'review',
      labelSide: x < base.x - 20 ? 'left' : undefined,
    })
    edges.push({ from: owner, to: l.id })
  }
  return { nodes, edges }
}

export function kindOf(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xlsx', 'xls', 'csv', 'numbers', 'tsv'].includes(ext)) return 'xlsx'
  if (['pdf'].includes(ext)) return 'pdf'
  if (['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) return 'img'
  return 'doc'
}

/** File nodes for added sources, parked in the source slots around the hub. */
export function sourceNodes(sources: Pick<KbSource, 'id' | 'title' | 'chunks'>[], reading: { id: string; title: string }[]): GNode[] {
  const all = [
    ...reading.map((r) => ({ id: r.id, title: r.title, chunks: undefined as number | undefined, busy: true })),
    ...sources.map((s) => ({ id: `src:${s.id}`, title: s.title, chunks: s.chunks, busy: false })),
  ]
  return all.slice(0, 10).map((s, i) => {
    const slot = SOURCE_SLOTS[i % SOURCE_SLOTS.length]
    const lap = Math.floor(i / SOURCE_SLOTS.length)
    return {
      id: s.id,
      kind: 'file' as const,
      label: s.title,
      file: kindOf(s.title),
      x: slot.x + lap * 70,
      y: slot.y + lap * 20,
      progress: s.busy ? 0.5 : 1,
      sub: s.busy ? 'Reading…' : `${s.chunks ?? 0} added`,
      subTone: s.busy ? ('info' as const) : ('ok' as const),
      spawnFrom: 'hub',
    }
  })
}
