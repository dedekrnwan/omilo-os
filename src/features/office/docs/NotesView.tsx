import { useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Check,
  Copy,
  Edit3,
  Eye,
  FileText,
  Folder,
  Link2,
  Pin,
  PinOff,
  Plus,
  Search,
  Share2,
  Sparkles,
  Spline,
  Brain,
  Trash2,
  X,
} from 'lucide-react'
import type { Channel, DocDetail, DocSummary, HelperArea } from '../../../core/domain/types'
import { Button, IconButton } from '../../../ui/ds/Button'
import { Mascot } from '../../../ui/ds/Mascot'
import { ContextMenuArea, MoreMenu, copyText } from '../../../ui/ds/ItemMenu'
import type { MenuEntries } from '../../../ui/ds/ItemMenu'
import { notify } from '../../../ui/ds/Toaster'
import { useDocVersions, useHelpers, useMembers, useMemoryDoc, usePatchDoc } from '../../../app/queries'
import { areaLabel, docLink, headingId, headingOf, longAgo, outlineOf, whoLabel } from './docsUtil'
import type { DocGroup, DocRow } from './docsUtil'
import { useSession } from '../../../app/session'

// ── Sidebar ──────────────────────────────────────────────────────────────────

export interface DocActions {
  rename: (doc: DocSummary, title: string) => void
  pin: (doc: DocSummary, pinned: boolean) => void
  duplicate: (doc: DocSummary) => void
  remove: (doc: DocSummary) => void
}

