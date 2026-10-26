import { useRef, useState } from 'react'
import {
  FileText,
  Network,
  Brain,
  MessageSquare,
  BookOpen,
  Search,
  Plus,
  Link2,
  Eye,
  Edit3,
  Share2,
  MoreHorizontal,
  Folder,
  Check,
  Upload,
  X,
  CheckCircle2,
  Circle,
  ArrowUpRight,
  Mic,
  Send,
  Zap,
  ChevronDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button, IconButton } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { Mascot } from '../../../ui/ds/Mascot'
import { notify } from '../../../ui/ds/Toaster'
import { helperColor } from '../../../ui/tokens'
import {
  DOC_AREAS,
  ACTIVE_DOC,
  LINKED_DOCS,
  LINKED_GOALS,
  GRAPH_NODES,
  GRAPH_EDGES,
  GRAPH_AREA_COLORS,
  KNOWLEDGE_MEMORIES,
  KNOWLEDGE_NODES,
  DROPPED_FILES,
  ASK_CHIEF_SUGGESTIONS,
  ASK_CHIEF_MATCHING_DOCS,
  ASK_CHIEF_ANSWER,
  HANDBOOK_FILES,
  POLICIES_MD_CONTENT,
} from './data'
import type { DocFile, KnowledgeMemory } from './data'
import { ForceGraph } from './ForceGraph'
import { useArea } from '../../../app/queries'
import { useUIStore } from '../../../app/store'

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocsMainView = 'notes' | 'graph' | 'knowledge' | 'ask-chief' | 'handbook'

type KnowledgeSubState = 'off' | 'graph' | 'answer' | 'dropping' | 'reading' | 'add-sources' | 'added'

// ── View toggle ───────────────────────────────────────────────────────────────

const VIEW_TABS: Array<{ id: DocsMainView; label: string; icon: LucideIcon }> = [
  { id: 'notes',     label: 'Notes',     icon: FileText },
  { id: 'graph',     label: 'Graph',     icon: Network },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
  { id: 'ask-chief', label: 'Ask Chief', icon: MessageSquare },
  { id: 'handbook',  label: 'Handbook',  icon: BookOpen },
]

