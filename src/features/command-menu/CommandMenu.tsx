/**
 * CommandMenu — global Cmd/Ctrl-K palette for Omilo v2.
 *
 * States covered (per design refs):
 *   • Closed       — nothing rendered
 *   • Open/empty   — Recent + Jump to + Actions (RGVME.png)
 *   • Typing       — grouped results with @ helpers / # channels (JdRi5.png)
 *   • Ask-Chief    — fallback when nothing matches (aNecq.png)
 *   • Action step  — "Hire helper" drill-in (dcWIN.png)
 *
 * Self-contained: no shared-file edits. Mount in Shell; open on Cmd/Ctrl-K.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import './command-menu.css'
import {
  Search,
  MessageSquare,
  FileText,
  ArrowLeft,
  ChevronRight,
  Zap,
  Users,
  Settings,
  Inbox,
  Activity,
  BarChart2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Mascot } from '../../ui/ds/Mascot'
import { accents }  from '../../ui/ds/accents'

import type { TabId, HireOption } from './data'
import { TABS, HIRE_OPTIONS, HIRED_OPTIONS } from './data'
import { search } from './search'
import type { HelperArea, ChannelAccent } from '../../core/domain/types'

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = 'palette' | 'hire-helper'

// ── Sub-components ────────────────────────────────────────────────────────────

function KbdHint({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-[2px]">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line-strong bg-soft px-[4px] font-mono text-[10px] text-muted"
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-[4px] pb-[2px] pt-[8px]">
      <span className="text-[10.5px] font-medium tracking-[0.9px] text-faint uppercase">{label}</span>
    </div>
  )
}

function ResultRow({
  leading,
  label,
  meta,
  trailing,
  selected,
  onClick,
}: {
  leading: React.ReactNode
  label: string
  meta?: React.ReactNode
  trailing?: React.ReactNode
  selected?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-[10px] rounded-sm px-[8px] py-[6px] text-left outline-none transition-colors ${
        selected ? 'bg-hover' : 'hover:bg-hover'
      }`}
    >
      <span className="flex shrink-0 items-center justify-center">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{label}</span>
        {meta && <span className="block truncate text-[11.5px] text-muted">{meta}</span>}
      </span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}

function HelperBubble({ area, size = 24 }: { area: HelperArea; size?: number }) {
  return <Mascot area={area} size={size} tile />
}

function ChannelTile({ accent }: { accent: ChannelAccent }) {
  const a = accents[accent]
  const Icon = a.icon
  return (
    <span
      className="inline-flex size-[24px] items-center justify-center rounded-xs"
      style={{ background: a.chipBg }}
    >
      <Icon size={13} style={{ color: a.color }} aria-hidden />
    </span>
  )
}

function PageIcon({ label }: { label: string }) {
  const map: Record<string, LucideIcon> = {
    Inbox,
    Flows: Activity,
    Team: Users,
    Goals: BarChart2,
    'Control panel': Settings,
  }
  const Icon = map[label] ?? FileText
  return (
    <span className="inline-flex size-[24px] items-center justify-center rounded-xs bg-soft">
      <Icon size={13} className="text-muted" aria-hidden />
    </span>
  )
}

function ActionIcon() {
  return (
    <span className="inline-flex size-[24px] items-center justify-center rounded-xs bg-soft">
      <Zap size={13} className="text-muted" aria-hidden />
    </span>
  )
}

function RecentIcon({ kind }: { kind: 'chat' | 'page' }) {
  const Icon = kind === 'chat' ? MessageSquare : FileText
  return (
    <span className="inline-flex size-[24px] items-center justify-center rounded-xs bg-soft">
      <Icon size={13} className="text-muted" aria-hidden />
    </span>
  )
}

// ── Footer ────────────────────────────────────────────────────────────────────

function PaletteFooter({ onAskChief }: { onAskChief: () => void }) {
  return (
    <div className="flex items-center gap-[12px] border-t border-line-strong px-[12px] py-[8px]">
      <span className="flex items-center gap-[4px] text-[11px] text-faint">
        <KbdHint keys={['↑', '↓']} />
        <span className="ml-[2px]">Navigate</span>
      </span>
      <span className="flex items-center gap-[4px] text-[11px] text-faint">
        <KbdHint keys={['↵']} />
        <span className="ml-[2px]">Open</span>
      </span>
      <button
        type="button"
        onClick={onAskChief}
        className="flex items-center gap-[4px] text-[11px] text-faint hover:text-muted"
      >
        <KbdHint keys={['⌘', '↵']} />
        <span className="ml-[2px]">Ask Chief</span>
      </button>
      <span className="flex-1" />
      <span className="text-[11px] text-faint">
        &gt; actions &nbsp;&nbsp; @ helpers &nbsp;&nbsp; # channels
      </span>
    </div>
  )
}

// ── Ask-Chief fallback ────────────────────────────────────────────────────────

function AskChiefFallback({
  query,
  onClose,
}: {
  query: string
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-[6px] px-[4px] py-[4px]">
      {/* Primary: Ask Chief */}
      <button
        type="button"
        onClick={onClose}
        className="flex w-full items-center gap-[10px] rounded-sm bg-hover px-[8px] py-[8px] text-left outline-none transition-colors hover:bg-[#E7E5E4D0]"
      >
        <Mascot area="brand" size={28} tile />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">Ask Chief</span>
          <span className="block truncate text-[11.5px] text-muted">
            &ldquo;{query}&rdquo;
          </span>
          <span className="block text-[11px] text-faint">
            Answers from your goals, flows, docs and chats. Opens in your Chief DM.
          </span>
        </span>
      </button>

      {/* Secondary: Ask in channel */}
      <button
        type="button"
        className="flex w-full items-center gap-[10px] rounded-sm px-[8px] py-[6px] text-left outline-none transition-colors hover:bg-hover"
      >
        <Mascot area="dev" size={28} tile />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] text-ink">Ask Grower in #marketing instead</span>
          <span className="block text-[11.5px] text-muted">Shared with the channel</span>
        </span>
      </button>

      {/* Closest document matches */}
      <SectionLabel label="Closest matches" />
      {[
        { label: '100 neighbourhoods', meta: 'Goal · 64% · sign-ups is a key result' },
        { label: 'Sign-up funnel notes', meta: 'Docs · Marketing' },
        { label: 'Why is the OTP step slow?', meta: '3d ago' },
      ].map((item) => (
        <button
          key={item.label}
          type="button"
          className="flex w-full items-center gap-[10px] rounded-sm px-[8px] py-[5px] text-left outline-none transition-colors hover:bg-hover"
        >
          <span className="inline-flex size-[24px] items-center justify-center rounded-xs bg-soft">
            <FileText size={13} className="text-muted" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-ink">{item.label}</span>
            <span className="block truncate text-[11.5px] text-muted">{item.meta}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

// ── Hire-helper step (action step — dcWIN.png) ────────────────────────────────

function HireHelperStep({ onBack }: { onBack: () => void }) {
  const [search, setSearch] = useState('')

  const filtered = HIRE_OPTIONS.filter(
    o => !search || o.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-col">
      {/* Step header */}
      <div className="flex items-center gap-[8px] border-b border-line-strong px-[12px] py-[10px]">
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="flex size-[28px] items-center justify-center rounded-sm text-muted transition-colors hover:bg-hover"
        >
          <ArrowLeft size={15} aria-hidden />
        </button>
        <span className="text-[13px] font-medium text-ink">Hire helper</span>
        <span className="flex-1" />
        <input
          autoFocus
          type="text"
          placeholder="Pick a role, or describe one..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
        />
      </div>

      {/* Scrollable list */}
      <div className="max-h-[320px] overflow-y-auto px-[8px] py-[8px]">
        <SectionLabel label="Ready to hire" />
        {filtered.map(o => (
          <HireOptionRow key={o.id} option={o} />
        ))}

        <SectionLabel label="Already on the team" />
        {HIRED_OPTIONS.map(o => (
          <HireOptionRow key={o.id} option={o} dimmed />
        ))}
      </div>

      {/* Step footer */}
      <div className="flex items-center gap-[8px] border-t border-line-strong px-[12px] py-[8px]">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-[4px] text-[11px] text-faint hover:text-muted"
        >
          <ArrowLeft size={11} aria-hidden />
          <span>Back</span>
        </button>
        <span className="flex-1" />
        <button type="button" className="text-[11px] text-faint hover:text-muted">
          Hire &amp; set a loop
        </button>
        <span className="text-[11px] text-faint">⌘ K</span>
        <button type="button" className="text-[11px] text-faint hover:text-muted">
          Ask Chief who to hire
        </button>
      </div>
    </div>
  )
}

function HireOptionRow({ option, dimmed }: { option: HireOption; dimmed?: boolean }) {
  const areaMap: Record<string, HelperArea> = {
    Retro: 'retro',
    Content: 'marketing',
    'Support · night shift': 'support',
    'Custom helper': 'brand',
    Builder: 'dev',
    Finance: 'finance',
  }
  const area = areaMap[option.label] ?? 'brand'

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-[10px] rounded-sm px-[8px] py-[6px] text-left outline-none transition-colors hover:bg-hover ${
        dimmed ? 'opacity-50' : ''
      }`}
    >
      <Mascot area={area} size={24} tile />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{option.label}</span>
        <span className="block truncate text-[11.5px] text-muted">{option.description}</span>
      </span>
      {option.price && (
        <span className="text-[11.5px] text-faint">{option.price} / mo</span>
      )}
      {dimmed && (
        <span className="text-[11px] font-medium text-faint">Hired</span>
      )}
    </button>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({
  active,
  onChange,
}: {
  active: TabId
  onChange: (id: TabId) => void
}) {
  return (
    <div className="flex items-center gap-[2px] border-b border-line-strong px-[10px]">
      {TABS.map(tab => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex h-[34px] items-center px-[8px] text-[12.5px] transition-colors ${
            active === tab.id
              ? 'border-b-2 border-ink font-medium text-ink'
              : 'text-muted hover:text-ink-2'
          }`}
          style={active === tab.id ? { marginBottom: -1 } : undefined}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ── Main palette ──────────────────────────────────────────────────────────────

function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [step, setStep] = useState<Step>('palette')
  const [askChief, setAskChief] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  const results = search(query, tab)
  const showAskChief = askChief || (query.trim().length > 2 && results.empty)

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (step === 'hire-helper') { setStep('palette'); return }
      onClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      setAskChief(true)
    }
  }, [step, onClose])

  if (step === 'hire-helper') {
    return <HireHelperStep onBack={() => setStep('palette')} />
  }

  return (
    <div className="flex flex-col" onKeyDown={handleKey}>
      {/* Search bar */}
      <div className="flex items-center gap-[10px] px-[12px] py-[12px]">
        <Search size={16} className="shrink-0 text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          aria-label="Search pages, chats, helpers — or ask Chief"
          placeholder="Search pages, chats, helpers — or ask Chief"
          value={query}
          onChange={e => { setQuery(e.target.value); setAskChief(false) }}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
        />
        {/* User avatar area */}
        <span className="inline-flex h-[26px] items-center gap-[6px] rounded-pill border border-line-strong px-[8px] text-[12px] text-ink-2">
          Sahabat Warga
        </span>
        <span className="text-[11px] text-faint">esc</span>
      </div>

      {/* Tab bar */}
      <TabBar active={tab} onChange={setTab} />

      {/* Results */}
      <div className="max-h-[340px] overflow-y-auto px-[8px] py-[6px]" role="listbox">
        {showAskChief ? (
          <AskChiefFallback query={query} onClose={onClose} />
        ) : query.trim() === '' ? (
          /* Empty state — recent + jump-to + actions */
          <EmptyState onHireHelper={() => setStep('hire-helper')} />
        ) : (
          /* Results state */
          <ResultsState results={results} />
        )}
      </div>

      {/* Footer */}
      <PaletteFooter onAskChief={() => setAskChief(true)} />
    </div>
  )
}

