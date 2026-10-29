import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Brain, Check, EyeOff, FileText, Link2, Search, Sparkles, Target } from 'lucide-react'
import type { Channel, DocGraph } from '../../../core/domain/types'
import { Mascot } from '../../../ui/ds/Mascot'
import { copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useDocGraph, usePatchDoc } from '../../../app/queries'
import { NetworkGraph } from './graph/NetworkGraph'
import { DOC_FRAME, areaColor, layoutDocGraph } from './graph/graphData'
import type { DocGraphNode } from './graph/graphData'
import { areaLabel, longAgo } from './docsUtil'

function CheckRow({ on, onChange, children, count }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode; count?: number }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-[21px] w-full items-center gap-[8px] rounded-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <span
        className={`flex size-[14px] shrink-0 items-center justify-center rounded-[4px] ${on ? 'bg-ink' : 'bg-surface outline-1 -outline-offset-1 outline-wire-strong'}`}
      >
        {on && <Check size={10} strokeWidth={3} aria-hidden className="text-white" />}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-[8px] text-[13px] text-ink-2">{children}</span>
      {count !== undefined && <span className="text-[11.5px] text-faint">{count}</span>}
    </button>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="m-0 pt-[14px] pb-[8px] text-[10.5px] font-medium tracking-[1px] text-faint">{children}</h3>
}

