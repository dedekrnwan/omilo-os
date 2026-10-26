import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { Simulation, SimulationNodeDatum } from 'd3-force'
import { Building2, FileText, Image, Maximize2, Minus, Plus, Sheet } from 'lucide-react'
import type { HelperArea } from '../../../../core/domain/types'
import { Mascot } from '../../../../ui/ds/Mascot'
import { ContextMenuArea } from '../../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../../ui/ds/ItemMenu'

/**
 * One graph engine for Docs · Graph and Docs · Knowledge (pen Czmj0, eU7Fc,
 * cUtde, n8N6dT, WZycb): docs and memories are dots with a label beside them,
 * helpers are mascots, company facts is a hub, sources are file tiles.
 * Positions come from the design and a light d3-force keeps them alive —
 * drag a node, pan the board, zoom, hover to see its neighbours.
 */

export type GNodeKind = 'doc' | 'goal' | 'memory' | 'agent' | 'hub' | 'file'
export type FileKind = 'pdf' | 'xlsx' | 'img' | 'doc'

export interface GNode {
  id: string
  kind: GNodeKind
  label: string
  /** Design position (world coordinates) */
  x: number
  y: number
  color?: string
  /** Bigger dot (hub docs) */
  big?: boolean
  helper?: HelperArea
  labelSide?: 'right' | 'left' | 'below'
  /** Second line (files) */
  sub?: string
  subTone?: 'info' | 'ok' | 'muted' | 'warn'
  file?: FileKind
  /** 0–1 while a source is being read */
  progress?: number
  emphasis?: 'review' | 'halo' | 'new'
  /** Numbered highlight (answers) */
  badge?: number
  /** Appears from this node's position */
  spawnFrom?: string
}

export interface GEdge {
  from: string
  to: string
  tone?: 'default' | 'source' | 'new'
}

type SimNode = GNode & SimulationNodeDatum & { x0: number; y0: number }

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const FILE_LOOK: Record<FileKind, { icon: typeof FileText; ink: string; ring: string }> = {
  pdf: { icon: FileText, ink: '#DC2626', ring: 'var(--color-line-strong)' },
  xlsx: { icon: Sheet, ink: '#15803D', ring: '#15803D' },
  img: { icon: Image, ink: '#2563EB', ring: 'var(--color-line-strong)' },
  doc: { icon: FileText, ink: '#2563EB', ring: 'var(--color-line-strong)' },
}

const SUB_TONE = { info: 'text-[#2563EB]', ok: 'text-ok', muted: 'text-muted', warn: 'text-warn' }

const EDGE: Record<NonNullable<GEdge['tone']>, { stroke: string; width: number }> = {
  default: { stroke: '#D6D3D1', width: 1.2 },
  source: { stroke: '#BFDBFE', width: 1.5 },
  new: { stroke: '#3B82F6', width: 1.5 },
}

function collideR(n: GNode) {
  if (n.kind === 'agent') return 30
  if (n.kind === 'hub' || n.kind === 'file') return 24
  return 10
}

function Dot({ n, selected, hovered }: { n: GNode; selected: boolean; hovered: boolean }) {
  const color = n.color ?? '#A8A29E'
  if (n.kind === 'goal')
    return <span className="block size-[10px] rounded-full border-2 bg-surface" style={{ borderColor: color }} />
  if (n.emphasis === 'review')
    return (
      <span className="relative flex size-[11px] items-center justify-center">
        <span className="absolute size-[22px] rounded-full opacity-30" style={{ background: color }} />
        <span className="relative size-[11px] rounded-full border-2 border-ink" style={{ background: color }} />
      </span>
    )
  if (n.emphasis === 'new')
    return <span className="block size-[11px] rounded-full border-2 border-[#1E3A8A] bg-[#60A5FA]" />
  const d = n.big ? 12 : n.kind === 'memory' ? 8 : 9
  return (
    <span className="relative flex items-center justify-center" style={{ width: d, height: d }}>
      {(selected || n.emphasis === 'halo') && (
        <span
          className="absolute rounded-full transition-all"
          style={{ width: selected ? 46 : 20, height: selected ? 46 : 20, background: color, opacity: selected ? 0.18 : 0.3 }}
        />
      )}
      <span
        className={`relative rounded-full transition-transform ${hovered ? 'scale-125' : ''}`}
        style={{ width: d, height: d, background: color }}
      />
    </span>
  )
}