function ViewToggle({
  active,
  onChange,
}: {
  active: DocsMainView
  onChange: (v: DocsMainView) => void
}) {
  return (
    <div className="flex items-center gap-px rounded-base bg-soft p-[3px] outline-1 -outline-offset-1 outline-line-strong">
      {VIEW_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          onClick={() => onChange(id)}
          className="flex h-[26px] items-center gap-[5px] rounded-sm px-[8px] text-[12px] font-medium transition-colors"
          style={{
            background: active === id ? 'var(--color-surface)' : 'transparent',
            color: active === id ? 'var(--color-ink)' : 'var(--color-muted)',
            boxShadow: active === id ? '0 1px 3px rgba(0,0,0,0.07)' : undefined,
          }}
        >
          <Icon size={13} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Shared topbar actions ─────────────────────────────────────────────────────

function TopbarActions({
  activeView,
  onViewChange,
}: {
  view: DocsMainView
  activeView: DocsMainView
  onViewChange: (v: DocsMainView) => void
}) {
  return (
    <div className="flex items-center gap-[10px]">
      <ViewToggle active={activeView} onChange={onViewChange} />
      <div className="flex items-center gap-[2px]">
        <IconButton icon={Upload} size={15} aria-label="Import" />
        <IconButton icon={Zap} size={15} aria-label="Automations" />
        <IconButton icon={Share2} size={15} aria-label="Share" />
        <IconButton icon={MoreHorizontal} size={15} aria-label="More" />
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function docIcon(icon: DocFile['icon']) {
  if (icon === 'folder') return <Folder size={13} className="text-muted shrink-0" aria-hidden />
  if (icon === 'check') return <Check size={13} className="text-muted shrink-0" aria-hidden />
  if (icon === 'markdown') return <FileText size={13} className="text-muted shrink-0" aria-hidden />
  return <FileText size={13} className="text-muted shrink-0" aria-hidden />
}

// ── Notes: left sidebar ───────────────────────────────────────────────────────

function NotesSidebar({
  activeId,
  onSelect,
  onViewChange,
  onNewDoc,
}: {
  activeId: string
  onSelect: (id: string) => void
  onViewChange: (v: DocsMainView) => void
  onNewDoc: () => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'All' | 'By you' | 'By agents'>('All')
  const filters = ['All', 'By you', 'By agents'] as const

  const allDocs = DOC_AREAS.flatMap((a) => a.docs)
  const filtered = query
    ? allDocs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : null

  return (
    <div className="flex w-[240px] shrink-0 flex-col gap-[8px] overflow-y-auto border-r border-line px-[8px] py-[10px]">
      {/* Search */}
      <label className="flex items-center gap-[6px] rounded-base bg-soft px-[8px] py-[5px] outline-1 -outline-offset-1 outline-line-strong">
        <Search size={12} aria-hidden className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a doc…"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => setQuery('')}
            className="text-faint hover:text-muted"
          >
            <X size={11} aria-hidden />
          </button>
        )}
        <button type="button" aria-label="New doc" onClick={onNewDoc} className="ml-auto text-faint hover:text-muted">
          <Plus size={13} aria-hidden />
        </button>
      </label>

      {/* Filter tabs */}
      <div className="flex gap-[2px]">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className="h-[24px] rounded-btn px-[7px] text-[11.5px] font-medium transition-colors"
            style={{
              background: filter === f ? 'var(--color-hover)' : 'transparent',
              color: filter === f ? 'var(--color-ink)' : 'var(--color-muted)',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Doc list */}
      {filtered ? (
        <div className="flex flex-col gap-px">
          {filtered.map((doc) => (
            <NoteDocRow
              key={doc.id}
              doc={doc}
              active={doc.id === activeId}
              onSelect={() => onSelect(doc.id)}
            />
          ))}
        </div>
      ) : (
        DOC_AREAS.map((area) => (
          <div key={area.id} className="flex flex-col gap-px">
            <div className="px-[10px] pb-[4px] pt-[4px]">
              <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint uppercase">
                {area.label}
              </span>
              <span className="ml-[4px] text-[10.5px] text-faint">{area.docs.length}</span>
            </div>
            {area.docs.map((doc) => (
              <NoteDocRow
                key={doc.id}
                doc={doc}
                active={doc.id === activeId}
                onSelect={() => onSelect(doc.id)}
              />
            ))}
          </div>
        ))
      )}

      {/* Knowledge footer */}
      <div className="mt-auto flex items-center gap-[6px] px-[8px] py-[6px]">
        <Brain size={12} className="text-faint" aria-hidden />
        <span className="text-[11.5px] text-muted">Agent memory is separate</span>
        <button type="button" onClick={() => onViewChange('knowledge')} className="ml-auto text-[11.5px] text-link hover:underline whitespace-nowrap">
          Open the Knowledge view
        </button>
      </div>
    </div>
  )
}

function NoteDocRow({
  doc,
  active,
  onSelect,
}: {
  doc: DocFile
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-[6px] rounded-sm px-[8px] py-[5px] text-left transition-colors ${
        active ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      {doc.unread && (
        <span aria-label="unread" className="size-[6px] shrink-0 rounded-full bg-helper-brand" />
      )}
      {docIcon(doc.icon)}
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${
          active ? 'font-medium text-ink' : 'text-ink-2'
        }`}
      >
        {doc.title}
      </span>
      {doc.status && (
        <span className="shrink-0 rounded-pill bg-soft px-[5px] py-[1px] text-[10.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
          {doc.status}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-faint whitespace-nowrap">{doc.edited}</span>
    </button>
  )
}

// ── Notes: doc viewer ─────────────────────────────────────────────────────────

function NoteDocViewer() {
  const [mode, setMode] = useState<'read' | 'edit' | 'both'>('read')
  const doc = ACTIVE_DOC

  function renderInline(text: string) {
    const parts = text.split(/(\[\[[^\]]+\]\])/g)
    return parts.map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const label = part.slice(2, -2)
        return (
          <button
            key={i}
            type="button"
            className="text-link underline underline-offset-2 hover:opacity-80"
            onClick={() => notify(`Opened: ${label}`)}
          >
            {label}
          </button>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  function renderBody(text: string) {
    return text.split('\n').map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return (
          <p key={i} className="m-0 font-semibold text-ink text-[13.5px] mt-[4px]">
            {line.slice(2, -2)}
          </p>
        )
      }
      if (line.startsWith('- ')) {
        return (
          <li key={i} className="text-[13.5px] text-ink-2 ml-[16px]">
            {renderInline(line.slice(2))}
          </li>
        )
      }
      if (line === '') return <div key={i} className="h-[8px]" />
      return (
        <p key={i} className="m-0 text-[13.5px] text-ink-2">
          {renderInline(line)}
        </p>
      )
    })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Main doc area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Saved badge + mode tabs + actions */}
        <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
          <div className="flex items-center gap-[6px] min-w-0 flex-1">
            <Mascot size={18} radius={5} area="dev" />
            <span className="text-[12px] text-muted shrink-0">Dev · edited {doc.editedAgo}</span>
            <span className="ml-[2px] rounded-pill bg-soft px-[6px] py-[1px] text-[10.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
              @ Passwordless login by Q4
            </span>
          </div>

          {/* Edit / Both / Read tabs */}
          <div className="flex gap-[2px] rounded-sm bg-soft p-[2px] outline-1 -outline-offset-1 outline-line-strong">
            {(['edit', 'both', 'read'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="flex h-[24px] items-center gap-[4px] rounded-xs px-[7px] text-[11.5px] font-medium transition-colors capitalize"
                style={{
                  background: mode === m ? 'var(--color-surface)' : 'transparent',
                  color: mode === m ? 'var(--color-ink)' : 'var(--color-muted)',
                }}
              >
                {m === 'edit' ? <Edit3 size={11} aria-hidden /> : m === 'read' ? <Eye size={11} aria-hidden /> : null}
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-[2px]">
            <span className="mr-[4px] text-[12px] text-muted">Saved · v3</span>
            <IconButton icon={Share2} size={14} aria-label="Share" />
            <IconButton icon={Link2} size={14} aria-label="Copy link" />
            <IconButton icon={Eye} size={14} aria-label="Preview" />
            <IconButton icon={MoreHorizontal} size={14} aria-label="More" />
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[48px] py-[36px]">
          <div className="flex items-center gap-[6px] mb-[4px]">
            <span className="text-[12px] text-faint">{doc.area}</span>
          </div>
          <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">
            {doc.title}
          </h1>
          <div className="flex flex-col gap-[6px]">{renderBody(doc.body)}</div>
        </div>
      </div>

      {/* Right panel */}
      <aside className="flex w-[220px] shrink-0 flex-col gap-[16px] overflow-y-auto border-l border-line px-[14px] py-[16px]">
        {/* Links */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center gap-[4px] mb-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKS FROM HERE</span>
            <span className="ml-auto text-[10.5px] text-faint">2</span>
          </div>
          {LINKED_DOCS.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => notify(`Opened: ${d.title}`)}
              className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover"
            >
              <div className="flex items-center gap-[4px]">
                <FileText size={11} className="text-faint shrink-0" aria-hidden />
                <span className="text-[12px] text-ink-2">{d.title}</span>
              </div>
              <span className="text-[11px] text-faint pl-[15px]">{d.meta}</span>
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* Linked in */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center gap-[4px] mb-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKED HERE</span>
            <span className="ml-auto text-[10.5px] text-faint">1</span>
          </div>
          {LINKED_GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => notify(`Opened goal: ${g.title}`)}
              className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover"
            >
              <span className="text-[12px] text-ink-2">{g.title}</span>
              <span className="text-[11px] text-faint">{g.meta}</span>
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* Outline */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center gap-[4px] mb-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">OUTLINE</span>
          </div>
          {['Wave 1 — web + iOS', 'Wave 2 — Android', 'Rollback'].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => notify(`Scrolled to: ${h}`)}
              className="rounded-sm px-[6px] py-[2px] text-left text-[12px] text-muted transition-colors hover:text-ink"
            >
              {h}
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* History */}
        <div className="flex flex-col gap-[2px]">
          <div className="flex items-center gap-[4px] mb-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">HISTORY</span>
          </div>
          {[
            { who: 'Dev',   time: '2h ago',  note: 'Updated wave 2 timeline' },
            { who: 'Chief', time: '2d ago',  note: 'Added rollback section' },
          ].map((h, i) => (
            <div key={i} className="flex flex-col gap-[1px] px-[6px] py-[3px]">
              <span className="text-[12px] text-ink-2">{h.who} · {h.time}</span>
              <span className="text-[11px] text-faint">{h.note}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

// ── Graph view ────────────────────────────────────────────────────────────────

function GraphView({ onViewChange }: { onViewChange: (v: DocsMainView) => void }) {
  const [selected, setSelected] = useState<string | null>('n-passkey')
  const [activeAreas, setActiveAreas] = useState<Set<string>>(new Set())
  const [activeMadeBy, setActiveMadeBy] = useState<Set<string>>(new Set())
  const [showChecks, setShowChecks] = useState<Record<string, boolean>>({
    'Orphan docs': false,
    'Links to goals': true,
  })

  function toggleArea(label: string) {
    setActiveAreas((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }

  function toggleMadeBy(label: string) {
    setActiveMadeBy((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label); else next.add(label)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left sidebar */}
      <div className="flex w-[240px] shrink-0 flex-col gap-[8px] overflow-y-auto border-r border-line px-[8px] py-[10px]">
        {/* Search */}
        <label className="flex items-center gap-[6px] rounded-base bg-soft px-[8px] py-[5px] outline-1 -outline-offset-1 outline-line-strong">
          <Search size={12} aria-hidden className="text-faint" />
          <input
            placeholder="Find in graph…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
          />
        </label>

        {/* Areas */}
        <div className="flex flex-col gap-px">
          <div className="px-[10px] pb-[4px] pt-[2px]">
            <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">AREAS</span>
          </div>
          {[
            { label: 'Engineering', color: 'var(--color-helper-dev)',       count: 18 },
            { label: 'Marketing',   color: 'var(--color-helper-marketing)', count: 14 },
            { label: 'Business',    color: 'var(--color-helper-sales)',      count: 11 },
            { label: 'General',     color: '#A8A29E',                        count: 11 },
          ].map((a) => {
            const isActive = activeAreas.has(a.label)
            return (
              <button
                key={a.label}
                type="button"
                onClick={() => toggleArea(a.label)}
                className={`flex h-[28px] items-center gap-[8px] rounded-sm px-[8px] transition-colors ${isActive ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                <span className="size-[8px] shrink-0 rounded-full" style={{ background: a.color }} />
                <span className={`flex-1 text-[13px] ${isActive ? 'font-medium text-ink' : 'text-ink-2'}`}>{a.label}</span>
                <span className="text-[11.5px] text-muted">{a.count}</span>
              </button>
            )
          })}
        </div>

        {/* Made by */}
        <div className="flex flex-col gap-px">
          <div className="px-[10px] pb-[4px] pt-[2px]">
            <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">MADE BY</span>
          </div>
          {[
            { label: 'You & team', count: 29 },
            { label: 'Agents',     count: 35 },
          ].map((m) => {
            const isActive = activeMadeBy.has(m.label)
            return (
              <button
                key={m.label}
                type="button"
                onClick={() => toggleMadeBy(m.label)}
                className={`flex h-[28px] items-center gap-[8px] rounded-sm px-[8px] transition-colors ${isActive ? 'bg-hover' : 'hover:bg-hover'}`}
              >
                <span className={`flex-1 text-[13px] ${isActive ? 'font-medium text-ink' : 'text-ink-2'}`}>{m.label}</span>
                <span className="text-[11.5px] text-muted">{m.count}</span>
              </button>
            )
          })}
        </div>

        {/* Show */}
        <div className="flex flex-col gap-px">
          <div className="px-[10px] pb-[4px] pt-[2px]">
            <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">SHOW</span>
          </div>
          {[
            { label: 'Orphan docs',   count: 6 },
            { label: 'Links to goals', count: 0 },
          ].map((s) => {
            const checked = showChecks[s.label] ?? false
            return (
              <button
                key={s.label}
                type="button"
                onClick={() => setShowChecks((prev) => ({ ...prev, [s.label]: !prev[s.label] }))}
                className="flex h-[28px] items-center gap-[8px] rounded-sm px-[8px] hover:bg-hover transition-colors"
              >
                <span
                  className="size-[14px] shrink-0 rounded-xs outline-1 -outline-offset-1 outline-line-strong flex items-center justify-center"
                  style={{ background: checked ? 'var(--color-primary)' : 'var(--color-surface)' }}
                >
                  {checked && <Check size={9} className="text-primary-ink" aria-hidden />}
                </span>
                <span className="flex-1 text-[13px] text-ink-2">{s.label}</span>
                {s.count > 0 && <span className="text-[11.5px] text-muted">{s.count}</span>}
              </button>
            )
          })}
        </div>

        {/* Knowledge notice */}
        <button
          type="button"
          onClick={() => onViewChange('knowledge')}
          className="mx-[4px] mt-auto flex items-start gap-[6px] rounded-base bg-soft px-[10px] py-[8px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
        >
          <Brain size={12} className="text-faint mt-[1px] shrink-0" aria-hidden />
          <span className="text-[11.5px] text-muted">Agent memory is kept out of this graph. Open the Knowledge view to see it.</span>
        </button>
      </div>

      {/* Graph canvas — real d3-force simulation: drag nodes, pan, zoom, click to open. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ForceGraph
          nodes={GRAPH_NODES}
          edges={GRAPH_EDGES}
          colorOf={(n) => GRAPH_AREA_COLORS[n.area]}
          selected={selected}
          onSelect={setSelected}
          renderCard={(node, pos) => (
            <div
              className="absolute z-10 w-[220px] rounded-lg bg-surface shadow-[0_12px_32px_#0C0A0924] outline-1 -outline-offset-1 outline-line-strong duration-150 ease-soft animate-in fade-in-0 zoom-in-95"
              style={{ left: pos.left + 16, top: pos.top - 10, maxWidth: 'calc(100% - 24px)' }}
            >
              <div className="px-[12px] py-[10px]">
                <div className="mb-[2px] flex items-center gap-[6px]">
                  <span className="size-[8px] shrink-0 rounded-full" style={{ background: GRAPH_AREA_COLORS[node.area] }} />
                  <span className="text-[11px] text-faint">Engineering / Q4 Launch · 6 links · edited 2h ago</span>
                </div>
                <p className="mb-[4px] text-[13px] font-medium text-ink">{node.label}</p>
                <p className="mb-[8px] text-[12px] text-muted">
                  Ship passkeys to every user before the Nov 28 code freeze, in two waves…
                </p>
                <div className="flex gap-[4px]">
                  <button
                    type="button"
                    onClick={() => { notify(`Opened: ${node.label}`) }}
                    className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[8px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong transition hover:text-ink active:scale-95"
                  >
                    <ArrowUpRight size={11} aria-hidden /> Open note
                  </button>
                  <button
                    type="button"
                    onClick={() => { onViewChange('ask-chief') }}
                    className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[8px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong transition hover:text-ink active:scale-95"
                  >
                    <MessageSquare size={11} aria-hidden /> Ask Chief
                  </button>
                </div>
              </div>
            </div>
          )}
        />

        {/* Legend */}
        <div className="pointer-events-none absolute bottom-[16px] left-[16px] flex items-center gap-[12px]">
          {[
            { label: 'Engineering', color: 'var(--color-helper-dev)' },
            { label: 'Marketing',   color: 'var(--color-helper-marketing)' },
            { label: 'Business',    color: 'var(--color-helper-sales)' },
            { label: 'General',     color: '#A8A29E' },
            { label: 'Goal',        color: '#6366F1' },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-[4px]">
              <span className="size-[6px] shrink-0 rounded-full" style={{ background: l.color }} />
              <span className="text-[11px] text-muted">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Knowledge off ─────────────────────────────────────────────────────────────

function KnowledgeOff({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0 px-[40px]">
      <div className="flex flex-col items-center gap-[16px] max-w-[420px] text-center">
        <div
          className="flex size-[56px] items-center justify-center rounded-xl bg-soft outline-1 -outline-offset-1 outline-line-strong"
          aria-hidden
        >
          <Brain size={24} className="text-muted" />
          <span className="absolute text-[10px] text-muted font-bold" style={{ marginTop: 20, marginLeft: 10 }}>○</span>
        </div>

        <div className="flex flex-col gap-[8px]">
          <h2 className="text-[22px] font-semibold tracking-[-0.4px] text-ink m-0">
            Knowledge is off
          </h2>
          <p className="text-[13.5px] text-muted m-0 leading-[1.6]">
            When it's on, agents remember lessons, preferences and company facts from your chats and
            decisions, and recall them by meaning. It runs on vector search (pgvector) in your workspace
            database.
          </p>
        </div>

        {/* Benefits */}
        <div className="flex flex-col gap-[6px] w-full text-left">
          {[
            'Agents stop repeating mistakes you already corrected',
            'Ask Chief can search docs and memory by meaning',
            'You review every lesson before agents use it',
          ].map((b) => (
            <div key={b} className="flex items-start gap-[8px]">
              <span className="mt-[3px] text-muted text-[13px]">↗</span>
              <span className="text-[13px] text-muted">{b}</span>
            </div>
          ))}
        </div>

        {/* Setup check */}
        <div className="w-full rounded-base bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line-strong">
          <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[8px] uppercase">
            Setup check
          </p>
          {[
            { label: 'Postgres 16 on db-main', status: 'Ready',                   ok: true },
            { label: 'pgvector extension',     status: 'Installed when you turn this on', ok: null },
            { label: 'Embedding model',        status: 'Uses your company AI account — ~$0.02 per 1k memories', ok: null },
          ].map((row) => (
            <div key={row.label} className="flex items-start gap-[8px] py-[4px]">
              {row.ok === true ? (
                <CheckCircle2 size={14} className="text-ok mt-[1px] shrink-0" aria-hidden />
              ) : (
                <Circle size={14} className="text-faint mt-[1px] shrink-0" aria-hidden />
              )}
              <span className="min-w-0 flex-1 text-[12.5px] text-ink-2">{row.label}</span>
              <span className="text-[12px] text-muted whitespace-nowrap">{row.status}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={onTurnOn}
            className="flex h-[32px] items-center gap-[6px] rounded-btn bg-primary px-[12px] text-[13px] font-medium text-primary-ink hover:bg-primary-hover transition-colors"
          >
            <Zap size={14} aria-hidden /> Turn on Knowledge
          </button>
          <button type="button" onClick={() => notify('Knowledge uses pgvector to store and search agent memories by meaning.')} className="flex h-[32px] items-center gap-[6px] rounded-btn bg-soft px-[12px] text-[13px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
            How it works
          </button>
        </div>
        <p className="text-[11.5px] text-faint m-0">
          Only admins can turn this on. Turn it off anytime — memories are kept for 30 days, then deleted.
        </p>
      </div>
    </div>
  )
}

// ── Knowledge on: graph + chat ────────────────────────────────────────────────

function KnowledgeReviewBubble({ mem, onConfirm, onForget }: { mem: KnowledgeMemory; onConfirm: () => void; onForget: () => void }) {
  return (
    <div className="absolute left-[140px] top-[76px] w-[220px] rounded-lg bg-surface shadow-lg outline-1 -outline-offset-1 outline-line-strong z-10">
      <div className="px-[12px] py-[10px]">
        <div className="flex items-center gap-[6px] mb-[4px]">
          <Mascot size={16} radius={4} area={mem.agentArea} />
          <span className="text-[11.5px] font-medium text-ink">{mem.agent}</span>
          <span className="text-[10.5px] text-faint">· lesson</span>
          <span className="ml-auto rounded-pill px-[5px] py-[0.5px] text-[10px] font-medium bg-warn-tint text-warn">
            Needs review
          </span>
        </div>
        <p className="text-[12.5px] text-ink font-medium m-0 mb-[2px]">{mem.text}</p>
        <p className="text-[11.5px] text-faint m-0 mb-[8px]">Learned from your Inbox decision · Nov 4</p>
        <div className="flex gap-[4px]">
          <button type="button" onClick={onConfirm} className="flex h-[24px] items-center gap-[3px] rounded-sm bg-primary px-[8px] text-[11.5px] font-medium text-primary-ink hover:bg-primary-hover transition-colors">
            <Check size={10} aria-hidden /> Confirm
          </button>
          <button type="button" className="flex h-[24px] items-center gap-[3px] rounded-sm bg-soft px-[8px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
            Edit
          </button>
          <button type="button" onClick={onForget} className="flex h-[24px] items-center gap-[3px] rounded-sm bg-soft px-[8px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
            Forget
          </button>
        </div>
      </div>
    </div>
  )
}

function KnowledgeGraph({
  onAsk,
  subState,
  onSubState,
}: {
  onAsk: (question: string) => void
  subState: KnowledgeSubState
  onSubState: (s: KnowledgeSubState) => void
}) {
  const [reviewDismissed, setReviewDismissed] = useState(false)
  const [filterTag, setFilterTag] = useState<'All' | 'Lessons' | 'Preferences' | 'Facts'>('All')
  const filterTags = ['All', 'Lessons', 'Preferences', 'Facts'] as const

  const dropping = subState === 'dropping'
  const reading  = subState === 'reading'
  const added    = subState === 'added'

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Sub-topbar strip */}
      <div className="flex h-[40px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <div className="flex gap-[2px]">
          {filterTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setFilterTag(t)}
              className="flex h-[24px] items-center gap-[4px] rounded-sm px-[8px] text-[12px] font-medium transition-colors"
              style={{
                background: filterTag === t ? 'var(--color-hover)' : 'transparent',
                color: filterTag === t ? 'var(--color-ink)' : 'var(--color-muted)',
              }}
            >
              {t !== 'All' && (
                <span
                  className="size-[6px] rounded-full shrink-0"
                  style={{
                    background:
                      t === 'Lessons' ? 'var(--color-info)' :
                      t === 'Preferences' ? 'var(--color-warn)' :
                      'var(--color-ok)',
                  }}
                />
              )}
              {t}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-[6px]">
          <button
            type="button"
            onClick={() => onSubState('add-sources')}
            className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[10px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors"
          >
            <Plus size={12} aria-hidden /> Add sources
          </button>
          <span className="rounded-pill bg-warn-tint px-[6px] py-[1px] text-[11px] font-medium text-warn">
            2 need review →
          </span>
        </div>
      </div>

      {/* Main graph area */}
      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onDragOver={(e) => { e.preventDefault(); onSubState('dropping') }}
        onDragLeave={() => { if (subState === 'dropping') onSubState('graph') }}
        onDrop={(e) => { e.preventDefault(); onSubState('reading') }}
      >
        {/* Drop overlay */}
        {dropping && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-surface/90 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-[12px]">
              <Mascot size={56} radius={14} area="brand" />
              <h3 className="text-[17px] font-semibold text-ink m-0">Drop to teach the whole company</h3>
              <p className="text-[13px] text-muted m-0">Chief reads documents and photos and adds what it finds to company knowledge.</p>
              <div className="flex items-center gap-[4px]">
                <span className="size-[6px] rounded-full bg-muted" aria-hidden />
                <span className="text-[12px] text-muted">Company-wide</span>
              </div>
              <p className="text-[11.5px] text-faint m-0">PDF, Word, Excel, slides · photos and scans · up to 50 MB each</p>
            </div>
          </div>
        )}

        {/* Review bubble */}
        {!reviewDismissed && !dropping && !reading && !added && (
          <KnowledgeReviewBubble
            mem={KNOWLEDGE_MEMORIES[0]}
            onConfirm={() => setReviewDismissed(true)}
            onForget={() => setReviewDismissed(true)}
          />
        )}

        {/* Sources panel (reading) */}
        {reading && (
          <div className="absolute right-0 top-0 bottom-0 w-[240px] z-10 border-l border-line bg-surface overflow-y-auto">
            <div className="flex items-center gap-[6px] px-[12px] py-[10px] border-b border-line">
              <span className="text-[12.5px] font-medium text-ink flex-1">Reading 3 files</span>
              <button type="button" onClick={() => onSubState('graph')} className="text-faint hover:text-muted">
                <X size={14} aria-hidden />
              </button>
            </div>
            <div className="flex flex-col divide-y divide-line">
              {DROPPED_FILES.map((f) => (
                <div key={f.id} className="px-[12px] py-[10px]">
                  <div className="flex items-start gap-[8px]">
                    <div
                      className="mt-[1px] size-[16px] shrink-0 rounded flex items-center justify-center text-[8px] font-bold uppercase"
                      style={{
                        background: f.type === 'xlsx' ? '#16A34A1A' : f.type === 'pdf' ? '#DC26261A' : '#0EA5E91A',
                        color: f.type === 'xlsx' ? '#16A34A' : f.type === 'pdf' ? '#DC2626' : '#0EA5E9',
                      }}
                    >
                      {f.type}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-medium text-ink m-0 truncate">{f.name}</p>
                      <p className="text-[11px] text-muted m-0">
                        {f.status === 'reading'
                          ? `Reading p. ${f.page ?? '…'}`
                          : f.status === 'added'
                          ? `${f.factsAdded} added · ${f.factsSkipped ?? 0} skipped`
                          : 'Skipped'}
                      </p>
                    </div>
                    {f.status === 'reading' ? (
                      <span className="text-[11px] text-info whitespace-nowrap">Reading</span>
                    ) : f.status === 'added' ? (
                      <CheckCircle2 size={14} className="text-ok shrink-0" aria-hidden />
                    ) : (
                      <span className="text-[11px] text-faint">Skip</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Added state: sources panel + toast */}
        {added && (
          <>
            <div className="absolute top-[8px] left-0 right-0 flex justify-center z-20">
              <div className="flex items-center gap-[10px] rounded-lg bg-surface shadow-lg outline-1 -outline-offset-1 outline-line-strong px-[14px] py-[8px]">
                <span className="text-[12.5px] font-medium text-ink">12 facts added from Harga sewa balai.xlsx · 1 skipped</span>
                <button type="button" className="text-[11.5px] text-link hover:underline">Undo</button>
                <button type="button" className="text-[11.5px] text-link hover:underline">Show in graph</button>
              </div>
            </div>
            {/* Sources sidebar */}
            <div className="absolute left-0 top-0 bottom-0 w-[180px] border-r border-line bg-soft overflow-y-auto z-10">
              <div className="px-[10px] py-[10px] flex flex-col gap-[4px]">
                <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[4px]">SOURCES</p>
                {DROPPED_FILES.map((f) => (
                  <div key={f.id} className="flex items-center gap-[6px] py-[2px]">
                    <div
                      className="size-[12px] shrink-0 rounded text-[7px] font-bold uppercase flex items-center justify-center"
                      style={{
                        background: f.type === 'xlsx' ? '#16A34A1A' : f.type === 'pdf' ? '#DC26261A' : '#0EA5E91A',
                        color: f.type === 'xlsx' ? '#16A34A' : f.type === 'pdf' ? '#DC2626' : '#0EA5E9',
                      }}
                    >
                      {f.type}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{f.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Knowledge graph SVG */}
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 720 380"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Knowledge memory graph"
          style={{ opacity: dropping ? 0.2 : 1 }}
        >
          {/* Connections from agents to Company facts */}
          {KNOWLEDGE_NODES.filter((n) => n.id !== 'kn-facts').map((n) => {
            const center = KNOWLEDGE_NODES.find((x) => x.id === 'kn-facts')!
            return (
              <line
                key={n.id}
                x1={n.x} y1={n.y} x2={center.x} y2={center.y}
                stroke="var(--color-line-strong)"
                strokeWidth={1.5}
              />
            )
          })}

          {/* Memory dots floating near agents */}
          {KNOWLEDGE_NODES.filter((n) => n.id !== 'kn-facts').flatMap((agent) =>
            (agent.memories ?? []).map((mem, mi) => {
              const angle = (mi / (agent.memories!.length)) * Math.PI + Math.PI * 0.5
              const dist = 60 + mi * 10
              const mx = agent.x + Math.cos(angle) * dist
              const my = agent.y + Math.sin(angle) * dist
              return (
                <g key={`${agent.id}-m${mi}`}>
                  <line
                    x1={agent.x} y1={agent.y} x2={mx} y2={my}
                    stroke="var(--color-line-strong)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  <circle cx={mx} cy={my} r={4} fill={helperColor[agent.area]} opacity={0.7} />
                  <text x={mx + 6} y={my + 4} fontSize={9} fill="var(--color-muted)" style={{ userSelect: 'none' }}>
                    {mem.length > 20 ? mem.slice(0, 18) + '…' : mem}
                  </text>
                </g>
              )
            })
          )}

          {/* Agent nodes */}
          {KNOWLEDGE_NODES.map((n) => {
            const r = n.size === 'lg' ? 16 : 11
            const m = n.size === 'lg' ? 18 : 13
            return (
              <g key={n.id}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={r}
                  fill={`${helperColor[n.area]}1A`}
                  stroke={helperColor[n.area]}
                  strokeWidth={1.5}
                />
                <foreignObject
                  x={n.x - m / 2}
                  y={n.y - m / 2}
                  width={m}
                  height={m}
                  style={{ overflow: 'visible' }}
                >
                  <Mascot size={m} radius={5} area={n.area} />
                </foreignObject>
                <text
                  x={n.x}
                  y={n.y + r + 12}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={500}
                  fill="var(--color-ink-2)"
                  style={{ userSelect: 'none' }}
                >
                  {n.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Chat composer */}
      <KnowledgeComposer onAsk={onAsk} />
    </div>
  )
}

function KnowledgeComposer({ onAsk }: { onAsk: (q: string) => void }) {
  const [value, setValue] = useState('')
  const [recording, setRecording] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const suggestions = ['What did agents learn this week?', 'Teach: refunds over Rp 2jt go to Dede', 'Forget anything about old pricing']

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <div className="px-[16px] py-[12px]">
        <div className="mb-[8px] flex items-center gap-[6px]">
          <Mascot size={22} radius={5} area="brand" />
          <span className="text-[13px] font-medium text-ink">Ask what your agents know, or teach them something</span>
        </div>
        <div className="rounded-lg bg-soft outline-1 -outline-offset-1 outline-line-strong overflow-hidden">
          <div className="flex items-center gap-[6px] px-[10px] pt-[8px] pb-[2px]">
            <span className="text-[11.5px] text-faint">To</span>
            <div className="flex h-[22px] items-center gap-[4px] rounded-sm bg-soft px-[6px] outline-1 -outline-offset-1 outline-line-strong">
              <Mascot size={14} radius={3} area="brand" />
              <span className="text-[11.5px] text-ink-2">Chief</span>
            </div>
          </div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) { onAsk(value); setValue('') } }}
            placeholder={'"What has Chief learned about deploys?" or "Remember that…"'}
            className="w-full bg-transparent px-[10px] py-[6px] text-[12.5px] text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-[6px] px-[10px] py-[6px] border-t border-line">
            <input ref={fileInputRef} type="file" className="hidden" aria-hidden onChange={(e) => { if (e.target.files?.length) notify(`${e.target.files.length} file(s) selected`) }} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex size-[24px] items-center justify-center rounded-sm text-faint hover:text-muted transition-colors"
            >
              <Plus size={14} aria-hidden />
            </button>
            <div className="flex items-center gap-[4px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
              ↕ 4.2k
            </div>
            <div className="flex items-center gap-[3px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
              <Mascot size={12} radius={2} area="brand" />
              Opus 5.5
              <ChevronDown size={10} className="text-faint" aria-hidden />
            </div>
            <div className="flex items-center gap-[3px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
              ⚡ Medium
              <ChevronDown size={10} className="text-faint" aria-hidden />
            </div>
            <div className="ml-auto flex items-center gap-[4px]">
              <button
                type="button"
                onClick={() => { setRecording((r) => !r); if (!recording) { notify('Recording…') } else { notify('Recording stopped') } }}
                className={`flex size-[28px] items-center justify-center rounded-sm transition-colors ${recording ? 'bg-bad text-primary-ink' : 'text-faint hover:bg-hover'}`}
              >
                <Mic size={14} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => { if (value.trim()) { onAsk(value); setValue('') } }}
                className="flex size-[28px] items-center justify-center rounded-sm bg-primary text-primary-ink hover:bg-primary-hover transition-colors"
              >
                <Send size={13} aria-hidden />
              </button>
            </div>
          </div>
        </div>
        {/* Quick suggest chips */}
        <div className="mt-[8px] flex flex-wrap gap-[4px]">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAsk(s)}
              className="h-[26px] rounded-pill bg-soft px-[10px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors whitespace-nowrap"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Knowledge on: answer ──────────────────────────────────────────────────────

function KnowledgeAnswer({ onBack }: { question: string; onBack: () => void }) {
  const [highlighting, setHighlighting] = useState(true)
  const [editingLesson, setEditingLesson] = useState(false)
  const [lessonText, setLessonText] = useState("Don't propose deploys after 21:00 — unless it's a P0 hotfix.")
  const [lessonSaved, setLessonSaved] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Answer pane overlaying graph (right side) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Graph (dimmed) */}
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ opacity: 0.4 }}>
          <svg width="100%" height="100%" viewBox="0 0 720 340" preserveAspectRatio="xMidYMid meet">
            {KNOWLEDGE_NODES.filter((n) => n.id !== 'kn-facts').map((n) => {
              const center = KNOWLEDGE_NODES.find((x) => x.id === 'kn-facts')!
              return (
                <line key={n.id} x1={n.x} y1={n.y} x2={center.x} y2={center.y}
                  stroke="var(--color-line-strong)" strokeWidth={1.5} />
              )
            })}
            {KNOWLEDGE_NODES.map((n) => {
              const r = n.size === 'lg' ? 16 : 11
              const m = n.size === 'lg' ? 18 : 13
              return (
                <g key={n.id}>
                  <circle cx={n.x} cy={n.y} r={r}
                    fill={`${helperColor[n.area]}1A`} stroke={helperColor[n.area]} strokeWidth={1.5} />
                  <foreignObject x={n.x - m / 2} y={n.y - m / 2} width={m} height={m} style={{ overflow: 'visible' }}>
                    <Mascot size={m} radius={5} area={n.area} />
                  </foreignObject>
                </g>
              )
            })}
          </svg>
          {/* Highlighted memory dots */}
          <div className="absolute inset-0 pointer-events-none">
            {[1,2,3,4,5,6].map((i) => (
              <div
                key={i}
                className="absolute size-[8px] rounded-full bg-primary"
                style={{ left: 120 + i * 70, top: 80 + (i % 3) * 60 }}
              />
            ))}
          </div>
        </div>

        {/* Answer panel */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-line overflow-hidden">
          <div className="flex h-[40px] shrink-0 items-center gap-[6px] border-b border-line px-[12px]">
            <span className="text-[12.5px] font-medium text-ink flex-1">Ask & teach</span>
            <button type="button" className="flex size-[26px] items-center justify-center rounded-sm text-faint hover:bg-hover transition-colors">
              <ArrowUpRight size={13} aria-hidden />
            </button>
            <button type="button" onClick={onBack} className="flex size-[26px] items-center justify-center rounded-sm text-faint hover:bg-hover transition-colors">
              <X size={13} aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-[12px] py-[12px] flex flex-col gap-[12px]">
            {/* Question */}
            <p className="text-[12.5px] text-muted text-right m-0">{ASK_CHIEF_ANSWER.question}</p>

            {/* Chief reply */}
            <div className="flex gap-[8px]">
              <Mascot size={24} radius={6} area="brand" />
              <div className="flex flex-col gap-[2px] min-w-0 flex-1">
                <div className="flex items-center gap-[4px]">
                  <span className="text-[12px] font-medium text-ink">Chief</span>
                  <span className="text-[11px] text-faint">Chief of Staff</span>
                  <span className="text-[11px] text-faint">· read 4 docs · 3s</span>
                </div>
                <p className="text-[12.5px] text-ink-2 m-0 leading-[1.6]">{ASK_CHIEF_ANSWER.answer}</p>
                {/* Sources */}
                <div className="flex items-center gap-[4px] mt-[4px]">
                  <span className="text-[11px] text-faint">Sources</span>
                  {ASK_CHIEF_ANSWER.sources.map((s) => (
                    <span key={s} className="flex h-[18px] items-center rounded-pill bg-soft px-[5px] text-[10.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                      {s.slice(0, 2).toUpperCase()} {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Cited list */}
            <div className="flex flex-col gap-[4px]">
              {ASK_CHIEF_ANSWER.cited.map((c) => (
                <div key={c.num} className="flex items-start gap-[8px] rounded-sm px-[8px] py-[6px] hover:bg-hover transition-colors">
                  <span className="text-[11px] font-medium text-faint w-[12px] shrink-0">{c.num}</span>
                  <div className="flex flex-col gap-[1px] min-w-0 flex-1">
                    <span className="text-[12px] font-medium text-ink-2">{c.title}</span>
                    <span className="text-[11px] text-faint">{c.area}</span>
                  </div>
                  <ArrowUpRight size={12} className="text-faint shrink-0 mt-[1px]" aria-hidden />
                </div>
              ))}
            </div>

            {/* Update lesson offer */}
            <div className="rounded-base bg-soft px-[10px] py-[8px] outline-1 -outline-offset-1 outline-line-strong flex flex-col gap-[4px]">
              <div className="flex items-center gap-[6px]">
                <Mascot size={16} radius={4} area="brand" />
                <span className="text-[11.5px] text-muted">Chief · read 51 memories · now</span>
              </div>
              <p className="text-[12px] text-ink-2 m-0">That refines lesson 1. Here's the update — save it?</p>
              <div className="flex items-center gap-[6px] mt-[4px]">
                <div className="flex items-center gap-[4px]">
                  <span className="size-[8px] rounded-full bg-primary" aria-hidden />
                  <span className="text-[11.5px] font-medium text-ink">Update Chief's lesson?</span>
                </div>
              </div>
              <p className="text-[11.5px] text-muted m-0 italic">
                "Don't propose deploys after 21:00 — unless it's a P0 hotfix." Replaces the old version; Chief uses it from the next run.
              </p>
              {editingLesson ? (
                <div className="flex flex-col gap-[4px] mt-[4px]">
                  <textarea
                    autoFocus
                    value={lessonText}
                    onChange={(e) => setLessonText(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-base bg-soft px-[8px] py-[6px] text-[11.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
                  />
                  <div className="flex gap-[4px]">
                    <button type="button" onClick={() => setEditingLesson(false)} className="flex h-[24px] items-center rounded-sm px-[8px] text-[11.5px] text-muted hover:text-ink transition-colors">Cancel</button>
                    <button type="button" onClick={() => { setEditingLesson(false); setLessonSaved(true); notify('Lesson saved') }} className="flex h-[24px] items-center gap-[3px] rounded-sm bg-primary px-[8px] text-[11.5px] font-medium text-primary-ink hover:bg-primary-hover transition-colors">
                      <Check size={10} aria-hidden /> Save lesson
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-[4px] mt-[4px]">
                  <button type="button" onClick={() => setEditingLesson(true)} className="flex h-[24px] items-center gap-[3px] rounded-sm bg-soft px-[8px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">Edit</button>
                  {!lessonSaved ? (
                    <button type="button" onClick={() => { setLessonSaved(true); notify('Lesson saved') }} className="flex h-[24px] items-center gap-[3px] rounded-sm bg-primary px-[8px] text-[11.5px] font-medium text-primary-ink hover:bg-primary-hover transition-colors">
                      <Check size={10} aria-hidden /> Save lesson
                    </button>
                  ) : (
                    <span className="flex h-[24px] items-center gap-[3px] px-[8px] text-[11.5px] text-ok">
                      <CheckCircle2 size={10} aria-hidden /> Saved
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Suggestions */}
            <div className="flex flex-wrap gap-[4px]">
              {ASK_CHIEF_ANSWER.suggestions.map((s) => (
                <button key={s} type="button" className="h-[26px] rounded-pill bg-soft px-[10px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Highlight strip */}
          {highlighting && (
            <div className="flex shrink-0 items-center gap-[6px] border-t border-line px-[12px] py-[6px]">
              <span className="size-[6px] rounded-full bg-primary" aria-hidden />
              <span className="text-[11.5px] text-muted">Highlighting 6 memories about deploys</span>
              <button type="button" onClick={() => setHighlighting(false)} className="ml-auto text-[11.5px] text-link hover:underline">Clear</button>
            </div>
          )}
        </aside>
      </div>

      {/* Composer */}
      <KnowledgeComposer onAsk={() => {}} />
    </div>
  )
}

// ── Knowledge: add-sources modal ──────────────────────────────────────────────

function AddSourcesModal({ onClose }: { onClose: () => void }) {
  const browseInputRef = useRef<HTMLInputElement>(null)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteUrl, setPasteUrl] = useState('')
  const [visibility, setVisibility] = useState<'Company-wide' | 'Engineering' | 'Marketing' | 'Business'>('Company-wide')
  const [visibilityOpen, setVisibilityOpen] = useState(false)

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/60">
      <div className="w-[460px] rounded-xl bg-surface shadow-2xl outline-1 -outline-offset-1 outline-line-strong overflow-hidden">
        <div className="flex items-center gap-[8px] px-[16px] py-[12px] border-b border-line">
          <span className="text-[13.5px] font-semibold text-ink flex-1">Add to company knowledge</span>
          <button type="button" onClick={onClose} className="flex size-[26px] items-center justify-center rounded-sm text-faint hover:bg-hover transition-colors">
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="px-[16px] py-[16px] flex flex-col gap-[12px]">
          {/* Drop zone */}
          <input ref={browseInputRef} type="file" multiple className="hidden" aria-hidden onChange={(e) => { if (e.target.files?.length) notify(`${e.target.files.length} file(s) added`) }} />
          <div
            className="rounded-lg border-2 border-dashed border-line-strong bg-soft px-[24px] py-[20px] flex flex-col items-center gap-[6px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); notify(`${e.dataTransfer.files.length} file(s) dropped`) }}
          >
            <Upload size={24} className="text-muted" aria-hidden />
            <p className="text-[13px] text-muted m-0">
              Drop files here, or{' '}
              <button type="button" onClick={() => browseInputRef.current?.click()} className="text-link hover:underline">browse</button>
            </p>
            <p className="text-[11.5px] text-faint m-0">PDF, Word, Excel, slides · photos and scans · up to 50 MB each</p>
          </div>

          {/* Paste link input */}
          {pasteOpen && (
            <div className="flex gap-[6px]">
              <input
                autoFocus
                type="url"
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                placeholder="https://…"
                className="min-w-0 flex-1 rounded-base bg-soft px-[8px] py-[5px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-primary"
              />
              <button type="button" onClick={() => { if (pasteUrl.trim()) { notify(`Link added: ${pasteUrl}`); setPasteUrl(''); setPasteOpen(false) } }} className="flex h-[28px] items-center rounded-btn bg-primary px-[10px] text-[12px] font-medium text-primary-ink hover:bg-primary-hover transition-colors">
                Add
              </button>
              <button type="button" onClick={() => setPasteOpen(false)} className="flex h-[28px] items-center rounded-btn px-[8px] text-[12px] text-muted hover:text-ink transition-colors">
                Cancel
              </button>
            </div>
          )}

          {/* Source options */}
          <div className="flex gap-[8px]">
            <button type="button" onClick={() => notify('Google Drive — connect your account to import')} className="flex h-[28px] flex-1 items-center justify-center gap-[5px] rounded-btn bg-soft text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
              ☁ From Google Drive
            </button>
            <button type="button" onClick={() => setPasteOpen((o) => !o)} className="flex h-[28px] flex-1 items-center justify-center gap-[5px] rounded-btn bg-soft text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
              🔗 Paste a link
            </button>
          </div>

          {/* Visible to */}
          <div className="relative flex items-center gap-[8px]">
            <span className="text-[12px] text-muted">Visible to</span>
            <button type="button" onClick={() => setVisibilityOpen((o) => !o)} className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[8px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
              🏢 {visibility}
              <ChevronDown size={10} className="text-faint" aria-hidden />
            </button>
            {visibilityOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setVisibilityOpen(false)} aria-hidden />
                <div className="absolute left-[80px] top-[28px] z-50 w-[160px] rounded-lg bg-surface py-[4px] shadow-lg outline-1 -outline-offset-1 outline-line-strong">
                  {(['Company-wide', 'Engineering', 'Marketing', 'Business'] as const).map((v) => (
                    <button key={v} type="button" onClick={() => { setVisibility(v); setVisibilityOpen(false) }} className="flex w-full items-center gap-[6px] px-[10px] py-[6px] text-[12.5px] text-ink-2 hover:bg-hover">
                      {visibility === v && <Check size={12} className="text-primary shrink-0" aria-hidden />}
                      <span className={visibility === v ? 'font-medium text-ink' : ''}>{v}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="text-[11.5px] text-faint ml-auto">Per channel ↗ data</span>
          </div>

          {/* File list */}
          <div className="flex flex-col gap-[4px]">
            {DROPPED_FILES.map((f) => (
              <div key={f.id} className="flex items-center gap-[8px] rounded-sm px-[8px] py-[6px] hover:bg-hover transition-colors">
                <div
                  className="size-[20px] shrink-0 rounded flex items-center justify-center text-[9px] font-bold uppercase"
                  style={{
                    background: f.type === 'xlsx' ? '#16A34A1A' : f.type === 'pdf' ? '#DC26261A' : '#0EA5E91A',
                    color: f.type === 'xlsx' ? '#16A34A' : f.type === 'pdf' ? '#DC2626' : '#0EA5E9',
                  }}
                >
                  {f.type}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink m-0 truncate">{f.name}</p>
                  <p className="text-[11px] text-muted m-0">
                    {f.status === 'reading'
                      ? `Reading p. ${f.page ?? '…'} of 14`
                      : f.status === 'added'
                      ? `${f.factsAdded} added · ${f.factsSkipped ?? 0} skipped`
                      : 'Dropped — looks like a personal ID; resident data stays out of Knowledge'}
                  </p>
                </div>
                {f.status === 'reading' ? (
                  <span className="text-[11.5px] text-info whitespace-nowrap">Reading</span>
                ) : f.status === 'added' ? (
                  <span className="text-[11.5px] text-ok whitespace-nowrap">Added</span>
                ) : (
                  <span className="text-[11.5px] text-bad whitespace-nowrap">Skipped</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-[11.5px] text-faint m-0">Runs on Quick steps · about Rp 420 for these files</p>

          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="flex h-[30px] items-center rounded-btn bg-primary px-[14px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Ask Chief view ────────────────────────────────────────────────────────────

function AskChiefView() {
  const [askState, setAskState] = useState<'idle' | 'answer'>('idle')
  const [query, setQuery] = useState('')

  function submit() {
    if (query.trim()) setAskState('answer')
  }

  if (askState === 'answer') {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Question echo */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[60px] py-[40px] gap-[20px]">
          <p className="text-[13.5px] text-muted text-right m-0">{ASK_CHIEF_ANSWER.question}</p>

          <div className="flex gap-[10px]">
            <Mascot size={28} radius={7} area="brand" />
            <div className="flex flex-col gap-[6px] min-w-0 flex-1">
              <div className="flex items-center gap-[6px]">
                <span className="text-[13px] font-medium text-ink">Chief</span>
                <span className="text-[11.5px] text-faint">Chief of Staff · read 4 docs · 3s</span>
              </div>
              <p className="text-[13.5px] text-ink-2 m-0 leading-[1.7]">{ASK_CHIEF_ANSWER.answer}</p>

              {/* Sources bar */}
              <div className="flex items-center gap-[6px] flex-wrap mt-[2px]">
                <span className="text-[11.5px] text-faint">Sources</span>
                {ASK_CHIEF_ANSWER.sources.map((s) => (
                  <span key={s} className="flex h-[20px] items-center rounded-pill bg-soft px-[6px] text-[11px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                    {s}
                  </span>
                ))}
              </div>

              {/* Citation list */}
              <div className="mt-[8px] flex flex-col gap-[4px]">
                {ASK_CHIEF_ANSWER.cited.map((c) => (
                  <div key={c.num} className="flex items-start gap-[10px] rounded-sm px-[10px] py-[6px] hover:bg-hover transition-colors">
                    <span className="text-[11.5px] font-medium text-faint w-[14px] shrink-0">{c.num}</span>
                    <div className="flex flex-col gap-[1px] min-w-0 flex-1">
                      <span className="text-[13px] font-medium text-ink-2">{c.title}</span>
                      <span className="text-[11.5px] text-faint">{c.area}</span>
                    </div>
                    <ArrowUpRight size={13} className="text-faint shrink-0 mt-[1px]" aria-hidden />
                  </div>
                ))}
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-wrap gap-[4px] mt-[8px]">
                {ASK_CHIEF_ANSWER.suggestions.map((s) => (
                  <button key={s} type="button" onClick={() => { setQuery(s); setAskState('answer') }} className="h-[28px] rounded-pill bg-soft px-[12px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
                    {s}
                  </button>
                ))}
              </div>

              {/* Knowledge notice */}
              <div className="mt-[8px] flex items-center gap-[6px] rounded-base bg-soft px-[10px] py-[6px] outline-1 -outline-offset-1 outline-line-strong">
                <Brain size={12} className="text-faint" aria-hidden />
                <span className="text-[11.5px] text-muted">Agent memory wasn't searched — Knowledge is off for this company.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Composer */}
        <AskChiefComposer
          value=""
          onChange={() => {}}
          onSubmit={() => setAskState('idle')}
          placeholder="Ask a follow-up…"
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Hero */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-[40px]">
        <div className="flex flex-col items-center gap-[16px] w-full max-w-[520px]">
          <Mascot size={40} radius={10} area="brand" />
          <h2 className="text-[20px] font-semibold tracking-[-0.3px] text-ink m-0">
            Ask Chief anything in your docs
          </h2>

          {/* Suggested questions */}
          <div className="w-full flex flex-col gap-[4px]">
            <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[2px]">SUGGESTED QUESTIONS</p>
            {ASK_CHIEF_SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setQuery(s); setAskState('answer') }}
                className="flex w-full items-center rounded-base bg-soft px-[12px] py-[10px] text-left text-[13px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Matching docs */}
          <div className="w-full flex flex-col gap-[4px]">
            <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[2px]">MATCHING DOCS</p>
            {ASK_CHIEF_MATCHING_DOCS.map((d) => (
              <div key={d.id} className="flex items-center gap-[8px] rounded-base px-[10px] py-[7px] hover:bg-hover transition-colors">
                <FileText size={13} className="text-muted shrink-0" aria-hidden />
                <span className="flex-1 text-[13px] text-ink-2">{d.title}</span>
                <span className="text-[11.5px] text-faint">{d.area}</span>
                {d.tag && <span className="text-[11px] text-faint">{d.tag}</span>}
              </div>
            ))}
          </div>

          {/* Narrow it */}
          <div className="w-full flex flex-col gap-[4px]">
            <p className="text-[10.5px] font-medium tracking-[0.8px] text-faint mb-[2px]">NARROW IT</p>
            {[
              { icon: '⊕', label: '@engineering', sub: 'Only Engineering docs', kind: 'scope' },
              { icon: '⊕', label: '@by:dev',      sub: 'Docs written by Dev',   kind: 'author' },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-[8px] rounded-base px-[10px] py-[6px] hover:bg-hover transition-colors">
                <span className="text-muted text-[14px]">{r.icon}</span>
                <span className="flex-1 text-[13px] text-muted">{r.label}</span>
                <span className="text-[12px] text-faint">{r.sub}</span>
                <span className="text-[11.5px] text-faint">{r.kind}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Composer */}
      <AskChiefComposer
        value={query}
        onChange={setQuery}
        onSubmit={submit}
        placeholder="rollback pl"
      />
    </div>
  )
}

function AskChiefComposer({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
}) {
  const [recording, setRecording] = useState(false)
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <div className="px-[20px] py-[12px]">
        <div className="rounded-lg bg-soft outline-1 -outline-offset-1 outline-line-strong overflow-hidden">
          <div className="flex items-center gap-[6px] px-[10px] pt-[8px] pb-[2px]">
            <span className="text-[11.5px] text-faint">To</span>
            <div className="flex h-[22px] items-center gap-[4px] rounded-sm bg-soft px-[6px] outline-1 -outline-offset-1 outline-line-strong">
              <Mascot size={14} radius={3} area="brand" />
              <span className="text-[11.5px] text-ink-2">Chief</span>
            </div>
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
            placeholder={placeholder}
            className="w-full bg-transparent px-[10px] py-[8px] text-[13px] text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-[6px] px-[10px] py-[6px] border-t border-line">
            <div className="flex items-center gap-[8px] flex-1">
              <div className="flex items-center gap-[4px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                ↕ 4.2k
              </div>
              <div className="flex items-center gap-[3px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                <Mascot size={12} radius={2} area="brand" />
                Opus 5.5
              </div>
              <div className="flex items-center gap-[3px] rounded-btn bg-soft px-[7px] py-[3px] text-[11.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                ⚡ Medium
              </div>
              <button
                type="button"
                onClick={() => { setRecording((r) => !r); if (!recording) { notify('Recording…') } else { notify('Recording stopped') } }}
                className={`flex size-[26px] items-center justify-center rounded-sm transition-colors ${recording ? 'bg-bad text-primary-ink' : 'text-faint hover:bg-hover'}`}
              >
                <Mic size={13} aria-hidden />
              </button>
            </div>
            <button
              type="button"
              onClick={onSubmit}
              className="flex size-[28px] items-center justify-center rounded-sm bg-primary text-primary-ink hover:bg-primary-hover transition-colors"
            >
              <Send size={13} aria-hidden />
            </button>
          </div>
        </div>

        {/* Bottom search options */}
        <div className="mt-[8px] flex items-center gap-[16px]">
          <span className="text-[11.5px] text-faint">Search in</span>
          {[
            { label: 'All areas', active: true },
            { label: 'Docs only', active: true },
            { label: 'Knowledge off', active: false },
          ].map((o) => (
            <div key={o.label} className="flex items-center gap-[4px]">
              <div
                className="size-[14px] shrink-0 rounded-full border border-line-strong flex items-center justify-center"
                style={{ background: o.active ? 'var(--color-primary)' : 'var(--color-surface)' }}
              >
                {o.active && <div className="size-[6px] rounded-full bg-primary-ink" />}
              </div>
              <span className="text-[11.5px] text-muted">{o.label}</span>
            </div>
          ))}
          <button type="button" onClick={() => notify('Keyword search — type a word to find exact matches')} className="ml-auto text-[11.5px] text-link hover:underline">
            Keyword search instead
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Handbook view ─────────────────────────────────────────────────────────────

function HandbookView({ onViewChange }: { onViewChange: (v: DocsMainView) => void }) {
  const [activeFile, setActiveFile] = useState<string | null>('hf-3')
  const [query, setQuery] = useState('')

  const selected = HANDBOOK_FILES.find((f) => f.id === activeFile)

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Left sidebar */}
      <div className="flex w-[240px] shrink-0 flex-col gap-[6px] overflow-y-auto border-r border-line px-[8px] py-[10px]">
        {/* Search */}
        <label className="flex items-center gap-[6px] rounded-base bg-soft px-[8px] py-[5px] outline-1 -outline-offset-1 outline-line-strong">
          <Search size={12} aria-hidden className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a doc…"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint"
          />
        </label>

        {/* Handbook pinned section */}
        <div className="flex flex-col gap-px">
          <div className="flex items-center gap-[6px] px-[8px] py-[4px]">
            <BookOpen size={13} className="text-muted" aria-hidden />
            <span className="text-[12.5px] font-medium text-ink flex-1">Company handbook</span>
            <span className="text-[11px] text-muted">6</span>
          </div>
          {HANDBOOK_FILES.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-current={f.id === activeFile ? 'true' : undefined}
              onClick={() => setActiveFile(f.id)}
              className={`flex w-full items-center gap-[6px] rounded-sm px-[8px] py-[4px] text-left transition-colors ${
                f.id === activeFile ? 'bg-hover' : 'hover:bg-hover'
              }`}
            >
              <FileText size={12} className="text-faint shrink-0" aria-hidden />
              <span
                className={`min-w-0 flex-1 truncate text-[12.5px] ${
                  f.id === activeFile ? 'font-medium text-ink' : 'text-ink-2'
                }`}
              >
                {f.filename}
              </span>
              {f.badge && (
                <span
                  className="shrink-0 rounded-pill px-[5px] py-[0.5px] text-[10.5px] font-medium"
                  style={{
                    background: f.badge === 'Updated' ? 'var(--color-info-tint)' : 'var(--color-ok-tint)',
                    color: f.badge === 'Updated' ? 'var(--color-info)' : 'var(--color-ok)',
                  }}
                >
                  {f.badge === 'New' && f.badgeCount ? `${f.badgeCount} new` : f.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Areas section */}
        <div className="flex flex-col gap-px mt-[8px]">
          <div className="px-[10px] pb-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">AREAS</span>
          </div>
          {DOC_AREAS.map((area) => (
            <div key={area.id} className="flex items-center gap-[8px] rounded-sm px-[8px] py-[3px] hover:bg-hover transition-colors">
              <Folder size={13} className="text-muted shrink-0" aria-hidden />
              <span className="flex-1 text-[12.5px] text-ink-2">{area.label}</span>
              <span className="text-[11px] text-muted">{area.docs.length}</span>
            </div>
          ))}
        </div>

        {/* Knowledge footer */}
        <div className="mt-auto flex items-center gap-[6px] px-[4px] py-[6px]">
          <Brain size={12} className="text-faint" aria-hidden />
          <span className="text-[11.5px] text-muted">Agent memory is separate</span>
          <button type="button" onClick={() => onViewChange('knowledge')} className="ml-auto text-[11.5px] text-link hover:underline whitespace-nowrap">
            Open Knowledge
          </button>
        </div>
      </div>

      {/* Doc viewer */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {selected && (
          <>
            {/* Doc sub-topbar */}
            <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
              <span className="text-[12px] text-muted">Read-only · updated yesterday by Dede</span>
              <div className="ml-auto flex items-center gap-[4px]">
                <button type="button" onClick={() => notify('Suggestion sent — Chief will review and propose an edit.')} className="flex h-[26px] items-center gap-[4px] rounded-btn bg-soft px-[10px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
                  Suggest a change
                </button>
                <span className="ml-[8px] text-[12px] text-muted">Saved · v3</span>
                <IconButton icon={Share2} size={14} aria-label="Share" />
                <IconButton icon={Link2} size={14} aria-label="Link" />
                <IconButton icon={MoreHorizontal} size={14} aria-label="More" />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* Main content */}
              <div className="min-h-0 flex-1 overflow-y-auto px-[48px] py-[36px]">
                {activeFile === 'hf-3' ? (
                  <>
                    <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">
                      Policies
                    </h1>
                    {POLICIES_MD_CONTENT.split('\n').map((line, i) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return <h2 key={i} className="text-[17px] font-semibold text-ink mt-[20px] mb-[8px]">{line.slice(2, -2)}</h2>
                      }
                      if (line.startsWith('- ')) {
                        const isNew = line.includes('aged 65')
                        return (
                          <li key={i} className={`text-[13.5px] text-ink-2 ml-[16px] mb-[4px] ${isNew ? 'bg-ok-tint rounded-sm px-[4px]' : ''}`}>
                            {line.slice(2)}
                            {isNew && <span className="ml-[6px] rounded-pill bg-ok-tint px-[5px] py-[0.5px] text-[10.5px] font-medium text-ok">New</span>}
                          </li>
                        )
                      }
                      if (line === '') return <div key={i} className="h-[6px]" />
                      return <p key={i} className="text-[13.5px] text-muted m-0 mb-[4px]">{line}</p>
                    })}
                  </>
                ) : (
                  <>
                    <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">
                      {selected.filename}
                    </h1>
                    <p className="text-[13.5px] text-ink-2">{selected.description}</p>
                  </>
                )}
              </div>

              {/* Right: what's new */}
              <aside className="flex w-[220px] shrink-0 flex-col gap-[12px] overflow-y-auto border-l border-line px-[14px] py-[16px]">
                <p className="text-[10.5px] font-medium tracking-[0.5px] text-faint m-0">WHAT'S NEW</p>

                <div className="flex flex-col gap-[4px]">
                  <div className="flex items-start gap-[8px]">
                    <FileText size={12} className="text-faint mt-[2px] shrink-0" aria-hidden />
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-[12px] font-medium text-ink-2">POLICIES.md</span>
                      <span className="text-[11px] text-faint">Late fee waived for residents 65+ · yesterday</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-[8px]">
                    <FileText size={12} className="text-faint mt-[2px] shrink-0" aria-hidden />
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-[12px] font-medium text-ink-2">FAQ.md</span>
                      <span className="text-[11px] text-faint">5 answers added by Support · today</span>
                    </div>
                  </div>
                </div>

                <div className="h-px w-full bg-line" />

                <div className="flex flex-col gap-[4px]">
                  <p className="text-[10.5px] font-medium tracking-[0.5px] text-faint m-0">ASK CHIEF</p>
                  <div className="rounded-base bg-soft px-[8px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
                    <div className="flex items-center gap-[4px] mb-[4px]">
                      <Mascot size={14} radius={3} area="brand" />
                      <span className="text-[11.5px] font-medium text-ink">Not sure of a rule?</span>
                    </div>
                    <p className="text-[11.5px] text-muted m-0">It answers from this handbook and shows the line it used.</p>
                    <button type="button" onClick={() => onViewChange('ask-chief')} className="mt-[6px] text-[11.5px] text-link hover:underline">
                      Can we refund a booking paid online?
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Knowledge view (root state machine) ──────────────────────────────────────

function KnowledgeView() {
  const [knowledgeOn, setKnowledgeOn] = useState(false)
  const [subState, setSubState] = useState<KnowledgeSubState>('graph')
  const [askQuestion, setAskQuestion] = useState('')

  if (!knowledgeOn) {
    return <KnowledgeOff onTurnOn={() => { setKnowledgeOn(true); setSubState('graph') }} />
  }

  if (subState === 'answer' && askQuestion) {
    return <KnowledgeAnswer question={askQuestion} onBack={() => setSubState('graph')} />
  }

  if (subState === 'add-sources') {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <KnowledgeGraph
          onAsk={(q) => { setAskQuestion(q); setSubState('answer') }}
          subState={subState}
          onSubState={setSubState}
        />
        <AddSourcesModal onClose={() => setSubState('graph')} />
      </div>
    )
  }

  return (
    <KnowledgeGraph
      onAsk={(q) => { setAskQuestion(q); setSubState('answer') }}
      subState={subState}
      onSubState={setSubState}
    />
  )
}

// ── Topbar meta per view ──────────────────────────────────────────────────────

function topbarMeta(view: DocsMainView, knowledgeOn: boolean, areaName: string | null): string {
  const scope = areaName ?? 'All areas'
  switch (view) {
    case 'notes':     return `${scope} / Q4 Launch`
    case 'graph':     return 'Graph · 64 docs'
    case 'knowledge': return knowledgeOn ? 'Knowledge · on · 51 memories' : 'Knowledge · off'
    case 'ask-chief': return 'Ask Chief · searches docs only'
    case 'handbook':  return 'Company / Company handbook'
  }
}

// ── Docs board (shared by both modes) ──────────────────────────────────────────

/**
 * Shared Docs board: Notes | Graph | Knowledge | Ask Chief | Handbook.
 * `areaId === null` → all areas; a specific area scopes the Notes/meta copy.
 * View switching is local state; the sidebar + Inset come from ModeLayout.
 */
function DocsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? null : null
  const [view, setView] = useState<DocsMainView>('notes')
  const [activeDocId, setActiveDocId] = useState(ACTIVE_DOC.id)
  // Knowledge "on" state is lifted so topbar meta is correct
  const [knowledgeOn] = useState(false)

  function handleNewDoc() {
    notify('Draft created')
  }

  return (
    <>
      <Topbar
        icon={FileText}
        title="Docs"
        meta={topbarMeta(view, knowledgeOn, areaName)}
        actions={
          view === 'knowledge' && knowledgeOn ? (
            <div className="flex items-center gap-[10px]">
              <Button variant="secondary" height={28} icon={Plus}>
                Teach something
              </Button>
              <ViewToggle active={view} onChange={setView} />
              <div className="flex items-center gap-[2px]">
                <IconButton icon={Upload} size={15} aria-label="Import" />
                <IconButton icon={Zap} size={15} aria-label="Automations" />
                <IconButton icon={Share2} size={15} aria-label="Share" />
                <IconButton icon={MoreHorizontal} size={15} aria-label="More" />
              </div>
            </div>
          ) : (
            <TopbarActions view={view} activeView={view} onViewChange={setView} />
          )
        }
      />

      {view === 'notes' && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NotesSidebar activeId={activeDocId} onSelect={setActiveDocId} onViewChange={setView} onNewDoc={handleNewDoc} />
          <NoteDocViewer />
        </div>
      )}

      {view === 'graph' && <GraphView onViewChange={setView} />}

      {view === 'knowledge' && <KnowledgeView />}

      {view === 'ask-chief' && <AskChiefView />}

      {view === 'handbook' && <HandbookView onViewChange={setView} />}
    </>
  )
}

// ── Route wrappers (shared board, area from the store) ────────────────────────

/** Office · Docs. */
export function OfficeDocsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <DocsBoard areaId={areaId} />
}

/** Chat · Docs — same full board (Notes · Graph · Knowledge · Ask Chief · Handbook). */
export function ChatDocsRoute() {
  const areaId = useUIStore((s) => s.areaId)
  return <DocsBoard areaId={areaId} />
}
