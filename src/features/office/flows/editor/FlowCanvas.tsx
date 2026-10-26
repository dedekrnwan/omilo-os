import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { CircleCheck, Hand, Maximize, Minus, MousePointer2, Plus, Redo2, Undo2 } from 'lucide-react'
import * as Popover from '@radix-ui/react-popover'
import { Mascot } from '../../../../ui/ds/Mascot'
import { menuSurface } from '../../../../ui/ds/Menu'
import { PALETTE } from './data'
import type { FlowEdge, FlowNode, PaletteItem } from './data'
import { PALETTE_ICON, StepTile, nodeGlyph } from './icons'
import { PALETTE_MIME, paletteItem } from './Palette'
import { nodeHeight, nodeWidth } from './store'
import type { Graph } from './store'

export type Tool = 'select' | 'pan'

const DOTS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect x='11' y='11' width='2' height='2' fill='%23EBEAE8'/%3E%3C/svg%3E\")"

const WIRE = '#BCB8B4'

interface Pt {
  x: number
  y: number
}

/** Orthogonal route between two nodes: down, across at `via`, down. */
export function edgeRoute(e: FlowEdge, nodes: FlowNode[]) {
  const a = nodes.find((n) => n.id === e.from)
  const b = nodes.find((n) => n.id === e.to)
  if (!a || !b) return null
  const p1: Pt = { x: a.x + nodeWidth(a) / 2, y: a.y + nodeHeight(a) }
  const p2: Pt = { x: b.x + nodeWidth(b) / 2, y: b.y }
  const straight = Math.abs(p1.x - p2.x) < 1
  const via = e.via ?? (p1.y + p2.y) / 2
  const d = straight ? `M${p1.x} ${p1.y} V${p2.y}` : `M${p1.x} ${p1.y} V${via} H${p2.x} V${p2.y}`
  return { d, p1, p2, via, straight, mid: { x: p1.x, y: (p1.y + p2.y) / 2 } }
}