/** pen `Docs · Graph` (Czmj0): filters on the left, the doc graph, a card for the selected doc. */
export function GraphView({
  onOpenNote,
  onAskChief,
  showFilters = true,
  channels = [],
  focusDocId = null,
}: {
  onOpenNote: (docId: string) => void
  onAskChief: (about: string) => void
  showFilters?: boolean
  channels?: Channel[]
  /** Doc to select when the graph opens ("Show in graph"). */
  focusDocId?: string | null
}) {
  const navigate = useNavigate()
  const { data: graph, isLoading, isError } = useDocGraph()
  const patchDoc = usePatchDoc()
  const [selected, setSelected] = useState<string | null>(focusDocId)
  const [query, setQuery] = useState('')
  const [areasOff, setAreasOff] = useState<Record<string, boolean>>({})
  const [madeBy, setMadeBy] = useState({ team: true, agents: true })
  const [orphans, setOrphans] = useState(false)
  const [goals, setGoals] = useState(true)
  const [hidden, setHidden] = useState<string[]>([])

  const all = useMemo(() => layoutDocGraph(graph ?? EMPTY, (a) => areaLabel(a, channels)), [graph, channels])
  const allEdges = useMemo(() => graph?.edges ?? [], [graph])
  const linked = useMemo(() => new Set(allEdges.flatMap((e) => [e.from, e.to])), [allEdges])
  const docNodes = all.filter((n) => n.kind !== 'goal')
  const areas = useMemo(() => {
    const m = new Map<string, number>()
    for (const n of docNodes) m.set(n.area, (m.get(n.area) ?? 0) + 1)
    return [...m.entries()].map(([label, count]) => ({ id: label, label, count }))
  }, [docNodes])
  const teamCount = docNodes.filter((n) => n.by === 'team').length
  const orphanCount = docNodes.filter((n) => !linked.has(n.id)).length

  const nodes = all.filter((n) => {
    if (hidden.includes(n.id)) return false
    if (n.kind === 'goal') return goals
    if (areasOff[n.area]) return false
    if (n.by && !madeBy[n.by]) return false
    if (!orphans && !linked.has(n.id)) return false
    return true
  })
  const ids = new Set(nodes.map((n) => n.id))
  const edges = allEdges.filter((e) => ids.has(e.from) && ids.has(e.to))
  const q = query.trim().toLowerCase()
  const focus = q ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)) : null
  const sel = nodes.find((n) => n.id === selected) as DocGraphNode | undefined

  function hide(n: DocGraphNode) {
    setHidden((h) => [...h, n.id])
    if (n.docId) patchDoc.mutate({ id: n.docId, patch: { hidden: true } })
    notify(`Hid “${n.label}”`, () => {
      setHidden((h) => h.filter((x) => x !== n.id))
      if (n.docId) patchDoc.mutate({ id: n.docId, patch: { hidden: false } })
    })
  }

  function menuFor(n: DocGraphNode): MenuEntries {
    return [
      n.docId && { label: 'Open note', icon: ArrowUpRight, onSelect: () => onOpenNote(n.docId!) },
      { label: 'Ask Chief about this', icon: Sparkles, onSelect: () => onAskChief(n.label) },
      { label: 'Show only its links', icon: Link2, onSelect: () => setSelected(n.id) },
      n.kind === 'goal' && { label: 'Open goal', icon: Target, onSelect: () => void navigate({ to: '/goals' }) },
      { type: 'separator' },
      n.docId && { label: 'Copy link', icon: Link2, onSelect: () => { copyText(`${location.origin}/docs/${n.docId}`); notify('Link copied') } },
      { label: 'Hide from graph', icon: EyeOff, onSelect: () => hide(n) },
    ]
  }


  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {showFilters && (
        <aside aria-label="Graph filters" className="flex w-[235px] shrink-0 flex-col overflow-y-auto px-[12px] pt-[12px] pb-[12px] shadow-[inset_-1px_0_0_var(--color-line)]">
          <label className="flex h-[28px] items-center gap-[7px] rounded-base bg-surface px-[9px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-ink">
            <Search size={13} aria-hidden className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in graph..."
              aria-label="Find in graph"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
            />
          </label>
          <Heading>AREAS</Heading>
          {areas.map((a) => (
            <CheckRow key={a.id} on={!areasOff[a.id]} count={a.count} onChange={(on) => setAreasOff((s) => ({ ...s, [a.id]: !on }))}>
              <span className="size-[8px] rounded-full" style={{ background: areaColor(a.label) }} />
              {a.label}
            </CheckRow>
          ))}
          <Heading>MADE BY</Heading>
          <CheckRow on={madeBy.team} count={teamCount} onChange={(team) => setMadeBy((m) => ({ ...m, team }))}>You &amp; team</CheckRow>
          <CheckRow on={madeBy.agents} count={docNodes.length - teamCount} onChange={(agents) => setMadeBy((m) => ({ ...m, agents }))}>Agents</CheckRow>
          <Heading>SHOW</Heading>
          <CheckRow on={orphans} count={orphanCount} onChange={setOrphans}>Orphan docs</CheckRow>
          <CheckRow on={goals} onChange={setGoals}>Links to goals</CheckRow>
          <div className="mt-[16px] flex gap-[8px] rounded-base bg-soft px-[10px] py-[10px] text-[12px] leading-[17px] text-muted outline-1 -outline-offset-1 outline-line">
            <Brain size={13} aria-hidden className="mt-[2px] shrink-0" />
            Agent memory is kept out of this graph. Open the Knowledge view to see it.
          </div>
        </aside>
      )}

      <NetworkGraph
        label="Document graph"
        nodes={nodes}
        edges={edges}
        frame={DOC_FRAME}
        selected={selected}
        onSelect={setSelected}
        focus={focus}
        menuFor={(n) => menuFor(n as DocGraphNode)}
        backgroundMenu={[{ label: 'Show orphan docs', checked: orphans, icon: FileText, onSelect: () => setOrphans((o) => !o) }]}
      >
        {sel && (
          <section
            aria-label={sel.label}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-[21px] left-[21px] z-10 w-[278px] rounded-lg bg-surface px-[12px] pt-[11px] pb-[10px] shadow-[0_8px_24px_#0C0A0914] outline-1 -outline-offset-1 outline-line-strong animate-in fade-in-0"
          >
            <div className="flex items-center gap-[7px]">
              {sel.kind === 'goal' ? <Target size={13} aria-hidden className="text-ok" /> : <FileText size={13} aria-hidden className="text-muted" />}
              <h3 className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{sel.label}</h3>
              {sel.by === 'agents' && sel.kind !== 'goal' && <Mascot size={16} radius={4} area="dev" still />}
            </div>
            <p className="m-0 mt-[4px] truncate text-[11.5px] tracking-[-0.1px] text-muted">
              {`${sel.kind === 'goal' ? 'Goal' : sel.area} · ${allEdges.filter((e) => e.from === sel.id || e.to === sel.id).length} links${sel.updatedAt ? ` · edited ${longAgo(sel.updatedAt)}` : ''}`}
            </p>
            {sel.excerpt && <p className="m-0 mt-[5px] text-[12.5px] leading-[17px] text-ink-2">{sel.excerpt}</p>}
            <div className="mt-[9px] flex gap-[6px]">
              {sel.docId && (
                <button
                  type="button"
                  onClick={() => onOpenNote(sel.docId!)}
                  className="flex h-[26px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
                >
                  <ArrowUpRight size={13} aria-hidden /> Open note
                </button>
              )}
              <button
                type="button"
                onClick={() => onAskChief(sel.label)}
                className="flex h-[26px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <Sparkles size={13} aria-hidden /> Ask Chief
              </button>
            </div>
          </section>
        )}
        {(isLoading || isError || docNodes.length === 0) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className={`text-[13px] ${isError ? 'text-bad' : 'text-muted'}`}>
              {isError ? "Couldn't load the graph" : isLoading ? 'Loading the graph…' : 'No docs yet — link docs with [[their title]] to grow the graph'}
            </span>
          </div>
        )}
        <div className="pointer-events-none absolute bottom-[20px] left-[20px] flex items-center gap-[12px]">
          {areas.map((a) => (
            <span key={a.id} className="flex items-center gap-[5px] text-[11.5px] text-muted">
              <span className="size-[7px] rounded-full" style={{ background: areaColor(a.label) }} />
              {a.label}
            </span>
          ))}
          <span className="flex items-center gap-[5px] text-[11.5px] text-muted">
            <span className="size-[8px] rounded-full border-2 border-ok" />
            Goal
          </span>
        </div>
      </NetworkGraph>
    </div>
  )
}

const EMPTY: DocGraph = { nodes: [], edges: [] }
