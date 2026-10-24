import { useState } from 'react'
import {
  FileText,
  Plus,
  Search,
  Star,
  Link2,
  Clock,
  Tag,
  History,
  Eye,
  Edit3,
  Share2,
  MoreHorizontal,
} from 'lucide-react'
import { useParams } from '@tanstack/react-router'
import { useChannel } from '../../app/queries'
import { Button } from '../../ui/ds/Button'
import { Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'

const DEFAULT_CHANNEL_ID = 'ch-general'

// ── static doc data matching k1bhz.png ───────────────────────────────────────

interface DocItem {
  id: string
  title: string
  icon: string
  edited: string
  editor: string
  pinned?: boolean
  unread?: boolean
  status?: 'v1' | 'draft' | undefined
}

const DOC_SECTIONS: Array<{ label: string; docs: DocItem[] }> = [
  {
    label: 'IN ENGINEERING',
    docs: [
      { id: 'd-q4',       title: 'Q4 Launch',             icon: '📁', edited: 'now',       editor: 'Dev', pinned: true },
      { id: 'd-passkey',  title: 'Passkey rollout — v1',  icon: '📄', edited: 'now',       editor: 'Dev', status: 'v1', unread: true },
      { id: 'd-freeze',   title: 'Freeze exceptions',     icon: '📄', edited: 'just now',  editor: 'Dev', unread: true },
      { id: 'd-launch-cl',title: 'Launch checklist',      icon: '✅', edited: '2h',        editor: 'Chief' },
      { id: 'd-runbooks', title: 'Runbooks',              icon: '📁', edited: '3d',        editor: 'Dev' },
      { id: 'd-pg16-rb',  title: 'Postgres 16 rollback',  icon: '📄', edited: '3d',        editor: 'Dev' },
      { id: 'd-postmortem',title: 'Postmortem #482',      icon: '📄', edited: '1w',        editor: 'Chief' },
      { id: 'd-arch',     title: 'Architecture overview', icon: '📊', edited: '2w',        editor: 'Chief' },
    ],
  },
]

interface ActiveDoc {
  id: string
  title: string
  editor: string
  editedAgo: string
  linkedTo: string
  body: string
}

const ACTIVE_DOC: ActiveDoc = {
  id: 'd-passkey',
  title: 'Passkey rollout — v1',
  editor: 'Dev',
  editedAgo: '21h ago',
  linkedTo: 'Passwordless login by Q4',
  body: `Ship passkeys to every user before the Nov 28 code freeze, in two waves. Owner: Dev. Approved by Dede on Nov 5.

**Wave 1 — web + iOS**

- Ship in staging Nov 10, to 10% of users Nov 12, to 100% Nov 14.
- Fallback stays on; password login remains for anyone without a passkey.
- Release notes reuse [[Launch checklist]].

**Wave 2 — Android**

Every morning → find PRs idle 5 days → label stale and ping the author

Legacy Android blocks WebAuthn, so Android gets a password fallback flow first. Two extra days, now due Nov 23.

- Risk tracked in [[Freeze exceptions policy]]

**Rollback**

Feature flag passkeys_enabled. Ops can flip it in under a minute; drill done Oct 19 (11 minutes end-to-end).`,
}

// ── Right panel: linked items ─────────────────────────────────────────────────

const LINKED_DOCS = [
  { id: 'ln-1', title: 'Launch checklist',  meta: 'Q4 Launch · 12 items · 7 done' },
  { id: 'ln-2', title: 'Freeze exceptions policy', meta: 'After Nov 23, with Chief sign-off' },
]

const LINKED_GOALS = [
  { id: 'lg-1', title: 'Passwordless login by Q4', meta: 'Goal · 40%  · Cited in this doc as a check-in' },
]

// ── DocListItem ───────────────────────────────────────────────────────────────

function DocListItem({
  doc,
  active,
  onSelect,
}: {
  doc: DocItem
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onSelect}
      className={`flex w-full items-center gap-[8px] rounded-sm px-[8px] py-[5px] text-left transition-colors ${
        active ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      {doc.unread && (
        <span aria-label="unread" className="size-[6px] shrink-0 rounded-full bg-helper-brand" />
      )}
      <span className="text-[13px] shrink-0">{doc.icon}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[12.5px] ${
          active ? 'font-medium text-ink' : 'text-ink-2'
        }`}
      >
        {doc.title}
      </span>
      {doc.status && (
        <span className="shrink-0 rounded-pill bg-soft px-[6px] py-[1px] text-[10.5px] text-muted">
          {doc.status}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-faint whitespace-nowrap">{doc.edited}</span>
    </button>
  )
}

// ── DocViewer ─────────────────────────────────────────────────────────────────

function DocViewer({ doc }: { doc: ActiveDoc }) {
  const [mode, setMode] = useState<'read' | 'edit'>('read')

  // Render body: bold **text** and [[link]] as styled spans
  function renderBody(text: string) {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      if (line.startsWith('**') && line.endsWith('**')) {
        return (
          <p key={i} className="m-0 font-semibold text-ink text-[13.5px]">
            {line.slice(2, -2)}
          </p>
        )
      }
      if (line.startsWith('- ')) {
        const content = line.slice(2)
        return (
          <li key={i} className="text-[13.5px] text-ink-2 ml-[16px]">
            {renderInline(content)}
          </li>
        )
      }
      if (line === '') {
        return <div key={i} className="h-[8px]" />
      }
      return (
        <p key={i} className="m-0 text-[13.5px] text-ink-2">
          {renderInline(line)}
        </p>
      )
    })
  }

  function renderInline(text: string) {
    const parts = text.split(/(\[\[[^\]]+\]\])/g)
    return parts.map((part, i) => {
      if (part.startsWith('[[') && part.endsWith(']]')) {
        const label = part.slice(2, -2)
        return (
          <a key={i} href="#" className="text-link underline underline-offset-2" onClick={(e) => e.preventDefault()}>
            {label}
          </a>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* Doc main area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Doc topbar */}
        <div className="flex h-[44px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
          <div className="flex items-center gap-[6px] min-w-0 flex-1">
            <Mascot size={18} radius={5} area="dev" />
            <span className="text-[12px] text-muted shrink-0">Dev edited {doc.editedAgo}</span>
          </div>

          {/* View / Edit tabs */}
          <div className="flex gap-[2px]">
            {(['edit', 'read'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className="flex h-[26px] items-center gap-[4px] rounded-btn px-[8px] text-[12px] font-medium transition-colors"
                style={{
                  background: mode === m ? 'var(--color-hover)' : 'transparent',
                  color: mode === m ? 'var(--color-ink)' : 'var(--color-muted)',
                }}
              >
                {m === 'edit' ? <Edit3 size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                {m === 'edit' ? 'Edit' : 'Read'}
              </button>
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-[4px]">
            <button type="button" className="flex h-[26px] items-center gap-[4px] rounded-btn px-[8px] text-[12px] text-muted hover:text-ink transition-colors">
              <Star size={13} aria-hidden />
              Saves +3
            </button>
            <button type="button" className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
              <Share2 size={14} aria-hidden />
            </button>
            <button type="button" className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
              <Link2 size={14} aria-hidden />
            </button>
            <button type="button" className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors">
              <MoreHorizontal size={14} aria-hidden />
            </button>
          </div>
        </div>

        {/* Doc body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[40px] py-[32px]">
          <h1 className="mb-[20px] font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">
            {doc.title}
          </h1>
          <div className="flex flex-col gap-[6px]">{renderBody(doc.body)}</div>

          {/* Agent memory strip at bottom */}
          <div className="mt-[32px] flex items-center gap-[8px] rounded-base bg-soft px-[12px] py-[8px] outline-1 -outline-offset-1 outline-line-strong">
            <Mascot size={20} radius={5} area="brand" />
            <span className="text-[12px] text-muted">Agent memory is separate</span>
            <button type="button" className="ml-auto text-[12px] text-link hover:underline">
              Open the Knowledge View
            </button>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <aside className="flex w-[220px] shrink-0 flex-col gap-[16px] overflow-y-auto border-l border-line px-[14px] py-[16px]">
        {/* Links */}
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center gap-[4px] mb-[2px]">
            <Link2 size={12} aria-hidden className="text-faint" />
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKS</span>
            <span className="ml-auto text-[10.5px] text-faint">8</span>
          </div>
          {LINKED_DOCS.map((d) => (
            <button
              key={d.id}
              type="button"
              className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover"
            >
              <span className="text-[12px] text-ink-2">{d.title}</span>
              <span className="text-[11px] text-faint">{d.meta}</span>
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* Linked in this doc */}
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center gap-[4px] mb-[2px]">
            <Tag size={12} aria-hidden className="text-faint" />
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKED HERE</span>
            <span className="ml-auto text-[10.5px] text-faint">4</span>
          </div>
          {LINKED_GOALS.map((g) => (
            <button
              key={g.id}
              type="button"
              className="flex flex-col gap-[1px] rounded-sm px-[6px] py-[4px] text-left transition-colors hover:bg-hover"
            >
              <span className="text-[12px] text-ink-2">{g.title}</span>
              <span className="text-[11px] text-faint">{g.meta}</span>
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* Outline */}
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center gap-[4px] mb-[2px]">
            <FileText size={12} aria-hidden className="text-faint" />
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">OUTLINE</span>
          </div>
          {['Wave 1 — web + iOS', 'Wave 2 — Android', 'Rollback'].map((h) => (
            <button
              key={h}
              type="button"
              className="rounded-sm px-[6px] py-[3px] text-left text-[12px] text-muted transition-colors hover:text-ink"
            >
              {h}
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-line" />

        {/* Related / history */}
        <div className="flex flex-col gap-[6px]">
          <div className="flex items-center gap-[4px] mb-[2px]">
            <History size={12} aria-hidden className="text-faint" />
            <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">HISTORY</span>
          </div>
          {[
            { who: 'Dev',   time: '21h ago', note: 'Updated wave 2 timeline' },
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

// ── DocsPage ─────────────────────────────────────────────────────────────────

type DocsView = 'All' | 'By you' | 'By agents'

function DocsPage({ channelName }: { channelName: string }) {
  const [activeDocId, setActiveDocId] = useState<string>(ACTIVE_DOC.id)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<DocsView>('All')
  const views: DocsView[] = ['All', 'By you', 'By agents']

  const allDocs = DOC_SECTIONS.flatMap((s) => s.docs)
  const filtered = query
    ? allDocs.filter((d) => d.title.toLowerCase().includes(query.toLowerCase()))
    : allDocs

  return (
    <>
      <Topbar
        icon={FileText}
        title="Docs"
        meta={`in ${channelName} · 19 docs`}
        actions={
          <div className="flex items-center gap-[6px]">
            <Button variant="secondary" height={28} icon={Clock}>
              Recent
            </Button>
            <Button icon={Plus} height={28}>
              New doc
            </Button>
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: doc list panel */}
        <div className="flex w-[240px] shrink-0 flex-col gap-[8px] border-r border-line overflow-y-auto px-[8px] py-[10px]">
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

          {/* View tabs */}
          <div className="flex gap-[2px]">
            {views.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className="h-[24px] rounded-btn px-[7px] text-[11.5px] font-medium transition-colors"
                style={{
                  background: view === v ? 'var(--color-hover)' : 'transparent',
                  color: view === v ? 'var(--color-ink)' : 'var(--color-muted)',
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Doc list */}
          {query ? (
            <div className="flex flex-col gap-px">
              {filtered.map((doc) => (
                <DocListItem
                  key={doc.id}
                  doc={doc}
                  active={doc.id === activeDocId}
                  onSelect={() => setActiveDocId(doc.id)}
                />
              ))}
            </div>
          ) : (
            DOC_SECTIONS.map((section) => (
              <div key={section.label} className="flex flex-col gap-px">
                <div className="px-[10px] pb-[4px] pt-[2px]">
                  <span className="text-[10.5px] font-medium tracking-[0.8px] text-faint">
                    {section.label}
                  </span>
                </div>
                {section.docs.map((doc) => (
                  <DocListItem
                    key={doc.id}
                    doc={doc}
                    active={doc.id === activeDocId}
                    onSelect={() => setActiveDocId(doc.id)}
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* Right: doc viewer */}
        <DocViewer doc={ACTIVE_DOC} />
      </div>
    </>
  )
}

// ── DocsRoute ─────────────────────────────────────────────────────────────────

/**
 * Main content for /chat/$channelId/docs.
 * The sidebar and Inset wrapper are provided by ChatChannelLayout.
 */
export function DocsRoute() {
  const params = useParams({ strict: false })
  const channelId = params.channelId ?? DEFAULT_CHANNEL_ID
  const { data: channel } = useChannel(channelId)

  return <DocsPage channelName={channel?.name ?? '…'} />
}
