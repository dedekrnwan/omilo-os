// ── Office Flow Canvas editor ─────────────────────────────────────────────────
// Matches design ref: ck4Kt.png + emtFw.png (canvas + test-run overlay)
// Interactive canvas: node selection, add-step from palette, toolbar tool modes,
// test-run mock state, publish. All local state only.

import { useReducer, useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  GitFork,
  Play,
  Power,
  Settings,
  ToggleLeft,
  MoreHorizontal,
  X,
  CheckCircle2,
  Clock,
  SkipForward,
} from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Button } from '../../../ui/ds/Button'
import { Mascot } from '../../../ui/ds/Mascot'
import {
  CANVAS_NODES,
  CANVAS_EDGES,
  STEP_PALETTE,
  TEST_RUN_RESULT,
  OFFICE_FLOWS,
} from './data'
import type { CanvasNode, CanvasEdge, NodeKind } from './data'
import { NODE_COLORS, NODE_KIND_LABEL } from './shared'

// ── Canvas state / reducer ────────────────────────────────────────────────────

interface CanvasState {
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  selectedNodeId: string | null
  activeTool: 'Move' | 'Connect' | 'Settings'
  testRunStatus: 'idle' | 'running' | 'done'
}

type CanvasAction =
  | { type: 'SELECT_NODE'; id: string | null }
  | { type: 'ADD_NODE'; kind: NodeKind; label: string }
  | { type: 'UPDATE_NODE_LABEL'; id: string; label: string }
  | { type: 'SET_TOOL'; tool: CanvasState['activeTool'] }
  | { type: 'START_TEST_RUN' }
  | { type: 'FINISH_TEST_RUN' }
  | { type: 'CLOSE_TEST_RUN' }

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'SELECT_NODE':
      return { ...state, selectedNodeId: action.id }

    case 'ADD_NODE': {
      const maxY = state.nodes.reduce((m, n) => Math.max(m, n.y + n.height), 0)
      const newNode: CanvasNode = {
        id: `n-new-${Date.now()}`,
        kind: action.kind,
        label: action.label,
        sublabel: '',
        x: 320,
        y: maxY + 40,
        width: 220,
        height: 68,
      }
      return {
        ...state,
        nodes: [...state.nodes, newNode],
        selectedNodeId: newNode.id,
      }
    }

    case 'UPDATE_NODE_LABEL':
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.id ? { ...n, label: action.label } : n
        ),
      }

    case 'SET_TOOL':
      return { ...state, activeTool: action.tool }

    case 'START_TEST_RUN':
      return { ...state, testRunStatus: 'running' }

    case 'FINISH_TEST_RUN':
      return { ...state, testRunStatus: 'done' }

    case 'CLOSE_TEST_RUN':
      return { ...state, testRunStatus: 'idle' }

    default:
      return state
  }
}

function initCanvasState(): CanvasState {
  return {
    nodes: CANVAS_NODES.map((n) => ({ ...n, selected: undefined })),
    edges: [...CANVAS_EDGES],
    selectedNodeId: 'n-read-logs',
    activeTool: 'Move',
    testRunStatus: 'idle',
  }
}

// ── Step palette sidebar ──────────────────────────────────────────────────────