export function NotesSidebar({
  activeId,
  onSelect,
  onShowInGraph,
  onAskChief,
  onOpenKnowledge,
  onNewDoc,
  groups,
  hidden,
  actions,
  isLoading,
  isError,
}: {
  activeId: string | null
  onSelect: (id: string) => void
  onShowInGraph: (id: string) => void
  onAskChief: (title: string) => void
  onOpenKnowledge: () => void
  onNewDoc: () => void
  groups: DocGroup[]
  /** Ids deleted but still undoable. */
  hidden: string[]
  actions: DocActions
  isLoading: boolean
  isError: boolean
}) {
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [filter, setFilter] = useState<'All' | 'By you' | 'By agents'>('All')
  const filters = ['All', 'By you', 'By agents'] as const

  function menuFor(row: DocRow): MenuEntries {
    const doc = row.doc
    if (!doc) {
      return [
        { label: 'Open', icon: FileText, onSelect: () => onSelect(row.id) },
        { label: 'Copy link', icon: Link2, onSelect: () => { copyText(docLink('handbook')); notify('Link copied') } },
      ]
    }
    return [
      { label: 'Open', icon: FileText, onSelect: () => onSelect(doc.id) },
      { label: 'Show in graph', icon: Spline, onSelect: () => onShowInGraph(doc.id) },
      { label: 'Ask Chief about it', icon: Sparkles, onSelect: () => onAskChief(doc.title) },
      { type: 'separator' },
      { label: 'Rename', icon: Edit3, onSelect: () => setRenaming(doc.id) },
      doc.pinned
        ? { label: 'Unpin', icon: PinOff, onSelect: () => actions.pin(doc, false) }
        : { label: 'Pin to top', icon: Pin, onSelect: () => actions.pin(doc, true) },
      { label: 'Duplicate', icon: Copy, onSelect: () => actions.duplicate(doc) },
      { label: 'Copy link', icon: Link2, onSelect: () => { copyText(docLink(doc.id)); notify('Link copied') } },
      { type: 'separator' },
      { label: 'Delete', icon: Trash2, danger: true, onSelect: () => actions.remove(doc) },
    ]
  }

  const keep = (r: DocRow) =>
    !hidden.includes(r.id) && (filter === 'All' || !r.doc || (filter === 'By you' ? r.byPerson : !r.byPerson))
  const visibleGroups = groups.map((g) => ({ ...g, docs: g.docs.filter(keep) })).filter((g) => g.docs.length > 0)
  const all = visibleGroups.flatMap((g) => g.docs)
  const filtered = query ? all.filter((d) => d.title.toLowerCase().includes(query.toLowerCase())) : null
  const companyDocs = groups.flatMap((g) => g.docs).filter((d) => d.doc && !hidden.includes(d.id))

  const row = (r: DocRow) => (
    <NoteDocRow
      key={r.id}
      doc={r}
      menu={menuFor(r)}
      renaming={renaming === r.id}
      onRename={(v) => {
        setRenaming(null)
        if (v && r.doc && v !== r.doc.title) actions.rename(r.doc, v)
      }}
      active={r.id === activeId}
      onSelect={() => onSelect(r.id)}
    />
  )

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
          <button type="button" aria-label="Clear" onClick={() => setQuery('')} className="text-faint hover:text-muted">
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

      {isError ? (
        <div className="flex flex-col items-center gap-[4px] px-[8px] py-[24px] text-center">
          <span className="text-[12.5px] text-bad">Couldn't load docs</span>
          <span className="text-[11.5px] text-faint">Check your connection and try again</span>
        </div>
      ) : isLoading ? (
        <div className="flex flex-col gap-[6px] py-[8px]">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[28px] animate-pulse rounded-sm bg-soft" />
          ))}
        </div>
      ) : (
        <>
          {filtered ? (
            <div className="flex flex-col gap-px">{filtered.map(row)}</div>
          ) : (
            visibleGroups.map((g) => (
              <div key={g.id} className="flex flex-col gap-px">
                <div className="px-[10px] pt-[4px] pb-[4px]">
                  <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint uppercase">{g.label}</span>
                  <span className="ml-[4px] text-[10.5px] text-faint">{g.docs.filter((d) => d.doc).length || g.docs.length}</span>
                </div>
                {g.docs.map(row)}
              </div>
            ))
          )}
          {companyDocs.length === 0 && !query && (
            <div className="flex flex-col items-center gap-[4px] px-[8px] py-[24px] text-center">
              <FileText size={18} className="text-faint" aria-hidden />
              <span className="text-[12.5px] text-muted">No docs yet</span>
              <span className="text-[11.5px] text-faint">Add your first doc to get started</span>
            </div>
          )}
        </>
      )}

      <div className="mt-auto flex items-center gap-[6px] px-[8px] py-[6px]">
        <Brain size={12} className="text-faint" aria-hidden />
        <span className="text-[11.5px] text-muted">Agent memory is separate</span>
        <button type="button" onClick={onOpenKnowledge} className="ml-auto text-[11.5px] whitespace-nowrap text-link hover:underline">
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
  doc: DocRow
  active: boolean
  onSelect: () => void
  menu: MenuEntries
  renaming: boolean
  onRename: (v: string | null) => void
}) {
  const Icon = doc.icon === 'folder' ? Folder : FileText
  return (
    <ContextMenuArea items={menu} label={`${doc.title} actions`}>
      <div
        className={`group/doc relative flex w-full items-center gap-[6px] rounded-sm px-[8px] py-[5px] transition-colors data-[state=open]:bg-hover ${
          active ? 'bg-hover' : 'hover:bg-hover'
        }`}
      >
        <button type="button" aria-current={active ? 'true' : undefined} aria-label={doc.title} onClick={onSelect} className="absolute inset-0 rounded-sm" />
        <span className="pointer-events-none relative flex w-full items-center gap-[6px]">
          <Icon size={13} className="shrink-0 text-muted" aria-hidden />
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
          {doc.pinned && doc.doc && <Pin size={11} aria-label="pinned" className="shrink-0 -rotate-45 text-faint" />}
          <span className="shrink-0 text-[11px] whitespace-nowrap text-faint group-hover/doc:hidden group-has-[[data-state=open]]/doc:hidden">{doc.edited}</span>
          <span className="pointer-events-auto hidden group-hover/doc:flex has-[[data-state=open]]:flex">
            <MoreMenu items={menu} label={`${doc.title} actions`} size={18} />
          </span>
        </span>
      </div>
    </ContextMenuArea>
  )
}

