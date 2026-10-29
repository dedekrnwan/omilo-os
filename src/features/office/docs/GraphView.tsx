import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Brain, Check, EyeOff, FileText, Link2, Search, Sparkles, Target } from 'lucide-react'
import { Mascot } from '../../../ui/ds/Mascot'
import { copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { NetworkGraph } from './graph/NetworkGraph'
import { AREA_COLOR, DOC_EDGES, DOC_FRAME, DOC_NODES } from './graph/graphData'
import type { DocArea, DocGraphNode } from './graph/graphData'

const AREAS: { id: DocArea; label: string; count: number }[] = [
  { id: 'engineering', label: 'Engineering', count: 18 },
  { id: 'marketing', label: 'Marketing', count: 14 },
  { id: 'business', label: 'Business', count: 21 },
  { id: 'general', label: 'General', count: 11 },
]

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
}: {
  onOpenNote: (docId: string) => void
  onAskChief: (about: string) => void
  showFilters?: boolean
}) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>('passkey')
  const [query, setQuery] = useState('')
  const [areas, setAreas] = useState<Record<DocArea, boolean>>({ engineering: true, marketing: true, business: true, general: true })
  const [madeBy, setMadeBy] = useState({ team: true, agents: true })
  const [orphans, setOrphans] = useState(false)
  const [goals, setGoals] = useState(true)
  const [hidden, setHidden] = useState<string[]>([])

  const linked = useMemo(() => new Set(DOC_EDGES.flatMap((e) => [e.from, e.to])), [])
  const nodes = useMemo(
    () =>
      DOC_NODES.filter((n) => {
        if (hidden.includes(n.id)) return false
        if (n.area === 'goal') return goals
        if (!areas[n.area]) return false
        if (n.by && !madeBy[n.by]) return false
        if (!orphans && !linked.has(n.id)) return false
        return true
      }),
    [areas, madeBy, orphans, goals, hidden, linked],
  )
  const ids = new Set(nodes.map((n) => n.id))
  const edges = DOC_EDGES.filter((e) => ids.has(e.from) && ids.has(e.to))
  const q = query.trim().toLowerCase()
  const focus = q ? new Set(nodes.filter((n) => n.label.toLowerCase().includes(q)).map((n) => n.id)) : null
  const sel = nodes.find((n) => n.id === selected) as DocGraphNode | undefined

  function menuFor(n: DocGraphNode): MenuEntries {
    return [
      n.docId && { label: 'Open note', icon: ArrowUpRight, onSelect: () => onOpenNote(n.docId!) },
      { label: 'Ask Chief about this', icon: Sparkles, onSelect: () => onAskChief(n.label) },
      { label: 'Show only its links', icon: Link2, onSelect: () => setSelected(n.id) },
      n.kind === 'goal' && { label: 'Open goal', icon: Target, onSelect: () => void navigate({ to: '/goals' }) },
      { type: 'separator' },
      { label: 'Copy link', icon: Link2, onSelect: () => { copyText(`${location.origin}/docs/${n.docId ?? n.id}`); notify('Link copied') } },
      {
        label: 'Hide from graph',
        icon: EyeOff,
        onSelect: () => {
          setHidden((h) => [...h, n.id])
          notify(`Hid “${n.label}”`, () => setHidden((h) => h.filter((x) => x !== n.id)))
        },
      },
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
          {AREAS.map((a) => (
            <CheckRow key={a.id} on={areas[a.id]} count={a.count} onChange={(on) => setAreas((s) => ({ ...s, [a.id]: on }))}>
              <span className="size-[8px] rounded-full" style={{ background: AREA_COLOR[a.id] }} />
              {a.label}
            </CheckRow>
          ))}
          <Heading>MADE BY</Heading>
          <CheckRow on={madeBy.team} count={29} onChange={(team) => setMadeBy((m) => ({ ...m, team }))}>You &amp; team</CheckRow>
          <CheckRow on={madeBy.agents} count={35} onChange={(agents) => setMadeBy((m) => ({ ...m, agents }))}>Agents</CheckRow>
          <Heading>SHOW</Heading>
          <CheckRow on={orphans} count={6} onChange={setOrphans}>Orphan docs</CheckRow>
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
              {sel.by === 'agents' && <Mascot size={16} radius={4} area="dev" still />}
            </div>
            <p className="m-0 mt-[4px] truncate text-[11.5px] tracking-[-0.1px] text-muted">
              {sel.meta ?? `${sel.area === 'goal' ? 'Goal' : sel.area[0].toUpperCase() + sel.area.slice(1)} · ${edges.filter((e) => e.from === sel.id || e.to === sel.id).length} links`}
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
        <div className="pointer-events-none absolute bottom-[20px] left-[20px] flex items-center gap-[12px]">
          {(['engineering', 'marketing', 'business', 'general'] as const).map((a) => (
            <span key={a} className="flex items-center gap-[5px] text-[11.5px] text-muted">
              <span className="size-[7px] rounded-full" style={{ background: AREA_COLOR[a] }} />
              {a[0].toUpperCase() + a.slice(1)}
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