function StepPalette({ onAddNode }: { onAddNode: (kind: NodeKind, label: string) => void }) {
  const [search, setSearch] = useState('')

  const filteredGroups = STEP_PALETTE.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      search.length === 0 || item.label.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((g) => g.items.length > 0)

  return (
    <div
      className="flex h-full w-[200px] shrink-0 flex-col gap-[12px] overflow-y-auto border-r border-line bg-app px-[8px] py-[10px]"
      aria-label="Step palette"
    >
      {/* Search */}
      <div className="relative">
        <input
          type="search"
          placeholder="Search steps and apps"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-[28px] w-full rounded-sm bg-hover px-[8px] text-[12px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      {filteredGroups.map((group) => (
        <div key={group.label} className="flex flex-col gap-px">
          <span className="px-[4px] pb-[4px] text-[10px] font-semibold tracking-[1px] text-faint">
            {group.label}
          </span>
          {group.items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onAddNode(item.kind, item.label)}
              className="flex h-[28px] w-full items-center gap-[8px] rounded-sm px-[8px] text-left text-[12.5px] text-ink-2 transition-colors hover:bg-hover"
              aria-label={`Add ${item.label}`}
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

// ── Canvas node ───────────────────────────────────────────────────────────────

function CanvasNodeCard({
  node,
  selected,
  onClick,
}: {
  node: CanvasNode
  selected: boolean
  onClick: () => void
}) {
  const colors = NODE_COLORS[node.kind]
  const kindLabel = NODE_KIND_LABEL[node.kind]

  const isTrigger = node.kind === 'trigger'
  const isCondition = node.kind === 'condition'

  if (isCondition) {
    // Diamond-like pill
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className="absolute flex items-center gap-[6px] rounded-pill px-[14px] text-[12px] font-medium text-ink transition-colors hover:opacity-90"
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
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="absolute flex flex-col gap-[6px] rounded-lg p-[12px] text-left transition-colors hover:opacity-90"
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
      {/* Kind badge row */}
      <div className="flex items-center gap-[6px]">
        <span
          className="inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold tracking-[0.5px]"
          style={{ background: colors.badge, color: colors.badgeText }}
        >
          {kindLabel}
        </span>
        {isTrigger && (
          <span className="text-[10.5px] text-faint">On 2m ago</span>
        )}
        {!isTrigger && (
          <span className="ml-auto text-[10.5px] text-faint">
            {node.kind === 'ai-step' ? '0 4s' : node.kind === 'approval' ? '0 1m' : '0 2s'}
          </span>
        )}
      </div>

      {/* Title + sublabel */}
      <span className="text-[13px] font-medium text-ink leading-[1.3]">{node.label}</span>
      {node.sublabel && (
        <span className="text-[11.5px] text-muted leading-[1.4]">{node.sublabel}</span>
      )}
    </button>
  )
}

// ── SVG edges ─────────────────────────────────────────────────────────────────

function CanvasEdgesView({ nodes, edges }: { nodes: CanvasNode[]; edges: CanvasEdge[] }) {
  // Build a map of node centers for edge routing
  const centers = Object.fromEntries(
    nodes.map((n) => [
      n.id,
      {
        cx: n.x + n.width / 2,
        bottomY: n.y + n.height,
        topY: n.y,
        leftX: n.x,
        rightX: n.x + n.width,
      },
    ])
  )

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      overflow="visible"
      aria-hidden
    >
      {edges.map((edge) => {
        const from = centers[edge.from]
        const to = centers[edge.to]
        if (!from || !to) return null

        const x1 = from.cx
        const y1 = from.bottomY
        const x2 = to.cx
        const y2 = to.topY
        const midY = (y1 + y2) / 2

        const path = `M ${x1} ${y1} C ${x1} ${midY} ${x2} ${midY} ${x2} ${y2}`

        // For condition edges going left/right
        const isCondition = edge.from === 'n-condition'
        const labelX = isCondition ? (x1 + x2) / 2 : x2 - 10
        const labelY = isCondition ? (y1 + y2) / 2 - 4 : midY

        return (
          <g key={edge.id}>
            <path
              d={path}
              fill="none"
              stroke="var(--color-line-strong)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            {edge.label && (
              <>
                <rect x={labelX - 12} y={labelY - 9} width={24} height={16} rx={4} fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth={1} />
                <text x={labelX} y={labelY + 3} textAnchor="middle" fontSize={10} fill="var(--color-muted)" fontWeight={600}>
                  {edge.label}
                </text>
              </>
            )}
            {/* Arrow head */}
            <polygon
              points={`${x2},${y2} ${x2 - 4},${y2 - 7} ${x2 + 4},${y2 - 7}`}
              fill="var(--color-line-strong)"
            />
          </g>
        )
      })}
    </svg>
  )
}

// ── Right detail panel (selected step) ───────────────────────────────────────

function StepDetailPanel({
  node,
  onLabelChange,
}: {
  node: CanvasNode
  onLabelChange: (id: string, label: string) => void
}) {
  return (
    <div
      className="flex h-full w-[260px] shrink-0 flex-col gap-[0px] overflow-y-auto border-l border-line bg-surface"
      aria-label="Step settings"
    >
      {/* Header */}
      <div className="flex items-center gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span
          className="inline-flex h-[18px] items-center rounded-pill px-[7px] text-[10px] font-semibold"
          style={{ background: NODE_COLORS[node.kind].badge, color: NODE_COLORS[node.kind].badgeText }}
        >
          {NODE_KIND_LABEL[node.kind]}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink"
          data-testid="detail-panel-label"
        >
          {node.label}
        </span>
        <button
          type="button"
          className="flex size-[22px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-muted"
          aria-label="More options"
        >
          <MoreHorizontal size={13} aria-hidden />
        </button>
      </div>

      {/* Editable label field */}
      <div className="flex flex-col gap-[6px] border-b border-line px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Step label</span>
        <input
          type="text"
          value={node.label}
          onChange={(e) => onLabelChange(node.id, e.target.value)}
          className="rounded-base bg-soft px-[8px] py-[5px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
          aria-label="Step label"
        />
      </div>

      {/* Agent */}
      <div className="flex flex-col gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Agent</span>
        <div className="flex items-center gap-[8px]">
          <Mascot size={24} radius={6} area="ops" />
          <span className="text-[12.5px] font-medium text-ink">Ops</span>
        </div>
      </div>

      {/* Instructions */}
      <div className="flex flex-col gap-[8px] border-b border-line px-[14px] py-[12px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Instructions</span>
          <span className="text-[10.5px] text-faint">Type / for fields</span>
        </div>
        <p className="m-0 text-[12px] leading-[1.5] text-ink-2">
          Read the logs from{' '}
          <span
            className="inline-flex items-center rounded-sm px-[4px] py-[1px] text-[11.5px] font-medium"
            style={{ background: 'var(--color-info-tint)', color: 'var(--color-info)' }}
          >
            Toggle_logs
          </span>
          . Say what broke in one sentence, the most likely cause, and rate severity P0–P3. Never re-run the deploy.
        </p>
      </div>

      {/* Returns */}
      <div className="flex flex-col gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Returns</span>
        <div className="flex flex-wrap gap-[4px]">
          {['summary', 'cause', 'severity'].map((f) => (
            <span
              key={f}
              className="inline-flex h-[20px] items-center rounded-pill px-[7px] text-[11px] font-medium"
              style={{ background: 'var(--color-soft)', color: 'var(--color-ink-2)' }}
            >
              {f}
            </span>
          ))}
        </div>
      </div>

      {/* Guardrails */}
      <div className="flex flex-col gap-[8px] border-b border-line px-[14px] py-[12px]">
        <span className="text-[11px] font-semibold tracking-[0.8px] text-faint">Guardrails</span>
        <div className="flex flex-col gap-[6px]">
          {[
            { label: 'Read-only — can\'t change code or infra', on: true },
            { label: 'Stop after 3 tool calls', on: true },
            { label: 'Ask in Inbox if unsure', on: false },
          ].map(({ label, on }) => (
            <div key={label} className="flex items-center gap-[8px]">
              <span
                role="switch"
                aria-checked={on}
                className="relative inline-flex h-[14px] w-[24px] shrink-0 items-center rounded-pill transition-colors"
                style={{ background: on ? 'var(--color-helper-brand)' : 'var(--color-line-strong)' }}
              >
                <span
                  className="absolute size-[10px] rounded-full bg-white shadow-sm transition-transform"
                  style={{ transform: on ? 'translateX(12px)' : 'translateX(2px)' }}
                />
              </span>
              <span className="text-[11.5px] text-muted">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: cost estimate */}
      <div className="px-[14px] py-[10px]">
        <span className="text-[11.5px] text-faint">Only AI step in this flow · ~$0.015 a run</span>
      </div>

      {/* Test this step */}
      <div className="mt-auto border-t border-line px-[14px] py-[10px]">
        <button
          type="button"
          className="flex items-center gap-[6px] text-[12px] text-muted transition-colors hover:text-ink-2"
        >
          <Play size={12} aria-hidden />
          Test this step with last run data
        </button>
      </div>
    </div>
  )
}

// ── Test run result overlay ────────────────────────────────────────────────────

function TestRunOverlay({
  status,
  onClose,
  onRunAgain,
}: {
  status: 'running' | 'done'
  onClose: () => void
  onRunAgain: () => void
}) {
  const r = TEST_RUN_RESULT

  if (status === 'running') {
    return (
      <div
        className="absolute bottom-[60px] left-1/2 z-20 flex w-[420px] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface shadow-[0_8px_32px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong"
        role="region"
        aria-label="Test run running"
        aria-live="polite"
      >
        <div className="flex items-center gap-[8px] px-[14px] py-[12px]">
          <span className="inline-block size-[14px] animate-spin rounded-full border-2 border-line-strong border-t-primary shrink-0" aria-hidden />
          <span className="text-[12.5px] font-medium text-ink">Running test…</span>
          <button
            type="button"
            aria-label="Close test result"
            onClick={onClose}
            className="ml-auto flex size-[22px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-muted"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className="absolute bottom-[60px] left-1/2 z-20 flex w-[420px] -translate-x-1/2 flex-col overflow-hidden rounded-lg bg-surface shadow-[0_8px_32px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong"
      role="region"
      aria-label="Test run result"
    >
      {/* Header */}
      <div className="flex items-center gap-[8px] border-b border-line px-[14px] py-[10px]">
        <CheckCircle2 size={14} aria-hidden className="text-[var(--color-ok)] shrink-0" />
        <span className="text-[12.5px] font-medium text-ink">Test passed</span>
        <span className="text-[11.5px] text-muted">{r.dataNote}</span>
        <button
          type="button"
          aria-label="Close test result"
          onClick={onClose}
          className="ml-auto flex size-[22px] shrink-0 items-center justify-center rounded-sm text-faint hover:bg-hover hover:text-muted"
        >
          <X size={13} aria-hidden />
        </button>
      </div>

      {/* Steps */}
      <div className="flex flex-col divide-y divide-line">
        {r.steps.map((step) => (
          <div key={step.label} className="flex items-center gap-[10px] px-[14px] py-[9px]">
            {step.skipped ? (
              <SkipForward size={13} aria-hidden className="shrink-0 text-faint" />
            ) : (
              <CheckCircle2 size={13} aria-hidden className="shrink-0 text-[var(--color-ok)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{step.label}</span>
            <span className="text-[11.5px] text-muted shrink-0 whitespace-nowrap">{step.detail}</span>
            {step.durationMs !== undefined && step.durationMs > 0 && (
              <span className="text-[11px] text-faint shrink-0">{step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}</span>
            )}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-[8px] border-t border-line px-[14px] py-[10px]">
        <button
          type="button"
          className="flex items-center gap-[5px] text-[12px] text-muted hover:text-ink-2 transition-colors"
          onClick={onClose}
        >
          <Clock size={12} aria-hidden />
          View full log
        </button>
        <span className="flex-1" />
        <Button variant="secondary" height={28} onClick={onRunAgain}>Run again</Button>
        <Button variant="primary" height={28}>Publish changes</Button>
      </div>
    </div>
  )
}

// ── Canvas toolbar (bottom) ───────────────────────────────────────────────────

const CANVAS_TOOLS: Array<{ icon: typeof GitFork; label: 'Move' | 'Connect' | 'Settings' }> = [
  { icon: GitFork, label: 'Move' },
  { icon: ToggleLeft, label: 'Connect' },
  { icon: Settings, label: 'Settings' },
]

function CanvasBottomBar({
  activeTool,
  onToolChange,
  onTestRun,
}: {
  activeTool: CanvasState['activeTool']
  onToolChange: (t: CanvasState['activeTool']) => void
  onTestRun: () => void
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 flex h-[48px] items-center gap-[8px] border-t border-line bg-surface px-[16px]">
      {/* Tool icons */}
      <div className="flex items-center gap-[2px]">
        {CANVAS_TOOLS.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            aria-pressed={activeTool === label}
            onClick={() => onToolChange(label)}
            className="flex size-[30px] items-center justify-center rounded-sm transition-colors"
            style={{
              background: activeTool === label ? 'var(--color-hover)' : 'transparent',
              color: activeTool === label ? 'var(--color-ink)' : 'var(--color-muted)',
            }}
          >
            <Icon size={14} aria-hidden />
          </button>
        ))}
      </div>

      <span className="flex-1" />

      <button
        type="button"
        onClick={onTestRun}
        className="flex items-center gap-[5px] rounded-btn h-[28px] px-[10px] text-[12px] font-medium text-muted outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft"
      >
        <Play size={12} aria-hidden />
        Test this step with last run data
      </button>
    </div>
  )
}

// ── OfficeFlowCanvasPage ───────────────────────────────────────────────────────

type CanvasTab = 'Canvas' | 'Runs' | 'Settings'
const CANVAS_TABS: CanvasTab[] = ['Canvas', 'Runs', 'Settings']

function OfficeFlowCanvasPage({ flowId }: { flowId?: string }) {
  const [state, dispatch] = useReducer(canvasReducer, undefined, initCanvasState)
  const [activeTab, setActiveTab] = useState<CanvasTab>('Canvas')
  const [flowOn, setFlowOn] = useState(true)
  const navigate = useNavigate()

  // Resolve flow title from route param (fall back gracefully for draft/chat ids)
  const resolvedFlow = flowId ? OFFICE_FLOWS.find((f) => f.id === flowId) : undefined
  const flowTitle = resolvedFlow?.title ?? 'Deploy failure triage'

  const selectedNode = state.nodes.find((n) => n.id === state.selectedNodeId)

  function handleTestRun() {
    dispatch({ type: 'START_TEST_RUN' })
    // Simulate async completion after 1.2s
    setTimeout(() => dispatch({ type: 'FINISH_TEST_RUN' }), 1200)
  }

  function handleRunAgain() {
    dispatch({ type: 'CLOSE_TEST_RUN' })
    handleTestRun()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[14px]">
        {/* Breadcrumb */}
        <button
          type="button"
          aria-label="Back to Flows"
          onClick={() => navigate({ to: '/office/flows' })}
          className="flex items-center gap-[4px] text-[12.5px] text-muted hover:text-ink-2 transition-colors"
        >
          <ArrowLeft size={13} aria-hidden />
          Flows
        </button>
        <ChevronRight size={12} aria-hidden className="text-faint" />
        <span className="text-[12.5px] font-medium text-ink">{flowTitle}</span>

        {/* Area chip */}
        <span className="inline-flex h-[20px] items-center gap-[5px] rounded-pill px-[7px] text-[11px] font-medium" style={{ background: '#14B8A620', color: '#14B8A6' }}>
          Engineering
        </span>

        {/* On/Off toggle */}
        <button
          type="button"
          aria-pressed={flowOn}
          onClick={() => setFlowOn(!flowOn)}
          className="flex items-center gap-[6px] rounded-pill px-[10px] h-[26px] text-[12px] font-medium transition-colors"
          style={{
            background: flowOn ? 'var(--color-ok-tint)' : 'var(--color-hover)',
            color: flowOn ? 'var(--color-ok)' : 'var(--color-muted)',
          }}
        >
          <Power size={11} aria-hidden />
          {flowOn ? 'On' : 'Off'}
        </button>

        <span className="flex-1" />

        {/* Tab bar */}
        <div className="flex items-center gap-px">
          {CANVAS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="h-[28px] rounded-sm px-[10px] text-[12.5px] font-medium transition-colors"
              style={{
                background: activeTab === tab ? 'var(--color-hover)' : 'transparent',
                color: activeTab === tab ? 'var(--color-ink)' : 'var(--color-muted)',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <span className="text-[11.5px] text-faint">~$0.01 a run</span>

        <Button variant="secondary" height={28} icon={Play} onClick={handleTestRun}>
          Test run
        </Button>
        <Button variant="primary" height={28}>
          Publish changes
        </Button>
      </header>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeTab === 'Canvas' ? (
          <>
            <StepPalette
              onAddNode={(kind, label) => dispatch({ type: 'ADD_NODE', kind, label })}
            />

            {/* Canvas area */}
            <div className="relative flex-1 overflow-auto bg-[#F7F6F3]" style={{ backgroundImage: 'radial-gradient(circle, var(--color-line-strong) 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
              {/* Nodes */}
              <div
                className="relative"
                style={{ minWidth: 900, minHeight: 640 }}
                data-testid="canvas-area"
              >
                <CanvasEdgesView nodes={state.nodes} edges={state.edges} />
                {state.nodes.map((node) => (
                  <CanvasNodeCard
                    key={node.id}
                    node={node}
                    selected={node.id === state.selectedNodeId}
                    onClick={() => dispatch({ type: 'SELECT_NODE', id: node.id })}
                  />
                ))}
              </div>

              {/* Test run overlay */}
              {state.testRunStatus !== 'idle' && (
                <TestRunOverlay
                  status={state.testRunStatus}
                  onClose={() => dispatch({ type: 'CLOSE_TEST_RUN' })}
                  onRunAgain={handleRunAgain}
                />
              )}

              <CanvasBottomBar
                activeTool={state.activeTool}
                onToolChange={(t) => dispatch({ type: 'SET_TOOL', tool: t })}
                onTestRun={handleTestRun}
              />
            </div>

            {/* Right panel */}
            {selectedNode && (
              <StepDetailPanel
                node={selectedNode}
                onLabelChange={(id, label) => dispatch({ type: 'UPDATE_NODE_LABEL', id, label })}
              />
            )}
          </>
        ) : activeTab === 'Runs' ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
            Runs tab — see OfficeFlowRunsRoute for the full runs history view.
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-[16px] p-[24px]">
            <h3 className="m-0 text-[15px] font-semibold text-ink">Flow settings</h3>
            <div className="flex flex-col gap-[10px] max-w-[400px]">
              {[
                { label: 'Flow name', value: flowTitle },
                { label: 'Area', value: 'Engineering' },
                { label: 'Runs as', value: 'Ops' },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-[5px]">
                  <label className="text-[12px] font-medium text-ink-2">{label}</label>
                  <input
                    type="text"
                    defaultValue={value}
                    className="rounded-base bg-soft px-[10px] py-[7px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── OfficeFlowCanvasRoute ─────────────────────────────────────────────────────

/**
 * Canvas editor for a specific flow at /office/flows/:flowId/canvas.
 * Inset wrapper is provided by OfficeLayout (no extra sidebar needed here —
 * the step palette is the in-canvas sidebar).
 */
export function OfficeFlowCanvasRoute() {
  // useParams returns unknown shape; access flowId safely
  const params = useParams({ strict: false }) as Record<string, string>
  return <OfficeFlowCanvasPage flowId={params.flowId} />
}