function NodeView({ n, selected, hovered }: { n: GNode; selected: boolean; hovered: boolean }) {
  if (n.kind === 'agent' || n.kind === 'hub') {
    return (
      <span className="flex flex-col items-center">
        <span
          className={`flex items-center justify-center rounded-full bg-surface shadow-[0_1px_3px_#0C0A0914,0_4px_10px_-4px_#0C0A091A] outline-1 -outline-offset-1 transition-transform ${
            selected ? 'outline-2 outline-ink' : 'outline-line-strong'
          } ${hovered ? 'scale-105' : ''}`}
          style={{ width: n.kind === 'agent' ? 38 : 30, height: n.kind === 'agent' ? 38 : 30 }}
        >
          {n.kind === 'agent' ? (
            <Mascot size={26} radius={8} area={n.helper ?? 'brand'} helper still={false} />
          ) : (
            <Building2 size={14} aria-hidden className="text-ink-2" />
          )}
        </span>
      </span>
    )
  }
  if (n.kind === 'file') {
    const look = FILE_LOOK[n.file ?? 'doc']
    const reading = n.progress !== undefined && n.progress < 1
    return (
      <span className="relative flex size-[36px] items-center justify-center">
        {reading && (
          <svg className="absolute -inset-[7px] size-[50px] -rotate-90 animate-[spin_3s_linear_infinite]" viewBox="0 0 50 50" aria-hidden>
            <circle cx="25" cy="25" r="22" fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${Math.max(0.15, n.progress ?? 0) * 138} 138`} />
          </svg>
        )}
        <span
          className={`relative flex size-[36px] items-center justify-center rounded-[10px] bg-surface shadow-[0_1px_3px_#0C0A0914] outline-1 -outline-offset-1 ${selected ? 'outline-2 outline-ink' : ''}`}
          style={selected ? undefined : { outlineColor: look.ring }}
        >
          <look.icon size={16} aria-hidden style={{ color: look.ink }} />
        </span>
      </span>
    )
  }
  return <Dot n={n} selected={selected} hovered={hovered} />
}

function Label({ n, selected, hovered }: { n: GNode; selected: boolean; hovered: boolean }) {
  const strong = selected || n.emphasis === 'review'
  const side = n.labelSide ?? (n.kind === 'agent' || n.kind === 'hub' ? 'below' : 'right')
  const pos =
    side === 'below'
      ? 'top-full left-1/2 mt-[5px] -translate-x-1/2 text-center'
      : side === 'left'
        ? 'right-full top-1/2 mr-[7px] -translate-y-1/2 text-right'
        : 'left-full top-1/2 ml-[7px] -translate-y-1/2'
  const big = n.kind === 'agent' || n.kind === 'hub'
  return (
    <span className={`pointer-events-none absolute flex whitespace-nowrap ${side === 'below' ? 'flex-col items-center' : 'flex-col'} ${pos}`}>
      <span className="flex items-center gap-[5px]">
        {n.badge !== undefined && side !== 'left' && (
          <span className="flex size-[14px] items-center justify-center rounded-full bg-ink text-[9px] font-semibold text-white">{n.badge}</span>
        )}
        <span
          className={
            big
              ? 'text-[12px] font-semibold text-ink'
              : n.kind === 'file'
                ? 'text-[12px] font-medium text-ink'
                : strong || n.badge !== undefined
                  ? 'text-[12px] font-semibold text-ink'
                  : `text-[11.5px] ${hovered ? 'text-ink' : n.emphasis === 'new' ? 'text-ink' : 'text-muted'}`
          }
        >
          {n.label}
        </span>
      </span>
      {n.sub && <span className={`text-[11px] ${SUB_TONE[n.subTone ?? 'muted']}`}>{n.sub}</span>}
    </span>
  )
}

export interface NetworkGraphProps {
  nodes: GNode[]
  edges: GEdge[]
  /** Size of the design frame the coordinates were authored in */
  frame: { w: number; h: number }
  selected?: string | null
  onSelect?: (id: string | null) => void
  /** Nodes not in this set are faded (search, filters, answers) */
  focus?: Set<string> | null
  menuFor?: (n: GNode) => MenuEntries
  backgroundMenu?: MenuEntries
  /** Overlays above the board (cards, toolbars) */
  children?: ReactNode
  label: string
  className?: string
  zoomControls?: boolean
  onDragOverBoard?: (e: React.DragEvent) => void
}

export function NetworkGraph({
  nodes,
  edges,
  frame,
  selected = null,
  onSelect,
  focus = null,
  menuFor,
  backgroundMenu = [],
  children,
  label,
  className = '',
  zoomControls = true,
}: NetworkGraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(frame)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const [hover, setHover] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const [menuNode, setMenuNode] = useState<GNode | null>(null)
  const sim = useRef<Simulation<SimNode, undefined> | null>(null)
  const simNodes = useRef(new Map<string, SimNode>())
  const drag = useRef<{ id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((e) => setSize({ w: e[0].contentRect.width || frame.w, h: e[0].contentRect.height || frame.h }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [frame.w, frame.h])

  // Keep simulation nodes in sync with props (new sources/facts fly in; removed ones leave)
  const list = useMemo(() => {
    const next = new Map<string, SimNode>()
    for (const n of nodes) {
      const prev = simNodes.current.get(n.id)
      if (prev) {
        Object.assign(prev, { ...n, x: prev.x, y: prev.y, x0: prev.x0, y0: prev.y0 })
        next.set(n.id, prev)
      } else {
        // New sources and facts grow out of the node they came from
        const origin = n.spawnFrom ? simNodes.current.get(n.spawnFrom) : undefined
        next.set(n.id, { ...n, x0: n.x, y0: n.y, x: origin?.x ?? n.x, y: origin?.y ?? n.y } as SimNode)
      }
    }
    simNodes.current = next
    return [...next.values()]
  }, [nodes])

  const links = useMemo(
    () =>
      edges
        .filter((e) => simNodes.current.has(e.from) && simNodes.current.has(e.to))
        .map((e) => ({ source: simNodes.current.get(e.from)!, target: simNodes.current.get(e.to)!, tone: e.tone ?? 'default' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edges, list],
  )

  useEffect(() => {
    const s = forceSimulation<SimNode>(list)
      .force('x', forceX<SimNode>((d) => d.x0).strength(0.35))
      .force('y', forceY<SimNode>((d) => d.y0).strength(0.35))
      .force('collide', forceCollide<SimNode>((d) => collideR(d)).strength(0.4))
      .force('charge', forceManyBody<SimNode>().strength(-8))
      .force(
        'link',
        forceLink(links.map((l) => ({ source: l.source, target: l.target })))
          .distance((l) => Math.hypot((l.source as SimNode).x0 - (l.target as SimNode).x0, (l.source as SimNode).y0 - (l.target as SimNode).y0))
          .strength(0.02),
      )
      .alpha(0.25)
      .alphaDecay(0.04)
      .on('tick', () => setTick((t) => t + 1))
    sim.current = s
    if (reduced()) {
      s.stop()
      for (let i = 0; i < 120; i++) s.tick()
      setTick((t) => t + 1)
    }
    return () => void s.stop()
  }, [list, links])

  // Narrower than the design (a side panel is open): fit what matters
  let cx = frame.w / 2
  let fit = 1
  if (size.w < frame.w) {
    const pts = list.filter((n) => (!focus || focus.has(n.id)) && (!focus || n.kind === 'memory' || n.kind === 'doc' || focus.size < 4))
    const use = pts.length ? pts : list
    if (use.length) {
      const min = Math.min(...use.map((n) => n.x0)) - 60
      const max = Math.max(...use.map((n) => n.x0)) + 170
      fit = Math.min(1, size.w / (max - min))
      cx = (min + max) / 2
    }
  }
  const k = view.k * fit
  const tx = size.w / 2 + view.x - cx * k
  const ty = size.h / 2 + view.y - (frame.h / 2) * k

  function grab(n: SimNode) {
    return (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
      drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x ?? n.x0, oy: n.y ?? n.y0, moved: false }
    }
  }

  function onBoardDown(e: ReactPointerEvent) {
    if (e.button !== 0) return
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
  }

  function onMove(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    if (d.id) {
      const n = simNodes.current.get(d.id)
      if (!n) return
      n.fx = d.ox + dx / k
      n.fy = d.oy + dy / k
      sim.current?.alpha(0.3).restart()
    } else {
      setView((v) => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    }
  }

  function onUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.id) {
      const n = simNodes.current.get(d.id)
      if (n && d.moved) {
        // Stays where it was dropped
        n.x0 = n.fx ?? n.x0
        n.y0 = n.fy ?? n.y0
        n.fx = null
        n.fy = null
        sim.current?.alpha(0.2).restart()
      } else if (n) onSelect?.(n.id === selected ? null : n.id)
    } else if (!d.moved) onSelect?.(null)
  }

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.min(2.5, Math.max(0.4, v.k * f)) }))
  const reset = () => setView({ x: 0, y: 0, k: 1 })

  const focusId = hover ?? null
  const neighbours = useMemo(() => {
    if (!focusId) return null
    const s = new Set([focusId])
    for (const l of links) {
      if (l.source.id === focusId) s.add(l.target.id)
      if (l.target.id === focusId) s.add(l.source.id)
    }
    return s
  }, [focusId, links])
  const lit = neighbours ?? focus
  const faded = (id: string) => (lit ? !lit.has(id) : false)

  const menu: MenuEntries = menuNode && menuFor ? menuFor(menuNode) : backgroundMenu

  return (
    <ContextMenuArea items={[...menu, ...(menuNode ? [] : [{ type: 'separator' as const }, { label: 'Zoom in', icon: Plus, onSelect: () => zoomBy(1.2) }, { label: 'Zoom out', icon: Minus, onSelect: () => zoomBy(1 / 1.2) }, { label: 'Reset view', icon: Maximize2, onSelect: reset }])]} label={`${label} actions`}>
      <div
        ref={box}
        role="application"
        aria-label={label}
        className={`relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-soft select-none ${className}`}
        onPointerDown={onBoardDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => {
          const el = (e.target as HTMLElement).closest('[data-gnode]')
          const id = el?.getAttribute('data-gnode')
          setMenuNode(id ? (nodes.find((n) => n.id === id) ?? null) : null)
        }}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)
          else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
        }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${tx}px, ${ty}px) scale(${k})` }}>
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
            {links.map((l, i) => {
              const st = EDGE[l.tone]
              const dim = lit && !(lit.has(l.source.id) && lit.has(l.target.id))
              return (
                <line
                  key={i}
                  x1={l.source.x}
                  y1={l.source.y}
                  x2={l.target.x}
                  y2={l.target.y}
                  stroke={st.stroke}
                  strokeWidth={st.width}
                  opacity={dim ? 0.35 : 1}
                  className="transition-opacity duration-150"
                />
              )
            })}
          </svg>
          {list.map((n) => {
            const isSel = n.id === selected
            const isHover = n.id === hover
            return (
              <button
                key={n.id}
                type="button"
                data-gnode={n.id}
                aria-label={n.sub ? `${n.label} — ${n.sub}` : n.label}
                aria-pressed={isSel}
                onPointerDown={grab(n)}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect?.(n.id === selected ? null : n.id)
                  }
                }}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ink"
                style={{ left: n.x, top: n.y, opacity: faded(n.id) ? 0.3 : 1, zIndex: n.kind === 'agent' || n.kind === 'file' ? 2 : 1 }}
              >
                <NodeView n={n} selected={isSel} hovered={isHover} />
                <Label n={n} selected={isSel} hovered={isHover} />
              </button>
            )
          })}
        </div>

        {children}

        {zoomControls && (
          <div className="absolute right-[16px] bottom-[16px] flex flex-col overflow-hidden rounded-base bg-surface shadow-[0_1px_2px_#0C0A090D] outline-1 -outline-offset-1 outline-line-strong" onPointerDown={(e) => e.stopPropagation()}>
            {[
              { icon: Plus, label: 'Zoom in', fn: () => zoomBy(1.2) },
              { icon: Minus, label: 'Zoom out', fn: () => zoomBy(1 / 1.2) },
              { icon: Maximize2, label: 'Reset view', fn: reset },
            ].map(({ icon: Icon, label: l, fn }) => (
              <button key={l} type="button" aria-label={l} title={l} onClick={fn} className="flex size-[30px] items-center justify-center text-muted hover:bg-soft hover:text-ink">
                <Icon size={14} aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    </ContextMenuArea>
  )
}