// ── Empty state (open with no query) ─────────────────────────────────────────

function EmptyState({ onHireHelper }: { onHireHelper: () => void }) {
  const { recent, pages, actions } = search('', 'all')

  return (
    <>
      <SectionLabel label="Recent" />
      {recent.map(r => (
        <ResultRow
          key={r.id}
          leading={<RecentIcon kind={r.kind} />}
          label={r.label}
          meta={r.meta}
        />
      ))}

      <SectionLabel label="Jump to" />
      {pages.map(p => (
        <ResultRow
          key={p.id}
          leading={<PageIcon label={p.label} />}
          label={p.label}
          meta={p.meta}
          trailing={
            p.badge !== undefined ? (
              <span className="text-[11.5px] text-muted">{p.badge}</span>
            ) : undefined
          }
        />
      ))}

      <SectionLabel label="Actions" />
      {actions.map(a => (
        <ResultRow
          key={a.id}
          leading={<ActionIcon />}
          label={a.label}
          meta={a.meta}
          trailing={a.shortcut ? <KbdHint keys={a.shortcut} /> : undefined}
          onClick={a.label === 'New chat' ? undefined : undefined}
        />
      ))}

      {/* Hire helper special row */}
      <ResultRow
        leading={
          <span className="inline-flex size-[24px] items-center justify-center rounded-xs bg-soft">
            <Users size={13} className="text-muted" aria-hidden />
          </span>
        }
        label="Hire a helper"
        trailing={<ChevronRight size={13} className="text-faint" aria-hidden />}
        onClick={onHireHelper}
      />
    </>
  )
}

