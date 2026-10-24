import { useState } from 'react'
import {
  FileText,
  Plus,
  Search,
  Link2,
  Clock,
  Target,
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
  editedAgo: '2h ago',
  linkedTo: 'Passwordless login by Q4',
  body: `Ship passkeys to every user before the Nov 28 code freeze, in two waves. Owner: Dev. Approved by Dede on Nov 3.

**Wave 1 — web + iOS**

- Ship to staging Nov 10, to 10% of users Nov 12, to 100% Nov 14.
- Fallback stays on: password login remains for anyone without a passkey.
- Release notes reuse [[Launch checklist]].

**Wave 2 — Android**

The legacy WebView blocks WebAuthn, so Android gets a password fallback flow first. Two extra days, now due Nov 23.

- Risk tracked in [[Freeze exceptions policy]]

**Rollback**

Feature flag passkeys_enabled. Ops can flip it in under a minute; drill done Oct 18 (11 minutes end to end).`,
}

// ── Right panel: linked items ─────────────────────────────────────────────────

const LINKS_FROM_HERE = [
  { id: 'ln-1', title: 'Launch checklist', meta: 'Engineering / Q4 Launch · 12 items, 7 done', chief: false },
  { id: 'ln-2', title: 'Freeze exceptions policy', meta: 'Only P0 fixes after Nov 28, with Chief sign-off.', chief: true },
]

const LINKED_HERE = [
  { id: 'lg-1', title: 'Passwordless login by Q4', meta: 'Goal · 40% · Chief cites this doc in 3 check-ins', chief: false },
]

const DOC_OUTLINE = ['Wave 1 — web + iOS', 'Wave 2 — Android', 'Rollback']

const DOC_HISTORY = [
  { who: 'Dev',   time: '2h ago', note: 'Updated wave 2 timeline' },
  { who: 'Chief', time: '2d ago', note: 'Added rollback section' },
]

const PANEL_TABS = ['Links', 'Outline', 'Related', 'History'] as const
type PanelTab = (typeof PANEL_TABS)[number]

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

type DocMode = 'edit' | 'both' | 'read'

function DocViewer({ doc }: { doc: ActiveDoc }) {
  const [mode, setMode] = useState<DocMode>('read')
  const [panelTab, setPanelTab] = useState<PanelTab>('Links')

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
        {/* Doc head — byline · goal chip · spacer · Edit/Both/Read segmented (pen DBF9W) */}
        <div className="flex flex-col gap-[14px] px-[40px] pt-[24px]">
          <div className="flex items-center gap-[10px]">
            <Mascot size={18} radius={5} area="dev" />
            <span className="text-[12px] text-muted shrink-0">Dev · edited {doc.editedAgo}</span>
            <span className="inline-flex items-center gap-[6px] rounded-pill outline-1 -outline-offset-1 outline-line-strong bg-soft px-[10px] py-[3px]">
              <Target size={12} aria-hidden className="text-ok" />
              <span className="text-[12px] font-medium whitespace-nowrap text-ink-2">{doc.linkedTo}</span>
            </span>
            <div className="flex-1" />
            {/* Segmented: Edit · Both · Read */}
            <div className="flex gap-[2px] rounded-base bg-soft p-[2px]">
              {(['edit', 'both', 'read'] as const).map((m) => {
                const on = mode === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    aria-pressed={on}
                    className={`flex h-[22px] items-center rounded-sm px-[10px] text-[12px] font-medium capitalize transition-colors ${
                      on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : 'text-muted hover:text-ink-2'
                    }`}
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.6px] text-ink">
            {doc.title}
          </h1>
        </div>

        {/* Doc body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-[40px] pt-[20px] pb-[32px]">
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

      {/* Right panel — tabbed: Links / Outline / Related / History (pen IIxA0) */}
      <aside className="flex w-[260px] shrink-0 flex-col gap-[14px] overflow-y-auto border-l border-line px-[14px] py-[14px]">
        {/* Tabs */}
        <div className="flex gap-[2px] rounded-base bg-soft p-[2px]">
          {PANEL_TABS.map((t) => {
            const on = panelTab === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => setPanelTab(t)}
                aria-pressed={on}
                className={`flex h-[22px] flex-1 items-center justify-center rounded-sm text-[11.5px] font-medium transition-colors ${
                  on ? 'bg-surface text-ink shadow-[0_1px_2px_#00000014]' : 'text-muted hover:text-ink-2'
                }`}
              >
                {t}
              </button>
            )
          })}
        </div>

        {panelTab === 'Links' && (
          <>
            {/* Links from here */}
            <div className="flex flex-col gap-[4px]">
              <div className="flex items-center gap-[6px] px-[2px] pb-[2px]">
                <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKS FROM HERE</span>
                <span className="rounded-pill bg-soft px-[5px] text-[10px] text-muted">{LINKS_FROM_HERE.length}</span>
              </div>
              {LINKS_FROM_HERE.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="flex flex-col gap-[2px] rounded-sm px-[6px] py-[5px] text-left transition-colors hover:bg-hover"
                >
                  <span className="flex items-center gap-[6px]">
                    <FileText size={12} aria-hidden className="shrink-0 text-faint" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{d.title}</span>
                    {d.chief && <Mascot size={16} radius={4} area="brand" title="Chief" />}
                  </span>
                  <span className="text-[11px] text-faint">{d.meta}</span>
                </button>
              ))}
            </div>

            {/* Linked here */}
            <div className="flex flex-col gap-[4px]">
              <div className="flex items-center gap-[6px] px-[2px] pb-[2px]">
                <span className="text-[10.5px] font-medium tracking-[0.5px] text-faint">LINKED HERE</span>
                <span className="rounded-pill bg-soft px-[5px] text-[10px] text-muted">{LINKED_HERE.length}</span>
              </div>
              {LINKED_HERE.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className="flex flex-col gap-[2px] rounded-sm px-[6px] py-[5px] text-left transition-colors hover:bg-hover"
                >
                  <span className="flex items-center gap-[6px]">
                    <Target size={12} aria-hidden className="shrink-0 text-ok" />
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{g.title}</span>
                  </span>
                  <span className="text-[11px] text-faint">{g.meta}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {panelTab === 'Outline' && (
          <div className="flex flex-col gap-[2px]">
            {DOC_OUTLINE.map((h) => (
              <button
                key={h}
                type="button"
                className="rounded-sm px-[6px] py-[4px] text-left text-[12px] text-muted transition-colors hover:text-ink"
              >
                {h}
              </button>
            ))}
          </div>
        )}

        {panelTab === 'Related' && (
          <div className="flex flex-col items-center gap-[6px] px-[6px] py-[24px] text-center">
            <Link2 size={18} aria-hidden className="text-faint" />
            <span className="text-[12px] text-muted">No related docs yet</span>
            <span className="text-[11px] text-faint">Chief surfaces docs that cover the same work.</span>
          </div>
        )}

        {panelTab === 'History' && (
          <div className="flex flex-col gap-[6px]">
            {DOC_HISTORY.map((h, i) => (
              <div key={i} className="flex flex-col gap-[1px] px-[6px] py-[3px]">
                <span className="text-[12px] text-ink-2">{h.who} · {h.time}</span>
                <span className="text-[11px] text-faint">{h.note}</span>
              </div>
            ))}
          </div>
        )}
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
