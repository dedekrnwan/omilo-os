import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force'
import { Maximize2, Minus, Plus } from 'lucide-react'
import type { GraphEdge, GraphNode } from './data'

type SimNode = GraphNode & SimulationNodeDatum
type SimLink = { source: SimNode; target: SimNode }

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface ForceGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  colorOf: (n: GraphNode) => string
  selected: string | null
  onSelect: (id: string | null) => void
  /** Rendered at the selected node's live screen position (follows the simulation). */
  renderCard?: (node: GraphNode, pos: { left: number; top: number }) => ReactNode
}

/**
 * Force-directed document graph (d3-force): drag a node to pull it, drag the
 * canvas to pan, scroll or use the buttons to zoom, click to select. Node size
 * grows with how many docs link to it; colour comes from its area.
 *
 * A real simulation (vs. hardcoded coordinates) is what makes the graph feel
 * alive — nodes settle, nudge their neighbours, and respond to the pointer.
 */
export function ForceGraph({ nodes, edges, colorOf, selected, onSelect, renderCard }: ForceGraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 520 })
  const [, setTick] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const sim = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null)
  const drag = useRef<{ node?: SimNode; pan?: { x: number; y: number; vx: number; vy: number }; moved?: boolean } | null>(null)

  // Track the container size so the graph fills the canvas and recenters.
  useEffect(() => {
    if (!box.current) return
    const ro = new ResizeObserver((e) =>
      setSize({ w: Math.max(320, e[0].contentRect.width), h: Math.max(320, e[0].contentRect.height) }),
    )
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [])

  // Degree (link count) drives node radius.
  const degree = useMemo(() => {
    const d = new Map<string, number>()
    for (const e of edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1)
      d.set(e.to, (d.get(e.to) ?? 0) + 1)
    }
    return d
  }, [edges])

  const data = useMemo(() => {
    // Seed from the authored coordinates (centred on origin) for a stable start.
    const ns: SimNode[] = nodes.map((n) => ({ ...n, x: n.x - 360, y: n.y - 230 }))
    const byId = new Map(ns.map((n) => [n.id, n]))
    const ls: SimLink[] = edges
      .filter((e) => byId.has(e.from) && byId.has(e.to))
      .map((e) => ({ source: byId.get(e.from)!, target: byId.get(e.to)! }))
    return { ns, ls, byId }
  }, [nodes, edges])

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const l of data.ls) {
      ;(m.get(l.source.id) ?? m.set(l.source.id, new Set()).get(l.source.id)!).add(l.target.id)
      ;(m.get(l.target.id) ?? m.set(l.target.id, new Set()).get(l.target.id)!).add(l.source.id)
    }
    return m
  }, [data])

  const radius = (n: SimNode) => {
    const base = n.size === 'lg' ? 8 : 5
    return base + Math.min(5, Math.sqrt(degree.get(n.id) ?? 0) * 1.6)
  }

  useEffect(() => {
    const s = forceSimulation<SimNode>(data.ns)
      .force('link', forceLink<SimNode, SimLink>(data.ls).id((d) => d.id).distance(66).strength(0.55))
      .force('charge', forceManyBody().strength(-290))
      .force('collide', forceCollide<SimNode>().radius((d) => radius(d) + 14))
      .force('x', forceX(0).strength(0.05))
      .force('y', forceY(0).strength(0.07))
      .force('center', forceCenter(0, 0))
      .alphaDecay(0.035)
      .on('tick', () => setTick((t) => t + 1))
    sim.current = s
    // Reduced motion: skip the settling animation, jump straight to the result.
    if (prefersReducedMotion()) {
      s.stop()
      for (let i = 0; i < 300; i++) s.tick()
      setTick((t) => t + 1)
    }
    return () => void s.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const toWorld = (cx: number, cy: number) => {
    const rect = box.current!.getBoundingClientRect()
    return { x: (cx - rect.left - size.w / 2 - view.x) / view.k, y: (cy - rect.top - size.h / 2 - view.y) / view.k }
  }
  const hit = (cx: number, cy: number) => {
    const p = toWorld(cx, cy)
    let best: SimNode | undefined
    let bd = Infinity
    for (const n of data.ns) {
      const d = Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y)
      if (d < Math.max(12, radius(n) + 7) / Math.min(1, view.k) && d < bd) {
        best = n
        bd = d
      }
    }
    return best
  }

  const onDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const n = hit(e.clientX, e.clientY)
    if (n) {
      drag.current = { node: n, moved: false }
      n.fx = n.x
      n.fy = n.y
      sim.current?.alphaTarget(0.3).restart()
    } else {
      drag.current = { pan: { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }
    }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) {
      setHover(hit(e.clientX, e.clientY)?.id ?? null)
      return
    }
    if (d.node) {
      const p = toWorld(e.clientX, e.clientY)
      d.node.fx = p.x
      d.node.fy = p.y
      d.moved = true
    } else if (d.pan) {
      setView((v) => ({ ...v, x: d.pan!.vx + e.clientX - d.pan!.x, y: d.pan!.vy + e.clientY - d.pan!.y }))
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.node) {
      sim.current?.alphaTarget(0)
      d.node.fx = null
      d.node.fy = null
      if (!d.moved) onSelect(d.node.id === selected ? null : d.node.id)
    }
  }
  const onWheel = (e: React.WheelEvent) => {
    const k = Math.max(0.35, Math.min(3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)))
    setView((v) => ({ ...v, k }))
  }

  const focus = hover ?? selected
  const near = focus ? neighbors.get(focus) ?? new Set<string>() : null
  const dim = (id: string) => !!near && id !== focus && !near.has(id)
  const showLabels = view.k >= 0.75 || data.ns.length < 40

  const selectedNode = selected ? data.byId.get(selected) : undefined
  const cardPos = selectedNode
    ? { left: size.w / 2 + view.x + (selectedNode.x ?? 0) * view.k, top: size.h / 2 + view.y + (selectedNode.y ?? 0) * view.k }
    : null

  const zoomBy = (f: number) => setView((v) => ({ ...v, k: Math.max(0.35, Math.min(3, v.k * f)) }))

  return (
    <div ref={box} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface" onWheel={onWheel}>
      <svg
        width={size.w}
        height={size.h}
        role="img"
        aria-label={`Document graph: ${data.ns.length} docs, ${data.ls.length} links`}
        className="select-none touch-none"
        style={{ cursor: hover ? 'pointer' : drag.current?.pan ? 'grabbing' : 'grab' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => {
          setHover(null)
          if (drag.current?.pan) drag.current = null
        }}
      >
        <g transform={`translate(${size.w / 2 + view.x},${size.h / 2 + view.y}) scale(${view.k})`}>
          {data.ls.map((l, i) => {
            const on = focus === l.source.id || focus === l.target.id
            return (
              <line
                key={i}
                x1={l.source.x}
                y1={l.source.y}
                x2={l.target.x}
                y2={l.target.y}
                stroke={on ? 'var(--color-ink-2)' : 'var(--color-line-strong)'}
                strokeWidth={on ? 1.75 : 1.25}
                strokeOpacity={focus && !on ? 0.35 : 1}
                className="transition-[stroke,stroke-opacity] duration-150"
              />
            )
          })}
          {data.ns.map((n) => {
            const r = radius(n)
            const color = colorOf(n)
            const isSel = n.id === selected
            const faded = dim(n.id)
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                className="transition-opacity duration-150"
                style={{ opacity: faded ? 0.3 : 1 }}
              >
                {isSel && <circle r={r + 5} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.45} />}
                <circle r={r} fill={color} stroke="var(--color-surface)" strokeWidth={2} />
                {(showLabels || n.id === focus || near?.has(n.id)) && (
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    fontSize={10}
                    fill={n.id === focus ? 'var(--color-ink)' : 'var(--color-muted)'}
                    fontWeight={n.id === focus ? 600 : 400}
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.label.length > 24 ? n.label.slice(0, 23) + '…' : n.label}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {selectedNode && cardPos && renderCard?.(selectedNode, cardPos)}

      {/* Zoom controls */}
      <div className="absolute right-[16px] bottom-[16px] flex flex-col gap-[2px]">
        {[
          { icon: Plus, label: 'Zoom in', fn: () => zoomBy(1.25) },
          { icon: Minus, label: 'Zoom out', fn: () => zoomBy(0.8) },
          { icon: Maximize2, label: 'Reset view', fn: () => setView({ x: 0, y: 0, k: 1 }) },
        ].map(({ icon: Icon, label, fn }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            onClick={fn}
            className="flex size-[28px] items-center justify-center rounded-sm bg-surface text-muted outline-1 -outline-offset-1 outline-line-strong transition hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ink active:scale-90"
          >
            <Icon size={14} aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}
