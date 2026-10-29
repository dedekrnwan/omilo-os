import { useCallback, useState } from 'react'
import {
  FileText,
  Spline,
  Sparkles,
  PanelRight,
  Pin,
  PinOff,
  Trash2,
  Copy,
  Brain,
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
  X,
  CheckCircle2,
  Circle,
  ArrowUpRight,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { KbItem, Model } from '../../../core/domain/types'
import { Composer } from '../../../ui/ChatSession/Composer'
import { DEFAULT_MODEL } from '../../../ui/ChatSession/ModelMenu'
import { Button, IconButton } from '../../../ui/ds/Button'
import { Topbar } from '../../../ui/ds/Frame'
import { Mascot } from '../../../ui/ds/Mascot'
import {
  // NOTE: ACTIVE_DOC, LINKED_DOCS, LINKED_GOALS retained as local defaults —
  // the backend KbItem shape has no doc-body, linked-docs, or linked-goals fields.
  ACTIVE_DOC,
  LINKED_DOCS,
  LINKED_GOALS,
  // NOTE: ASK_CHIEF_* retained — no live API for Ask Chief suggestions/answers.
  ASK_CHIEF_SUGGESTIONS,
  ASK_CHIEF_MATCHING_DOCS,
  ASK_CHIEF_ANSWER,
  // NOTE: HANDBOOK_FILES / POLICIES_MD_CONTENT retained — no live handbook API.
  HANDBOOK_FILES,
  POLICIES_MD_CONTENT,
} from './data'
import { GraphView } from './GraphView'
import { KnowledgeView } from './KnowledgeView'
import { ContextMenuArea, MoreMenu, copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useArea, useCreateDoc, useKnowledge, useUpdateDoc } from '../../../app/queries'
import { useUIStore } from '../../../app/store'

// ── KbItem → DocFile mapping ──────────────────────────────────────────────────

interface DocFile {
  id: string
  title: string
  icon: 'doc' | 'folder' | 'check' | 'markdown'
  edited: string   // backend doesn't provide this; using '' as default
  editor: string   // backend doesn't provide this; using '' as default
  pinned?: boolean
  unread?: boolean
  status?: 'v1' | 'draft'
  badge?: 'Updated' | 'New'
}

interface DocArea {
  id: string
  label: string
  docs: DocFile[]
}

/** Map KbItem.kind to a human-readable area label. */
function kindToAreaLabel(kind: string): string {
  const MAP: Record<string, string> = {
    skill: 'Skills',
    upload: 'Uploads',
    doc: 'Documents',
    note: 'Notes',
  }
  return MAP[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

/** Map KbItem[] → DocArea[] grouped by kind. */
function kbItemsToDocAreas(items: KbItem[]): DocArea[] {
  const byKind = new Map<string, KbItem[]>()
  for (const item of items) {
    const bucket = byKind.get(item.kind) ?? []
    bucket.push(item)
    byKind.set(item.kind, bucket)
  }
  return [...byKind.entries()].map(([kind, kindItems]) => ({
    id: kind,
    label: kindToAreaLabel(kind),
    docs: kindItems.map((item, i) => ({
      id: `${item.sourceId}-${i}`,
      title: item.heading,
      // NOTE: icon, edited, editor not in KbItem; using safe defaults
      icon: 'doc' as const,
      edited: '',
      editor: '',
    })),
  }))
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocsMainView = 'notes' | 'graph' | 'knowledge' | 'ask-chief' | 'handbook'


// ── View toggle (icon-only button group, pen Docs topbar) ─────────────────────

const VIEW_TABS: Array<{ id: Exclude<DocsMainView, 'handbook'>; label: string; icon: LucideIcon }> = [
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'graph', label: 'Graph', icon: Spline },
  { id: 'knowledge', label: 'Knowledge', icon: Brain },
  { id: 'ask-chief', label: 'Ask Chief', icon: Sparkles },
]

function ViewToggle({ active, onChange, knowledgeOn }: { active: DocsMainView; onChange: (v: DocsMainView) => void; knowledgeOn: boolean }) {
  const current = active === 'handbook' ? 'notes' : active
  return (
    <div role="tablist" aria-label="Docs views" className="flex items-center gap-[2px] rounded-base bg-soft p-[2px] outline-1 -outline-offset-1 outline-line">
      {VIEW_TABS.map(({ id, label, icon: Icon }) => {
        const on = current === id
        const off = id === 'knowledge' && !knowledgeOn && !on
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={label}
            onClick={() => onChange(id)}
            className={`group relative flex size-[28px] items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink ${
              on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : off ? 'text-faint hover:text-muted' : 'text-muted hover:text-ink-2'
            }`}
          >
            <Icon size={15} aria-hidden />
            <span
              role="tooltip"
              className="pointer-events-none absolute top-[calc(100%+6px)] left-1/2 z-50 hidden h-[24px] -translate-x-1/2 items-center rounded-btn bg-primary px-[8px] text-[12px] whitespace-nowrap text-white shadow-[0_4px_10px_#0C0A0929] group-hover:flex"
            >
              {id === 'knowledge' && !knowledgeOn ? 'Knowledge · off' : label}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PanelToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={onToggle}
      className={`flex size-[30px] items-center justify-center rounded-sm hover:bg-hover ${open ? 'text-ink' : 'text-muted'}`}
    >
      <PanelRight size={16} aria-hidden />
    </button>
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
  onShowInGraph,
  onAskChief,
  onOpenKnowledge,
  onNewDoc,
  docAreas,
  isLoading,
  isError,
}: {
  activeId: string
  onSelect: (id: string) => void
  onShowInGraph: (id: string) => void
  onAskChief: (id: string) => void
  onOpenKnowledge: () => void
  onNewDoc: () => void
  /** Live doc areas from useKnowledge() mapped to DocArea[]. */
  docAreas: DocArea[]
  isLoading: boolean
  isError: boolean
}) {
  const [query, setQuery] = useState('')
  const [pinned, setPinned] = useState<Record<string, boolean>>({})
  const [deleted, setDeleted] = useState<string[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [renaming, setRenaming] = useState<string | null>(null)

  function menuFor(doc: DocFile): MenuEntries {
    const isPinned = pinned[doc.id] ?? doc.pinned ?? false
    return [
      { label: 'Open', icon: FileText, onSelect: () => onSelect(doc.id) },
      { label: 'Show in graph', icon: Spline, onSelect: () => onShowInGraph(doc.id) },
      { label: 'Ask Chief about it', icon: Sparkles, onSelect: () => onAskChief(doc.id) },
      { type: 'separator' },
      { label: 'Rename', icon: Edit3, onSelect: () => setRenaming(doc.id) },
      isPinned
        ? { label: 'Unpin', icon: PinOff, onSelect: () => setPinned((p) => ({ ...p, [doc.id]: false })) }
        : { label: 'Pin to top', icon: Pin, onSelect: () => setPinned((p) => ({ ...p, [doc.id]: true })) },
      { label: 'Duplicate', icon: Copy, onSelect: () => notify(`Made a copy of "${names[doc.id] ?? doc.title}"`) },
      { label: 'Copy link', icon: Link2, onSelect: () => { copyText(`${location.origin}/docs/${doc.id}`); notify('Link copied') } },
      { type: 'separator' },
      {
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => {
          setDeleted((d) => [...d, doc.id])
          notify(`Deleted "${names[doc.id] ?? doc.title}"`, () => setDeleted((d) => d.filter((x) => x !== doc.id)))
        },
      },
    ]
  }
  const rowProps = (doc: DocFile) => ({
    doc: { ...doc, title: names[doc.id] ?? doc.title, pinned: pinned[doc.id] ?? doc.pinned },
    menu: menuFor(doc),
    renaming: renaming === doc.id,
    onRename: (v: string | null) => {
      setRenaming(null)
      if (v) setNames((n) => ({ ...n, [doc.id]: v }))
    },
  })
  const visible = (d: DocFile) => !deleted.includes(d.id)
  const [filter, setFilter] = useState<'All' | 'By you' | 'By agents'>('All')
  const filters = ['All', 'By you', 'By agents'] as const

  const allDocs = docAreas.flatMap((a) => a.docs).filter(visible)
  const filtered = query
    ? allDocs.filter((d) => (names[d.id] ?? d.title).toLowerCase().includes(query.toLowerCase()))
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

      {/* Doc list — live states */}
      {isError ? (
        <div className="flex flex-col items-center gap-[4px] py-[24px] text-center px-[8px]">
          <span className="text-[12.5px] text-bad">Couldn't load docs</span>
          <span className="text-[11.5px] text-faint">Check your connection and try again</span>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-[6px] py-[8px]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[28px] animate-pulse rounded-sm bg-soft" />
          ))}
        </div>
      ) : docAreas.length === 0 ? (
        <div className="flex flex-col items-center gap-[4px] py-[24px] text-center px-[8px]">
          <FileText size={18} className="text-faint" aria-hidden />
          <span className="text-[12.5px] text-muted">No docs yet</span>
          <span className="text-[11.5px] text-faint">Add your first doc to get started</span>
        </div>
      ) : filtered ? (
        <div className="flex flex-col gap-px">
          {filtered.map((doc) => (
            <NoteDocRow
              key={doc.id}
              {...rowProps(doc)}
              active={doc.id === activeId}
              onSelect={() => onSelect(doc.id)}
            />
          ))}
        </div>
      ) : (
        docAreas.map((area) => (
          <div key={area.id} className="flex flex-col gap-px">
            <div className="px-[10px] pb-[4px] pt-[4px]">
              <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint uppercase">
                {area.label}
              </span>
              <span className="ml-[4px] text-[10.5px] text-faint">{area.docs.length}</span>
            </div>
            {area.docs.filter(visible).map((doc) => (
              <NoteDocRow
                key={doc.id}
                {...rowProps(doc)}
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
        <button type="button" onClick={onOpenKnowledge} className="ml-auto text-[11.5px] text-link hover:underline whitespace-nowrap">
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
  menu,
  renaming,
  onRename,
}: {
  doc: DocFile
  active: boolean
  onSelect: () => void
  menu: MenuEntries
  renaming: boolean
  onRename: (v: string | null) => void
}) {
  return (
    <ContextMenuArea items={menu} label={`${doc.title} actions`}>
      <div
        className={`group/doc relative flex w-full items-center gap-[6px] rounded-sm px-[8px] py-[5px] transition-colors data-[state=open]:bg-hover ${
          active ? 'bg-hover' : 'hover:bg-hover'
        }`}
      >
        <button type="button" aria-current={active ? 'true' : undefined} aria-label={doc.title} onClick={onSelect} className="absolute inset-0 rounded-sm" />
        <span className="pointer-events-none relative flex w-full items-center gap-[6px]">
          {doc.unread && <span aria-label="unread" className="size-[6px] shrink-0 rounded-full bg-helper-brand" />}
          {docIcon(doc.icon)}
          {renaming ? (
            <input
              autoFocus
              aria-label="New name"
              defaultValue={doc.title}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => onRename(e.currentTarget.value.trim() || null)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') onRename(null)
              }}
              className="pointer-events-auto h-[20px] min-w-0 flex-1 rounded-xs bg-surface px-[4px] text-[12.5px] text-ink outline-1 outline-ink"
            />
          ) : (
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? 'font-medium text-ink' : 'text-ink-2'}`}>{doc.title}</span>
          )}
          {doc.pinned && <Pin size={11} aria-label="pinned" className="shrink-0 -rotate-45 text-faint" />}
          {doc.status && (
            <span className="shrink-0 rounded-pill bg-soft px-[5px] py-[1px] text-[10.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
              {doc.status}
            </span>
          )}
          <span className="shrink-0 text-[11px] whitespace-nowrap text-faint group-hover/doc:hidden group-has-[[data-state=open]]/doc:hidden">{doc.edited}</span>
          <span className="pointer-events-auto hidden group-hover/doc:flex has-[[data-state=open]]:flex">
            <MoreMenu items={menu} label={`${doc.title} actions`} size={18} />
          </span>
        </span>
      </div>
    </ContextMenuArea>
  )
}

// ── Notes: doc viewer ─────────────────────────────────────────────────────────

function NoteDocViewer({ docId }: { docId: string }) {
  const [mode, setMode] = useState<'read' | 'edit' | 'both'>('read')
  const doc = ACTIVE_DOC
  const [body, setBody] = useState(doc.body)
  const updateDoc = useUpdateDoc()
  const save = () => {
    updateDoc.mutate(
      { id: docId, content: body },
      { onSuccess: () => notify('Saved'), onError: () => notify("Couldn't save") },
    )
  }

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
            {mode !== 'read' && (
              <Button variant="primary" height={28} onClick={save} disabled={updateDoc.isPending}>
                {updateDoc.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
            <span className="mx-[4px] text-[12px] text-muted">{mode === 'read' ? 'Saved · v3' : 'Editing'}</span>
            <IconButton icon={Share2} size={14} aria-label="Share" />
            <IconButton icon={Link2} size={14} aria-label="Copy link" />
            <IconButton icon={Eye} size={14} aria-label="Preview" onClick={() => setMode('read')} />
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
          {mode === 'read' ? (
            <div className="flex flex-col gap-[6px]">{renderBody(body)}</div>
          ) : (
            <textarea
              aria-label="Doc body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[320px] w-full resize-y rounded-base bg-surface px-[12px] py-[10px] font-mono text-[13px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong"
            />
          )}
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

// ── Ask Chief view ────────────────────────────────────────────────────────────

function AskChiefView() {
  const [askState, setAskState] = useState<'idle' | 'answer'>('idle')
  const [model, setModel] = useState<Model>(DEFAULT_MODEL)

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
                  <button key={s} type="button" onClick={() => setAskState('answer')} className="h-[28px] rounded-pill bg-soft px-[12px] text-[12px] text-muted outline-1 -outline-offset-1 outline-line-strong hover:text-ink transition-colors">
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
        <div className="shrink-0 px-[20px] pt-[6px] pb-[12px]">
          <Composer
            sessionId="ask-chief-answer"
            selectedModel={model}
            onModelChange={setModel}
            placeholder="Ask a follow-up…"
            compact
            onSend={() => setAskState('idle')}
          />
        </div>
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
                onClick={() => setAskState('answer')}
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
      <div className="shrink-0 px-[20px] pt-[6px] pb-[12px]">
        <Composer
          sessionId="ask-chief"
          selectedModel={model}
          onModelChange={setModel}
          placeholder="Ask Chief anything in your docs…"
          compact
          onSend={() => setAskState('answer')}
          autoFocus
        />
      </div>
    </div>
  )
}

// ── Handbook view ─────────────────────────────────────────────────────────────

function HandbookView({ onViewChange, handbookDocAreas }: { onViewChange: (v: DocsMainView) => void; handbookDocAreas: DocArea[] }) {
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

        {/* Areas section — derived client-side from live doc areas */}
        {handbookDocAreas.length > 0 && (
          <div className="flex flex-col gap-px mt-[8px]">
            <div className="px-[10px] pb-[4px]">
              <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">AREAS</span>
            </div>
            {handbookDocAreas.map((area) => (
              <div key={area.id} className="flex items-center gap-[8px] rounded-sm px-[8px] py-[3px] hover:bg-hover transition-colors">
                <Folder size={13} className="text-muted shrink-0" aria-hidden />
                <span className="flex-1 text-[12.5px] text-ink-2">{area.label}</span>
                <span className="text-[11px] text-muted">{area.docs.length}</span>
              </div>
            ))}
          </div>
        )}

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

// ── Topbar meta per view ──────────────────────────────────────────────────────

function topbarMeta(view: DocsMainView, knowledgeOn: boolean, areaName: string | null, liveKbCount: number): string {
  const scope = areaName ?? 'All areas'
  switch (view) {
    case 'notes':     return `${scope} / Q4 Launch`
    case 'graph':     return 'Graph · 64 docs'
    case 'knowledge': return knowledgeOn ? `Knowledge · on · ${liveKbCount} memories` : 'Knowledge · off'
    case 'ask-chief': return 'Ask Chief · searches docs only'
    case 'handbook':  return 'Company / Company handbook'
  }
}

// ── Docs board (shared by both modes) ──────────────────────────────────────────

/**
 * Shared Docs board: Notes · Graph · Knowledge · Ask Chief (icon-only toggle);
 * Handbook opens from the Notes list. The panel toggle shows/hides the view's
 * side panel (graph filters, Ask & teach).
 */
function DocsBoard({ areaId }: { areaId: string | null }) {
  const { data: area } = useArea(areaId ?? '')
  const areaName = areaId ? area?.name ?? null : null

  // ── Live knowledge data from the repo (not the data.ts fixture) ──────────────
  // NOTE: useKnowledgeSources() is NOT used — GET /v1/knowledge/sources does not
  // exist on the backend yet. Sources grouping is derived client-side from KbItem.kind.
  const { data: kbItems = [], isLoading: kbLoading, isError: kbError } = useKnowledge()
  const docAreas = kbItemsToDocAreas(kbItems)
  // Live count for KnowledgeView topbar meta (replaces hardcoded 51)
  const liveKbCount = kbItems.length

  const [view, setView] = useState<DocsMainView>('notes')
  const [activeDocId, setActiveDocId] = useState(ACTIVE_DOC.id)
  const [knowledgeOn, setKnowledgeOn] = useState(false)
  const [panel, setPanel] = useState<Record<string, boolean>>({ graph: true, knowledge: false, notes: true })
  const [teach, setTeach] = useState(0)
  const panelOpen = panel[view] ?? false
  const setPanelOpen = useCallback((open: boolean) => setPanel((p) => ({ ...p, [view]: open })), [view])

  const createDoc = useCreateDoc()
  function handleNewDoc() {
    createDoc.mutate(
      { title: 'Untitled doc', content: '', kind: 'doc' },
      {
        onSuccess: (doc) => {
          notify('Draft created')
          setActiveDocId(doc.id)
          setView('notes')
        },
        onError: () => notify("Couldn't create the doc"),
      },
    )
  }

  return (
    <>
      <Topbar
        icon={FileText}
        title="Docs"
        meta={topbarMeta(view, knowledgeOn, areaName, liveKbCount)}
        actions={
          <div className="flex items-center gap-[10px]">
            {view === 'knowledge' && knowledgeOn && (
              <Button
                variant="secondary"
                height={30}
                icon={Plus}
                onClick={() => {
                  setPanel((p) => ({ ...p, knowledge: true }))
                  setTeach((t) => t + 1)
                }}
              >
                Teach something
              </Button>
            )}
            <ViewToggle active={view} onChange={setView} knowledgeOn={knowledgeOn} />
            <PanelToggle
              open={panelOpen}
              onToggle={() => setPanelOpen(!panelOpen)}
              label={view === 'knowledge' ? 'Ask & teach panel' : view === 'graph' ? 'Graph filters' : 'Side panel'}
            />
          </div>
        }
      />

      {view === 'notes' && (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <NotesSidebar
            activeId={activeDocId}
            onSelect={(id) => (id === 'd-handbook' ? setView('handbook') : setActiveDocId(id))}
            onShowInGraph={() => setView('graph')}
            onAskChief={() => setView('ask-chief')}
            onOpenKnowledge={() => setView('knowledge')}
            onNewDoc={handleNewDoc}
            docAreas={docAreas}
            isLoading={kbLoading}
            isError={kbError}
          />
          <NoteDocViewer docId={activeDocId} />
        </div>
      )}

      {view === 'graph' && (
        <GraphView
          showFilters={panelOpen}
          onOpenNote={(docId) => {
            if (docId === 'd-handbook') return setView('handbook')
            setActiveDocId(docId)
            setView('notes')
          }}
          onAskChief={() => setView('ask-chief')}
        />
      )}

      {view === 'knowledge' &&
        (knowledgeOn ? (
          <KnowledgeView panelOpen={panelOpen} onPanelOpen={setPanelOpen} teachSignal={teach} />
        ) : (
          <KnowledgeOff onTurnOn={() => setKnowledgeOn(true)} />
        ))}

      {view === 'ask-chief' && <AskChiefView />}

      {view === 'handbook' && <HandbookView onViewChange={setView} handbookDocAreas={docAreas} />}
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