// ── Typed results state ───────────────────────────────────────────────────────

function ResultsState({
  results,
}: {
  results: ReturnType<typeof search>
}) {
  return (
    <>
      {results.pages.length > 0 && (
        <>
          <SectionLabel label="Pages" />
          {results.pages.map(p => (
            <ResultRow
              key={p.id}
              leading={<PageIcon label={p.label} />}
              label={p.label}
              meta={p.meta}
            />
          ))}
        </>
      )}

      {results.recent.length > 0 && (
        <>
          <SectionLabel label="Chats" />
          {results.recent.map(r => (
            <ResultRow
              key={r.id}
              leading={<RecentIcon kind={r.kind} />}
              label={r.label}
              meta={r.meta}
            />
          ))}
        </>
      )}

      {results.actions.length > 0 && (
        <>
          <SectionLabel label="Actions" />
          {results.actions.map(a => (
            <ResultRow
              key={a.id}
              leading={<ActionIcon />}
              label={a.label}
              meta={a.meta}
              trailing={a.shortcut ? <KbdHint keys={a.shortcut} /> : undefined}
            />
          ))}
        </>
      )}

      {results.helpers.length > 0 && (
        <>
          <SectionLabel label={results.atMode ? 'Helpers' : 'Helpers'} />
          {results.helpers.map(h => (
            <ResultRow
              key={h.id}
              leading={<HelperBubble area={h.area} />}
              label={h.name}
              meta={h.role}
            />
          ))}
        </>
      )}

      {results.channels.length > 0 && (
        <>
          <SectionLabel label="Channels" />
          {results.channels.map(c => (
            <ResultRow
              key={c.id}
              leading={<ChannelTile accent={c.accent} />}
              label={`#${c.name}`}
              meta={c.meta}
              trailing={
                c.badge !== undefined ? (
                  <span className="text-[11.5px] text-muted">{c.badge}</span>
                ) : undefined
              }
            />
          ))}
        </>
      )}
    </>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────

/**
 * `<CommandMenu open onOpenChange />` — mount once in Shell.
 *
 * @example
 * // Shell.tsx
 * const [cmdOpen, setCmdOpen] = useState(false)
 * useEffect(() => {
 *   const handler = (e: KeyboardEvent) => {
 *     if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
 *       e.preventDefault(); setCmdOpen(o => !o)
 *     }
 *   }
 *   window.addEventListener('keydown', handler)
 *   return () => window.removeEventListener('keydown', handler)
 * }, [])
 * return (
 *   <>
 *     {children}
 *     <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
 *   </>
 * )
 */
export function CommandMenu({ open, onOpenChange }: CommandMenuProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Scrim */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px] data-[state=closed]:animate-[fadeOut_120ms_ease] data-[state=open]:animate-[fadeIn_120ms_ease]" />

        {/* Palette centered at ~25% from top */}
        <Dialog.Content
          aria-label="Command menu"
          className="fixed left-1/2 top-[22%] z-50 w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-dialog bg-surface shadow-[0_24px_64px_#0C0A0940] outline-1 -outline-offset-1 outline-line-strong data-[state=closed]:animate-[scaleOut_120ms_ease] data-[state=open]:animate-[scaleIn_120ms_ease]"
        >
          <Dialog.Title className="sr-only">Command menu</Dialog.Title>
          <Palette onClose={() => onOpenChange(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