function EdgePlus({ edge, at, onInsert }: { edge: FlowEdge; at: Pt; onInsert: (edge: FlowEdge, item: PaletteItem) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Insert a step here"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute flex size-[18px] items-center justify-center rounded-full bg-surface text-faint outline-1 -outline-offset-1 outline-line-strong transition hover:scale-110 hover:text-ink focus-visible:ring-2 focus-visible:ring-ink"
          style={{ left: at.x - 9, top: at.y - 9 }}
        >
          <Plus size={11} strokeWidth={2.25} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side="right" align="center" sideOffset={8} className={`z-50 flex w-[220px] flex-col ${menuSurface}`}>
          <p className="m-0 px-[8px] pt-[4px] pb-[2px] text-[11px] font-medium tracking-[0.6px] text-faint">INSERT A STEP</p>
          {PALETTE.flatMap((g) => g.items)
            .filter((i) => i.kind !== 'trigger')
            .slice(0, 8)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onInsert(edge, item)
                  setOpen(false)
                }}
                className="flex h-[30px] items-center gap-[8px] rounded-sm px-[8px] text-left text-[12.5px] text-ink hover:bg-hover"
              >
                <StepTile icon={PALETTE_ICON[item.icon]} tone={item.tone} size={20} />
                {item.label}
              </button>
            ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** One step card on the canvas. */
function NodeCard({
  node,
  selected,
  draft,
  showLast,
  onSelect,
  onDragStart,
}: {
  node: FlowNode
  selected: boolean
  draft: boolean
  showLast: boolean
  onSelect: () => void
  onDragStart: (e: ReactPointerEvent) => void
}) {
  const { icon, tone } = nodeGlyph(node)
    const ring = selected
    ? 'outline-2 -outline-offset-2 outline-[#6366F1]'
    : draft
      ? 'outline-1 -outline-offset-1 outline-[#C7D2FE]'
      : 'outline-1 -outline-offset-1 outline-line-strong'
  const base = `absolute select-none bg-surface text-left shadow-[0_1px_2px_#0C0A090D,0_3px_8px_-2px_#0C0A090A] transition-shadow hover:shadow-[0_2px_4px_#0C0A0912,0_6px_14px_-4px_#0C0A0914] focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${ring}`

  if (node.kind === 'if') {
    return (
      <button
        type="button"
        data-node={node.id}
        aria-pressed={selected}
        aria-label={node.title}
        onClick={onSelect}
        onPointerDown={onDragStart}
        className={`${base} flex items-center gap-[8px] rounded-full px-[13px]`}
        style={{ left: node.x, top: node.y, width: 220, height: 44 }}
      >
        <StepGlyph icon={icon} />
        <span className="truncate text-[13px] font-medium text-ink">{node.title}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      data-node={node.id}
      aria-pressed={selected}
      aria-label={node.title}
      onClick={onSelect}
      onPointerDown={onDragStart}
      className={`${base} flex flex-col rounded-md px-[12px] pt-[11px]`}
      style={{ left: node.x, top: node.y, width: 260, height: 96 }}
    >
      <span className="flex h-[22px] w-full items-center gap-[7px]">
        <StepTile icon={icon} tone={tone} />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
          <span className="font-semibold tracking-[0.6px]">{node.kindLabel}</span>
          {node.source && <span className="font-medium"> · {node.source}</span>}
        </span>
        {node.helper && <Mascot size={18} radius={4} area={node.helper} still={false} />}
        {showLast && node.last && (
          <span className="flex items-center gap-[3px] text-[11px] text-faint">
            <CircleCheck size={11} aria-hidden className={node.last === 'waits' ? 'text-faint' : 'text-ok'} />
            {node.last}
          </span>
        )}
      </span>
      <span className="mt-[7px] w-full truncate text-[13.5px] font-semibold text-ink">{node.title}</span>
      {node.desc && <span className="mt-[5px] w-full truncate text-[12px] text-muted">{node.desc}</span>}
    </button>
  )
}

function StepGlyph({ icon: Icon }: { icon: typeof Plus }) {
  return <Icon size={14} aria-hidden className="shrink-0 text-ink-2" />
}

export interface CanvasProps {
  graph: Graph
  selected: string | null
  draft?: boolean
  showLast?: boolean
  onSelect: (id: string | null) => void
  onMove: (id: string, x: number, y: number, commit: boolean) => void
  onDrop: (item: PaletteItem, at: Pt) => void
  onInsert: (edge: FlowEdge, item: PaletteItem) => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onDelete: (id: string) => void
  /** Overlays in canvas space (draft notes) */
  layer?: ReactNode
  /** Overlays fixed to the viewport (last-run pill, panels) */
  overlay?: ReactNode
}

/**
 * The flow canvas: dotted board, orthogonal wires with Yes/No labels and
 * insert (+) buttons, draggable step cards, and the bottom-left toolbar
 * (select · pan · zoom in · undo · redo · zoom out · fit).
 */
export function FlowCanvas({
  graph,
  selected,
  draft = false,
  showLast = true,
  onSelect,
  onMove,
  onDrop,
  onInsert,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onDelete,
  layer,
  overlay,
}: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select')
  const [pan, setPan] = useState<Pt>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [space, setSpace] = useState(false)
  const [grabbing, setGrabbing] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null)
  const panning = tool === 'pan' || space

  // Keyboard: Delete removes the selected step, ⌘Z/⇧⌘Z undo/redo, space pans
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t.closest('input,textarea,[contenteditable=true]')) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        onDelete(selected)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) onRedo()
        else onUndo()
      } else if (e.key === ' ' && !e.repeat) {
        setSpace(true)
      } else if (e.key === 'Escape') {
        onSelect(null)
      }
    }
    function onUp(e: KeyboardEvent) {
      if (e.key === ' ') setSpace(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onUp)
    }
  }, [selected, onDelete, onUndo, onRedo, onSelect])

  function toCanvas(clientX: number, clientY: number): Pt {
    const r = ref.current?.getBoundingClientRect()
    return { x: (clientX - (r?.left ?? 0) - pan.x) / zoom, y: (clientY - (r?.top ?? 0) - pan.y) / zoom }
  }

  function startPan(e: ReactPointerEvent) {
    if (e.button !== 0 && e.button !== 1) return
    if (!panning && e.button === 0) {
      onSelect(null)
      return
    }
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, moved: false }
    setGrabbing(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  function startNode(node: FlowNode) {
    return (e: ReactPointerEvent) => {
      if (panning || e.button !== 0) return
      e.stopPropagation()
      drag.current = { kind: 'node', id: node.id, sx: e.clientX, sy: e.clientY, ox: node.x, oy: node.y, moved: false }
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    if (d.kind === 'pan') setPan({ x: d.ox + dx, y: d.oy + dy })
    else if (d.id) onMove(d.id, Math.round(d.ox + dx / zoom), Math.round(d.oy + dy / zoom), false)
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current
    drag.current = null
    setGrabbing(false)
    if (d?.kind === 'node' && d.id && d.moved) {
      // Snap to the 4px grid and record one undo step
      const x = Math.round((d.ox + (e.clientX - d.sx) / zoom) / 4) * 4 + 1
      const y = Math.round((d.oy + (e.clientY - d.sy) / zoom) / 4) * 4
      onMove(d.id, x, y, true)
    }
  }

  const zoomBy = (f: number) => setZoom((z) => Math.min(2, Math.max(0.4, Math.round(z * f * 100) / 100)))

  function fit() {
    const r = ref.current?.getBoundingClientRect()
    if (!r || graph.nodes.length === 0) {
      setPan({ x: 0, y: 0 })
      setZoom(1)
      return
    }
    const minX = Math.min(...graph.nodes.map((n) => n.x))
    const minY = Math.min(...graph.nodes.map((n) => n.y))
    const maxX = Math.max(...graph.nodes.map((n) => n.x + nodeWidth(n)))
    const maxY = Math.max(...graph.nodes.map((n) => n.y + nodeHeight(n)))
    const z = Math.min(1, (r.width - 80) / (maxX - minX), (r.height - 120) / (maxY - minY))
    setZoom(Math.round(z * 100) / 100)
    setPan({ x: (r.width - (maxX - minX) * z) / 2 - minX * z, y: (r.height - (maxY - minY) * z) / 2 - minY * z })
  }

  const routes = graph.edges.map((e) => ({ e, r: edgeRoute(e, graph.nodes) })).filter((x) => x.r)

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Flow canvas"
      data-zoom={zoom}
      className={`relative min-w-0 flex-1 overflow-hidden bg-soft ${panning ? (grabbing ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
      style={{ backgroundImage: DOTS, backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${24 * zoom}px ${24 * zoom}px` }}
      onPointerDown={startPan}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={(e) => {
        if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1)
        else setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PALETTE_MIME)) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const item = paletteItem(e.dataTransfer.getData(PALETTE_MIME))
        if (!item) return
        e.preventDefault()
        const p = toCanvas(e.clientX, e.clientY)
        onDrop(item, { x: Math.round(p.x - 130), y: Math.round(p.y - 24) })
      }}
    >
      <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1" aria-hidden>
          {routes.map(({ e, r }) => (
            <path key={`${e.from}-${e.to}`} d={r!.d} fill="none" stroke={WIRE} strokeWidth={2} />
          ))}
        </svg>
        {routes.map(({ e, r }) =>
          e.branch ? (
            <span
              key={`b-${e.from}-${e.to}`}
              className={`pointer-events-none absolute flex h-[17px] items-center rounded-xs px-[6px] text-[10.5px] font-semibold ${
                e.branch === 'yes' ? 'bg-[#FEF3C7] text-warn' : 'bg-app text-muted'
              }`}
              style={{ left: r!.p2.x - 14, top: r!.via - 10, transform: 'translateX(-50%)' }}
            >
              {e.branch === 'yes' ? 'Yes' : 'No'}
            </span>
          ) : null,
        )}
        {routes.map(({ e, r }) =>
          e.plus && r!.straight ? <EdgePlus key={`p-${e.from}-${e.to}`} edge={e} at={{ x: r!.mid.x, y: r!.mid.y - 2 }} onInsert={onInsert} /> : null,
        )}
        {layer}
        {graph.nodes.map((n) => (
          <NodeCard
            key={n.id}
            node={n}
            selected={n.id === selected}
            draft={draft}
            showLast={showLast}
            onSelect={() => onSelect(n.id)}
            onDragStart={startNode(n)}
          />
        ))}
      </div>

      {overlay}

      <div
        role="toolbar"
        aria-label="Canvas tools"
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-[18px] left-[16px] flex h-[33px] items-center gap-[4px] rounded-base bg-surface px-[4px] shadow-[0_1px_2px_#0C0A090D,0_2px_6px_#0C0A0908] outline-1 -outline-offset-1 outline-line-strong"
      >
        <ToolButton label="Select" active={tool === 'select' && !space} onClick={() => setTool('select')}>
          <MousePointer2 size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Pan (hold space)" active={panning} onClick={() => setTool('pan')}>
          <Hand size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Zoom in" onClick={() => zoomBy(1.2)}>
          <Plus size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Undo" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Redo" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
          <Minus size={14} aria-hidden />
        </ToolButton>
        <ToolButton label="Fit to screen" onClick={fit}>
          <Maximize size={14} aria-hidden />
        </ToolButton>
      </div>
    </div>
  )
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-[26px] items-center justify-center rounded-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink disabled:cursor-default disabled:text-muted ${
        active ? 'bg-app text-ink' : 'text-ink-2 hover:bg-soft'
      }`}
    >
      {children}
    </button>
  )
}