// ── Viewer ───────────────────────────────────────────────────────────────────

export function NoteDocViewer({
  docId,
  channels,
  allDocs,
  actions,
  onOpenDoc,
  onCreateDoc,
}: {
  docId: string | null
  channels: Channel[]
  allDocs: DocSummary[]
  actions: DocActions
  onOpenDoc: (id: string) => void
  onCreateDoc: (title: string) => void
}) {
  const { data: detail, isLoading, isError } = useMemoryDoc(docId)
  if (!docId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[6px] text-center">
        <FileText size={22} className="text-faint" aria-hidden />
        <span className="text-[13px] text-muted">Pick a doc, or press + to write one</span>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] px-[48px] py-[36px]">
        <div className="h-[28px] w-[260px] animate-pulse rounded-sm bg-soft" />
        <div className="h-[14px] w-full animate-pulse rounded-sm bg-soft" />
        <div className="h-[14px] w-2/3 animate-pulse rounded-sm bg-soft" />
      </div>
    )
  }
  if (isError || !detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[4px] text-center">
        <span className="text-[13px] text-bad">{isError ? "Couldn't open this doc" : 'This doc no longer exists'}</span>
      </div>
    )
  }
  return (
    <DocViewerBody
      key={`${detail.id}:${detail.version}`}
      detail={detail}
      channels={channels}
      allDocs={allDocs}
      actions={actions}
      onOpenDoc={onOpenDoc}
      onCreateDoc={onCreateDoc}
    />
  )
}

