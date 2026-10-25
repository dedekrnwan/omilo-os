// ── Office Flow Draft from Suggested ─────────────────────────────────────────
// Matches design ref: SgKgq.png
// Canvas with "Draft: not running" state + Dev-authored annotations on nodes.
// Reuses canvas node rendering from OfficeFlowCanvasRoute but adds annotation bubbles.

import { useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Play,
  MoreHorizontal,
  Trash2,
  Check,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '../../../ui/ds/Button'
import { Mascot } from '../../../ui/ds/Mascot'
import {
  CANVAS_NODES,
  CANVAS_EDGES,
  STEP_PALETTE,
  DRAFT_ANNOTATIONS,
} from './data'
import type { CanvasNode } from './data'
import { NODE_COLORS, NODE_KIND_LABEL } from './shared'

// ── Step palette (same as canvas, reused here inline) ────────────────────────

function StepPalette() {
  return (
    <div
      className="flex h-full w-[200px] shrink-0 flex-col gap-[12px] overflow-y-auto border-r border-line bg-app px-[8px] py-[10px]"
      aria-label="Step palette"
    >
      <div className="relative">
        <input
          type="search"
          placeholder="Search steps and apps"
          className="h-[28px] w-full rounded-sm bg-hover px-[8px] text-[12px] text-ink outline-none placeholder:text-faint"
          readOnly
        />
      </div>
      {STEP_PALETTE.map((group) => (
        <div key={group.label} className="flex flex-col gap-px">
          <span className="px-[4px] pb-[4px] text-[10px] font-semibold tracking-[1px] text-faint">
            {group.label}
          </span>
          {group.items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="flex h-[28px] w-full items-center gap-[8px] rounded-sm px-[8px] text-left text-[12.5px] text-ink-2 transition-colors hover:bg-hover"
            >
              <span
                className="size-[8px] shrink-0 rounded-full"
                style={{ background: NODE_COLORS[item.kind].badgeText }}
                aria-hidden
              />
              {item.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Annotation bubble ─────────────────────────────────────────────────────────

interface AnnotationBubbleProps {
  text: string
  anchorX: number
  anchorY: number
  side?: 'right' | 'bottom'
  onDiscard?: () => void
}

function AnnotationBubble({ text, anchorX, anchorY, side = 'right', onDiscard }: AnnotationBubbleProps) {
  const lines = text.split('\n')
  const offsetX = side === 'right' ? 16 : 0
  const offsetY = side === 'bottom' ? 16 : -20

  return (
    <div
      className="absolute z-10 flex max-w-[240px] flex-col gap-[8px] rounded-lg bg-surface p-[12px] shadow-[0_4px_16px_#0C0A0920] outline-1 -outline-offset-1 outline-line-strong"
      style={{ left: anchorX + offsetX, top: anchorY + offsetY }}
      role="note"
    >
      <div className="flex items-start gap-[8px]">
        <Mascot size={22} radius={6} area="dev" />
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          {lines.map((line, i) => (
            <p key={i} className="m-0 text-[12px] leading-[1.5] text-ink-2">{line}</p>
          ))}
        </div>
      </div>
      {onDiscard && (
        <button
          type="button"
          onClick={onDiscard}
          className="self-end text-[11.5px] text-faint hover:text-muted transition-colors"
        >
          Discard
        </button>
      )}
    </div>
  )
}

// ── Draft node card ───────────────────────────────────────────────────────────

function DraftNodeCard({
  node,
  selected,
  onClick,
  hasAnnotation,
}: {
  node: CanvasNode
  selected: boolean
  onClick: () => void
  hasAnnotation: boolean
}) {
  const colors = NODE_COLORS[node.kind]
  const kindLabel = NODE_KIND_LABEL[node.kind]
  const isCondition = node.kind === 'condition'

  if (isCondition) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className="absolute flex items-center gap-[6px] rounded-pill px-[14px] text-[12px] font-medium text-ink transition-colors"
        style={{
          left: node.x,
          top: node.y,
          height: node.height,
          width: node.width,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-line-strong)',
          boxShadow: selected ? `0 0 0 2px var(--color-primary)` : undefined,
        }}
      >
        <span className="text-[11px] font-semibold tracking-wide text-muted">IF</span>
        <span>{node.label}</span>
        {hasAnnotation && (
          <span
            aria-hidden
            className="absolute -top-[4px] -right-[4px] size-[8px] rounded-full"
            style={{ background: '#6366F1' }}
          />
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="absolute flex flex-col gap-[6px] rounded-lg p-[12px] text-left transition-colors"
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        minHeight: node.height,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        boxShadow: selected ? `0 0 0 2px var(--color-primary)` : '0 1px 4px #0C0A090A',
      }}
    >
      <div className="flex items-center gap-[6px]">
        <span
          className="inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold tracking-[0.5px]"
          style={{ background: colors.badge, color: colors.badgeText }}
        >
          {kindLabel}
        </span>
        <span className="ml-auto text-[10.5px] text-faint">Draft</span>
        {hasAnnotation && (
          <span
            aria-hidden
            className="size-[8px] shrink-0 rounded-full"
            style={{ background: '#6366F1' }}
          />
        )}
      </div>
      <span className="text-[13px] font-medium text-ink leading-[1.3]">{node.label}</span>
      {node.sublabel && (
        <span className="text-[11.5px] text-muted leading-[1.4]">{node.sublabel}</span>
      )}
    </button>
  )
}

// ── Canvas edges (same as main canvas) ────────────────────────────────────────

function CanvasEdges() {
  const centers = Object.fromEntries(
    CANVAS_NODES.map((n) => [
      n.id,
      {
        cx: n.x + n.width / 2,
        bottomY: n.y + n.height,
        topY: n.y,
      },
    ])
  )

  return (
    <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%" overflow="visible" aria-hidden>
      {CANVAS_EDGES.map((edge) => {
        const from = centers[edge.from]
        const to = centers[edge.to]
        if (!from || !to) return null
        const x1 = from.cx
        const y1 = from.bottomY
        const x2 = to.cx
        const y2 = to.topY
        const midY = (y1 + y2) / 2
        const path = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`
        const labelX = (x1 + x2) / 2
        const labelY = (y1 + y2) / 2
        return (
          <g key={edge.id}>
            <path d={path} fill="none" stroke="var(--color-line-strong)" strokeWidth={1.5} strokeLinecap="round" />
            {edge.label && (
              <>
                <rect x={labelX - 12} y={labelY - 9} width={24} height={16} rx={4} fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth={1} />
                <text x={labelX} y={labelY + 3} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontWeight={600}>{edge.label}</text>
              </>
            )}
            <polygon points={`${x2},${y2} ${x2 - 4},${y2 - 7} ${x2 + 4},${y2 - 7}`} fill="var(--color-line-strong)" />
          </g>
        )
      })}
    </svg>
  )
}

// ── Right panel (step detail — same structure as canvas) ─────────────────────

function StepDetailPanel({ node }: { node: CanvasNode }) {
  const colors = NODE_COLORS[node.kind]
  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col gap-[0px] overflow-y-auto border-l border-line bg-surface">
      <div className="flex items-center gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span
          className="inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold"
          style={{ background: colors.badge, color: colors.badgeText }}
        >
          {NODE_KIND_LABEL[node.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{node.label}</span>
        <button type="button" className="flex size-[22px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-muted" aria-label="More options">
          <MoreHorizontal size={13} aria-hidden />
        </button>
      </div>
      <div className="flex flex-col gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Agent</span>
        <div className="flex items-center gap-[8px]">
          <Mascot size={24} radius={6} area="ops" />
          <span className="text-[12.5px] font-medium text-ink">Ops</span>
        </div>
      </div>
      <div className="flex flex-col gap-[8px] px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Instructions</span>
        <p className="m-0 text-[12px] leading-[1.5] text-ink-2">
          Read the logs from{' '}
          <span className="inline-flex items-center rounded-sm px-[4px] py-[1px] text-[11.5px] font-medium" style={{ background: 'var(--color-info-tint)', color: 'var(--color-info)' }}>
            Toggle_logs
          </span>
          . Say what broke in one sentence, the most likely cause, and rate severity P0–P3. Never re-run the deploy.
        </p>
      </div>
      <div className="flex flex-col gap-[6px] px-[14px] pb-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Returns</span>
        <div className="flex flex-wrap gap-[4px]">
          {['summary', 'cause', 'severity'].map((f) => (
            <span key={f} className="inline-flex h-[20px] items-center rounded-pill px-[7px] text-[11px] font-medium" style={{ background: 'var(--color-soft)', color: 'var(--color-ink-2)' }}>
              {f}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-auto border-t border-line px-[14px] py-[10px]">
        <button type="button" className="flex items-center gap-[6px] text-[12px] text-muted hover:text-ink-2 transition-colors">
          <Play size={12} aria-hidden />
          Test this step with last run data
        </button>
      </div>
    </div>
  )
}

// ── OfficeFlowDraftPage ────────────────────────────────────────────────────────

function OfficeFlowDraftPage() {
  const [selectedNodeId, setSelectedNodeId] = useState<string>('n-read-logs')
  const [dismissedAnnotations, setDismissedAnnotations] = useState<Set<string>>(new Set())
  const navigate = useNavigate()

  const selectedNode = CANVAS_NODES.find((n) => n.id === selectedNodeId)

  function dismissAnnotation(nodeId: string) {
    setDismissedAnnotations((prev) => new Set([...prev, nodeId]))
  }

  const annotationMap = Object.fromEntries(
    DRAFT_ANNOTATIONS.filter((a) => !dismissedAnnotations.has(a.nodeId)).map((a) => [a.nodeId, a])
  )

  // Compute annotation positions based on node positions
  const annotationPositions: Record<string, { x: number; y: number; side: 'right' | 'bottom' }> = {
    'n-read-logs': { x: CANVAS_NODES.find(n => n.id === 'n-read-logs')!.x + CANVAS_NODES.find(n => n.id === 'n-read-logs')!.width + 10, y: CANVAS_NODES.find(n => n.id === 'n-read-logs')!.y, side: 'right' },
    'n-condition': { x: CANVAS_NODES.find(n => n.id === 'n-condition')!.x - 260, y: CANVAS_NODES.find(n => n.id === 'n-condition')!.y - 10, side: 'right' },
    'n-notify-oncall': { x: CANVAS_NODES.find(n => n.id === 'n-notify-oncall')!.x + CANVAS_NODES.find(n => n.id === 'n-notify-oncall')!.width + 10, y: CANVAS_NODES.find(n => n.id === 'n-notify-oncall')!.y, side: 'right' },
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[14px]">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate({ to: '/office/flows' })}
          className="flex items-center gap-[4px] text-[12.5px] text-muted hover:text-ink-2 transition-colors"
        >
          <ArrowLeft size={13} aria-hidden />
          Flows
        </button>
        <ChevronRight size={12} aria-hidden className="text-faint" />
        <span className="text-[12.5px] font-medium text-ink">Deploy failure triage</span>
        <span className="inline-flex h-[20px] items-center gap-[5px] rounded-pill px-[7px] text-[11px] font-medium" style={{ background: '#14B8A620', color: '#14B8A6' }}>
          Engineering
        </span>

        {/* Draft badge */}
        <span
          className="inline-flex h-[22px] items-center rounded-pill px-[9px] text-[11.5px] font-medium"
          style={{ background: 'var(--color-warn-tint)', color: 'var(--color-warn)' }}
        >
          Draft · not running
        </span>

        <span className="flex-1" />

        {/* Tab bar */}
        <div className="flex items-center gap-px">
          {(['Canvas', 'Runs', 'Settings'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className="h-[28px] rounded-sm px-[10px] text-[12.5px] font-medium transition-colors"
              style={{
                background: tab === 'Canvas' ? 'var(--color-hover)' : 'transparent',
                color: tab === 'Canvas' ? 'var(--color-ink)' : 'var(--color-muted)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <span className="text-[11.5px] text-faint">~$0.02 a run</span>
        <Button variant="secondary" height={28} icon={Play}>Test run</Button>
        <Button variant="primary" height={28}>Turn on live</Button>
      </header>

      {/* Dev authoring notice */}
      <div className="flex items-center gap-[10px] border-b border-line bg-soft px-[16px] py-[8px]">
        <Mascot size={20} radius={5} area="dev" />
        <p className="m-0 text-[12.5px] text-ink-2">
          Dev drafted this from 4 triages you did by hand. Check each step, run a test on last week's failures, then turn it on. Nothing runs until you do.
        </p>
        <button type="button" className="ml-auto flex items-center gap-[4px] text-[12px] text-muted hover:text-ink-2 transition-colors shrink-0">
          <Trash2 size={12} aria-hidden />
          Discard
        </button>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <StepPalette />

        {/* Canvas */}
        <div className="relative flex-1 overflow-auto bg-[#F7F6F3]" style={{ backgroundImage: 'radial-gradient(circle, var(--color-line-strong) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
          <div className="relative" style={{ minWidth: 960, minHeight: 700 }}>
            <CanvasEdges />

            {CANVAS_NODES.map((node) => {
              const annotation = annotationMap[node.id]
              const pos = annotationPositions[node.id]
              return (
                <div key={node.id}>
                  <DraftNodeCard
                    node={node}
                    selected={node.id === selectedNodeId}
                    onClick={() => setSelectedNodeId(node.id)}
                    hasAnnotation={!!annotation}
                  />
                  {annotation && pos && (
                    <AnnotationBubble
                      text={annotation.text}
                      anchorX={pos.x}
                      anchorY={pos.y}
                      side={pos.side}
                      onDiscard={node.id !== 'n-condition' ? () => dismissAnnotation(node.id) : undefined}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Bottom confirm bar */}
          <div className="absolute bottom-0 left-0 right-0 flex h-[48px] items-center gap-[8px] border-t border-line bg-surface px-[16px]">
            <button
              type="button"
              className="flex items-center gap-[5px] rounded-btn h-[28px] px-[10px] text-[12px] font-medium text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
            >
              <Play size={12} aria-hidden />
              Test this step with last run data
            </button>
            <span className="flex-1" />
            <Button variant="secondary" height={28} icon={Trash2}>Discard draft</Button>
            <Button variant="primary" height={28} icon={Check}>Approve & turn on</Button>
          </div>
        </div>

        {selectedNode && <StepDetailPanel node={selectedNode} />}
      </div>
    </div>
  )
}

// ── OfficeFlowDraftRoute ──────────────────────────────────────────────────────

/**
 * Draft-from-suggested view for /office/flows/:flowId/draft.
 * Shows the Dev-authored canvas with annotation bubbles and an approval bar.
 */
export function OfficeFlowDraftRoute() {
  return <OfficeFlowDraftPage />
}