function DocViewerBody({
  detail,
  channels,
  allDocs,
  actions,
  onOpenDoc,
  onCreateDoc,
}: {
  detail: DocDetail
  channels: Channel[]
  allDocs: DocSummary[]
  actions: DocActions
  onOpenDoc: (id: string) => void
  onCreateDoc: (title: string) => void
}) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'read' | 'edit' | 'both'>('read')
  const [body, setBody] = useState(detail.content)
  const patchDoc = usePatchDoc()
  const { data: versions = [] } = useDocVersions(detail.id)
  const { data: helpers = [] } = useHelpers()
  const { data: members = [] } = useMembers()
  const userId = useSession((s) => s.user?.id)
  const scroller = useRef<HTMLDivElement>(null)
  const who = (by: string) => whoLabel(by, { userId, members, helpers })
  const dirty = body !== detail.content

  const editorHelper = detail.updatedBy.startsWith('helper:') ? helpers.find((h) => `helper:${h.id}` === detail.updatedBy) : undefined
  const mascotArea: HelperArea = editorHelper?.area ?? 'brand'
  const editor = who(detail.updatedBy)

  const save = () =>
    patchDoc.mutate(
      { id: detail.id, patch: { content: body } },
      { onSuccess: () => notify('Saved'), onError: () => notify("Couldn't save") },
    )

  const outline = useMemo(() => outlineOf(body), [body])

  function openTarget(label: string) {
    const key = label.toLowerCase()
    const link = detail.links.find((l) => l.title.toLowerCase() === key) ?? allDocs.find((d) => d.title.toLowerCase() === key)
    if (link) return onOpenDoc(link.id)
    if (detail.goals.some((g) => g.title.toLowerCase() === key)) return void navigate({ to: '/goals' })
    onCreateDoc(label)
  }

  function renderInline(text: string) {
    return text.split(/(\[\[[^\]]+\]\])/g).map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const label = part.slice(2, -2).split('|')[0].trim()
        const shown = part.slice(2, -2).split('|').pop()!.trim()
        return (
          <button key={i} type="button" className="text-link underline underline-offset-2 hover:opacity-80" onClick={() => openTarget(label)}>
            {shown}
          </button>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  function renderBody(text: string) {
    return text.split('\n').map((line, i) => {
      const h = headingOf(line)
      if (h) {
        return (
          <p key={i} id={headingId(h.text)} className="m-0 mt-[4px] text-[13.5px] font-semibold text-ink">
            {h.text}
          </p>
        )
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        return (
          <li key={i} className="ml-[16px] text-[13.5px] text-ink-2">
            {renderInline(line.slice(2))}
          </li>
        )
      }
      if (line.trim() === '') return <div key={i} className="h-[8px]" />
      return (
        <p key={i} className="m-0 text-[13.5px] text-ink-2">
          {renderInline(line)}
        </p>
      )
    })
  }

  const moreMenu: MenuEntries = [
    { label: 'Duplicate', icon: Copy, onSelect: () => actions.duplicate(detail) },
    detail.pinned
      ? { label: 'Unpin', icon: PinOff, onSelect: () => actions.pin(detail, false) }
      : { label: 'Pin to top', icon: Pin, onSelect: () => actions.pin(detail, true) },
    { type: 'separator' },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => actions.remove(detail) },
  ]
  const copyLink = () => {
    copyText(docLink(detail.id))
    notify('Link copied')
  }
  const linksCount = detail.links.length + detail.unresolved.length
  const linkedHere = detail.backlinks.length + detail.goals.length

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
          <div className="flex min-w-0 flex-1 items-center gap-[6px]">
            <Mascot size={18} radius={5} area={mascotArea} />
            <span className="shrink-0 text-[12px] text-muted">
              {editor ? `${editor.charAt(0).toUpperCase()}${editor.slice(1)} · ` : ''}edited {longAgo(detail.updatedAt)}
            </span>
            {detail.goals[0] && (
              <span className="ml-[2px] truncate rounded-pill bg-soft px-[6px] py-[1px] text-[10.5px] text-muted outline-1 -outline-offset-1 outline-line-strong">
                @ {detail.goals[0].title}
              </span>
            )}
          </div>

          <div className="flex gap-[2px] rounded-sm bg-soft p-[2px] outline-1 -outline-offset-1 outline-line-strong">
            {(['edit', 'both', 'read'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="flex h-[24px] items-center gap-[4px] rounded-xs px-[7px] text-[11.5px] font-medium capitalize transition-colors"
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

          <div className="flex items-center gap-[2px]">
            {mode !== 'read' && (
              <Button variant="primary" height={28} onClick={save} disabled={patchDoc.isPending || !dirty}>
                {patchDoc.isPending ? 'Saving…' : 'Save'}
              </Button>
            )}
            <span className="mx-[4px] text-[12px] text-muted">{dirty ? 'Unsaved changes' : `Saved · v${detail.version}`}</span>
            <IconButton icon={Share2} size={14} aria-label="Share" onClick={copyLink} />
            <IconButton icon={Link2} size={14} aria-label="Copy link" onClick={copyLink} />
            <IconButton icon={Eye} size={14} aria-label="Preview" onClick={() => setMode('read')} />
            <MoreMenu items={moreMenu} label="More" size={28} />
          </div>
        </div>

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-[48px] py-[36px]">
          <div className="mb-[4px] flex items-center gap-[6px]">
            <span className="text-[12px] text-faint">{areaLabel(detail.area, channels)}</span>
          </div>
          <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">{detail.title}</h1>
          {mode === 'read' ? (
            <div className="flex flex-col gap-[6px]">
              {body.trim() ? renderBody(body) : <p className="m-0 text-[13.5px] text-faint">This doc is empty — switch to Edit to write it.</p>}
            </div>
          ) : (
            <div className={mode === 'both' ? 'grid grid-cols-2 gap-[20px]' : ''}>
              <textarea
                aria-label="Doc body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-[320px] w-full resize-y rounded-base bg-surface px-[12px] py-[10px] font-mono text-[13px] leading-[1.6] text-ink outline-1 -outline-offset-1 outline-line-strong"
              />
              {mode === 'both' && <div className="flex flex-col gap-[6px]">{renderBody(body)}</div>}
            </div>
          )}
        </div>
      </div>

      <aside className="flex w-[220px] shrink-0 flex-col gap-[16px] overflow-y-auto border-l border-line px-[14px] py-[16px]">
        <div className="flex flex-col gap-[2px]">
          <div className="mb-[4px] flex items-center gap-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKS FROM HERE</span>
            <span className="ml-auto text-[10.5px] text-faint">{linksCount}</span>
          </div>
          {detail.links.map((d) => (
            <button key={d.id} type="button" onClick={() => onOpenDoc(d.id)} className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover">
              <div className="flex items-center gap-[4px]">
                <FileText size={11} className="shrink-0 text-faint" aria-hidden />
                <span className="text-[12px] text-ink-2">{d.title}</span>
              </div>
              <span className="pl-[15px] text-[11px] text-faint">{d.kind === 'handbook' ? 'Company handbook' : areaLabel(allDocs.find((x) => x.id === d.id)?.area, channels)}</span>
            </button>
          ))}
          {detail.unresolved.map((t) => (
            <button key={t} type="button" onClick={() => onCreateDoc(t)} className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover">
              <div className="flex items-center gap-[4px]">
                <Plus size={11} className="shrink-0 text-faint" aria-hidden />
                <span className="text-[12px] text-muted">{t}</span>
              </div>
              <span className="pl-[15px] text-[11px] text-faint">Not written yet · create it</span>
            </button>
          ))}
          {linksCount === 0 && <span className="px-[6px] text-[11.5px] text-faint">Link a doc with [[its title]]</span>}
        </div>

        <div className="h-px w-full bg-line" />

        <div className="flex flex-col gap-[2px]">
          <div className="mb-[4px] flex items-center gap-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKED HERE</span>
            <span className="ml-auto text-[10.5px] text-faint">{linkedHere}</span>
          </div>
          {detail.goals.map((g) => (
            <button key={g.id} type="button" onClick={() => void navigate({ to: '/goals' })} className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover">
              <span className="text-[12px] text-ink-2">{g.title}</span>
              <span className="text-[11px] text-faint">Goal · {g.progress}%</span>
            </button>
          ))}
          {detail.backlinks.map((d) => (
            <button key={d.id} type="button" onClick={() => onOpenDoc(d.id)} className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover">
              <span className="text-[12px] text-ink-2">{d.title}</span>
              <span className="text-[11px] text-faint">Links to this doc</span>
            </button>
          ))}
          {linkedHere === 0 && <span className="px-[6px] text-[11.5px] text-faint">Nothing links here yet</span>}
        </div>

        <div className="h-px w-full bg-line" />

        <div className="flex flex-col gap-[2px]">
          <div className="mb-[4px] flex items-center gap-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">OUTLINE</span>
          </div>
          {outline.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => document.getElementById(h.id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}
              className="rounded-sm px-[6px] py-[2px] text-left text-[12px] text-muted transition-colors hover:text-ink"
            >
              {h.text}
            </button>
          ))}
          {outline.length === 0 && <span className="px-[6px] text-[11.5px] text-faint">Add ## headings to build an outline</span>}
        </div>

        <div className="h-px w-full bg-line" />

        <div className="flex flex-col gap-[2px]">
          <div className="mb-[4px] flex items-center gap-[4px]">
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">HISTORY</span>
          </div>
          {versions.slice(0, 4).map((v) => {
            const name = who(v.updatedBy)
            return (
              <div key={v.id} className="flex flex-col gap-[1px] px-[6px] py-[3px]">
                <span className="text-[12px] text-ink-2">
                  {name.charAt(0).toUpperCase() + name.slice(1)} · {longAgo(v.createdAt)}
                </span>
                <span className="text-[11px] text-faint">
                  v{v.version}
                  {v.note ? ` · ${v.note}` : ''}
                </span>
              </div>
            )
          })}
          {versions.length === 0 && (
            <span className="flex items-center gap-[4px] px-[6px] text-[11.5px] text-faint">
              <Check size={11} aria-hidden /> v{detail.version}
            </span>
          )}
        </div>
      </aside>
    </div>
  )
}
